# Cloudflare 與 TWSE 免費資料

正式來源改為臺灣證券交易所，不需 API Token，也不呼叫 FinMind。一般 Vite 開發仍使用明確標示的示範資料。

## 資料範圍與來源

- 公司名錄：`https://openapi.twse.com.tw/v1/opendata/t187ap03_L`。2026-10-18 實測有 1,096 筆，包含官方名錄內的存託憑證；以每日實際回應為準，不固定檔數。不包含上櫃及 ETF。
- ETF 名錄：`https://www.twse.com.tw/rwd/zh/ETF/list?response=json`。以完整欄名讀取上市日期、代號與簡稱；雙幣櫃檯只取主要新臺幣代號，支援 `00632R`、`00981A` 等字母代碼，另以 `assetType: "etf"`、`sector: "ETF"`、`currency: "TWD"` 明確標記。法人買株不納入 ETF 的家數、金額、排行或產業明細。
- 每日價量：`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=YYYYMMDD&type=ALLBUT0999`。
- 每日三大法人：`https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=YYYYMMDD&selectType=ALLBUT0999`。
- 後兩項是證交所網站的 JSON 報表介面。`ALLBUT0999` 排除權證等大量無關商品，再以公司名錄精確篩選；不僅依代碼長度判斷股票。歷史行情兼容 `tables` 及 `fields9/data9` 格式。
- 外資不含外資自營商；投信獨立；自營商合併自行買賣與避險。資料單位為股，畫面才除以 1,000 換算成張。
- 未還原價格。新上市公司的歷史從上市日起算，資料不足時 KD／均線顯示資料不足。停牌、無一般交易 OHLC（可能仍有零股量）、法人未列出的資料均保留缺漏，不製造價格或填零。
- 2026-10-16 實測：1,096 家中 1,087 家有 OHLC、5 家無 OHLC、4 家未出現在行情表；有 OHLC 的公司中 13 家未列在 T86。完整名錄和缺漏名單存入 manifest 的 `coverage`，不把缺漏藏起來。
- 曾以證交所官方個股頁使用的 `/rwd/zh/IIH/company/foreign?code=1213&start=20261016&end=20261016` 交叉核對大飲：有股價資料，但法人 `categories` 與各 `series.data` 均為空。因此不把 T86 未列出的公司自動轉成零交易；此介面只作一次性驗證，不加入逐檔每日排程。

## 歷史回補（可中斷續接）

```powershell
npm.cmd run seed -- --end=2026-10-16 --sessions=90
```

預設首次回補最近 90 個市場交易日，初次約 180 次日報請求，加上少量休市日檢查與公司名錄請求，足以提供最近 30 日回看與 MA60 計算（新上市或停牌等個股缺漏除外）。往後每日累積，保留上限為 260 筆；不必首次就抓滿 260 日。按日期整批下載，所有網路請求單線、起始時間至少間隔 10 秒；不按個股下載。這是本專案自行採取的保守頻率，不是宣稱 TWSE 的官方額度。

下載立即快取於 `.wrangler/twse-cache/`，進度見 `progress.json`。遇到 HTTP 403／429、非 JSON、日期不符、欄名改變、筆數異常即停止，不自動密集重試。重新執行同一命令會沿用成功快取。週末不請求；平日僅在回傳明確「沒有符合條件的資料」時跳過。未發布的法人報表不當作零交易。

完成後輸出 `.wrangler/market-seed.json`：128 個壓縮欄位歷史分組與 1 個市場索引，共 129 個 KV key。原始與輸出資料均在 Git 忽略的 `.wrangler/`；不需任何行情來源憑證。

執行 `npm.cmd run verify:market` 可驗證全部公司與歷史格式、上市日期、資料日及涵蓋率，並輸出 `.wrangler/market-verification.json`。另可使用 `-- --calendars=.wrangler`，以已快取的 `calendar-2025.json`／`calendar-2026.json` 交叉檢查所有預定交易日是否完整；年度檔可從官方 `/rwd/zh/holidaySchedule/holidaySchedule?response=json&date=2025`（`date` 為西元年）取得，必須核對回應 `queryYear`，不能把預設的當年度資料當成歷史年度。臨時休市若不在年度表中，驗證會停止並列出日期供核對。

90 日首次下載耗時約 30 分鐘以上，取決於休市及網路延遲；已有快取可立即使用 `--offline` 重建輸出，不連 TWSE。若年度表未列休市日期，另快取官方 `/rwd/zh/afterTrading/FMTQIK?date=YYYYMM01&response=json` 為 `market-calendar-YYYYMM.json`；驗證器核對整個月份的實際成交日期，只有月報也確認沒有市場交易時才接受缺日。2026-07-10 已用七月份月報核對，不列為交易日。

## 本機正式模式

```powershell
npx.cmd wrangler kv bulk put .wrangler/market-seed.json --binding MARKET_DATA --local
npm.cmd run dev:cloudflare
```

