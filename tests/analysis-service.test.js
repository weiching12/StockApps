import test from "node:test";
import assert from "node:assert/strict";
import * as browser from "../src/indicators.js";
import * as domain from "../shared/indicators.js";
import { stockAnalysis } from "../cloudflare/services/analysis-service.js";
import { analysisOptions } from "../cloudflare/api/validators.js";

test("browser compatibility entry exports identical pure rule functions", () => {
  for (const key of Object.keys(browser)) assert.equal(browser[key], domain[key]);
});

test("server analysis matches browser snapshots and never includes future bars", async () => {
  const history = Array.from({ length: 70 }, (_, index) => ({ date: new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10),
    open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 10000,
    institutions: ["外資", "投信", "自營商"].map((name) => ({ name, buy: 500, sell: 100 })) }));
  const stock = { symbol: "2330", history, tradingDates: history.map((row) => row.date) };
  const market = { stock: async () => ({ stock, asOf: history.at(-1).date }) };
  const asOf = history[40].date;
  const options = analysisOptions(new URLSearchParams({ asOf }));
  const result = await stockAnalysis(market, "2330", options);
  const expected = browser.getSnapshot(stock, asOf, options.settings);
  assert.deepEqual(result.data.latest, expected.latest);
  assert.deepEqual(result.data.signal, expected.signal);
  assert.deepEqual(result.data.trend, expected.trend);
  assert.equal(result.data.priceHistory.length, 30);
  assert.equal(result.data.priceHistory.at(-1).date, asOf);
  assert.equal(result.data.priceHistory.at(-1).close, history[40].close);
  assert.equal(result.data.priceHistory.at(-1).volume, history[40].volume);
  assert.equal(result.data.priceHistory.at(-1).ma20, expected.latest.ma20);
  assert.equal(result.data.priceHistory.at(-1).ma60, null);
  assert.equal(result.data.priceHistory.at(-1).k, expected.latest.k);
  assert.equal(result.data.priceHistory.at(-1).d, expected.latest.d);
  assert.equal(result.data.latest.ma60, null);
  history[69].close = 999999;
  assert.deepEqual(await stockAnalysis(market, "2330", options), result);
  await assert.rejects(stockAnalysis(market, "2330", { ...options, asOf: "2099-01-01" }), /交易日/);
});

test("daily chart adds volume and existing MA20/MA60 only for complete market sessions", async () => {
  const dates = Array.from({ length: 65 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
  const { dailyCloseSeries } = await import("../shared/price-history.js");
  const history = dates.map((date, index) => ({ date, close: 100 + index, volume: 1000 + index,
    ma20: index >= 19 ? 100 + index - 9.5 : null,
    ma60: index >= 59 ? 100 + index - 29.5 : null,
    k: index >= 8 ? 45 + index / 10 : null, d: index >= 8 ? 40 + index / 10 : null,
    changePercent: index ? 1 : null }));
  const series = dailyCloseSeries(history, dates, dates[64]);
  assert.equal(series.at(-1).volume, 1064);
  assert.equal(series.at(-1).ma20, history[64].ma20);
  assert.equal(series.at(-1).ma60, history[64].ma60);
  assert.equal(series.at(-1).k, history[64].k);
  assert.equal(series.at(-1).d, history[64].d);
  assert.equal(series.at(-1).changePercent, 1);
  history.splice(62, 1);
  const missing = dailyCloseSeries(history, dates, dates[64]);
  assert.equal(missing.at(-1).ma60, null);
  assert.equal(missing.at(-1).ma20, null);
  assert.equal(missing.at(-1).changePercent, 1);
  assert.equal(missing.find((point) => point.date === dates[62]).volume, null);
  assert.equal(missing.find((point) => point.date === dates[62]).k, null);
  assert.equal(missing.find((point) => point.date === dates[62]).d, null);
  assert.ok(missing.every((point) => point.date <= dates[64]));
});

test("daily close series preserves missing market days and excludes later prices", async () => {
  const dates = Array.from({ length: 35 }, (_, index) => new Date(Date.UTC(2026, 6, index + 1)).toISOString().slice(0, 10));
  const history = dates.filter((_, index) => index !== 10).map((date, index) => ({ date, close: 100 + index }));
  const { dailyCloseSeries } = await import("../shared/price-history.js");
  const series = dailyCloseSeries(history, dates, dates[30]);
  assert.equal(series.length, 30);
  assert.deepEqual(series.find((point) => point.date === dates[10]),
    { date: dates[10], close: null, volume: null, foreignVolume: null, trustVolume: null, dealerVolume: null, institutionalNet: null,
      ma20: null, ma60: null, k: null, d: null, changePercent: null });
  assert.equal(series.at(-1).date, dates[30]);
  assert.ok(series.every((point) => point.date <= dates[30]));
});

test("daily series reports each institution's buys plus sells and keeps unknown rows null", async () => {
  const { dailyCloseSeries } = await import("../shared/price-history.js");
  const dates = ["2026-07-01"];
  const at = (institutions) => dailyCloseSeries([{ date: dates[0], close: 100, volume: 1000, institutions }], dates, dates[0])[0];
  const full = at([{ name: "外資", buy: 300, sell: 100 }, { name: "投信", buy: 0, sell: 0 }, { name: "自營商", buy: 5, sell: 20 }]);
  assert.deepEqual([full.foreignVolume, full.trustVolume, full.dealerVolume, full.institutionalNet], [400, 0, 25, 185]);
  const partial = at([{ name: "外資", buy: 300, sell: null }, { name: "投信", buy: 1, sell: 2 }, { name: "投信", buy: 1, sell: 2 }]);
  assert.deepEqual([partial.foreignVolume, partial.trustVolume, partial.dealerVolume, partial.institutionalNet], [null, null, null, null]);
});

test("analysis parameter validation follows frontend bounds", () => {
  for (const query of ["period=0", "period=61", "dSmooth=21", "kSmooth=no", "asOf=2026-02-30"])
    assert.throws(() => analysisOptions(new URLSearchParams(query)));
});


test("KD signal requires the immediately preceding market session after a suspension", () => {
  const dates = Array.from({ length: 25 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
  const stock = { symbol: "2330", tradingDates: dates, history: dates.map((date, index) =>
    ({ date, open: 100 + index, close: 100 + index, high: 101 + index, low: 99 + index,
      volume: 1000, institutions: [] })) };
  assert.notEqual(domain.getSnapshot(stock, dates.at(-1)).signal.code, "insufficient");
  stock.history.splice(-2, 1);
  const snapshot = domain.getSnapshot(stock, dates.at(-1));
  assert.equal(snapshot.latest.date, dates.at(-1));
  assert.equal(snapshot.signal.code, "insufficient");
  // A known calendar is mandatory for suspension checks, legacy callers remain supported.
  assert.notEqual(domain.getSnapshot({ ...stock, tradingDates: undefined }, dates.at(-1)).signal.code, "insufficient");
});
