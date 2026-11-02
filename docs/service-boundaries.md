# Application and API boundaries

## Public HTTP requests

`worker.js` dispatches APIs to `api/router.js`. The router applies the matched
resource's method/cache policy and delegates to a controller; it does not parse
business query options or construct stock/history representations.

- `api/routes.js`: v1/legacy resource matching and permitted methods.
- `api/validators.js`: URL query parsing, numeric bounds and date syntax.
- `api/market-controller.js`: invoke application services and adapt API representations.
- `api/presence-controller.js`: adapt the existing presence HTTP contract to v1.
- `api/errors.js`: domain-code to HTTP-status mapping and private-error sanitization.
- `composition.js`: assemble environment bindings, repositories and services.
- `services/market-service.js`: compose securities and published market data.
- `services/analysis-service.js`: analyze a saved session using plain options and shared rules.
- `services/history-service.js`: adapt saved stock history into the history resource representation.

`shared/domain-error.js` carries only a code and message. Application services do
not accept HTTP Request/Response or URLSearchParams, and errors do not contain an
HTTP status.
`composition.js` creates the Market, Analysis and History services and injects them
as one application-service collection at the router boundary.
Existing HTTP paths, response fields, cache headers and error envelopes remain.

## Summary caching and research persistence

The summary Durable Object keys only validated, effective query options. Parameter
ordering and ignored query values cannot create additional cache entries. Derived
responses have a six-hour TTL, a 64-entry LRU limit and a 16 MiB total payload budget;
alarms remove expired parts even without another request. The versioned transactional
index replaces the old unbounded cache on first use. Only the summary object's
derived cache is cleared; published KV history, D1 research and sync checkpoints are
not part of that storage. Oversized responses remain available without being cached.

Summary DO failures pass through the same awaited API error boundary as other
services. Research snapshot persistence is ancillary: failure keeps the market
response available with `meta.researchCapture: "failed"` and `Cache-Control: no-store`,
and prevents a persistent summary cache entry. Public summaries only check whether
their exact revision exists; research writes are explicitly enabled only inside the
serialized sync capture job. Later cron ticks retry persistence, and subsequent
requests become cacheable once that revision is saved. An existing research
revision counts as successfully saved. This prevents a delayed public request from
publishing an older generation after a newer capture.

Research API requests use the PWA data cache's network-first policy, not the shell
cache. A cache-policy version change clears old shells that may contain API data;
`no-store` responses do not overwrite the last cacheable response. Offline fallback
retains the `X-PWA-Cache: fallback` marker. Because the asset host answers unknown
paths with the SPA page, an HTML body for a script, stylesheet, image or other file
asset is never cached; such an entry left by an older worker is discarded and
refetched, and a version whose shell asset arrives as HTML fails to install so the
previous version stays active. Regression coverage includes real Chrome
Service Workers and `node tests/summary-cache-runtime.mjs` with isolated workerd and
SQLite-backed Durable Object storage.

## Shared rules and source adapters

`shared/sectors.js` owns sector grouping, ETF exclusion, complete-window summaries,
returns, rankings, TOP1 and constituent data. `ui/sectors.js` formats the resulting
model and owns DOM interaction only. See [sector rules](sector-rules.md).

`shared/market.js` owns coverage/history rules; `shared/market-codec.js` owns compact
encoding and symbol/shard identity. Browser and backend use the same modules.
`src/market-codec.js` remains a compatibility entry point.

TWSE HTTP and official-column parsing live in `adapters/twse.js`. Storage keys live
in `storage/market-keys.js`; API-link serialization lives in
`snapshots/market-format.js`. `twse.js` remains a facade for existing consumers.
The T86 transaction and optimistic concurrency guard stay in `t86-store.js`.

## Presence

`presence.js` preserves the Durable Object name/schema and handles HTTP, same-origin
policy, body byte limits and response mapping. `PresenceService` owns UUID
validation and Taipei-day boundaries; `PresenceRepository` owns synchronous SQLite
deduplication and count statements. There is no asynchronous boundary between cleanup,
recording a visit and counting.

## Verification

- Unit/contract tests preserve v1 and legacy status/body/header behavior.
- Sector regression tests compare prior behavior across dates/windows/sorts.
- TWSE fixture hashes include parsers, coverage, all 128 shards and the manifest.
- `npm run test:presence-runtime` uses isolated workerd/SQLite for daily visits and Taipei midnight reset.
- `npm run test:refactor-browser` (after `npm run build:cloudflare`) serves local
  fixed fixtures and verifies desktop/phone sectors, details, favorites and navigation.
- Set `CHROMIUM_PATH` when using an installed browser instead of Playwright's bundle.

No migration, market-data write, historical recalculation or new API resource is
needed for this refactor. Frontend v1 migration, remaining cross-view event handlers
and independent date-query history models are separate future changes.
Push subscription transport is handled by `api/push-controller.js`; validation,
VAPID payload creation and delivery live in `services/push-service.js`, while D1
persistence is isolated in `repositories/push-repository.js`.