開啟 `http://localhost:8787`。`/api/market` 回傳來源、公司名錄、交易日、涵蓋率及分組網址；`/api/market/版本/編號` 回傳不可變歷史分組；`/api/stocks/2330` 提供單檔展開格式便於檢查。公開 API 僅讀快取，不觸發 TWSE 請求。正式模式讀取失敗會顯示錯誤，不退回模擬資料。

## 今日造訪人數與欄位載入狀態

`ONLINE_PRESENCE` 沿用 `OnlinePresence` SQLite Durable Object 與既有 `visitors` 資料表。`GET /api/presence` 唯讀查詢；同源 `POST /api/presence` 在頁面載入時記錄隨機瀏覽器 UUID。到期時間固定為下一個台灣時間午夜；同一瀏覽器當日多分頁或重新整理只計一次，隔日首次造訪再計入新一天。前端在使用者操作觸發版本檢查時一併以 GET 更新顯示，一般檢查最多每 60 秒一次，手動按「檢查更新」則立即讀取；不再每分鐘發送心跳或定時更新。瀏覽器禁止儲存時以單頁隨機 UUID 降級，因此這是當日造訪瀏覽器的估計，並非精確自然人數。僅存 UUID 與到期時間，不保存 IP，也不占用行情 D1／KV。部署當日無法追溯部署前已離線的訪客，隔日起為完整日統計。

端點不快取、不允許跨站寫入；無法取得時顯示錯誤，不以 0 或舊數字冒充統計結果。`tests/presence.test.js` 驗證當日去重、台灣時間跨日重置、重建物件保留資料、異常輸入與跨站阻擋；瀏覽器測試驗證每日造訪計數與失敗狀態。

## 每日股票排程

每輪先驗證法人，再取得公司名錄、ETF 名錄及價量；各階段分開到不同 Cron 分鐘，不增加逐檔上游請求。公司與 ETF 各自檢查資料涵蓋率，ETF 不能掩蓋個股資料缺漏。數字代碼維持原分組；字母代碼採前後端共用的固定雜湊。

ETF 初次加入採最新資料先上線，從 2026-10-19 起逐日累積，原有 1,096 家公司歷史逐檔比對並完整保留。當日官方名錄中有 236 檔已上市新臺幣 ETF，235 檔有一般交易價量；未提供行情的標的仍保留缺漏，歷史不足不顯示假指標。`scripts/prepare-etfs.js` 驗證官方原始報表與五日筆數基準、準備新版分組及獨立索引檔；發布時先寫 128 組、等待傳播並驗證全部分組，確認舊索引未被其他排程變更後才切換。初次加入不重寫原股票歷史，也不將完整歷史重匯至正式 D1。

程式已改為台灣時間 18:30、20:30 兩輪，先以共用 T86DataValidator 驗證完整報表，再由 D1 交易式暫存／Upsert／版本紀錄保護，最後分批更新 KV。此程式版本需先完成 D1 migration 與初始基準確認，部署後才在正式站生效；完整規則、錯誤保護、狀態、歷史回補及操作步驟請看 [T86 同步](t86-sync.md)。

Cloudflare 的免費 KV 仍有每日 100,000 次讀取及 1 GB 容量限制；一次完整載入讀取 129 個 key，流量成長時須觀察用量，不代表網站可無限使用免費資源。Worker 亦有 CPU 限制，因此採小分組、跨 Cron 分批處理。

完整限制、目前用量與修改前檢查表見 [Cloudflare 免費方案限制](cloudflare-limits.md)（每次修改前必讀）。D1 免費方案另有三項限制：每日讀取 500 萬列、寫入 10 萬列，每次執行（含 Durable Object 的每個請求）最多 50 個查詢，單一資料庫 500 MB。目前設計：

- 行情分組階段每分鐘處理 32 組，前一版與本版已存的分組各用一個查詢讀取，加上 32 個寫入，共約 34 個查詢（原本每組 3 個、約 96 個）。
- 進場研究擷取以約 1 MB 為一組寫入，約 10 多個查詢；舊資料刪除走索引，只在有過期資料時執行。
- 策略回測與樣本列表依擷取版本快取，重複瀏覽不再重新彙總 D1（見 [進場研究](entry-research.md)）。
- Web Push 每次排程最多送 10 筆，其餘在下一分鐘繼續；瀏覽器推播尚未送完前，iOS 推播等到下一次，避免同一次排程的對外請求超過 50 個。
- 儲存空間：進場研究保留半年約 330～380 MB，T86 原始報表與版本紀錄目前沒有自動刪除，會逐日增加；合計接近免費方案單一資料庫 500 MB 上限時，需縮短研究保留期或清理舊 T86 原始資料。

## 部署

