const pageCopy = {
  market: ["MARKET WATCHLIST", "市場觀察清單", "比較全部標的的價量、技術指標與法人籌碼。"],
  favorites: ["MY RESEARCH WATCHLIST", "株研追蹤", "查看追蹤股票的進場研究：準備度、初步門檻與明日進場評估，預設依準備度排序。點選股票查看完整研究。"],
  backtest: ["STRATEGY BACKTEST", "策略回測", "以每日保存的全市場研究樣本與後續實際行情，檢視進場研究模型的歷史表現。參數暫定，結果僅供研究。"],
  sectors: ["INSTITUTIONAL RANKING", "法人買株", "依產業排名觀察法人資金方向；點選產業查看個股價格與買賣超張數。"],
};

export function renderPageView({ state, dataset, renderLoadState, updateSegmentedControls }) {
  const [eyebrow, title, description] = pageCopy[state.page];
  document.querySelector("#page-eyebrow").textContent = eyebrow;
  document.querySelector("#page-title").innerHTML = `${title}<span class="heading-dot">.</span>`;
  document.querySelector("#page-description").textContent = description;
  document.querySelector("#breadcrumb-current").textContent = title;
  const sectors = state.page === "sectors" || state.page === "backtest";
  const favorites = state.page === "favorites";
  const dateSelect = document.querySelector("#trade-date");
  dateSelect.hidden = sectors || favorites;
  dateSelect.disabled = sectors || favorites || !dataset.dates.length;
  document.querySelector(".date-control label").hidden = sectors || favorites;
  document.querySelector(".date-control").hidden = sectors || favorites;
  document.querySelector(".page-heading").classList.toggle("without-date", sectors || favorites);
  document.querySelector(".page-heading").classList.toggle("favorites-heading", favorites);
  document.querySelector("#research-date").hidden = !favorites;
  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.pagePanel !== state.page;
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

