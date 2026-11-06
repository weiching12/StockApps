import test from "node:test";
import assert from "node:assert/strict";
import { renderResearchCenter, researchCardPrice } from "../src/ui/research.js";

const stock = (date, close) => ({ latest: { date, close } });

test("card price shows an absolute closing-price difference from the saved join baseline", () => {
  const period = { baseline: { asOf: "2026-10-22", close: 48.2, priceBasis: "unadjusted" } };
  const result = researchCardPrice(period, stock("2026-10-28", 47.5), "2026-10-28");
  assert.equal(result.close, 47.5);
  assert(Math.abs(result.delta + .7) < 1e-10);
  assert.equal(result.baseline.asOf, "2026-10-22");
});

test("a saved join snapshot can supply its observed close but a later first-valid baseline cannot", () => {
  const latest = stock("2026-10-28", 52);
  assert.equal(researchCardPrice({ addedSnapshot: { asOf: "2026-10-22", close: 50, priceBasis: "reference-adjusted" } }, latest, "2026-10-28").delta, 2);
  assert.equal(researchCardPrice({ firstValidPriceBaseline: { asOf: "2026-10-27", close: 51 } }, latest, "2026-10-28").delta, null);
});

test("card price rejects stale closes, later join dates and different price bases", () => {
  const baseline = { asOf: "2026-10-22", close: 50, priceBasis: "unadjusted" };
  assert.equal(researchCardPrice({ baseline }, stock("2026-10-27", 51), "2026-10-28").close, null);
  assert.equal(researchCardPrice({ baseline: { ...baseline, asOf: "2026-10-29" } }, stock("2026-10-28", 52), "2026-10-28").delta, null);
  assert.equal(researchCardPrice({ baseline: { ...baseline, priceBasis: "adjusted" } }, stock("2026-10-28", 52), "2026-10-28").delta, null);
});

test("the lapsed count covers yesterday's signals that no longer hold, not today's or older ones", () => {
  const stock = (symbol, status, signalDate) => ({ symbol, name: symbol, sector: "x", entryResearch: { status, signalDate, nextDayStatus: "WAIT_TRIGGER", gateStatus: "PASS", gateConditions: {} } });
  const stocks = [stock("1", "SIGNAL_EXPIRED", "2026-10-15"), stock("2", "SIGNAL_INVALIDATED", "2026-10-15"), stock("3", "NOT_ELIGIBLE", "2026-10-15"),
    stock("4", "TRIGGERED", "2026-10-16"), stock("5", "SIGNAL_EXPIRED", "2026-10-13"), stock("6", "WAIT_TRIGGER", null)];
  const { stats } = renderResearchCenter({ favorites: stocks.map((item) => item.symbol), stocks, store: { periods: [] },
    date: "2026-10-16", previousDate: "2026-10-15", sort: "readiness", filter: "all", esc: String });
  assert.match(stats, /今日候選失效<\/span><strong class="">3<small>/);
});
