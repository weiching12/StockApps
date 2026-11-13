# API contracts and sync telemetry

The OpenAPI 3.1 contract is available at `/openapi.json` and maintained in
`public/openapi.json`. It describes v1 resources, pagination/filter bounds, analysis
settings, HEAD behavior, heartbeat requirements and error envelopes. Existing API
schema 2 is independent of the HTTP API version. Contract tests exercise actual
router responses against the schema keywords used by this specification.

Each active sync phase emits `market-sync-metrics` to Cloudflare Workers Logs:
date/slot, phase, duration, failures, result, last-tick KV operations and cumulative
round KV operations. Attempts and failed operations are both counted. These are
application observations, not a replacement for Cloudflare billing analytics;
dashboard, CLI and other writers are outside this meter.

The latest aggregate is persisted privately in the coordinator's `metrics` key.
No public diagnostics endpoint exposes internal state, and telemetry never writes
market KV. Idle ticks do not save duplicate metrics. A telemetry storage failure is
logged as `sync-metrics-failed` but cannot undo a completed data checkpoint. Existing
`twse-sync-delayed` and API-read failure logs remain available for diagnosis.

Operational acceptance: confirm a subsequent evening round publishes/finishes,
review `market-sync-metrics` totals and `twse-sync-delayed` errors, and compare the
published generation in KV with the D1 manifest. Deployment itself does not fetch
today's TWSE report or claim a successful future Cron run.

## ETF 基金資料

- 資料表在 migration `0011_etf_info.sql`、`0012_etf_products.sql` 與 `0013_etf_holdings.sql`；部署前先套用：`npx wrangler d1 migrations apply stockapps-t86 --remote`（`npm run deploy` 發現有未套用的 migration 會拒絕部署）。
- 平日晚間市場資料發布後自動同步（`ETF_INFO_ENABLED=1`），每個市場日最多嘗試兩次、間隔 30 分鐘；排程日誌的 `etfInfo` 為 `complete`／`partial`／`delayed`，個別來源失敗另有 `etf-info-delayed` 事件並標明 `source`。
- 首次建立或需要手動補資料時執行 `node scripts/sync-etf-info.mjs --local|--remote`：使用與排程相同的解析規則，印出各來源筆數與**預估寫入量**後寫入 D1；單一來源失敗會略過該來源、其餘照常寫入。腳本只寫入有變動的列，已儲存的持股月份不會重抓。遠端預估超過 2 萬次寫入時會拒絕執行，確認當日額度（`npx wrangler d1 info stockapps-t86` 的 `rows_written_24h`，上限 10 萬）足夠後再加 `--allow-large`，或用 `--holdings-months N` 分天補。
- 每日同步只寫入有變動的列，執行紀錄 `etf_info_runs.Detail` 的 `written` 是該次實際寫入的資料列數（不含索引）。
- 成分股來自投信投顧公會月報，保留最近 13 個月：平常每晚只讀一次表單確認最新月份（`holdings` 為 0），有新月份時才多查約 17 個類別、需時約半分鐘，並刪除超出 13 個月的舊資料；公會網站無法連線或格式變動時保留既有月份。排程每次只補最新一個月，歷史月份由 `scripts/sync-etf-info.mjs` 一次回補（13 個月約需 8 分鐘，`--holdings-months N` 可只補最近 N 個月）。
- 折溢價來源（`mis.twse.com.tw`）不在 TWSE OpenAPI 目錄內，若格式變動或無法連線，畫面只會少掉折溢價與估算規模，其餘不受影響。
