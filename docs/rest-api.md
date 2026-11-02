# REST API v1

## Architecture

`worker.js` is the platform entry point: static assets, API dispatch and Cron.
`api/router.js` coordinates routing, method/cache policy and HTTP error handling.
`api/routes.js` matches resources; controllers adapt representations and
`api/validators.js` parses URL options. `api/errors.js` maps domain codes to HTTP.
`services/market-service.js` owns market/stock composition and resource errors.
`repositories/market-repository.js` owns KV keys and reads. Services accept a repository
so storage can change without rewriting HTTP handlers. `api/http.js` owns JSON,
HEAD handling, cache headers and error envelopes.

Application services use plain data and domain errors without HTTP status.
Bindings are assembled in `composition.js`; detailed responsibilities and verification
are documented in [service boundaries](service-boundaries.md).

The existing sync orchestrator and T86 validation/store remain separate from public
queries. No public mutation endpoint starts ingestion, deletes data or changes settings.
Future research signals and backtests should use their own services and repositories,
with versioned API routes added only when those capabilities exist.

## Resources

| Method | Path | Response |
| --- | --- | --- |
| GET / HEAD | `/api/v1/market` | Published market manifest; chunk links point to v1 |
| GET / HEAD | `/api/v1/market/snapshots/{generation}/shards/{index}` | Immutable published shard |
| GET / HEAD | `/api/v1/stocks` | Paginated security metadata, including ETFs |
| GET / HEAD | `/api/v1/stocks/{symbol}` | Stock metadata and available history, existing snapshot format |
| GET / HEAD | `/api/v1/stocks/{symbol}/history` | `{data: [...], meta: {symbol, asOf, updatedAt, tradingDates}}` |
| GET / HEAD | `/api/v1/stocks/{symbol}/analysis` | Shared indicator rules, latest bar, signal, institutional summary, and up to 30 daily closes through `asOf` |
| GET / HEAD | `/api/v1/favorites/research` | Saved snapshots and sparse history through `asOf`, covering up to 120 market sessions; `asOf` remains limited to the latest 30 sessions |
| GET / POST | `/api/v1/presence` | Administrator-only month/day page-entry analytics and lifetime totals / record a page entry with an idempotent `visitId` (receipt only); same-origin protection retained |

The stocks collection supports `offset` (default 0), `limit` (default 100, 1–200),
`type=stock|etf`, exact `sector`, and case-insensitive `q` matching code/name.
It reads only the manifest and returns `{data, meta: {asOf, updatedAt, total, offset, limit}}`.
No filter fetches upstream data. History contains available sessions, not fabricated bars.

Research tracking compares each adjacent market-session pair from the saved join-date or first reliable baseline. Small changes are included; missing snapshots and incompatible settings remain explicit and are not bridged. The personal join date stays in local storage and is applied by the UI to the shared history.

Analysis accepts `asOf` (a saved market session), `period` (1–60), `kSmooth` and
`dSmooth` (1–20). It shares `shared/indicators.js` with the frontend, reports rule
version `technical-v1` and unadjusted prices, and excludes bars after `asOf`.
The machine-readable OpenAPI contract is published at `/openapi.json`.

Examples: `/api/v1/stocks?type=etf&limit=20`, `/api/v1/stocks/2330/history`.

Presence accepts `month=YYYY-MM` (default current Taipei month), optional `selectedDay=YYYY-MM-DD`
and `offset`. Repeated entries/reloads from the same browser count again. `daily[].visitors`
and its `visits` alias count page entries, not distinct browsers; `today.today` is today's
page-entry count. `unique` is retained solely for compatibility and is not displayed as
the browsing metric. `selectedDay` filters only `visitors[]` detail rows
and `detailTotal`; `total` and the daily trend retain the whole month. `overall.total` always
covers all retained events and `months[]` lists recorded months plus the current month.
POST `{id, visitId?, metadataOnly?}` requires UUID v4 IDs: new page entries use
new `visitId`; only delivery retries reuse that entry's key to prevent counting the same
delivery twice. Compatibility metadata-only writes require an existing owned event and never add a count.
The administrator's country column is derived from trusted Cloudflare IP geography:
`request.cf.country` takes priority, with `CF-IPCountry` as fallback. Codes normalize to
uppercase ISO alpha-2; unknown/special values are `null`. Client-submitted geography is
ignored; no self-reported nationality field is stored or returned by current event APIs.
Legacy id-only POSTs create a new event per request. Legacy date-range/history query parameters
remain supported. See [visitor analytics](visitor-analytics.md) for migration and count limits.

## Compatibility and errors

Existing `/api/market`, `/api/market/{generation}/{index}`, `/api/stocks/{symbol}`,
and `/api/presence` remain available for compatibility. The frontend uses `/api/v1`
through dedicated API clients; legacy paths are no longer part of its runtime data
flow. There is no storage migration or change to scheduled KV publication.

v1 errors use `{error: {code, message}}`; legacy errors retain `{error: message}`.
Codes include `INVALID_QUERY` (400), `NOT_FOUND` / `STOCK_NOT_FOUND` (404),
`METHOD_NOT_ALLOWED` (405), `DATA_UNAVAILABLE` (503), and `PRESENCE_ERROR`.
405 responses include `Allow`. HEAD returns the same status and policy as GET,
without a response body. Missing/unavailable snapshot keys retain legacy 503 behavior.
Errors and presence responses use `no-store`; mutable market resources cache for
60 seconds; immutable snapshot shards cache for 24 hours.

This first version keeps existing snapshot response formats where useful, rather
than forcing every endpoint into one envelope. API version v1 and stored
`schemaVersion: 2` describe different contracts.
## Push notifications

- `GET /api/v1/push/config` returns Web Push availability and the public VAPID key.
- `POST /api/v1/push/subscriptions` validates and stores a same-origin browser subscription.
- `DELETE /api/v1/push/subscriptions` removes the subscription by endpoint.

Subscriptions contain only the push endpoint and browser-generated encryption keys.
Endpoints must be HTTPS URLs (at most 1,024 characters, default port, no credentials) on a
browser push service: `fcm.googleapis.com`, `android.googleapis.com`,
`*.push.services.mozilla.com`, `web.push.apple.com` or `*.notify.windows.com`. Request
bodies are limited to 4 KiB even when streamed without `Content-Length`. Stored rows on
other hosts are removed at the next send instead of being contacted.
After a validated manifest for the current Taipei trade date is published, the sync
service sends one notification per subscription and trade date. Expired `404`/`410`
subscriptions are removed automatically. Push delivery failures never roll back the
market publication.

Account authentication: `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`, and `POST /api/v1/auth/change-password`. Session cookies are HttpOnly, Secure, SameSite=Strict and expire after 12 hours. Auth responses are never cached. Account objects include boolean `mustChangePassword`; temporary-password sessions must change their password before querying protected administrator statistics. The change endpoint accepts `{password, confirmPassword}`, requires an authenticated temporary-password session, rejects mismatched or reused passwords, and returns `{user}` with a rotated Session Cookie after storing a salted hash and revoking previous sessions. See [accounts](accounts.md) for provisioning and the `--temporary` option.
