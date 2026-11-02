# 株研 V2｜Phase 1 現況盤點與開發規劃

盤點基準：`main` @ `a58f195`（v0.2.1，2026-11-02）。本文件是 V2「波段進場研究與明日進場評估」的第一階段產出，只做盤點與規劃，未修改程式。需求書提到的 ASP.NET 在本 repository 不存在；後端全部是 Cloudflare Worker（`cloudflare/`），共用規則在 `shared/`，前端是 Vite 原生 JS（`src/`）。

## 1. 可直接沿用的既有能力

| 需求 | 既有實作 | 備註 |
| --- | --- | --- |
| 五大構面 PASS／FAIL／UNKNOWN | `shared/entry-score.js` `evaluateCoreConditions()` | 已是三態，UNKNOWN 不當 PASS、不補零 |
| MA5／20／60、KD、RSV | `shared/indicators.js` `analyzeHistory()` | 每日 bar 內含 |
| RVOL20、量價分類 | `getPriceVolumeSignal()` | |
| ATR14（Wilder） | `getAtr14()` | 需 15 根完整 OHLC |
| 近五日法人淨額 | `getInstitutionalNet()` | |
| 公司行動（除權息）查核與參考價調整 | `shared/corporate-actions.js`、D1 `corporate_action_*` | 未查核期間 V1.2 不給分 |
| 交易日曆 | manifest `dates`（市場實際交易日） | 不以日曆天計算 |
| 全市場每日研究快照 | `research-capture.js` → D1 `entry_score_snapshot_*` | 每日盤後於同步佇列內執行，冪等 |
| 盤後排程 | `worker.js` `runScheduled`：同步 → 公司行動 → 研究快照 | V2 新步驟接在研究快照之後 |
| 個股分析 API | `GET /api/v1/stocks/{symbol}/analysis` | 開啟評分視窗時才載入 |
| 市場摘要 API | `GET /api/v1/market/summary` | 全市場精簡欄位，經摘要快取 |

### V1.2 五大核心條件（V2 第一階段原樣沿用，不改門檻）

| 構面 | PASS 條件（全部成立） | UNKNOWN |
| --- | --- | --- |
| 趨勢結構 | 收盤 > MA20；MA20 > MA60；MA20、MA60 皆較前一交易日上升 | 61 日行情不完整或均線無效 |
| KD 動能 | K > D，且 K 未連續兩日下降 | 連續三日 KD 不完整 |
| 量價表現 | 未出現「跌幅超過 0.50% 且 RVOL20 ≥ 2」 | 漲跌幅或 RVOL20 缺 |
| 法人籌碼 | 近五日三大法人合計淨額 ≥ 0 | 五日任一天法人資料缺 |
| 基礎價格風險 | MA20 乖離 ≤ 10%，且前十日最低價 < 收盤 | 前十日低點、均線或 ATR14 缺 |

另有整體前提：截至評估日需連續 61 個市場交易日完整行情；60 日內的公司行動須已查核（可用參考價調整），否則整筆不評分。這些前提 V2 一併沿用。

## 2. 需要新增的部分

### 2.1 共用模組（`shared/`）
- `shared/entry-research.js`：`evaluateEntryResearch(input)` 單一入口，回傳 `gateResult`、`entryResearch`、`nextDayPlan`、`dataQuality`。第一階段直接呼叫 `evaluateCoreConditions()`，不複製規則。
- `shared/entry-research-model.js`：模型版本 `entry-research-v1`、50／30／20 權重、訊號與價格參數，全部集中、標記為「暫定、未經回測」。
- `shared/entry-research-outcome.js`：後續 1／5／10／20 日報酬、MFE、MAE、是否觸及失效價、模擬成交判斷（純函式，前後端與回測共用）。

### 2.2 資料表（新 migration，只新增不改舊表）
- `entry_research_samples`：每股每日每模型一列，主鍵 `(Symbol, TradeDate, ModelVersion)`。可查詢欄位獨立成欄（門檻結果、通過數、準備度、狀態、策略類型、明日評估、參考價、失效價、ATR14、資料品質），完整依據放在一個 JSON 欄位供明細顯示。索引：`(TradeDate, ModelVersion)`、`(ModelVersion, EntryStatus, TradeDate)`、`(ModelVersion, SetupType, TradeDate)`。
- `entry_research_outcomes`：每筆樣本的後續表現，狀態 `PENDING`／`COMPLETE`／`UNAVAILABLE`；只在第 1、5、10、20 個交易日寫入，避免每天更新全部歷史樣本。
- `entry_research_runs`：每日批次執行紀錄（模型版本、交易日、樣本數、失敗原因、重算紀錄）。

重算規則：同一 `(Symbol, TradeDate, ModelVersion)` 已存在即不覆蓋；需要重算時必須升模型版本或寫入新的 run 並保留原始列。

### 2.3 API（局部擴充）
- `analysis`：增加完整 `entryResearch` 物件（不移除既有 `entryScore`）。
- `market/summary`：每股增加精簡欄位（門檻通過數、準備度、研究狀態、明日評估、策略類型），並更新摘要快取版本。
- 新增 `GET /api/v1/research/samples`（日期區間、股票、狀態、策略、模型版本、分頁）。
- 新增 `GET /api/v1/research/backtest`（彙總統計、準備度分組、策略比較、權益曲線）。
- 同步更新 `public/openapi.json` 與 `cloudflare/api/routes.js`（架構測試會檢查）。

