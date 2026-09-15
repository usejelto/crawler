# @jelto/crawler

Optional server crawler request reporting for Jelto. Node.js 22+ or a Fetch
runtime with Web Crypto and `AbortSignal.timeout`; zero runtime dependencies.

```ts
import { createCrawlerTracker } from '@jelto/crawler'

const crawlers = createCrawlerTracker({
  endpoint: 'https://your-jelto-api.example',
  apiKey: process.env.JELTO_CRAWLER_KEY ?? '',
  publicOrigin: 'https://example.com',
})

// Once the application has created the response:
crawlers.trackResponse(request, response, context) // context.waitUntil is optional
// A middleware without the final response uses trackRequest(request, context).
```

Use a server-held website key with only `crawlers:write`. Register your website
hostname, install the integration, then run `await crawlers.check('example.com')`
from the server while collection is disabled. After a successful check, enable
collection and save in **Settings → Traffic & usage → Server crawlers**. A check
creates no traffic. Refresh **Connection activity** to see when eligible crawler
requests have been received.

`trackRequest` and `trackResponse` return a boolean indicating whether the
in-memory queue accepted the observation. They never wait for network delivery.
`flush()` resolves once current queued work completes or exhausts its retries;
it does not guarantee delivery. Repeated use of the same Request is deduplicated.
`check(hostname)` returns connection evidence or null on failure.

The SDK reads only request URL/method/user-agent and optional response status.
No cookies, authorization, bodies, forwarding headers, IPs or browser identities
are copied. Query strings and fragments are stripped. Classification by user
agent is a claim, not verification; the server discards raw user agents.
Only GET/HEAD requests are eligible. The bandwidth filter preserves robots,
llms text, Markdown, PDF and sitemap files (including `.xml.gz`); it skips
API routes, framework internals and obvious assets. Invalid paths are dropped
before they can cause the server to reject other events in the same batch.

Memory is bounded at 100 events including in-flight work, 20 per batch, two
concurrent requests, one-second timeouts and two retries with unchanged IDs.
Long Retry-After values drop a batch rather than retry early. Server termination
and queue overflow can lose events; use waitUntil on short-lived runtimes and
flush on graceful Node shutdown. This is an optional best-effort analytics path.

The package is published on npm as `@jelto/crawler`; in your website project,
run `npm install @jelto/crawler`. To build from this repository root instead,
run `npm ci` and `npm pack`; packing rebuilds the exports and includes the
current installation guide. `npm run conformance` rebuilds and tests the
exported JavaScript; run it twice before release.

The tarball includes full framework, rotation, coverage and erasure instructions
in `GUIDE.md`, generated from the pinned `vendor/jelto/crawler.md` input.
The [public integration guide](https://jelto.io/docs/sdk/crawler) covers the same setup.

## Standalone development

Run `npm ci`, `npm run check`, `npm run conformance` twice, then `npm pack`
from this directory. The guide included in the tarball and the bot catalog used
by tests are versioned inputs in `vendor/jelto/`; their manifest records source
paths and checksums. Builds and tests need no documentation or backend checkout.
The source repository refreshes these inputs explicitly; do not edit the copies.

## Repository CI and releases

The component-owned workflows become active when this directory is the
repository root. CI runs local package tests; release CI additionally requires
conformance twice and the configured contracts pin where applicable.
See [RELEASING.md](https://github.com/usejelto/crawler/blob/main/RELEASING.md) for initial publication, trusted publishing,
version tags, and retries. Publishing stays disabled until explicitly configured.

## Community and license

Questions, bug reports and documentation improvements are welcome. See
[Support](https://github.com/usejelto/crawler/blob/main/SUPPORT.md),
[Contributing](https://github.com/usejelto/crawler/blob/main/CONTRIBUTING.md),
[Code of Conduct](https://github.com/usejelto/crawler/blob/main/CODE_OF_CONDUCT.md), and
[Security policy](https://github.com/usejelto/crawler/blob/main/SECURITY.md).
Contact [taha@jelto.io](mailto:taha@jelto.io) for anything else.

Jelto-owned software and associated documentation use the [MIT license](LICENSE).
Third-party materials retain their own terms, including the Contributor Covenant
attribution. Jelto names, logos, mascots and original brand artwork are excluded
from the software license; no trademark rights are granted.
