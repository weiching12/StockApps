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


## 版本號規則

App 版本號顯示在側欄底部與「設定」頁，格式為「主版本.次版本.修補版本」（MAJOR.MINOR.PATCH），只能由 `npm run deploy` 改動，不要手動編輯 `package.json` 的版本。每部署一次正式站就前進一次，升較高一層時，較低的數字歸零。

| 升級 | 指令 | 何時使用 | 例子 |
|---|---|---|---|
| 修補版本 | `npm run deploy`（預設） | 錯誤修正、文字或畫面微調、測試與文件、資料清理、效能改善、不改變結果的重構 | 0.2.49 → 0.2.50 |
| 次版本 | `npm run deploy -- --minor` | 使用者看得到的新功能或新頁面；研究模型或評分規則換版（例如 `entry-research-v4`）；新增 API 欄位或端點但舊用法仍可用；新增 D1 migration | 0.2.49 → 0.3.0 |
| 主版本 | `npm run deploy -- --major` | 既有 API 路徑、回應欄位或錯誤格式不再相容；已存資料無法再讀取；正式定版 1.0.0 | 0.3.4 → 1.0.0 |

- 同一次部署包含多種改動時，依最高的一項決定。
- 主版本維持 0 期間，表示仍在開發階段；API 的相容性仍以 `docs/rest-api.md` 與 `public/openapi.json` 為準，舊路由照常保留。
- 部署成功後，腳本在本機建立只含版本號的 commit「Release vX.Y.Z」；失敗或 `--dry-run` 會還原版本號。推送仍需手動執行 `git push origin main`。
- 要查某一版改了什麼，看 git 紀錄中該 Release commit 之前的 commit。
- App 版本號與其他版本各自獨立：研究模型（`entry-research-vN`）、摘要與研究快取版本、PWA 快取名稱、D1 migration 編號，各依自己的規則變更。研究模型換版時，App 通常同時升次版本。

## ETF 基金資料

- 資料表在 migration `0011_etf_info.sql`、`0012_etf_products.sql` 與 `0013_etf_holdings.sql`；部署前先套用：`npx wrangler d1 migrations apply stockapps-t86 --remote`（`npm run deploy` 發現有未套用的 migration 會拒絕部署）。
- 平日晚間市場資料發布後自動同步（`ETF_INFO_ENABLED=1`），每個市場日最多嘗試兩次、間隔 30 分鐘；排程日誌的 `etfInfo` 為 `complete`／`partial`／`delayed`，個別來源失敗另有 `etf-info-delayed` 事件並標明 `source`。
- 首次建立或需要手動補資料時執行 `node scripts/sync-etf-info.mjs --local|--remote`：使用與排程相同的解析規則，印出各來源筆數與**預估寫入量**後寫入 D1；單一來源失敗會略過該來源、其餘照常寫入。腳本只寫入有變動的列，已儲存的持股月份不會重抓。遠端預估超過 2 萬次寫入時會拒絕執行，確認當日額度（`npx wrangler d1 info stockapps-t86` 的 `rows_written_24h`，上限 10 萬）足夠後再加 `--allow-large`，或用 `--holdings-months N` 分天補。
- 每日同步只寫入有變動的列，執行紀錄 `etf_info_runs.Detail` 的 `written` 是該次實際寫入的資料列數（不含索引）。
- 成分股來自投信投顧公會月報，保留最近 13 個月：平常每晚只讀一次表單確認最新月份（`holdings` 為 0），有新月份時才多查約 17 個類別、需時約半分鐘，並刪除超出 13 個月的舊資料；公會網站無法連線或格式變動時保留既有月份。排程每次只補最新一個月，歷史月份由 `scripts/sync-etf-info.mjs` 一次回補（13 個月約需 8 分鐘，`--holdings-months N` 可只補最近 N 個月）。
- 折溢價來源（`mis.twse.com.tw`）不在 TWSE OpenAPI 目錄內，若格式變動或無法連線，畫面只會少掉折溢價與估算規模，其餘不受影響。
