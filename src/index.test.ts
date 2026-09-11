import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createCrawlerTracker } from '@jelto/crawler'

const options = { endpoint: 'https://analytics.example.test', apiKey: `jk_${'a'.repeat(43)}` }
function request(path = '/pricing?email=private@example.test#secret', ua = 'ChatGPT-User/1.0'): Request {
  return new Request(`https://example.test${path}`, { headers: { 'user-agent': ua, cookie: 'private-cookie', authorization: 'secret-auth', 'x-forwarded-for': 'private-address', 'x-forwarded-host': 'attacker.test' } })
}

test('wire contract strips query and fragment, ignores forwarding headers, and has no identity', async t => {
  const original = globalThis.fetch
  const sent: { url: string; init: RequestInit }[] = []
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init: init! }); return new Response('{}', { status: 202 }) }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  const req = request()
  assert.equal(tracker.trackResponse(req, new Response(null, { status: 200 })), true)
  assert.equal(tracker.trackRequest(req), false)
  await tracker.flush()
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.url, 'https://analytics.example.test/api/v1/crawls')
  const { init } = sent[0]!
  assert.equal(init.credentials, 'omit')
  assert.equal(init.redirect, 'error')
  const headers = new Headers(init.headers)
  assert.deepEqual([...headers.keys()].sort(), ['authorization', 'content-type'])
  assert.equal(headers.get('authorization'), `Bearer ${options.apiKey}`)
  const body = JSON.parse(String(init.body))
  assert.deepEqual(Object.keys(body), ['events'])
  assert.equal(body.events.length, 1)
  const event = body.events[0]
  assert.match(event.id, /^[0-9a-f-]{36}$/)
  assert.match(event.occurred_at, /Z$/)
  assert.deepEqual({ ...event, id: undefined, occurred_at: undefined }, {
    id: undefined, occurred_at: undefined, hostname: 'example.test', path: '/pricing', method: 'GET', user_agent: 'ChatGPT-User/1.0', status_code: 200,
  })
  for (const forbidden of ['private', 'secret', 'attacker', 'cookie', 'visitor', 'session', 'install', 'forwarded']) assert.equal(String(init.body).includes(forbidden), false)
})

test('request-only mode is status-unknown, explicit publicOrigin handles an internal URL', async t => {
  const original = globalThis.fetch
  const bodies: unknown[] = []
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response('{}', { status: 202 }) }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker({ ...options, publicOrigin: 'https://public.example.test' })
  assert.equal(tracker.trackRequest(new Request('http://internal:8080/robots.txt?token=hidden', { headers: { 'user-agent': 'Googlebot/2.1' } })), true)
  await tracker.flush()
  const body = bodies[0] as { events: Record<string, unknown>[] }
  assert.equal(body.events[0]!.hostname, 'public.example.test')
  assert.equal(body.events[0]!.path, '/robots.txt')
  assert.equal('status_code' in body.events[0]!, false)
})

test('prefilter preserves crawler discovery and content files but drops humans and assets', async t => {
  const original = globalThis.fetch
  let count = 0
  globalThis.fetch = async (_url, init) => { count += JSON.parse(String(init?.body)).events.length; return new Response('{}', { status: 202 }) }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  const documents = ['/robots.txt', '/sitemap.xml', '/sitemap.xml.gz', '/sitemaps/pages-1.xml.gz', '/llms.txt', '/llms-full.txt', '/docs/intro.md', '/docs/guide.pdf']
  for (const path of documents) assert.equal(tracker.trackRequest(request(path, 'Googlebot/2.1')), true, path)
  for (const path of ['/api/data', '/_next/static/chunk.js', '/assets/logo.svg', '/static/theme.css', '/font.otf', '/chunk.json', '/audio.wav']) assert.equal(tracker.trackRequest(request(path)), false, path)
  assert.equal(tracker.trackRequest(request('/human', 'Mozilla/5.0 Chrome/128 Safari/537.36')), false)
  assert.equal(tracker.trackRequest(request('/empty', '')), false)
  assert.equal(tracker.trackRequest(new Request('https://example.test/', { method: 'POST', headers: { 'user-agent': 'Googlebot' } })), false)
  await tracker.flush()
  assert.equal(count, documents.length)
})

