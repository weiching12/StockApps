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
- `ui/controls.js`: segmented-control geometry and resize handling.
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
