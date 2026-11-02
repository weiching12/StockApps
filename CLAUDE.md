# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

株研 Stock Insight｜台股研究室 — a Traditional Chinese (zh-TW) Taiwan-stock research app. Vanilla JS/CSS/SVG frontend built with Vite, served by a Cloudflare Worker (Static Assets + KV + D1 + Durable Objects). Data comes from free TWSE whole-market endpoints (company/ETF lists, daily quotes, T86 institutional flows). Also ships as a PWA and a Capacitor iOS app. Production: https://stock-insight-tw.stock-insight-tw.workers.dev/

All user-facing text and `docs/*.md` / `README.md` are written in Traditional Chinese; code, comments and commit messages are in English (sentence-case imperative, no `feat:` prefix, e.g. "Keep research price and score metrics side by side on phones"). Taiwan convention: red = up, green = down.

## Commands

Node 22.12+ (or 24 LTS).

```bash
npm run dev                 # Vite at :5173, demo mode (simulated data, 14 stocks, fixed cutoff 2026-10-16)
npm run dev:cloudflare      # build:cloudflare + wrangler dev at :8787 (real API mode against local KV/D1)
npm test                    # all Node unit/integration tests (node --test tests/*.test.js, needs --experimental-sqlite)
node --experimental-sqlite --test tests/entry-score.test.js                 # single test file
node --experimental-sqlite --test --test-name-pattern="ATR" tests/entry-score.test.js  # single test
npm run test:e2e            # Playwright, tests/browser, auto-starts Vite :5173 (first run: npx playwright install chromium)
npx playwright test tests/browser/<file>.spec.js
npm run test:pwa            # build + tests/pwa-browser
npm run test:cloudflare     # tests/cloudflare-browser
npm run test:native         # tests/native-browser
npm run build               # dist/, demo mode
npm run build:cloudflare    # dist/, API mode (what deploy uses)
npm run build:native        # dist-native/, for Capacitor (STOCKAPPS_NATIVE_API_ORIGIN, HTTPS origin only)
npm run deploy              # scripts/deploy.mjs: bump patch version, build:cloudflare, wrangler deploy, then commit "Release vX.Y.Z" locally (restored on failure) — production, ask first
node scripts/deploy.mjs --dry-run   # build and wrangler --dry-run only; version restored, nothing committed
```

Runtime tests that spin up isolated workerd + SQLite DO storage (no production/TWSE access): `npm run test:sync-runtime`, `test:presence-runtime`, `test:auth-runtime`, `test:auth-proxy-runtime`, `test:t86-runtime`, `test:pwa-build-runtime`, `test:refactor-browser` (after `build:cloudflare`), plus `node tests/summary-cache-runtime.mjs`. `CHROMIUM_PATH` overrides the Playwright browser.

There is no linter configured; `git diff --check` is used as part of verification.

Local git note: this checkout's `.git` is owned by another Windows account, so git commands may need `git -c safe.directory=C:/Users/user/Desktop/budget_prj/StockApps ...` (scripts/deploy-ui.js already does this).

## Build modes

`vite.config.js` switches on `mode`:
- default → `VITE_DATA_MODE="demo"` (browser computes indicators from `src/data.js` simulated history)
- `cloudflare` → `VITE_DATA_MODE="api"`, frontend reads same-origin `/api/v1/*` only, never TWSE directly; production never falls back to demo data
- `native` → API mode against `__STOCKAPPS_API_ORIGIN__`, output `dist-native/`, no service worker

The PWA service worker (`sw.js`) is generated inside `vite.config.js` (not a source file). It caches the shell cache-first and selected market APIs network-first, honours `no-store`, and must never cache `/api/v1/auth/*`, presence or push config. Changing caching policy means editing the generator and bumping the cache name.

The Vite dev server proxies `/api/v1/auth`, `/api/v1/presence`, `/api/presence` to `127.0.0.1:8787`, so login/admin pages in `npm run dev` need `npm run dev:cloudflare` running.

## Architecture