test('the bandwidth filter admits every shared known and generic signature, even in a browser-shaped UA', async t => {
  // bots.yaml deliberately uses one flow mapping per signature. Read every
  // row, failing on an unfamiliar shape instead of silently skipping coverage.
  const catalog = readFileSync(new URL('../vendor/signatures/bots.yaml', import.meta.url), 'utf8')
  const block = catalog.split('\nsignatures:\n')[1]?.split('\ncategory_labels:\n')[0]
  assert.ok(block)
  const needles = block.split('\n').filter(line => line.trimStart().startsWith('-')).map(line => {
    const match = line.match(/^\s*-\s*\{\s*needle:\s*(?:"([^"]+)"|([^,]+)),/)
    assert.ok(match, `unreadable signature: ${line}`)
    return (match[1] ?? match[2]!).trim()
  })
  const generic = catalog.match(/^\s+generic_tokens:\s*\[([^\]]+)\]/m)
  assert.ok(generic)
  needles.push(...generic[1]!.split(',').map(token => token.trim()))
  assert.ok(needles.length)
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('{}', { status: 202 })
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  const missing: string[] = []
  for (const needle of needles) {
    if (!tracker.trackRequest(request('/catalog', `Mozilla/5.0 Chrome/128 Safari/537.36 ${needle.toUpperCase()}`))) missing.push(needle)
    await tracker.flush()
  }
  assert.deepEqual(missing, [], 'the SDK dropped server-recognized agents')
})

test('new answer-agent requests are delivered without broad provider-brand matches', async t => {
  const original = globalThis.fetch
  const sent: { user_agent: string }[] = []
  globalThis.fetch = async (_url, init) => { sent.push(...JSON.parse(String(init?.body)).events); return new Response('{}', { status: 202 }) }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  const tokens = ['Amzn-User', 'MistralAI-User', 'MistralAI-Index', 'MistralAI-Training', 'Kimi-User', 'Grok-DeepSearch', 'xAI-Grok', 'Qwen-User', 'meta-webindexer']
  const agents = tokens.map(token => `Mozilla/5.0 Chrome/128 Safari/537.36 ${token}/1.0`)
  for (const ua of agents) assert.equal(tracker.trackRequest(request('/article', ua)), true, ua)
  for (const token of ['ngrok/3.0', 'grokking/1.0', 'GrokBrowser/1.0', 'MyCopilotBrowser/1.0', 'Gemini/1.0', 'Kimi/1.0', 'Qwen/1.0', 'xai-client/1.0', 'Grok/1.0', 'Copilot/1.0']) {
    assert.equal(tracker.trackRequest(request('/article', `Mozilla/5.0 Chrome/128 Safari/537.36 ${token}`)), false, token)
  }
  await tracker.flush()
  assert.deepEqual(sent.map(event => event.user_agent), agents)
})

test('malformed paths and invalid hosts never poison an otherwise valid batch', async t => {
  const original = globalThis.fetch
  const sent: { hostname: string; path: string }[] = []
  globalThis.fetch = async (_url, init) => { sent.push(...JSON.parse(String(init?.body)).events); return new Response('{}', { status: 202 }) }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  for (const path of ['/invalid%', '/invalid%GG', '/invalid%FF', '/invalid%C0%AF', '/invalid%00', '/invalid%0A', '/invalid%0D', '/invalid%5C', '/%2Felsewhere', `/${'a'.repeat(2048)}`]) {
    assert.equal(tracker.trackRequest(request(path)), false, path)
  }
  for (const host of ['[::1]', 'invalid_host.test', 'bad..test', '-bad.test', `${'a'.repeat(64)}.test`]) {
    assert.equal(tracker.trackRequest(new Request(`https://${host}/`, { headers: { 'user-agent': 'Googlebot/2.1' } })), false, host)
  }
  assert.equal(tracker.trackRequest(request('/valid')), true)
  await tracker.flush()
  assert.deepEqual(sent.map(({ hostname, path }) => ({ hostname, path })), [{ hostname: 'example.test', path: '/valid' }])
})

test('path filtering uses one decoded path while the wire preserves encoded delimiters', async t => {
  const original = globalThis.fetch
  const sent: { path: string }[] = []
  globalThis.fetch = async (_url, init) => { sent.push(...JSON.parse(String(init?.body)).events); return new Response('{}', { status: 202 }) }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  for (const path of ['/%61pi/data', '/%5Fnext/data', '/%61ssets/image.svg', '/script%2Ejs']) assert.equal(tracker.trackRequest(request(path)), false, path)
  const paths = ['/docs/why%3F', '/docs/tag%23name', '/docs/%252Fexample', `/${'界'.repeat(2047)}`]
  for (const path of paths) assert.equal(tracker.trackRequest(request(path)), true, path)
  await tracker.flush()
  assert.deepEqual(sent.map(event => event.path), paths.map(path => new URL(path, 'https://example.test').pathname))
})

