import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../shared/indicators.js";
import { entryResearchGates, evaluateEntryResearch } from "../shared/entry-research.js";
import { ENTRY_RESEARCH_MODEL, ENTRY_RESEARCH_MODEL_V1, ENTRY_RESEARCH_MODEL_V2 } from "../shared/entry-research-model.js";

const KEYS = ["trend", "momentum", "priceVolume", "institutional", "entryRisk"];
const dates = Array.from({ length: 100 }, (_, index) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10));
const asOf = dates.at(-1), last = dates.length - 1;
const flows = (foreign = 0, trust = 0, dealer = 0) => [
  { name: "外資", buy: Math.max(foreign, 0), sell: Math.max(-foreign, 0) },
  { name: "投信", buy: Math.max(trust, 0), sell: Math.max(-trust, 0) },
  { name: "自營商", buy: Math.max(dealer, 0), sell: Math.max(-dealer, 0) },
];

/** A liquid, steady uptrend that triggers no veto: ATR14 ≈ 2, close 1.5 ATR above MA20. */
function baseline() {
  return dates.map((date, index) => {
    const close = 100 + index * 0.2;
    return { date, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1_000_000,
      ma20: close - 3, ma60: close - 6, k: 60, d: 50, changePercent: 0.2, institutions: flows() };
  });
}
const stubScore = (categories = {}) => ({ priceBasis: "unadjusted", missingData: [], conflictingEvidence: [],
  coreConditions: Object.fromEntries(KEYS.map((key) => [key, { status: "PASS", reason: "", data: {} }])),
  categories: Object.fromEntries(KEYS.map((key) => [key, { score: categories[key] ?? 80 }])) });
const input = (bars, extra = {}) => ({ stock: { symbol: "9999", history: bars }, tradingDates: dates, asOf,
  settings: DEFAULT_SETTINGS, score: stubScore(), model: ENTRY_RESEARCH_MODEL_V2, ...extra });
const gates = (bars, extra) => entryResearchGates(input(bars, extra));

test("v2 passes a liquid uptrend and lists five vetoes with their references", () => {
  const result = gates(baseline());
  assert.equal(result.status, "PASS");
  assert.equal(result.passedCount, 5);
  assert.deepEqual(Object.keys(result.details), ["trend", "distribution", "extension", "institutional", "liquidity"]);
  assert.ok(Object.values(result.details).every((item) => item.references.length && item.references.every((ref) => ref.url.startsWith("https://"))));
  assert.equal(result.details.extension.data.extensionAtr, 1.5);
});

test("G1 vetoes a bearish MA order or a falling MA60, but not a close below MA20", () => {
  const belowMa20 = baseline(); belowMa20[last].close = belowMa20[last].ma20 - 0.5; belowMa20[last].low = belowMa20[last].close - 1;
  assert.equal(gates(belowMa20).conditions.trend, "PASS", "a pullback under MA20 is not a broken trend");
  const crossed = baseline(); crossed[last].ma20 = crossed[last].ma60 - 0.1;
  assert.equal(gates(crossed).conditions.trend, "FAIL");
  const falling = baseline(); falling[last - 20].ma60 = falling[last].ma60 + 0.01;
  const result = gates(falling);
  assert.equal(result.conditions.trend, "FAIL");
  assert.match(result.details.trend.reason, /20 個交易日前/);
  const short = baseline().slice(0, -1); short.push({ ...baseline()[last] }); delete short[last - 20].ma60;
  assert.equal(gates(short).conditions.trend, "UNKNOWN");
});

test("G2 vetoes an unrecovered heavy-selling day within ten sessions only", () => {
  const heavy = (bars, age) => { Object.assign(bars[last - age], { changePercent: -2, volume: 3_000_000, high: bars[last].close + 5 }); return bars; };
  const result = gates(heavy(baseline(), 6));
  assert.equal(result.conditions.distribution, "FAIL");
  assert.match(result.details.distribution.reason, /收盤尚未站回當日高點/);
  const recovered = heavy(baseline(), 6); recovered[last - 6].high = recovered[last].close - 0.1;
  assert.equal(gates(recovered).conditions.distribution, "PASS");
  assert.equal(gates(heavy(baseline(), 12)).conditions.distribution, "PASS", "outside the ten-session look-back");
  const mild = baseline(); Object.assign(mild[last - 3], { changePercent: -2, volume: 1_500_000, high: mild[last].close + 5 });
  assert.equal(gates(mild).conditions.distribution, "PASS", "a decline on under twice the average volume is not a veto");
});

test("G3 vetoes a close more than three ATR14 above MA20", () => {
  const extended = baseline(); extended[last].ma20 = extended[last].close - 6.5;
  const result = gates(extended);
  assert.equal(result.conditions.extension, "FAIL");
  assert.ok(result.details.extension.data.extensionAtr > 3);
});

