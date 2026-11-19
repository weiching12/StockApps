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
- `about.js`: purpose, current capabilities and future goals.

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

預設為玻璃風格：導覽列與上方麵包屑為毛玻璃，資料卡片接近不透明以保持數字與紅綠漲跌的可讀性；換頁時舊頁面模糊淡出、新卡片依序浮現，換產業、排行方式或時間範圍時列表各列模糊淡入，清單篩選選中後分離成獨立膠囊，指標說明有固定的章節列。設定頁可改選「經典」（原本的外觀），以及勾選「減少動畫與特效」關閉所有轉場、動畫與背景模糊（玻璃表面改為接近不透明），兩者都保存在 `stock-insight-v1`（`uiStyle`、`reduceEffects`）。系統開啟「減少動態效果」時，玻璃的轉場也會自動關閉。

實作：`src/glass-mode.js` 依設定切換 `html.glass-preview` 與 `html[data-effects="reduced"]`（網址 `?glass=1`／`?glass=0` 可強制開關以便比較）；樣式集中在 `src/glass-preview.css`，換頁轉場在 `glass-transition.js`（View Transitions API，不支援的瀏覽器直接切換）、列表刷新在 `glass-refresh.js`、指標說明章節列在 `glass-guide.js`。背景光暈放在固定的獨立圖層（不用 `background-attachment: fixed`），手機導覽列的模糊減半，以免捲動時重繪整頁。

寬視窗（1101px 以上）換頁時，主內容區快照的模糊淡出會大量掉格（1920×1080 實測切到市場觀察清單 1.5 秒只畫約 40～50 格，多次卡住 80～200 ms），因此寬視窗不使用 View Transition：舊頁面直接切換，新卡片改用不含模糊的 `glass-rise-in`（淡入加上移）；側欄底色接近不透明、下方只有靜止的背景光暈，模糊幾乎看不出來卻在換頁時每格重繪，所以寬視窗側欄只保留底色、不做背景模糊。修改後約 90 格、不再掉格。1100px 以下（手機、平板）維持原本的轉場與模糊。Playwright 版面測試預設以經典風格執行（`playwright.config.js` 的 `storageState`），玻璃預設值與設定由 `tests/browser/ui-style.spec.js` 驗證。