test('large valid Unicode paths are split into batches below the intake byte limit', async t => {
  const original = globalThis.fetch
  const batches: { bytes: number; events: unknown[] }[] = []
  globalThis.fetch = async (_url, init) => {
    const body = String(init?.body)
    batches.push({ bytes: new TextEncoder().encode(body).byteLength, events: JSON.parse(body).events })
    return new Response('{}', { status: 202 })
  }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  const paths = Array.from({ length: 20 }, (_unused, i) => `/${i}/${'🦋'.repeat(2040)}`)
  for (const path of paths) assert.equal(tracker.trackRequest(request(path)), true)
  await tracker.flush()
  assert.ok(batches.length > 1)
  assert.ok(batches.every(batch => batch.bytes <= 64 * 1024))
  assert.equal(batches.flatMap(batch => batch.events).length, paths.length)
})

test('failures retry exactly twice with the same event ID and normalized body', async t => {
  const original = globalThis.fetch
  const bodies: string[] = []
  globalThis.fetch = async (_url, init) => { bodies.push(String(init?.body)); return new Response('{}', { status: 503, headers: { 'Retry-After': '0' } }) }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  assert.equal(tracker.trackRequest(request()), true)
  await tracker.flush()
  assert.equal(bodies.length, 3)
  assert.equal(new Set(bodies).size, 1)
})

test('long Retry-After is respected by dropping instead of retrying early', async t => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }) }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  tracker.trackRequest(request())
  await tracker.flush()
  assert.equal(calls, 1)
})

test('each network attempt aborts after one second and exhausted timeouts resolve safely', async t => {
  const original = globalThis.fetch
  const signals: AbortSignal[] = []
  globalThis.fetch = async (_url, init) => {
    const signal = init?.signal as AbortSignal
    signals.push(signal)
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    throw new Error('unreachable')
  }
  t.after(() => { globalThis.fetch = original })
  // AbortSignal's native timer is unref'ed: keep the test runtime alive while
  // asserting it, just as a running customer's server does.
  const keepAlive = setInterval(() => {}, 100)
  t.after(() => clearInterval(keepAlive))
  const tracker = createCrawlerTracker(options)
  tracker.trackRequest(request())
  await tracker.flush()
  assert.equal(signals.length, 3)
  assert.ok(signals.every(signal => signal.aborted))
  assert.equal(new Set(signals).size, 3)
})

test('queues at most 100 observations, at most two requests, and batches at most 20', async t => {
  const original = globalThis.fetch
  const pending: (() => void)[] = []
  let active = 0
  let peak = 0
  let events = 0
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.ok(body.events.length <= 20)
    assert.ok(new TextEncoder().encode(String(init?.body)).byteLength <= 65536)
    events += body.events.length
    active++; peak = Math.max(peak, active)
    await new Promise<void>(resolve => pending.push(resolve))
    active--
    return new Response('{}', { status: 202 })
  }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  let accepted = 0
  for (let i = 0; i < 125; i++) if (tracker.trackRequest(request(`/page/${i}`))) accepted++
  assert.equal(accepted, 100)
  const done = tracker.flush()
  // An unresolved collector request has not blocked trackRequest or site work.
  await Promise.resolve()
  assert.equal(active, 2)
  while (pending.length || active) {
    for (const resolve of pending.splice(0)) resolve()
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  await done
  assert.equal(peak, 2)
  assert.equal(events, 100)
})

