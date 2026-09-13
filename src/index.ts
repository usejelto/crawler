/** Server-only best-effort reporting. No cookies, IPs, forwarding headers or identities. */
export interface RuntimeContext { waitUntil(promise: Promise<unknown>): void }
export interface TrackerOptions { endpoint: string; apiKey: string; publicOrigin?: string }
export interface ConnectionCheck {
  enabled: boolean
  paused: boolean
  last_checked_at?: string
  checked_hostname?: string
  last_received_at?: string
  verification: 'not_performed'
}
interface CrawlEvent {
  id: string; occurred_at: string; hostname: string; path: string
  method: 'GET' | 'HEAD'; user_agent: string; status_code?: number
}
export interface CrawlerTracker {
  trackRequest(request: Request, context?: RuntimeContext): boolean
  trackResponse(request: Request, response: Response, context?: RuntimeContext): boolean
  flush(): Promise<void>
  check(hostname: string): Promise<ConnectionCheck | null>
}
const maxQueue = 100
const batchSize = 20
const encoder = new TextEncoder()
// This is a bandwidth filter, not a classifier. Keep it broad enough for every
// existing catalog signature (including browser-shaped agents); the server
// remains authoritative for names, categories and newly recognized crawlers.
const hints = new RegExp([
  'bot|crawl|spider|slurp|scanner|fetcher|http.?client',
  'chatgpt|claude|anthropic|perplexity|cohere|omgili|meta-external|bing|google|yandex|yisou',
  'amzn-user|mistralai-(?:user|index|training)|kimi-user|grok-deepsearch|xai-grok|qwen-user|meta-webindexer',
  'ahrefssiteaudit|barkrowler|screaming frog|seokicks|facebook|slack|whatsapp|telegram|discord|linkedin|pinterest|embedly|skypeuripreview|vkshare|mastodon|notion',
  'pingdom|statuscake|better ?uptime|site24x7|datadog|hetrixtools|nodeping|uptime-kuma|newrelicpinger|gtmetrix|freshping|cron-job\\.org',
  'censys|expanse|internetmeasurement|shodan|netsystemsresearch|paloaltonetworks|projectdiscovery|nuclei|zgrab|masscan|l9explore|leakix',
  'ia_archiver|wayback|heritrix|webrecorder',
  'curl|wget|python|aiohttp|httpx|okhttp|java/|axios|node-fetch|undici|libwww-perl|guzzlehttp|php/|httpie|postmanruntime|insomnia|deno/|bun/',
  'headlesschrome|-lighthouse|pagespeed|page speed insights|privacy preserving prefetch proxy|phantomjs|playwright|puppeteer|scrapy',
].join('|'), 'i')
const asset = /\.(?:css|js|mjs|cjs|map|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|mp3|wav|ogg|webm|zip|gz)$/i

function hostname(value: string): string | undefined {
  const host = value.toLowerCase().replace(/\.$/, '')
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) return undefined
  if (host.split('.').some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) return undefined
  return host
}

function eligiblePath(path: string): boolean {
  // Match the intake's single decode and character limit before enqueueing.
  // One invalid path would otherwise reject unrelated observations in a batch.
  const decoded = decodeURIComponent(path)
  if (!decoded.startsWith('/') || decoded.startsWith('//') || /[\\\0\r\n]/.test(decoded) || [...decoded].length > 2048) return false
  if (/^\/(?:api|_next|_nuxt|assets|static)(?:\/|$)/i.test(decoded)) return false
  // Compressed sitemap files are discovery documents, not download archives.
  const sitemap = /\.xml\.gz$/i.test(decoded)
  return sitemap || !asset.test(decoded)
}

