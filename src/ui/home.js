import { matchesResearchFilter, researchListCells, researchSummaryOf } from "./entry-research.js";

const COLLAPSED_ROWS = 10;

const readiness = (stock) => researchSummaryOf(stock)?.score;
const byReadiness = (a, b) => (Number.isFinite(readiness(b)) ? readiness(b) : -1) - (Number.isFinite(readiness(a)) ? readiness(a) : -1)
  || a.symbol.localeCompare(b.symbol);

/** The latest session's screening: next-day candidates, then everything that cleared the gates. */
export function homeEntryLists(stocks) {
  return { candidate: stocks.filter((stock) => matchesResearchFilter(stock, "candidate")).sort(byReadiness),
    gatePass: stocks.filter((stock) => matchesResearchFilter(stock, "gatePass")).sort(byReadiness) };
}

/** Candidates can be few or none, so a day without any opens on the stocks that cleared the gates. */
export const homeEntryChoice = (lists, chosen) => chosen ?? (lists.candidate.length ? "candidate" : "gatePass");

export function renderHomeView({ state, stocks, loading, loadFailed, asOf, loadingIcon, esc, number, percent, direction }) {
  const list = document.querySelector("#home-list");
  if (!list) return;
  const date = document.querySelector("#home-date");
  date.textContent = asOf ? `依 ${asOf} 收盤` : "";
  if (loading || loadFailed) {
    document.querySelector("#home-tabs").innerHTML = "";
    list.innerHTML = loading ? `<div class="home-loading">${loadingIcon("進場篩選載入中")}</div>` : "";
    return;
  }
  const lists = homeEntryLists(stocks), choice = homeEntryChoice(lists, state.homeList);
  const tab = (value, label) => `<button type="button" data-home-list="${value}" aria-pressed="${choice === value}">${label} ${lists[value].length}</button>`;
  document.querySelector("#home-tabs").innerHTML = tab("candidate", "明日候選") + tab("gatePass", "門檻通過");
  const chosen = lists[choice];
  if (!chosen.length) {
    list.innerHTML = `<p class="research-muted">${choice === "candidate" ? "本日沒有明日進場候選。" : "本日沒有通過初步門檻的個股。"}</p>`;
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