test('sustained automatic reporting keeps drain waiters bounded while refilling the queue', async t => {
  const originalFetch = globalThis.fetch
  const originalRace = Promise.race
  const pending: (() => void)[] = []
  let activeFetches = 0
  let peakFetches = 0
  let activeWaiters = 0
  let peakWaiters = 0
  let delivered = 0
  Promise.race = function<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>> {
    activeWaiters++
    peakWaiters = Math.max(peakWaiters, activeWaiters)
    const result = originalRace.call(Promise, values) as Promise<Awaited<T>>
    void result.then(() => { activeWaiters-- }, () => { activeWaiters-- })
    return result
  }
  globalThis.fetch = async (_url, init) => {
    const body = String(init?.body)
    const events = JSON.parse(body).events
    assert.ok(events.length <= 20)
    assert.ok(new TextEncoder().encode(body).byteLength <= 65536)
    activeFetches++
    peakFetches = Math.max(peakFetches, activeFetches)
    await new Promise<void>(resolve => pending.push(resolve))
    activeFetches--
    delivered += events.length
    return new Response('{}', { status: 202 })
  }
  const tracker = createCrawlerTracker(options)
  t.after(async () => {
    const done = tracker.flush()
    for (let turn = 0; turn < 10; turn++) {
      for (const resolve of pending.splice(0)) resolve()
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    await done
    globalThis.fetch = originalFetch
    Promise.race = originalRace
  })
  let accepted = 0
  for (let i = 0; i < 125; i++) if (tracker.trackRequest(request(`/initial/${i}`))) accepted++
  assert.equal(accepted, 100)
  await Promise.resolve()
  // Only normal no-context reporting runs during the sustained load. Finish
  // one batch and refill its capacity while the other fetch remains pending.
  for (let cycle = 0; cycle < 12; cycle++) {
    assert.equal(activeFetches, 2)
    pending.shift()!()
    await new Promise<void>(resolve => setImmediate(resolve))
    for (let i = 0; i < 20; i++) {
      assert.equal(tracker.trackRequest(request(`/refill/${cycle}/${i}`)), true)
      accepted++
    }
    assert.equal(tracker.trackRequest(request(`/overflow/${cycle}`)), false)
    assert.equal(accepted - delivered, 100)
  }
  assert.ok(peakWaiters <= 1, `reporting accumulated ${peakWaiters} concurrent drain waiters`)
  assert.equal(peakFetches, 2)
  const done = tracker.flush()
  for (let turn = 0; turn < 10; turn++) {
    for (const resolve of pending.splice(0)) resolve()
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  await done
  assert.equal(delivered, accepted)
  assert.equal(activeWaiters, 0)
})

test('concurrent manual and waitUntil flush callers share delivery and restart after idle', async t => {
  const original = globalThis.fetch
  const pending: (() => void)[] = []
  const delivered: string[] = []
  globalThis.fetch = async (_url, init) => {
    const paths = JSON.parse(String(init?.body)).events.map((event: { path: string }) => event.path)
    await new Promise<void>(resolve => pending.push(resolve))
    delivered.push(...paths)
    return new Response('{}', { status: 202 })
  }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  const work: Promise<unknown>[] = []
  const context = { waitUntil: (promise: Promise<unknown>) => { work.push(promise) } }
  for (let run = 0; run < 2; run++) {
    const previous = work.at(-1)
    for (let i = 0; i < 10; i++) tracker.trackRequest(request(`/run/${run}/${i}`), context)
    const done = tracker.flush()
    const manual = Array.from({ length: 10 }, () => tracker.flush())
    await Promise.resolve()
    for (const resolve of pending.splice(0)) resolve()
    await Promise.all([...work, ...manual, done])
    assert.ok(work.slice(run * 10).every(promise => promise === done))
    assert.ok(manual.every(promise => promise === done))
    assert.notEqual(done, previous, 'an idle tracker must start a new drain')
  }
  assert.equal(delivered.length, 20)
  assert.equal(new Set(delivered).size, 20)
})

test('an enqueue at drain settlement starts delivery before the old flush promise settles', async t => {
  const originalFetch = globalThis.fetch
  const originalRace = Promise.race
  const delivered: string[] = []
  const work: Promise<unknown>[] = []
  const tracker = createCrawlerTracker(options)
  let enqueueAtSettlement = true
  Promise.race = function<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>> {
    const result = originalRace.call(Promise, values) as Promise<Awaited<T>>
    // Schedule just after the drain resumes, before any separate finally
    // wrapper could clear a latch on its already-completed worker.
    void result.then(() => {
      if (!enqueueAtSettlement) return
      enqueueAtSettlement = false
      queueMicrotask(() => {
        tracker.trackRequest(request('/late'), { waitUntil: promise => { work.push(promise) } })
      })
    })
    return result
  }
  globalThis.fetch = async (_url, init) => {
    delivered.push(...JSON.parse(String(init?.body)).events.map((event: { path: string }) => event.path))
    return new Response('{}', { status: 202 })
  }
  t.after(() => { globalThis.fetch = originalFetch; Promise.race = originalRace })
  tracker.trackRequest(request('/first'))
  const first = tracker.flush()
  await first
  await Promise.all(work)
  assert.equal(work.length, 1)
  assert.notEqual(work[0], first)
  assert.deepEqual(delivered, ['/first', '/late'])
})

test('waitUntil owns delivery and does not change the customer response', async t => {
  const original = globalThis.fetch
  let release!: () => void
  globalThis.fetch = async () => { await new Promise<void>(resolve => { release = resolve }); return new Response('{}', { status: 202 }) }
  t.after(() => { globalThis.fetch = original })
  const work: Promise<unknown>[] = []
  const tracker = createCrawlerTracker(options)
  const response = new Response('customer content', { status: 404 })
  assert.equal(tracker.trackResponse(request(), response, { waitUntil: promise => { work.push(promise) } }), true)
  assert.equal(await response.text(), 'customer content')
  assert.equal(work.length, 1)
  release()
  await Promise.all(work)
})

test('only the user-agent header is read and a failing context stays best effort', async t => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('{}', { status: 202 })
  t.after(() => { globalThis.fetch = original })
  const req = request()
  const names: string[] = []
  Object.defineProperty(req, 'headers', { value: { get(name: string) { names.push(name); if (name !== 'user-agent') throw new Error('private header read'); return 'Googlebot/2.1' } } })
  const tracker = createCrawlerTracker(options)
  assert.equal(tracker.trackRequest(req, { waitUntil() { throw new Error('runtime finished') } }), true)
  await tracker.flush()
  assert.deepEqual(names, ['user-agent'])
})

test('connection check creates no traffic and reports failure as null', async t => {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    assert.deepEqual(JSON.parse(String(init?.body)), { hostname: 'example.test' })
    return new Response(JSON.stringify({ enabled: false, paused: false, verification: 'not_performed', checked_hostname: 'example.test' }))
  }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  assert.equal((await tracker.check('example.test'))?.verification, 'not_performed')
  await tracker.flush()
  assert.deepEqual(calls, ['https://analytics.example.test/api/v1/crawls/check'])
  globalThis.fetch = async () => { throw new Error('offline') }
  assert.equal(await tracker.check('example.test'), null)
})

