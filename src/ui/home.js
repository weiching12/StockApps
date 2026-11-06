import { matchesResearchFilter, researchListCells, researchSummaryOf } from "./entry-research.js";

const COLLAPSED_ROWS = 10;

const readiness = (stock) => researchSummaryOf(stock)?.score;
const byReadiness = (a, b) => (Number.isFinite(readiness(b)) ? readiness(b) : -1) - (Number.isFinite(readiness(a)) ? readiness(a) : -1)
  || a.symbol.localeCompare(b.symbol);

/** The latest session's screening: its next-day candidates, highest readiness first. */
export const homeCandidates = (stocks) => stocks.filter((stock) => matchesResearchFilter(stock, "candidate")).sort(byReadiness);

export function renderHomeView({ state, stocks, loading, loadFailed, asOf, loadingIcon, esc, number, percent, direction }) {
  const list = document.querySelector("#home-list");
  if (!list) return;
  const date = document.querySelector("#home-date");
  date.textContent = asOf ? `依 ${asOf} 收盤` : "";
  const count = document.querySelector("#home-count");
  if (loading || loadFailed) {
    count.textContent = "";
    list.innerHTML = loading ? `<div class="home-loading">${loadingIcon("進場篩選載入中")}</div>` : "";
    return;
  }
  const chosen = homeCandidates(stocks);
  count.textContent = `明日候選 ${chosen.length} 檔`;
  if (!chosen.length) {
    list.innerHTML = '<p class="research-muted">本日沒有明日進場候選。</p>';
    return;
  }
  const shown = state.homeExpanded ? chosen : chosen.slice(0, COLLAPSED_ROWS);
  const rows = shown.map((stock) => {
    const cells = researchListCells(stock, esc, number), bar = stock.latest;
    const sector = stock.sector ? `<span class="research-sector-badge" title="${esc(stock.sector)}">${esc(stock.sector)}</span>` : "";
    return `<tr class="research-card" data-research-symbol="${esc(stock.symbol)}" data-entry-score="${esc(stock.symbol)}"><th scope="row"><button type="button" class="research-card-main" data-entry-score="${esc(stock.symbol)}" aria-label="查看 ${esc(stock.symbol)} ${esc(stock.name)} 進場研究"><span class="research-stock"><span class="research-stock-head"><span class="research-code">${esc(stock.symbol)}</span><strong>${esc(stock.name)}</strong>${sector}</span></span></button><span class="research-stock-badges">${cells.research}</span></th><td class="research-readiness-cell">${cells.readiness}</td><td class="research-price"><strong>${number(bar?.close, 2)}</strong><small class="research-price-change ${direction(bar?.changePercent)}">${percent(bar?.changePercent)}</small></td><td class="research-cell">${cells.research}</td></tr>`;
  }).join("");
  const more = shown.length < chosen.length
    ? `<button type="button" class="outline-button home-show-all" data-home-expand>顯示全部 ${chosen.length} 檔</button>` : "";
  list.innerHTML = `<table class="research-table research-tracking"><thead><tr><th scope="col">股票</th><th scope="col">準備度</th><th scope="col">股價</th><th scope="col">進場研究</th></tr></thead><tbody>${rows}</tbody></table>${more}`;
}
