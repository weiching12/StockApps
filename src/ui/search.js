import { researchRowMarkup } from "./home.js";

const RESULT_LIMIT = 50;

/** Codes first (exact, then prefix), then names containing the query; ETFs and companies alike. */
export function searchStocks(stocks, query, limit = RESULT_LIMIT) {
  const text = query.trim().toLocaleLowerCase();
  if (!text) return { matches: [], total: 0 };
  const rank = (stock) => {
    const symbol = stock.symbol.toLocaleLowerCase(), name = (stock.name ?? "").toLocaleLowerCase();
    return symbol === text ? 0 : symbol.startsWith(text) ? 1 : name.startsWith(text) ? 2 : name.includes(text) || symbol.includes(text) ? 3 : null;
  };
  const found = stocks.map((stock) => [rank(stock), stock]).filter(([order]) => order !== null)
    .sort(([a, x], [b, y]) => a - b || x.symbol.localeCompare(y.symbol)).map(([, stock]) => stock);
  return { matches: found.slice(0, limit), total: found.length };
}

const SUGGESTION_COUNT = 8;

/** There is no record of what people search, so "popular" means the session's largest traded value. */
export function popularStocks(stocks, count = SUGGESTION_COUNT) {
  const value = (stock) => Number.isFinite(stock.latest?.close) && Number.isFinite(stock.latest?.volume) ? stock.latest.close * stock.latest.volume : null;
  return stocks.filter((stock) => value(stock) !== null).sort((a, b) => value(b) - value(a) || a.symbol.localeCompare(b.symbol)).slice(0, count);
}

export function renderSearchView({ query, stocks, loading, asOf, loadingIcon, esc, number, percent, direction }) {
  const list = document.querySelector("#search-results");
  if (!list) return;
  const summary = document.querySelector("#search-summary"), suggestions = document.querySelector("#search-suggestions");
  if (loading) { summary.textContent = ""; suggestions.hidden = true; list.innerHTML = `<div class="home-loading">${loadingIcon("股票資料載入中")}</div>`; return; }
  if (!query.trim()) {
    const popular = popularStocks(stocks);
    summary.textContent = "輸入代碼或名稱，例如 2330 或 台積電。";
    suggestions.innerHTML = popular.length ? `<h3>熱門查詢</h3><div class="sector-chip-row">${popular.map((stock) => `<button type="button" data-search-suggestion="${esc(stock.symbol)}">${esc(stock.symbol)} ${esc(stock.name)}</button>`).join("")}</div>` : "";
    suggestions.hidden = !popular.length;
    list.innerHTML = "";
    return;
  }
  suggestions.hidden = true;
  const { matches, total } = searchStocks(stocks, query);
  summary.textContent = !total ? "沒有符合的股票。"
    : `找到 ${total} 檔${total > matches.length ? `，顯示前 ${matches.length} 檔` : ""}`;
  list.innerHTML = matches.length
    ? `<table class="research-table research-tracking"><thead><tr><th scope="col">股票</th><th scope="col">準備度</th><th scope="col">股價</th><th scope="col">進場研究</th></tr></thead><tbody>${matches.map((stock) => researchRowMarkup(stock, { esc, number, percent, direction })).join("")}</tbody></table>` : "";
}
