import appPackage from "../../package.json" with { type: "json" };
import { RESEARCH_FILTER_CHIPS, RESEARCH_FILTERS } from "./entry-research.js";
import { backtestPanelMarkup } from "./backtest.js";
import { moodMeterMarkup } from "./sentiment.js";
import { sectorFilterOptions } from "./sectors.js";
import { RESEARCH_TRACKING_FILTERS, RESEARCH_TRACKING_SORTS } from "./research.js";

const appVersion = `v${appPackage.version}`;

export function shellMarkup({ dataset, state, isDemo, icon, loadingIcon, esc }) {
  return `
    <aside class="sidebar">
      <a class="brand" href="#main" data-home aria-label="返回市場觀察清單頂端"><span class="brand-mark">${icon("chart")}</span><span>株研<span class="brand-en">STOCK INSIGHT</span></span></a>
      <div class="nav-caption">WORKSPACE <span>研究工作台</span></div>
      <nav aria-label="主要導覽">
        <button class="nav-item active" data-page="market" aria-label="市場觀察清單">${icon("grid")}<span class="nav-label">市場觀察清單</span><span class="nav-label-mobile" aria-hidden="true">市場</span><span class="nav-dot"></span></button>
        <button class="nav-item" data-page="favorites" aria-label="株研追蹤">${icon("star")}<span class="nav-label">株研追蹤</span><span class="nav-label-mobile" aria-hidden="true">株研追蹤</span><span id="favorite-count" class="count-pill"></span></button>
        <button class="nav-item" data-page="sectors" aria-label="法人買株">${icon("chart")}<span class="nav-label">法人買株</span><span class="nav-label-mobile" aria-hidden="true">法人</span><span class="nav-dot"></span></button>
        <button class="nav-item" data-page="backtest" aria-label="策略回測">${icon("trend")}<span class="nav-label">策略回測</span><span class="nav-label-mobile" aria-hidden="true">回測</span><span class="nav-dot"></span></button>
        <button class="nav-item" data-dialog="methodology" aria-label="指標小百科">${icon("book")}<span>指標說明</span>${icon("chevron", "nav-chevron")}</button>
        <button class="nav-item" data-dialog="source" aria-label="資料說明">${icon("info")}<span>資料說明</span>${icon("chevron", "nav-chevron")}</button>
      </nav>
      <div class="sidebar-note"><span class="note-line"></span><p>看懂數據，<br>找到自己的節奏。</p><span>YOUR EDGE, YOUR PACE.</span></div>
      <div class="sidebar-bottom"><button class="nav-item" data-dialog="settings" aria-label="設定">${icon("settings")}<span>設定</span></button><div class="nav-more"><button class="nav-item nav-more-toggle" type="button" aria-label="更多選單" aria-haspopup="menu" aria-expanded="false" aria-controls="nav-more-menu">${icon("menu")}</button><div id="nav-more-menu" class="nav-more-menu" role="menu" aria-label="更多選單" hidden><button type="button" role="menuitem" data-dialog="methodology">${icon("book")}<span>指標說明</span></button><button type="button" role="menuitem" data-dialog="source">${icon("info")}<span>資料說明</span></button><button type="button" role="menuitem" data-dialog="settings">${icon("settings")}<span>設定</span></button></div></div><div class="workspace-status"><span class="status-dot"></span>${isDemo ? "前端示範版" : "每日收盤資料"} <span>${appVersion}</span></div></div>
    </aside>
    <div class="workspace">
      <header class="topbar"><div class="breadcrumb">研究工作台 ${icon("chevron")} <span id="breadcrumb-current">市場觀察清單</span></div><div class="topbar-actions"><span id="account-menu" class="account-menu"><a href="/login.html">登入</a></span><span id="online-count" hidden></span><span class="demo-badge"><span></span>${esc(dataset.info.label)}</span></div></header>
      <main id="main" tabindex="-1">
        <section class="page-heading"><div><div class="eyebrow" id="page-eyebrow">TAIWAN STOCK EXPLORER</div><h1 id="page-title">市場觀察清單<span class="heading-dot">.</span></h1><p id="page-description">比較全部標的的價量、技術指標與法人籌碼。</p></div><p id="research-date" class="research-date" hidden></p><div class="date-control"><label for="trade-date">${icon("calendar")}<span class="date-label-text">資料交易日</span></label><select id="trade-date">${dataset.dates
          .slice(-30)
          .reverse()
          .map(
            (date) =>
              `<option value="${date}">${date.replaceAll("-", "/")}</option>`,
          )
          .join(
            "",
          )}</select><div class="date-status"><button class="date-notification-button" type="button" data-dialog="settings" aria-label="開啟更新通知" aria-haspopup="dialog" hidden>${icon("bell")}</button><span id="update-countdown" class="update-countdown" role="timer" hidden></span></div></div></section>
        <div id="pull-refresh" class="pull-refresh" aria-hidden="true"><span></span>下拉重新整理</div>
        <div id="app-status" class="app-status" role="status" hidden><span></span></div>
        <div id="load-status" class="load-status" role="status" hidden><span></span><button class="text-button" id="reload-data" hidden>重新載入</button></div>
        <section id="watchlist" data-page-panel="favorites" aria-label="株研追蹤" hidden>
          <section class="research-center" aria-label="追蹤股票的進場研究"><div id="research-stats" class="research-stats"></div><div class="research-controls"><label>排序 <select id="research-sort">${RESEARCH_TRACKING_SORTS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label>篩選 <select id="research-filter">${RESEARCH_TRACKING_FILTERS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label></div><div id="research-list" class="research-list"></div></section>
        </section>
        <section id="market-sentiment" class="market-sentiment" data-page-panel="market" data-sentiment="unknown" aria-labelledby="sentiment-title">
          <div class="sentiment-card">
            <div class="sentiment-heading"><h2 id="sentiment-title">台股市場情緒</h2><span class="sentiment-date">資料更新中</span></div>
            <div class="sentiment-meter" title="株研建立的觀察指標，不是交易所官方指數">${moodMeterMarkup()}</div>
            <div class="sentiment-breadth"></div>
            <div class="sentiment-facts"></div>
          </div>
        </section>
        <section class="panel stocks-panel" data-page-panel="market" aria-label="市場觀察股票表格">
          <div class="table-toolbar"><div class="filter-tabs segmented-control" role="group" aria-label="清單篩選"><span class="segmented-indicator" aria-hidden="true"></span><button data-view="all" class="active" aria-pressed="true"><span class="filter-label-desktop">全部標的</span><span class="filter-label-mobile">全部</span></button><button data-view="favorites" aria-pressed="false"><span class="filter-label-desktop">我的自選</span><span class="filter-label-mobile">自選</span></button>${RESEARCH_FILTER_CHIPS.map(([value, label]) => `<button class="filter-chip-research" data-research-chip="${value}" aria-pressed="${state.research === value}" aria-label="${RESEARCH_FILTERS.find(([key]) => key === value)[1]}">${label}</button>`).join("")}<button data-view="above" aria-pressed="false">站上季線</button><button data-view="below" aria-pressed="false">季線之下</button><button data-view="oversold" aria-pressed="false" aria-label="K 值低於 20">K值低於20</button></div><div class="search-controls"><label class="search-box">${icon("search")}<input id="stock-search" type="search" placeholder="搜尋代碼或名稱" aria-label="搜尋股票代碼或名稱" autocomplete="off"/><kbd>/</kbd></label><select id="sector-filter" aria-label="產業篩選">${sectorFilterOptions(dataset.stocks, esc)}</select><select id="market-research-filter" aria-label="進場研究篩選">${RESEARCH_FILTERS.map(([value, label]) => `<option value="${value}"${state.research === value ? " selected" : ""}>${label}</option>`).join("")}</select><select id="market-sort" aria-label="清單排序"><option value="">預設：進場研究</option><option value="readiness">進場準備度</option><option value="changePercent">日漲跌幅</option><option value="volume">成交量</option><option value="symbol">股票代碼</option></select></div></div>
          <div class="signal-note">${icon("info")}<span>依資料日 KD 交叉與 MA20 趨勢判讀；${isDemo ? "模擬資料技術提示" : "技術提示僅供觀察"}，需搭配風險控管。</span><button class="text-button" data-dialog="signals">判讀規則 ${icon("chevron")}</button></div>
          <div class="table-scroll" tabindex="0" role="region" aria-label="股票觀察清單，可左右捲動"><table><caption class="sr-only">${isDemo ? "模擬股票行情" : "股票收盤行情"}、株研評分、KD 技術建議與三大法人買賣超。株研評分為固定研究策略的條件符合程度，並非買賣指令。日漲跌幅與前一交易日收盤價比較，成交量位於收盤價下方，以張表示。點選星號可加入或移除株研追蹤。</caption><colgroup><col class="favorite-column"/><col class="stock-column"/><col class="entry-column"/><col class="research-column"/><col class="price-column"/><col class="price-volume-column"/><col class="trend-column"/><col class="net-column-mobile"/><col class="change-column"/><col class="kd-column"/><col class="signal-column"/><col class="position-column"/><col class="net-column"/></colgroup><thead><tr><th scope="col"><span class="sr-only">自選</span></th><th scope="col">股票</th><th scope="col" data-sort-heading="readiness" aria-sort="none"><button data-sort="readiness"><span>進場準備度</span> ${icon("sort", "sort-icon")}</button></th><th scope="col" class="research-heading">進場研究</th>${[
            ["close", '<span class="close-label-desktop">收盤價</span><span class="close-label-mobile">收盤／漲跌</span>'],
            ["priceVolume", "今日量價"],
            ["trend", "趨勢判斷"],
             ["institutionalNetMobile", "法人買賣超"],
            ["changePercent", "日漲跌幅"],
            ["k", "K 值"],
            ["deviation", "與季線位置"],
            ["institutionalNet", "法人買賣超"],
          ]
            .map(
              ([key, label]) => {
                if (key === "priceVolume" || key === "trend") return `<th scope="col">${label}</th>`;
                const sortKey = key === "institutionalNetMobile" ? "institutionalNet" : key;
                const className = key === "institutionalNetMobile"
                  ? ' class="net-heading-mobile"'
                  : key === "institutionalNet"
                    ? ' class="net-heading-desktop"'
                    : "";
                return `<th scope="col"${className} data-sort-heading="${sortKey}" aria-sort="none"><button data-sort="${sortKey}">${label} ${icon("sort", "sort-icon")}</button></th>${key === "k" ? '<th scope="col" class="signal-heading">KD 技術建議</th>' : ""}`;
              },
            )
            .join(
              "",
            )}</tr></thead><tbody id="stock-rows"></tbody></table></div><div id="table-load-trigger" class="table-load-trigger" aria-hidden="true" hidden></div><div id="table-empty" class="empty-state" hidden>${icon("search")}<h3>沒有符合條件的股票</h3><p>試試其他關鍵字，或清除篩選條件。</p><button class="outline-button" id="reset-filters">清除篩選</button></div><div class="table-footer"><span id="table-summary"></span><span>點選星號，即時更新我的自選 ${icon("star")}</span></div>
        </section>
        <section id="sector-page" class="sector-page panel" data-page-panel="sectors" aria-label="法人買株排行榜" hidden>
          <div class="sector-toolbar"><div class="sector-sort-control"><span>排行方式</span><div class="sector-sort-tabs segmented-control" role="group" aria-label="排行方式"><span class="segmented-indicator" aria-hidden="true"></span><button data-sector-sort="activity-desc" aria-pressed="true" title="依法人買賣合計金額占全市場的比重排序">交易量</button><button data-sector-sort="net-desc" aria-pressed="false">買超</button><button data-sector-sort="net-asc" aria-pressed="false">賣超</button></div></div><div class="sector-period-control"><span>時間範圍</span><div class="sector-period segmented-control" role="group" aria-label="法人買株累計區間"><span class="segmented-indicator" aria-hidden="true"></span><button data-sector-window="day" aria-pressed="true">當日</button><button data-sector-window="5" aria-pressed="false">5 日</button><button data-sector-window="20" aria-pressed="false">20 日</button></div></div></div>
          <div class="sector-ranking-head" aria-hidden="true"><span>產業排名</span><span id="sector-change-label">當日平均漲跌</span><span>法人淨買賣超金額</span></div>
          <div id="sector-grid" class="sector-grid sector-ranking"></div>
          <p class="sector-note">金額以億元顯示，張數為輔。金額依各股每日法人淨買賣股數 × 當日收盤價累計，非實際成交金額。TOP1 百分比為該個股的區間漲跌幅；點選產業可同時查看當日、5 日、20 日買賣超。僅統計目前研究標的。</p>
        </section>
        ${backtestPanelMarkup()}
        <footer class="page-footer"><span class="footer-brand">株研 <span>STOCK RESEARCH</span></span><span>技術提示僅供研究參考。</span><button data-dialog="source">關於株研 ${icon("arrow")}</button></footer>
      </main>
    </div>
    <dialog id="info-dialog" aria-labelledby="dialog-heading"><div class="info-dialog-handle" role="button" tabindex="0" aria-label="關閉個股明細，可向下拖曳"></div><div class="dialog-top"><span class="eyebrow">STOCK INSIGHT</span><button class="icon-button" id="close-dialog" aria-label="關閉視窗">${icon("close")}</button></div><div id="dialog-content"></div><section id="settings-notifications" class="settings-notifications" hidden><div><strong>資料更新通知</strong><span>每日資料完成更新後通知你</span></div><button class="outline-button push-nav-item" id="push-notifications" type="button" aria-label="開啟每日資料更新通知" aria-pressed="false">${icon("bell")}<span>開啟更新通知</span></button><div class="app-version-control"><strong class="settings-version-title">版本更新</strong><button class="outline-button" id="check-update" type="button">檢查更新</button><span id="app-version" class="app-version" aria-label="目前版本 ${appVersion}">${appVersion}</span></div><p id="update-check-status" class="update-check-status" role="status" aria-live="polite" hidden></p></section></dialog>
    <dialog id="sector-dialog" class="sector-dialog" aria-labelledby="sector-dialog-heading" aria-describedby="sector-dialog-meta"><div class="sector-dialog-handle" role="button" tabindex="0" aria-label="關閉產業明細，可向下拖曳"></div><header class="institution-dialog-top sector-dialog-top"><div><span class="eyebrow">SECTOR INSTITUTIONAL FLOWS</span><h2 id="sector-dialog-heading">產業法人買賣超</h2><p id="sector-dialog-meta"></p></div><button class="icon-button" id="close-sector-dialog" aria-label="關閉產業明細">${icon("close")}</button></header><div id="sector-dialog-content" class="sector-dialog-body"></div><footer class="institution-dialog-footer sector-dialog-footer">正值為買超、負值為賣超 · 1 張 = 1,000 股 · 僅統計目前研究標的</footer></dialog>
    <div id="toast" role="status" class="toast"></div>`;
}