### Layering (enforced by `tests/architecture-boundaries.test.js`)
- `shared/` — pure domain rules used by **both** browser and Worker (indicators/KD/MA, `entry-score.js`, sectors, sentiment, market coverage, compact codec, research tracking/review, corporate actions). Must not import from `src/` or `cloudflare/`. Put any rule that frontend and backend must agree on here; `src/indicators.js` and `src/market-codec.js` are compatibility re-exports.
- `cloudflare/services/` must not import `api/`; `cloudflare/repositories/` must not import `api/` or `services/`.
- `src/ui/*` must not call `fetch`; HTTP goes through `src/api/*` clients (`HttpClient` → `MarketApiClient`, `PresenceApiClient`, `PushApiClient`, …).
- Every `/api/v1` path in `public/openapi.json` must be routable via `cloudflare/api/routes.js` with the documented methods — update both together.

### Worker (`cloudflare/`)
`worker.js` sends `/api/*` to `api/router.js` and everything else to static assets. Request flow: `api/routes.js` (v1 + legacy path matching) → `api/validators.js` → controllers → services built in `composition.js` → repositories. Services throw `shared/domain-error.js` (code + message only); `api/errors.js` maps codes to HTTP status. Existing HTTP paths, response fields, cache headers and error envelopes are treated as a contract (legacy routes stay working).

Durable Objects (`wrangler.jsonc`):
- `MARKET_SYNC` (`sync/coordinator.js`) — single named object that serializes every scheduled sync phase; its SQLite storage is the **authoritative** checkpoint/manifest (not KV). Never publish KV heads outside it.
- `MARKET_SUMMARY` (`summary-coordinator.js`) — derived summary cache keyed by validated query options (6h TTL, 64-entry LRU, 16 MiB budget).
- `ONLINE_PRESENCE` (`presence.js`) — daily visits / admin visitor analytics.

### Scheduled data pipeline
Cron (weekdays, Taipei evening, see `wrangler.jsonc`) → `runScheduled` in `worker.js`:
1. `coordinateMarketSync` — phases in `cloudflare/sync/` (plan → acquire → snapshot → publish → cleanup). T86 is validated (date, 19-column schema, integer/formula checks, dynamic row-count thresholds from `T86_*_RATIO` vars) and upserted into D1 transactionally before KV shards are published; identical content hashes are not rewritten; failure keeps the last good version. 30-min cooldown, 3-failure ceiling.
2. Corporate-action sync (`corporate-actions/`).
3. When sync phase is `done`, idempotent research snapshot capture (`research-capture.js`) into D1.

Data rules to preserve: prices are **unadjusted**; missing/suspended data is never zero-filled; indicators/scores return null/insufficient rather than redistributing weights; ETFs are searchable/favoritable but excluded from sector rankings.

### Storage
- KV `MARKET_DATA`: published market manifest + 128 compact history shards (up to 260 trading days).
- D1 `T86_DB` (`stockapps-t86`): T86, market history, corporate actions, push subscriptions, research snapshots, auth. Migrations are append-only in `cloudflare/migrations/`; apply with `npx wrangler d1 migrations apply stockapps-t86 --local|--remote`.

### Frontend (`src/`)
`main.js` is the composition root: startup, data loading, render scheduling and cross-view event delegation. View modules in `src/ui/` receive models/formatters/callbacks and own only DOM. Favorites/settings live in `localStorage` (`ui/preferences.js`, with one-time migrations) or Capacitor Preferences in native (`src/native/`). Typography uses a fixed six-step scale (12/14/16/20/24/32px) centralised in `src/typography.css` — see `docs/typography.md`. Standalone pages in `public/` (`login`, `change-password`, `admin-visitors`) are plain HTML/JS.

### Scoring model
`shared/entry-score.js` (`entry-score-v1.2`) is the single entry-score model: five fixed-weight components gated by PASS/FAIL/UNKNOWN core conditions, requiring 61 consecutive trading days; any known corporate action in the window → no score. Summary API returns compact fields; per-stock Analysis API returns full evidence. Changing it requires bumping the summary cache version. Spec: `docs/entry-score.md`.

### Auth
Account login with D1-backed sessions (PBKDF2 hashes, HttpOnly SameSite=Strict cookie, role re-checked server-side). Users are created only via `node scripts/manage-user.mjs ... --local|--remote`; no self-signup or default accounts. See `docs/accounts.md`.

## Docs

`docs/` holds the authoritative design notes per subsystem (data-contract, sync-architecture, service-boundaries, frontend-architecture, t86-sync, history-storage, entry-score, sector-rules, visitor-analytics, accounts, native-ios, operations, cloudflare, rest-api). When changing behaviour in one of these areas, update the matching doc (in Chinese) and the README feature list if user-visible.
