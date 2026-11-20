# Frontend composition

`main.js` owns application startup, data loading, scheduling renders and event
coordination. Views receive explicit models/formatters/callbacks instead of fetching
data or creating independent copies of business rules.

HTTP access is isolated in `src/api`: `HttpClient` normalizes transport and API
errors, while `MarketApiClient` and `PresenceApiClient` own the versioned resource
paths. Providers, PWA refresh checks and presence lifecycle code depend on these
clients; view modules never call `fetch` directly.

- `ui/state.js`: fresh page/filter/settings state per application.
- `ui/preferences.js`: existing storage schema, defaults, migration and failure handling.
- `ui/shell.js`: shared shell markup and accessible navigation.
- `ui/navigation.js`: page visibility, headings, active navigation and date controls.
- `ui/home.js`: the home page's screening of the latest session (next-day candidates and stocks that cleared the gates).
- `ui/market.js`: sorting/filtering, row reuse and batched market table rendering.
- `ui/sectors.js`: the market list's sector chips, the chosen sector's institutional flows, sector ranking and constituent dialog rendering; ETFs stay excluded.
- `ui/controls.js`: segmented-control geometry and resize handling. `batch()` defers indicator measurement until a render finishes, so showing a page reads layout once instead of between every DOM change.

切換頁面時，`renderPage()` 先畫過期的產業選項再畫清單（清單高度取決於上方選項），整個過程只在最後量一次選項指示器位置。數字格式化共用 `Intl.NumberFormat`，不每次重建。以 1,300 檔、CPU 降速 4 倍量測，手機首次切到市場觀察清單的主執行緒阻塞由約 460 ms 降到約 220 ms。
- `ui/dialogs.js`: common dialog opening, backdrop dismissal and mobile drag dismissal.
- `ui/gestures.js`: input-mode tracking, pull-to-refresh and drag gesture primitives.
- `ui/keyboard.js`: sector-card and search keyboard navigation.
- `ui/search.js`: the search page: code and name matching over the latest session, shown as research rows.
- `ui/table-batches.js`: viewport-driven progressive table rendering.
- `about.js`: purpose, current capabilities and future goals（各目標的「目前階段」隨功能上線更新）。
- `ui/topbar.js`: the wider-layout top bar: search as you type and the data status. The status is the countdown to 18:30 while one is due, 「今日資料更新中」 from 18:30 on a weekday until that day's data is published, then the update time (with its date when it differs from the trading day).
- `ui/analysis-guide.js`: 株研分析說明 (see `docs/entry-research.md`).

頂部列與導覽（701px 以上才有頂部列）：
- 交易日選單（含更新通知鈴鐺）由 `placeDateControl()` 在頂部列與手機頁首之間搬移同一個元素；狀態文字排在選單正下方，頂部列維持單列。首頁與市場頁（清單、法人買株、ETF）讀所選交易日，所以顯示選單；自選與搜尋只讀最新一日，顯示文字。手機的市場頁首沒有空間，只在首頁選擇。
- 搜尋頁本身就是大搜尋框，頂部列隱藏（`.topbar.is-redundant`）；`/` 改為聚焦頁面的搜尋框。
- 1100px 以下側欄變成頂部導覽：四個頁面之外的策略回測、分析說明、指標說明、資料說明與設定收進「更多」選單；701～760px 用簡短頁名。導覽的層級高於頁面頂部列，選單不會被蓋住。
- 個股明細在桌機是非 modal 的側邊抽屜；若已有 modal 開著（法人買株的產業視窗），改以 modal 開啟，才會疊在上方。701～899px 的產業視窗為滿版高度的下拉視窗。

Application event delegation remains in the composition root because those actions
coordinate state, persistence and multiple views. View-specific presentation and
reusable DOM interactions stay in `src/ui`.
Indicator calculations live in `shared/indicators.js`; `src/indicators.js` is a
compatibility re-export. Server analysis uses the same rules, version `technical-v1`,
and explicitly reports unadjusted prices. No new strategy or backtest claim is added.

網頁建置的外部樣式表不阻塞首次繪製（`#app-styles`，由 `vite.config.js` 改寫），以縮短 iOS PWA
從啟動圖交給網頁時的白畫面；首次繪製所需的進場動畫與載入骨架樣式都內嵌在 `index.html`，
`main.js` 會等樣式表載入後才繪製 shell。原生建置不使用這個方式。

從主畫面開啟的 PWA 會播放品牌進場動畫，至少 1.8 秒；市場清單與首日摘要在動畫期間同時下載，動畫會等到資料抵達才淡出，因此進入頁面時首頁已載入完成。伺服器摘要快取剛失效（部署或每日同步後）時，第一次計算可能需要數秒；為避免請求卡住，動畫最多等待 10 秒，逾時後改由頁面內的載入狀態接手。

Browser selectors target sidebar navigation explicitly because About content has
its own navigation buttons. Tests should select the main content panel rather than
assuming only one market-related section exists.

## 介面風格（玻璃／經典）

預設為玻璃風格：導覽列與頂部列（搜尋與資料狀態）為毛玻璃，資料卡片接近不透明以保持數字與紅綠漲跌的可讀性；換頁時舊頁面模糊淡出、新卡片依序浮現，換產業、排行方式或時間範圍時列表各列模糊淡入，清單篩選選中後分離成獨立膠囊（同一段的選項相連，選中者兩側拉開 10px，切換時按鈕隨間隙移動；背後的水滴層 `src/ui/goo-pills.js` 以小數像素跟著按鈕，分開與合併時以水滴相吸的方式連接。為避免看起來發抖：每個選項邊框都是 1px、選中時不改字重而以描邊加粗、間隙開合不回彈、選中效果只淡入不縮放、濾鏡模糊半徑 3px 讓邊緣在分開時保持清楚），指標說明有固定的章節列。設定頁可改選「經典」（原本的外觀），以及勾選「減少動畫與特效」關閉所有轉場、動畫與背景模糊（玻璃表面改為接近不透明），兩者都保存在 `stock-insight-v1`（`uiStyle`、`reduceEffects`）。系統開啟「減少動態效果」時，玻璃的轉場也會自動關閉。

實作：`src/glass-mode.js` 依設定切換 `html.glass-preview` 與 `html[data-effects="reduced"]`（網址 `?glass=1`／`?glass=0` 可強制開關以便比較）；樣式集中在 `src/glass-preview.css`，換頁轉場在 `glass-transition.js`（View Transitions API，不支援的瀏覽器直接切換）、列表刷新在 `glass-refresh.js`、指標說明章節列在 `glass-guide.js`。背景光暈放在固定的獨立圖層（不用 `background-attachment: fixed`），手機導覽列的模糊減半，以免捲動時重繪整頁。

寬視窗（1101px 以上）換頁時，主內容區快照的模糊淡出會大量掉格（1920×1080 實測切到市場觀察清單 1.5 秒只畫約 40～50 格，多次卡住 80～200 ms），因此寬視窗不使用 View Transition：舊頁面直接切換，新卡片改用不含模糊的 `glass-rise-in`（淡入加上移）；側欄底色接近不透明、下方只有靜止的背景光暈，模糊幾乎看不出來卻在換頁時每格重繪，所以寬視窗側欄只保留底色、不做背景模糊。修改後約 90 格、不再掉格。1100px 以下（手機、平板）維持原本的轉場與模糊。Playwright 版面測試預設以經典風格執行（`playwright.config.js` 的 `storageState`），玻璃預設值與設定由 `tests/browser/ui-style.spec.js` 驗證。