test('unsafe endpoints and public keys fail at configuration, before any request work', () => {
  for (const endpoint of ['http://analytics.example.test', 'https://user:password@example.test', 'https://example.test?secret=x', 'https://analytics.example.test/base', 'https://analytics.example.test/base/']) assert.throws(() => createCrawlerTracker({ ...options, endpoint }), TypeError)
  assert.throws(() => createCrawlerTracker({ ...options, apiKey: 'prd_public' }), TypeError)
})

test('a batch never mixes hostnames; an unregistered host cannot sink another hostname\'s batch', async t => {
  const original = globalThis.fetch
  const posts: { hostname: string }[][] = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    posts.push(body.events.map((event: { hostname: string }) => ({ hostname: event.hostname })))
    return new Response('{}', { status: 202 })
  }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  for (let i = 0; i < 3; i++) assert.equal(tracker.trackRequest(new Request(`https://shop.example/page/${i}`, { headers: { 'user-agent': 'Googlebot/2.1' } })), true)
  assert.equal(tracker.trackRequest(new Request('https://other.test/', { headers: { 'user-agent': 'Googlebot/2.1' } })), true)
  await tracker.flush()
  assert.equal(posts.length, 2)
  assert.ok(posts.every(events => new Set(events.map(event => event.hostname)).size === 1))
  const shopBatch = posts.find(events => events[0]!.hostname === 'shop.example')
  const otherBatch = posts.find(events => events[0]!.hostname === 'other.test')
  assert.equal(shopBatch?.length, 3)
  assert.equal(otherBatch?.length, 1)
})

test('check() validates and normalizes its hostname argument before any request', async t => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ enabled: false, paused: false, verification: 'not_performed' })) }
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  assert.equal(await tracker.check('bad host!'), null)
  assert.equal(calls, 0)
})

test('the byte cap and control-character check run before the bandwidth regex', async t => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('{}', { status: 202 })
  t.after(() => { globalThis.fetch = original })
  const tracker = createCrawlerTracker(options)
  const oversized = `bot ${'a'.repeat(2048)}`
  assert.equal(tracker.trackRequest(request('/page', oversized)), false)
})

test('a fire-and-forget flush never escapes trackRequest as an unhandled rejection', async t => {
  const original = globalThis.fetch
  const originalRace = Promise.race
  globalThis.fetch = async () => new Response('{}', { status: 202 })
  Promise.race = () => { throw new Error('drain failure') }
  const rejections: unknown[] = []
  const onUnhandledRejection = (reason: unknown) => { rejections.push(reason) }
  process.on('unhandledRejection', onUnhandledRejection)
  t.after(() => {
    globalThis.fetch = original
    Promise.race = originalRace
    process.off('unhandledRejection', onUnhandledRejection)
  })
  const tracker = createCrawlerTracker(options)
  for (let i = 0; i < 20; i++) assert.equal(tracker.trackRequest(request(`/batch/${i}`)), true)
  // Give the microtask queue two turns to surface any unhandled rejection.
  await new Promise<void>(resolve => setImmediate(resolve))
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(rejections, [])
})

test('the browser entry throws at import time instead of shipping a server-only key client-side', async () => {
  await assert.rejects(import('../dist/browser.js'), TypeError)
})