test("G4 vetoes clear foreign and trust selling, ignores dealers and small selling", () => {
  const selling = baseline();
  for (let age = 0; age < 3; age++) selling[last - age].institutions = flows(-40_000, -20_000);
  assert.equal(gates(selling).conditions.institutional, "FAIL", "−6% of three sessions' volume");
  const small = baseline(); small[last].institutions = flows(-30_000);
  assert.equal(gates(small).conditions.institutional, "PASS", "−1% is not a clear sell-off");
  const dealer = baseline();
  for (let age = 0; age < 3; age++) dealer[last - age].institutions = flows(0, 0, -900_000);
  assert.equal(gates(dealer).conditions.institutional, "PASS", "dealer flows (hedging) are not counted");
  const older = baseline();
  for (let age = 3; age < 6; age++) older[last - age].institutions = flows(-900_000);
  assert.equal(gates(older).conditions.institutional, "PASS", "only the last three sessions count");
  const missing = baseline(); missing[last - 1].institutions = [];
  assert.equal(gates(missing).conditions.institutional, "UNKNOWN");
});

test("G5 vetoes thin trading by average traded value, not share count", () => {
  const thin = baseline().map((bar) => ({ ...bar, volume: 50_000 })); // ≈ NT$6 million a day
  const result = gates(thin);
  assert.equal(result.conditions.liquidity, "FAIL");
  assert.match(result.details.liquidity.reason, /萬元/);
  const pricey = baseline().map((bar) => ({ ...bar, volume: 50_000, close: bar.close * 5, open: bar.open * 5,
    high: bar.high * 5, low: bar.low * 5, ma20: bar.ma20 * 5, ma60: bar.ma60 * 5 }));
  assert.equal(gates(pricey).conditions.liquidity, "PASS", "the same share count at a higher price is liquid enough");
});

test("any FAIL fails the stage, an UNKNOWN without FAIL is UNKNOWN, and research stops before signals", () => {
  const unknown = baseline(); unknown[last - 1].institutions = [];
  assert.equal(gates(unknown).status, "UNKNOWN");
  const mixed = baseline(); mixed[last - 1].institutions = []; mixed[last].ma20 = mixed[last].ma60 - 0.1;
  assert.equal(gates(mixed).status, "FAIL");
  const failed = evaluateEntryResearch(input(mixed));
  assert.equal(failed.entryResearch.status, "NOT_ELIGIBLE");
  assert.equal(failed.entryResearch.score, null);
  assert.equal(failed.nextDayPlan.status, "NOT_ELIGIBLE");
  assert.equal(evaluateEntryResearch(input(unknown)).dataQuality.status, "INSUFFICIENT");
  assert.match(evaluateEntryResearch(input(unknown)).dataQuality.missing[0], /^法人明顯賣壓：/);
  const comparison = evaluateEntryResearch(input(mixed, { researchAllStocks: true }));
  assert.equal(comparison.gateResult.status, "FAIL");
  assert.notEqual(comparison.entryResearch.status, "NOT_ELIGIBLE", "offline comparisons still see the research stage");
});

test("v2 structure averages only the V1.2 trend and institutional scores", () => {
  const score = { ...stubScore({ trend: 100, institutional: 60, momentum: 0, priceVolume: 0, entryRisk: 0 }) };
  const v2 = evaluateEntryResearch(input(baseline(), { score }));
  assert.equal(v2.entryResearch.componentScores.structure, 80);
  const v1 = evaluateEntryResearch(input(baseline(), { score, model: ENTRY_RESEARCH_MODEL_V1 }));
  assert.equal(v1.entryResearch.componentScores.structure, 32, "v1 keeps the five-category mean");
  assert.equal(v2.modelVersion, "entry-research-v2");
  assert.equal(ENTRY_RESEARCH_MODEL, ENTRY_RESEARCH_MODEL_V2, "v2 is the live model");
});

test("a stock without a bar on the evaluated session is pending, never an error", () => {
  const suspended = baseline().slice(0, -1);
  Object.assign(suspended[last - 3], { changePercent: -2, volume: 3_000_000 }); // an earlier heavy-selling day
  const result = gates(suspended);
  assert.equal(result.status, "UNKNOWN");
  assert.ok(Object.values(result.conditions).every((status) => status !== "PASS"), JSON.stringify(result.conditions));
  const research = evaluateEntryResearch(input(suspended));
  assert.equal(research.entryResearch.status, "DATA_INSUFFICIENT");
  assert.equal(research.nextDayPlan.status, "DATA_INSUFFICIENT");
});

test("v2 gates never read sessions after the evaluated date", () => {
  const bars = baseline(), asOfEarlier = dates[last - 5];
  const before = entryResearchGates({ ...input(bars), asOf: asOfEarlier });
  const changed = bars.map((bar, index) => index > last - 5
    ? { ...bar, close: 1, high: 2, low: 0.5, open: 1, ma20: 50, ma60: 90, volume: 1, changePercent: -50, institutions: flows(-1e9) } : bar);
  assert.deepEqual(entryResearchGates({ ...input(changed), asOf: asOfEarlier }), before);
});
