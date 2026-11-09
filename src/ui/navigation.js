const pageCopy = {
  home: ["TODAY'S OVERVIEW", "主頁面", "今日市場情緒與進場篩選結果，點選股票查看完整研究。"],
  market: ["MARKET WATCHLIST", "市場觀察清單", "依產業切換個股，同時查看該產業的法人買賣超。"],
  search: ["STOCK SEARCH", "搜尋", "輸入股票代碼或名稱，點選結果查看完整研究。"],
  favorites: ["MY RESEARCH WATCHLIST", "自選", "查看自選股票的進場研究：準備度、初步門檻與明日進場評估，預設依準備度排序。點選股票查看完整研究。"],
  backtest: ["STRATEGY BACKTEST", "策略回測", "以每日保存的全市場研究樣本與後續實際行情，檢視進場研究模型的歷史表現。參數暫定，結果僅供研究。"],
};

const marketCopy = {
  list: pageCopy.market,
  sectors: ["INSTITUTIONAL RANKING", "法人買株", "依細產業排名法人資金方向，點選產業查看個股；資金流向僅供觀察，非買進訊號。"],
  etf: ["ETF WATCHLIST", "ETF", "上市 ETF 的價格、量價與法人買賣超；ETF 不列入產業與法人買株排行。"],
};

export function renderPageView({ state, dataset, renderLoadState, updateSegmentedControls }) {
  const market = state.page === "market";
  const [eyebrow, title, description] = market ? marketCopy[state.marketView] : pageCopy[state.page];
  document.querySelector("#page-eyebrow").textContent = eyebrow;
  document.querySelector("#page-title").innerHTML = `${title}<span class="heading-dot">.</span>`;
  document.querySelector("#page-description").textContent = description;
  document.querySelector("#breadcrumb-current").textContent = title;
  // Only the market list browses past sessions; the other pages read the latest one.
  // The trading-day choice and the update countdown live on home; it sets the session the market list reads too.
  const sectors = state.page !== "home";
  const favorites = state.page === "favorites";
  const dateSelect = document.querySelector("#trade-date");
  dateSelect.hidden = sectors || favorites;
  dateSelect.disabled = sectors || favorites || !dataset.dates.length;
  document.querySelector(".date-control label").hidden = sectors || favorites;
  document.querySelector(".date-control").hidden = sectors || favorites;
  document.querySelector(".page-heading").classList.toggle("without-date", sectors || favorites);
  document.querySelector(".page-heading").classList.toggle("favorites-heading", favorites);
  document.querySelector("#research-date").hidden = !favorites;
  // The market page shows its views as a switch in place of the title.
  document.querySelector("#page-title").classList.toggle("sr-only", market);
  document.querySelector(".market-header").hidden = !market;
  // The search page opens straight on its field; its heading stays for screen readers only.
  document.querySelector(".page-heading").classList.toggle("sr-only", state.page === "search");
  // Sector choices narrow the list only, so they sit in the header just for that view.
  document.querySelector(".sector-nav").hidden = state.marketView !== "list";
  document.querySelector(".sector-toolbar").hidden = state.marketView !== "sectors";
  // ETFs are not researched, so their view drops the readiness and research columns and filter.
  document.querySelector(".stocks-panel")?.classList.toggle("is-etf", state.marketView === "etf");
  document.querySelectorAll("[data-market-view-choice]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.marketViewChoice === state.marketView)));
  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.pagePanel !== state.page ||
      Boolean(panel.dataset.marketView) && !panel.dataset.marketView.split(" ").includes(state.marketView);
  });
  document.querySelectorAll("[data-page]").forEach((button) => {
    const active = button.dataset.page === state.page;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  renderLoadState();
  updateSegmentedControls();
}

