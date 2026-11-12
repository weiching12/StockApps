import test from "node:test";
import assert from "node:assert/strict";
import { chartDays } from "../cloudflare/api/validators.js";
import { AnalysisService } from "../cloudflare/services/analysis-service.js";
import { entryChartMarkup, CHART_RANGES } from "../src/ui/entry-score.js";
import { sectorChipsMarkup, sectorTree, sectorTurnover } from "../src/ui/sectors.js";

const dates = Array.from({ length: 100 }, (_, index) => new Date(Date.UTC(2026, 0, 5) + index * 86_400_000).toISOString().slice(0, 10));
const history = dates.map((date, index) => ({ date, open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, volume: 1000 + index,
  institutions: [{ name: "外資", buy: 10, sell: 5 }, { name: "投信", buy: 1, sell: 1 }, { name: "自營商", buy: 2, sell: 3 }] }));
const market = { stock: async (symbol) => ({ asOf: dates.at(-1), stock: { symbol, name: "測試", sector: "半導體", history, tradingDates: dates } }) };

test("the chart range accepts only the offered lengths and defaults to a month", () => {
  assert.equal(chartDays(new URLSearchParams()), 30);
  for (const [days] of CHART_RANGES) assert.equal(chartDays(new URLSearchParams({ days: String(days) })), days);
  for (const bad of ["0", "31", "120", "261", "1000", "abc", ""]) assert.throws(() => chartDays(new URLSearchParams({ days: bad })), /days/);
});

test("the analysis sends as many sessions as asked for, and all there is when history is shorter", async () => {
  const service = new AnalysisService(market);
  assert.equal((await service.stock("2330")).data.priceHistory.length, 30);
  const sixty = (await service.stock("2330", { days: 60 })).data.priceHistory;
  assert.equal(sixty.length, 60);
  assert.equal(sixty.at(-1).date, dates.at(-1));
  assert.equal(sixty[0].date, dates.at(-60));
  // The stored history is shorter than a year: the range shows what exists instead of failing.
  const year = (await service.stock("2330", { days: 260 })).data.priceHistory;
  assert.equal(year.length, 100);
  assert.equal(year[0].date, dates[0]);
  // A longer range ends on the same session with the same figures as the default one.
  assert.deepEqual(year.at(-1), sixty.at(-1));
});

test("a redrawn chart names its real length, marks the chosen range and thins a long series", () => {
  const esc = (value) => String(value).replaceAll('"', "&quot;"), number = (value, digits = 0) => Number(value).toFixed(digits);
  const series = (length) => Array.from({ length }, (_, index) => ({ date: dates[index], close: 100 + index, volume: 1000, changePercent: 1, ma20: null, ma60: null }));
  const month = entryChartMarkup({ symbol: "2330" }, esc, number, series(30), 30);
  assert.match(month, /<h3>30 個交易日走勢圖<\/h3>/);
  assert.match(month, /data-chart-range="30" aria-pressed="true"/);
  assert.match(month, /data-chart-range="260" aria-pressed="false"/);
  assert.doesNotMatch(month, /class="entry-price-chart[^"]* dense/);
  assert.match(month, /width="10\.0"/);
  const year = entryChartMarkup({ symbol: "2330" }, esc, number, series(100), 260);
  assert.match(year, /<h3>100 個交易日走勢圖<\/h3>/, "the heading counts the sessions drawn, not the range asked for");
  assert.match(year, /data-chart-range="260" aria-pressed="true"/);
  assert.match(year, /class="entry-price-chart hide-plan dense" data-trend="up" data-range="260"/);
  assert.match(year, /aria-valuemax="100"/);
  const width = Number(/class="entry-chart-volume up" x="[\d.]+" y="[\d.]+" width="([\d.]+)"/.exec(year)[1]);
  assert.ok(width < 584 / 99, "bars stay narrower than the gap between sessions");
  // No data in the range still offers the other ranges.
  assert.match(entryChartMarkup({ symbol: "2330" }, esc, number, [], 60), /data-chart-range="60" aria-pressed="true".*近 60 個交易日沒有走勢資料/s);
  assert.deepEqual(CHART_RANGES.map(([days, label]) => `${days}:${label}`), ["30:1 月", "60:3 月", "260:1 年"]);
  // An ETF has no plan levels.
  assert.doesNotMatch(entryChartMarkup({ symbol: "0050", sector: "ETF", entryResearch: { gateResult: {} } }, esc, number, series(30), 30), /entry-chart-plan-toggle/);
});

const stocks = [
  { symbol: "1", sector: "晶圓代工", sectorGroup: "半導體" }, { symbol: "2", sector: "IC設計", sectorGroup: "半導體" },
  { symbol: "3", sector: "金控", sectorGroup: "金融" }, { symbol: "4", sector: "銀行", sectorGroup: "金融" },
  { symbol: "5", sector: "航運", sectorGroup: "交通運輸" }, { symbol: "6", sector: "ETF" },
];
const snapshots = [
  { ...stocks[0], latest: { volume: 10, close: 1000 } }, { ...stocks[1], latest: { volume: 100, close: 500 } },
  { ...stocks[2], latest: { volume: 5000, close: 30 } }, { ...stocks[3], latest: { volume: null, close: 20 } },
  { ...stocks[4], latest: null },
];

test("sector turnover is volume times close, and a stock without a price or volume adds nothing", () => {
  const turnover = sectorTurnover(snapshots);
  assert.equal(turnover.get("半導體"), 60_000);
  assert.equal(turnover.get("晶圓代工"), 10_000);
  assert.equal(turnover.get("IC設計"), 50_000);
  assert.equal(turnover.get("金融"), 150_000);
  assert.equal(turnover.get("金控"), 150_000);
  assert.equal(turnover.has("銀行"), false);
  assert.equal(turnover.has("交通運輸"), false);
});

test("sector choices put the busiest first at both levels and fall back to names without trading data", () => {
  const byName = sectorTree(stocks);
  assert.deepEqual(byName.groups.map((group) => group.name), ["半導體", "交通運輸", "金融"].sort((a, b) => a.localeCompare(b, "zh-Hant")));
  const busiest = sectorTree(stocks, sectorTurnover(snapshots));
  // 金融 trades more shares at low prices but also more money; 交通運輸 has no data and goes last.
  assert.deepEqual(busiest.groups.map((group) => group.name), ["金融", "半導體", "交通運輸"]);
  assert.deepEqual(busiest.groups[1].subs, ["IC設計", "晶圓代工"]);
  assert.deepEqual(busiest.groups[0].subs, ["金控", "銀行"]);
  assert.deepEqual(busiest.plain, ["ETF"]);
  const chips = sectorChipsMarkup(stocks.slice(0, 5), "晶圓代工", String, sectorTurnover(snapshots));
  assert.deepEqual([...chips.first.matchAll(/data-sector-chip="([^"]+)"/g)].map((match) => match[1]), ["all", "金融", "半導體", "交通運輸"]);
  assert.deepEqual([...chips.second.matchAll(/data-sector-chip="([^"]+)"/g)].map((match) => match[1]), ["半導體", "IC設計", "晶圓代工"]);
  assert.match(chips.first, /data-sector-chip="半導體" aria-pressed="true"/);
});
