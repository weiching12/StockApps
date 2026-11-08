import { activeResearchPeriod } from "./research-store.js";
import { compareResearchStocks, matchesResearchFilter, researchListCells, researchSummaryOf } from "./entry-research.js";

const fmt = (value) => Number.isFinite(value) ? value.toFixed(2) : "—";
const delta = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${fmt(value)}` : "—";
const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "neutral";

export function researchCardPrice(period, stock, asOf) {
  const positive = value => Number.isFinite(value) && value > 0;
  const close = stock?.latest?.date === asOf && positive(stock.latest.close) ? stock.latest.close : null;
  // Snapshot.close is the observed closing price, even when scoring adjusts earlier bars.
  const joined = period?.addedSnapshot;
  const baseline = period?.baseline ?? (positive(joined?.close) ? { asOf: joined.asOf, close: joined.close, priceBasis: "unadjusted" } : null);
  if (!close) return { close: null, delta: null, asOf, reason: "當日收盤價不足" };
  if (!positive(baseline?.close) || !baseline.asOf) return { close, delta: null, asOf, reason: "收藏價格未保存，無法比較" };
  if (baseline.asOf > asOf || baseline.priceBasis && baseline.priceBasis !== "unadjusted")
    return { close, delta: null, asOf, reason: "收藏價格日期或基準不一致，無法比較" };
  return { close, delta: close - baseline.close, asOf, baseline };
}

export const RESEARCH_TRACKING_SORTS = [["readiness", "準備度"], ["nextDay", "明日評估優先"], ["price", "收藏後股價變化"]];
export const RESEARCH_TRACKING_FILTERS = [["all", "全部自選"], ["candidate", "明日進場候選"], ["gatePass", "初步門檻通過"],
  ["triggered", "進場訊號已觸發"], ["waiting", "等待進場訊號"]];
const number = (value, digits = 2) => Number.isFinite(value)
  ? value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";

/** Yesterday's signal no longer holds: it lasts one session, unless a new one fired or a veto ended it. */
const lapsedToday = (summary, previousDate) => Boolean(previousDate) && summary.signalDate === previousDate && summary.status !== "TRIGGERED";

export function renderResearchCenter({ favorites, stocks, store, date, previousDate, sort, filter, esc }) {
  const bySymbol = new Map(stocks.map((stock) => [stock.symbol, stock]));
  const values = favorites.map((symbol) => {
    const stock = bySymbol.get(symbol);
    return { symbol, stock: stock ?? { symbol }, summary: researchSummaryOf(stock),
      price: researchCardPrice(activeResearchPeriod(store, symbol), stock, date) };
  });
  const filtered = values.filter(({ stock }) => matchesResearchFilter(stock, filter));
  const readiness = ({ summary }) => Number.isFinite(summary?.score) ? summary.score : null;
  const byValue = (value) => (a, b) => {
    const av = value(a), bv = value(b);
    return av === null && bv === null ? a.symbol.localeCompare(b.symbol) : av === null ? 1 : bv === null ? -1 : bv - av || a.symbol.localeCompare(b.symbol);
  };
  filtered.sort(sort === "nextDay" ? (a, b) => compareResearchStocks(a.stock, b.stock)
    : sort === "price" ? byValue(({ price }) => Number.isFinite(price.delta) ? price.delta : null) : byValue(readiness));
  const entries = filtered.map(({ symbol, stock, price }) => {
    const label = stock.name ?? symbol;
    const cells = researchListCells(stock, esc, number);
    const priceDetail = price.baseline ? `收藏基準 ${price.baseline.asOf} ${fmt(price.baseline.close)} → ${price.asOf} ${fmt(price.close)}；未還原收盤價差，未計股息，不代表投資損益` : price.reason;
    const sectorBadge = stock.sector ? `<span class="research-sector-badge" title="${esc(stock.sector)}">${esc(stock.sector)}</span>` : "";
    return `<tr class="research-card" data-research-symbol="${esc(symbol)}" data-entry-score="${esc(symbol)}"><th scope="row"><button type="button" class="research-card-main" data-entry-score="${esc(symbol)}" aria-label="查看 ${esc(symbol)} ${esc(label)} 進場研究"><span class="research-stock"><span class="research-stock-head"><span class="research-code">${esc(symbol)}</span><strong>${esc(label)}</strong>${sectorBadge}</span></span></button><span class="research-stock-badges">${cells.research}</span></th><td class="research-readiness-cell">${cells.readiness}</td><td class="research-price"><strong aria-label="${esc(price.asOf ?? "")} 收盤價 ${fmt(price.close)}">${fmt(price.close)}</strong><small class="research-price-change ${tone(price.delta)}" title="${esc(priceDetail)}" aria-label="自收藏後股價差異 ${delta(price.delta)}">${delta(price.delta)}</small></td><td class="research-cell">${cells.research}</td></tr>`;
  }).join("");
  const count = (test) => values.filter(({ summary }) => summary && test(summary)).length;
  const stat = (label, value, note, tone = "") => `<div class="research-stat"><span class="research-stat-label">${label}</span><strong class="${tone}">${value}<small>檔</small></strong><span class="research-stat-note">${note}</span></div>`;
  const candidates = count((summary) => summary.nextDayStatus === "NEXT_DAY_CANDIDATE");
  return { stats: stat("自選股票", favorites.length, "點選股票查看完整研究") +
      stat("明日進場候選", candidates, "訊號觸發且價格在計畫內", candidates ? "up" : "") +
      stat("今日候選失效", count((summary) => lapsedToday(summary, previousDate)), "昨日訊號已不成立"),
    cards: entries ? `<table class="research-table research-tracking"><thead><tr><th scope="col">股票</th><th scope="col">準備度</th><th scope="col">股價</th><th scope="col">進場研究</th></tr></thead><tbody>${entries}</tbody></table>`
      : `<p class="research-muted">${favorites.length ? "此篩選目前沒有股票。" : "尚無自選股票。"}</p>` };
}