function endpoint(value: string): URL {
  const u = new URL(value)
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' ||
    (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) {
    throw new TypeError('Jelto crawler endpoint must be HTTPS (HTTP loopback is allowed for development)')
  }
  return u
}
function retryDelay(response: Response | undefined, attempt: number): number {
  const raw = response?.headers.get('Retry-After')
  const seconds = raw ? Number(raw) : NaN
  const requested = Number.isFinite(seconds) ? seconds * 1000 : raw ? Date.parse(raw) - Date.now() : 250 * 2 ** attempt
  // A long server delay is respected by dropping this best-effort batch rather
  // than retrying early or retaining arbitrary work beyond the runtime lifetime.
  return Math.max(0, requested)
}
export function createCrawlerTracker(options: TrackerOptions): CrawlerTracker {
  if (typeof window !== 'undefined') throw new TypeError('Jelto crawler tracking belongs on the server')
  const base = endpoint(options.endpoint)
  if (!/^jk_[A-Za-z0-9_-]{43}$/.test(options.apiKey)) throw new TypeError('A server-held Jelto crawlers:write key is required')
  const apiKey = options.apiKey
  const publicHost = options.publicOrigin ? hostname(endpoint(options.publicOrigin).hostname) : undefined
  if (options.publicOrigin && !publicHost) throw new TypeError('Jelto crawler publicOrigin must have a valid website hostname')
  const ingestURL = new URL('/api/v1/crawls', base).href
  const checkURL = new URL('/api/v1/crawls/check', base).href
  const queue: CrawlEvent[] = []
  const inFlight = new Set<Promise<void>>()
  const seen = new WeakSet<Request>()
  let retained = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let draining: Promise<void> | undefined

  async function send(events: CrawlEvent[]): Promise<void> {
    const body = JSON.stringify({ events })
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response | undefined
      try {
        // manual: a redirect is never followed (the key must not travel to another
        // origin) and its 3xx is a final, non-retryable answer below. workerd rejects
        // redirect: error outright, so error would silently disable delivery there.
        response = await fetch(ingestURL, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual', signal: AbortSignal.timeout(1000),
        })
        if (response.ok || (response.status < 500 && response.status !== 429)) return
      } catch { /* The customer's response never depends on reporting. */ }
      if (attempt === 2) return
      const delay = retryDelay(response, attempt)
      if (!Number.isFinite(delay) || delay > 2000) return
      await new Promise<void>(resolve => setTimeout(resolve, delay))
    }
  }
  function flush(): Promise<void> {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
    if (draining) return draining
    // Install the shared promise before starting work. Repeated automatic,
    // waitUntil and manual flushes must not accumulate their own drain loops.
    draining = Promise.resolve().then(async () => {
      try {
        while (queue.length || inFlight.size) {
          while (queue.length && inFlight.size < 2) {
            // UTF-8 size, not JavaScript character count; every batch obeys 64 KiB.
            // A batch never mixes hostnames: a spoofed or unregistered host on
            // one event must not block delivery of another hostname's events.
            const events: CrawlEvent[] = []
            const head = queue[0]!.hostname
            for (let i = 0; i < queue.length && events.length < batchSize;) {
              const next = queue[i]!
              if (next.hostname !== head) { i++; continue }
              if (events.length && encoder.encode(JSON.stringify({ events: [...events, next] })).byteLength > 64 * 1024) break
              events.push(next)
              queue.splice(i, 1)
            }
            let job: Promise<void>
            job = send(events).catch(() => {}).finally(() => { retained -= events.length; inFlight.delete(job) })
            inFlight.add(job)
          }
          if (inFlight.size) await Promise.race(inFlight)
        }
      } finally {
        // Clear inside the worker, before it settles, so a late enqueue starts
        // new work instead of attaching to a finished drain.
        draining = undefined
      }
    })
    return draining
  }
  // A fire-and-forget flush must never surface as an unhandled rejection
  // inside the customer's request handler.
  function fireAndForget(): void { flush().catch(() => {}) }
  function track(request: Request, response?: Response, context?: RuntimeContext): boolean {
    try {
      if (seen.has(request) || retained >= maxQueue || (request.method !== 'GET' && request.method !== 'HEAD')) return false
      const ua = request.headers.get('user-agent') ?? ''
      if (!ua || encoder.encode(ua).byteLength > 1024 || /[\r\n\0]/.test(ua) || !hints.test(ua)) return false
      const u = new URL(request.url)
      const path = u.pathname
      if (!['https:', 'http:'].includes(u.protocol) || !eligiblePath(path)) return false
      const host = publicHost ?? hostname(u.hostname)
      if (!host) return false
      const event: CrawlEvent = { id: crypto.randomUUID(), occurred_at: new Date().toISOString(), hostname: host, path, method: request.method, user_agent: ua }
      if (response && response.status >= 100 && response.status <= 599) event.status_code = response.status
      seen.add(request); queue.push(event); retained++
      if (context) { try { context.waitUntil(flush()) } catch { fireAndForget() } }
      else if (queue.length >= batchSize) fireAndForget()
      else if (timer === undefined) timer = setTimeout(() => { timer = undefined; fireAndForget() }, 100)
      return true
    } catch { return false }
  }
  return {
    trackRequest: (request, context) => track(request, undefined, context),
    trackResponse: (request, response, context) => track(request, response, context),
    flush,
    async check(value) {
      const host = hostname(value)
      if (!host) return null
      try {
        const response = await fetch(checkURL, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ hostname: host }), credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual', signal: AbortSignal.timeout(1000),
        })
        if (!response.ok) return null
        return await response.json() as ConnectionCheck
      } catch { return null }
    },
  }
}