若只需發布介面，而正式站仍使用尚未啟用 D1 的 API，可先以 `npx.cmd wrangler deployments list` 核對線上版本對應的 Git commit，再執行 `npm.cmd run deploy:ui -- --backend-ref=<該GitSHA>`。此命令以目前介面建置 assets，沿用指定版本的 Worker、KV binding、Cron 與更新說明，不會啟用 D1。必須明確指定已核對的線上後端 commit，不會自動選舊版；支援 `--dry-run` 與 `--build-only`。發布來源紀錄保存在 `.wrangler/ui-release-*/release.json`。完整 T86／D1 上線仍須完成 [啟用步驟](t86-sync.md)。

先完成回補、單元／瀏覽器測試、本機正式模式及部署乾跑，再匯入雲端與部署。

```powershell
npx.cmd wrangler kv bulk put .wrangler/market-seed.json --binding MARKET_DATA --remote
npm.cmd run deploy
```

沿用既有 KV namespace，另需建立 D1 並完成 [T86 啟用步驟](t86-sync.md)；不需行情 Secret。上傳初始資料與 Worker 都使用 `twse:v2:` key，舊資料 key 不會與新資料混用。若需回退，舊 Worker 及舊 key 仍可復原。不要在初始歷史尚未準備好時部署至正式站。

### 2026-10-20 同步修正部署

- 正式 Worker 版本：`48ac6519-9b70-474f-9507-5cbb40bd0f03`；程式來源為 `ec9e542`，另補上正式 `T86_DB` 資料庫 ID。
- 已建立 `stockapps-t86` D1，原子套用 `0001_t86.sql`、`0002_t86_raw_chunks.sql`；官方 10 月 13、14、15、16、19 日報表經日期、完整欄位、算式、跨日筆數核對後，按確切 Hash 建立五日基準。
- 已部署平日台灣時間 18:30、20:30 兩輪排程。當日法人 Hash 相同仍更新公司名錄、價量及排定的歷史複查；相同法人資料不重寫 D1 逐股資料。
- 正式建置、75 項單元測試、隔離 workerd/D1 交易與回滾測試、Wrangler 部署乾跑通過。
- 部署後首頁 HTTP 200，正式 API 全部 128 個歷史分組及 2330 單檔 API 驗證通過：1,096 家公司、91 個市場交易日，公開資料截至 2026-10-19。沿用既有 KV；部署本身不會提前發布 10 月 20 日行情。
- 此紀錄確認部署、綁定、基準及公開資料可讀；部署當下尚未觀察到 10 月 20 日晚間新排程成功發布。

### 2026-10-18 上線驗證

- Worker 版本：`090a6e24-79ee-4158-80e7-a8ce98822e8e`；已部署上述 Cron。
- 初始資料：2026-06-08 至 2026-10-16，90 個市場交易日、1,096 筆公司名錄、97,854 筆個股歷史、129 個 KV key，未壓縮約 6.72 MiB。
- 日期完整性：年度休市表加官方七月份成交月報交叉核對通過，7 月 10 日無市場交易；個股缺漏不補零。
- 驗證：37 項單元測試、37 項既有瀏覽器測試、3 項本機真實資料測試及同 3 項正式網站測試均通過；正式網站已讀取 TWSE schema 2 與全部 128 個歷史分組，手機與桌面操作正常。
- 今天為週日，此紀錄確認部署及設定，不代表已觀察到下一個平日晚間排程執行。

本專案頻率控制不代表官方的服務承諾或授權聲明。介面可能調整，維護時參照 [TWSE OpenAPI](https://openapi.twse.com.tw/)、[三大法人日報](https://www.twse.com.tw/zh/trading/foreign/t86.html)、[網站使用條款](https://www.twse.com.tw/zh/terms/use.html)、[Cloudflare KV 限制](https://developers.cloudflare.com/kv/platform/limits/)與 [Cron 說明](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。


## KV operation budget

Temporary companies/catalog/prices/days keys expire after 24 hours; published shards,
manifest and sync state never expire. No manual temporary-key deletion is performed.
Legacy temporary keys are left untouched. Superseded public generations retain the
existing cleanup policy and current/previous generation protection.

Canonical SHA-256 fingerprints cover the complete normalized catalog and each validated
market day (OHLC, volume, institutional flows and coverage). Once a baseline manifest
has fingerprints, a matching round checks upstream data but skips shard writes,
manifest publication and generation cleanup. Missing fingerprints force publication;
Friday historical corrections and catalog changes are included in the comparison.
Fingerprints are retained only for the manifest's history window.

For one date and no failures, a coordinated changed round uses 133 KV writes and an unchanged
round 4. A normal changed/unchanged pair uses about 137 writes and up to 128 deletes,
versus approximately 288 writes and 272 deletes before this change. Historical rechecks,
backfills and retries increase usage. Sync progress is now persisted in the MarketSyncCoordinator Durable Object.
Existing D1 institutional audit/version storage and public snapshot switching remain.
Single-writer orchestration is implemented; see [sync architecture](sync-architecture.md).
Migrating full OHLC history into D1 remains future work.