### 2.4 前端
- 市場觀察清單：新增「五大門檻」「進場準備度」「研究狀態」「明日評估」欄位與篩選；預設排序依需求書四組；手機改卡片式。
- 個股評分視窗：依需求書順序重排（明日評估主卡片置頂），既有 V1.2 內容移到「詳細分析」並明確標示為舊株研評分。
- 走勢圖：加標訊號日、回踩／突破參考價、進場參考價、價格上限、失效價（沿用現有 30 日圖資料，不額外載入）。
- 新增「策略回測」頁（導覽列第四項）。

## 3. 必須先知道的限制

1. **歷史行情只保留 260 個交易日**，而且 D1 只保留目前與上一個 generation。後續報酬必須在樣本產生後 20 個交易日內算完並寫入 outcomes 表，之後原始行情可能被淘汰。
2. **歷史回補有存活者偏差**：股票清單每天以當時上市名單為準，已下市股票的行情不會留在分片裡。用現有分片回補過去約 200 個交易日（扣掉 61 日暖機），只能涵蓋「目前仍上市」的股票。回補樣本要標記 `source = historical-recalculation`，回測頁預設排除或分開顯示；從上線日起每日保存的樣本才沒有這個偏差。
3. **沒有盤中與即時行情**：只有日 OHLC。明日評估只能是條件式計畫，以隔日開盤價判斷是否成交，不判斷盤中觸價先後。
4. **價格未還原**：只有在公司行動已查核、且可用除息參考價調整時才產生價格計畫；查核未完成時明日評估回傳 `DATA_INSUFFICIENT`。回測遇到持有期間有未查核的公司行動，該筆交易標記不可用，不計入績效。
5. **資料量**：目前 V1.2 研究快照每天約 1.9 MB、沒有清理機制；V2 樣本每天預估再增加約 1.5～2.5 MB。兩者合計一年約 0.9～1.1 GB，**超過 D1 免費方案的 500 MB 上限**，需要 Workers Paid（單一資料庫 10 GB），或決定 V1.2 快照的保留期限。正式資料庫目前約 61 MB。
6. **寫入量**：每日約 1,340 筆樣本，加上 outcomes 只在 4 個時間點寫入（約 5,400 列／日），在 D1 每日寫入上限內。

## 4. 需要你決定的策略參數（實作前確認）

以下是建議的初始值，全部會集中在 `entry-research-model.js`、標示為暫定，可以直接改：

| 項目 | 建議初始值 |
| --- | --- |
| 回踩恢復：回踩定義 | 近 5 個交易日內，任一日最低價 ≤ MA20 + 0.5 × ATR14，且收盤未低於 MA60 |
| 回踩恢復：觸發 | 今日收盤 > MA20，且收盤 > 前一交易日最高價，且 K 上升 |
| 整理突破：區間 | 前 20 個交易日（不含今日）最高價與最低價的區間振幅 ≤ 4 × ATR14 |
| 整理突破：觸發 | 今日收盤 > 區間上緣，且 RVOL20 ≥ 1.5 |
| 訊號有效期 | 觸發後 3 個交易日；收盤跌破失效價即失效 |
| 進場參考價 | 回踩：訊號日收盤；突破：區間上緣 |
| 可接受上限 | 進場參考價 + 0.5 × ATR14 |
| 失效價 | 回踩：回踩期間最低價 − 0.25 × ATR14；突破：區間上緣 − 1 × ATR14（取較高者不低於區間下緣） |
| 風險上限 | 進場上限至失效價 ≤ 8% |
| 進場準備度權重 | 五大構面強度 50％、訊號品質 30％、位置與時機 20％ |
| 回測成本 | 手續費雙邊 0.1425％、證交稅 0.3％（賣出）、滑價單邊 0.1％ |
| 回測出場 | 固定持有 5／10／20 日，或收盤跌破失效價隔日開盤出場 |

## 5. 建議開發順序與交付批次

| 批次 | 內容 | 可獨立驗收 |
| --- | --- | --- |
| A | Phase 2＋3：`shared` 研究引擎、價格計畫、完整單元測試 | 用固定測試資料驗證所有狀態 |
| B | Phase 4：migration、每日批次保存、outcomes 補算、樣本 API | 本機 workerd 執行一輪排程 |
| C | Phase 5-1／5-2：市場清單、個股視窗（桌面＋手機） | 瀏覽器測試與截圖 |
| D | Phase 5-4＋6：回測 API、回測頁、圖表、整合驗收 | 全部測試套件 |

每一批完成後先回報、確認再進下一批；不自行推送或部署。

## 6. 進度

- 批次 A（研究引擎、明日價格計畫）：已完成，規則見 [entry-research.md](entry-research.md)。
- 批次 B（每日樣本、後續表現、樣本 API）：已完成，尚未部署。正式啟用需先 `npx wrangler d1 migrations apply stockapps-t86 --remote` 套用 `0010_entry_research.sql`。歷史回補（`historical-recalculation`）尚未實作。
