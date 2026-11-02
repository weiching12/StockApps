import test from "node:test";
import assert from "node:assert/strict";
import { demoProvider } from "../src/data.js";
import { analyzeHistory, DEFAULT_SETTINGS, getSnapshot } from "../shared/indicators.js";
import { checkNextDayPlan, entryResearchSummary, evaluateEntryResearch, evaluateGates } from "../shared/entry-research.js";
import { ENTRY_RESEARCH_MODEL } from "../shared/entry-research-model.js";

const KEYS = ["trend", "momentum", "priceVolume", "institutional", "entryRisk"];
const dates = Array.from({ length: 90 }, (_, index) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10));
const asOf = dates.at(-1);

// A stubbed V1.2 result isolates the research stages from gate data preparation.
const stubScore = (statuses = {}, { missingData = [], category = 80, categories } = {}) => ({
  priceBasis: "unadjusted", missingData, conflictingEvidence: [],
  coreConditions: Object.fromEntries(KEYS.map((key) => [key, { status: statuses[key] ?? "PASS", reason: `${key} reason`, data: {} }])),
  categories: Object.fromEntries(KEYS.map((key) => [key, { score: categories?.[key] ?? category }])),
});

/** Hand-built analyzed bars: a steady uptrend whose lows stay clear of MA20 (no pullback),
 * with no session closing above the prior high (no trigger) unless a scenario says so. */
function baseline() {
  return dates.map((date, index) => {
    const close = 100 + index * 0.2;
    return { date, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1000,
      ma20: close - 3, ma60: close - 6, k: 60, d: 50, changePercent: 0.2 };
  });
}
const run = (bars, score = stubScore(), extra = {}) => evaluateEntryResearch({ stock: { symbol: "9999", history: bars },
  tradingDates: dates, asOf, score, settings: DEFAULT_SETTINGS, ...extra });

/** Pullback recovery triggered on session `at`. */
function pullback(bars, at, { kRising = true, kAboveD = true, volume = 1000, deepLow } = {}) {
  for (let back = 1; back <= 5; back++) {
    const bar = bars[at - back];
    bar.low = bar.ma20 + 0.5; // within MA20 + 0.5 × ATR14 (ATR ≈ 2)
  }
  if (deepLow) bars[at - 2].low = deepLow;
  const previous = bars[at - 1], today = bars[at];
  today.close = previous.high + 0.5; today.high = today.close + 0.5; today.open = previous.close;
  today.low = previous.close - 0.5; today.volume = volume;
  today.k = kRising ? previous.k + 5 : previous.k; today.d = kAboveD ? today.k - 5 : today.k + 5;
  return bars;
}

/** Flat 20-session range (99-101) and a breakout close on session `at`. */
function breakout(bars, at, { close = 102, volume = 3000 } = {}) {
  for (let back = 1; back <= 20; back++)
    Object.assign(bars[at - back], { open: 100, high: 101, low: 99, close: 100, ma20: 100, ma60: 95, volume: 1000 });
  Object.assign(bars[at], { open: 100.5, close, high: close + 0.5, low: 100.5, ma20: 100, ma60: 95, volume, k: 60, d: 50 });
  return bars;
}

test("stage 1 passes only when all five gates PASS with no missing prerequisites", () => {
  const pass = evaluateGates(stubScore());
  assert.equal(pass.status, "PASS");
  assert.equal(pass.passedCount, 5);
  const oneFail = evaluateGates(stubScore({ institutional: "FAIL" }));
  assert.equal(oneFail.status, "FAIL");
  assert.equal(oneFail.passedCount, 4);
  assert.match(oneFail.reasons[0], /^法人籌碼：/);
  const manyFail = evaluateGates(stubScore({ trend: "FAIL", momentum: "FAIL", entryRisk: "UNKNOWN" }));
  assert.equal(manyFail.status, "FAIL", "a FAIL is never softened by UNKNOWN or other strengths");
  assert.equal(manyFail.reasons.length, 3);
  const unknown = evaluateGates(stubScore({ priceVolume: "UNKNOWN" }));
  assert.equal(unknown.status, "UNKNOWN", "UNKNOWN is never treated as PASS");
  for (const reason of ["公司行動參考價無法核對；未還原價格不適合直接評分", "需截至評估日連續 61 個市場交易日行情", "近五日法人或成交量資料不完整"]) {
    const gate = evaluateGates(stubScore({}, { missingData: [reason] }));
    assert.equal(gate.status, "UNKNOWN", reason);
    assert.ok(gate.reasons.includes(reason));
  }
  assert.equal(evaluateGates(null).status, "UNKNOWN");
});

test("only gate PASS reaches stage 2; failed or unknown gates get no readiness score", () => {
  const failed = run(pullback(baseline(), 89), stubScore({ momentum: "FAIL" }));
  assert.equal(failed.entryResearch.status, "NOT_ELIGIBLE");
  assert.equal(failed.entryResearch.score, null);
  assert.equal(failed.nextDayPlan.status, "NOT_ELIGIBLE");
  assert.equal(failed.nextDayPlan.entryPriceUpper, null);
  const unknown = run(pullback(baseline(), 89), stubScore({}, { missingData: ["公司行動參考價無法核對；未還原價格不適合直接評分"] }));
  assert.equal(unknown.entryResearch.status, "DATA_INSUFFICIENT");
  assert.equal(unknown.entryResearch.score, null);
  assert.equal(unknown.nextDayPlan.status, "DATA_INSUFFICIENT");
  assert.equal(unknown.dataQuality.status, "INSUFFICIENT");
});

test("gates pass without a signal: waiting, with pending conditions and no plan prices", () => {
  const result = run(baseline());
  assert.equal(result.entryResearch.status, "WAIT_TRIGGER");
  assert.equal(result.entryResearch.signal, null);
  assert.ok(result.entryResearch.score > 0);
  assert.ok(result.entryResearch.pendingConditions.length > 0);
  assert.equal(result.nextDayPlan.status, "WAIT_TRIGGER");
  assert.equal(result.nextDayPlan.entryReferencePrice, null);
});

test("pullback recovery triggers and builds an ATR-based next-day plan", () => {
  const result = run(pullback(baseline(), 89));
  const { entryResearch: research, nextDayPlan: plan } = result;
  assert.equal(research.status, "TRIGGERED");
  assert.equal(research.setupType, "PULLBACK_RECOVERY");
  assert.equal(research.signal.date, asOf);
  assert.equal(research.signal.kdConfirmed, true);
  assert.equal(plan.status, "NEXT_DAY_CANDIDATE");
  assert.equal(plan.entryReferencePrice, plan.referenceClose);
  assert.ok(plan.entryPriceUpper > plan.entryReferencePrice);
  assert.ok(plan.invalidationPrice < research.signal.evidence.pullbackLow);
  assert.equal(plan.entryPriceLower, null, "the strategy defines no lower bound");
  assert.ok(Math.abs(plan.entryPriceUpper - plan.entryReferencePrice - 0.5 * plan.atr14) < 0.02);
  assert.ok(plan.riskPercent > 0 && plan.maxRiskPercent <= ENTRY_RESEARCH_MODEL.plan.maxRiskPercent);
  assert.equal(plan.requiresPriceConfirmation, true);
  assert.equal(plan.planAsOf, asOf);
  assert.deepEqual(Object.keys(research.componentScores), ["structure", "signal", "timing"]);
});

test("range breakout triggers on a first close above the range with RVOL confirmation", () => {
  const result = run(breakout(baseline(), 89));
  assert.equal(result.entryResearch.status, "TRIGGERED");
  assert.equal(result.entryResearch.setupType, "RANGE_BREAKOUT");
  assert.equal(result.entryResearch.signal.evidence.rangeHigh, 101);
  assert.equal(result.entryResearch.signal.evidence.rangeStart, dates[69]);
  assert.equal(result.entryResearch.signal.entryReferencePrice, 101);
  assert.equal(result.nextDayPlan.status, "NEXT_DAY_CANDIDATE");
  assert.equal(result.nextDayPlan.entryReferencePrice, 101);
  // Without volume confirmation there is no breakout trigger.
  assert.notEqual(run(breakout(baseline(), 89, { volume: 1000 })).entryResearch.setupType, "RANGE_BREAKOUT");
});

test("signals expire after their valid sessions and are invalidated by a close below invalidation", () => {
  const expired = run(pullback(baseline(), 86));
  assert.equal(expired.entryResearch.status, "SIGNAL_EXPIRED");
  assert.equal(expired.entryResearch.signal.age, 3);
  assert.equal(expired.nextDayPlan.status, "WAIT_TRIGGER");
  const stillValid = run(pullback(baseline(), 87));
  assert.equal(stillValid.entryResearch.status, "TRIGGERED", "trigger day plus two sessions");
  const yesterday = run(pullback(baseline(), 88));
  assert.equal(yesterday.entryResearch.status, "TRIGGERED");
  assert.equal(yesterday.entryResearch.signal.age, 1);
  const broken = pullback(baseline(), 88);
  Object.assign(broken[89], { close: 90, open: 91, high: 92, low: 89.5 });
  const result = run(broken);
  assert.equal(result.entryResearch.status, "SIGNAL_INVALIDATED");
  assert.equal(result.entryResearch.signal.invalidatedOn, asOf);
  assert.equal(result.nextDayPlan.status, "PLAN_INVALIDATED");
});

test("weak KD or volume confirmation is reported without hiding the trigger", () => {
  const result = run(pullback(baseline(), 89, { kAboveD: false, volume: 500 }));
  assert.equal(result.entryResearch.status, "TRIGGERED");
  assert.equal(result.entryResearch.signal.kdConfirmed, false);
  assert.equal(result.entryResearch.signal.volumeConfirmed, false);
  assert.ok(result.entryResearch.pendingConditions.includes("KD 動能尚未完全確認"));
  assert.ok(result.entryResearch.riskWarnings.includes("成交量未達確認標準"));
  assert.ok(result.entryResearch.componentScores.signal < run(pullback(baseline(), 89)).entryResearch.componentScores.signal);
});

test("prices far from the plan or with too wide a risk are not candidates", () => {
  const chased = run(breakout(baseline(), 89, { close: 104.5 })); // 3.47% above the 101 range high
  assert.equal(chased.entryResearch.status, "TRIGGERED");
  assert.equal(chased.nextDayPlan.status, "PRICE_TOO_HIGH");
  assert.match(chased.nextDayPlan.reasons.at(-1), /高於可接受上限/);
  assert.ok(chased.entryResearch.riskWarnings.some((warning) => warning.includes("追價風險")));
  const wide = run(pullback(baseline(), 89, { deepLow: 95 }));
  assert.equal(wide.entryResearch.status, "TRIGGERED");
  assert.equal(wide.nextDayPlan.status, "PRICE_TOO_HIGH");
  assert.match(wide.nextDayPlan.reasons.at(-1), /風險 .*超過 8%/);
});

test("a high readiness score never stands in for a missing trigger", () => {
  const waiting = run(baseline(), stubScore({}, { category: 100 }));
  const triggered = run(pullback(baseline(), 89), stubScore({}, { category: 55 }));
  assert.ok(waiting.entryResearch.score > triggered.entryResearch.score);
  assert.equal(waiting.entryResearch.status, "WAIT_TRIGGER");
  assert.equal(waiting.nextDayPlan.status, "WAIT_TRIGGER");
  assert.equal(triggered.nextDayPlan.status, "NEXT_DAY_CANDIDATE");
  // Waiting signal credit is capped below any triggered signal.
  assert.ok(waiting.entryResearch.componentScores.signal <= 50);
  assert.ok(triggered.entryResearch.componentScores.signal >= 60);
});

test("missing ATR14 inputs never produce plan prices", () => {
  const bars = pullback(baseline(), 89);
  bars[40].high = null; // inside the 61-session ATR window
  const result = run(bars);
  assert.equal(result.entryResearch.status, "DATA_INSUFFICIENT");
  assert.equal(result.nextDayPlan.status, "DATA_INSUFFICIENT");
  assert.equal(result.nextDayPlan.entryPriceUpper, null);
  assert.equal(result.nextDayPlan.invalidationPrice, null);
});

test("next-day check uses only the actual open and never assumes it equals the close", () => {
  const plan = run(pullback(baseline(), 89)).nextDayPlan;
  assert.equal(checkNextDayPlan(plan, null).status, "AWAITING_PRICE");
  assert.equal(checkNextDayPlan(plan, { open: plan.entryPriceUpper }).status, "WITHIN_PLAN");
  assert.equal(checkNextDayPlan(plan, { open: plan.entryPriceUpper }).fillPrice, plan.entryPriceUpper);
  assert.equal(checkNextDayPlan(plan, { open: plan.entryPriceUpper + 0.01 }).status, "OPEN_ABOVE_UPPER");
  assert.equal(checkNextDayPlan(plan, { open: plan.invalidationPrice }).status, "OPEN_BELOW_INVALIDATION");
  assert.equal(checkNextDayPlan({ status: "WAIT_TRIGGER" }, { open: 100 }).status, "NOT_APPLICABLE");
  // A plan never stretches its own limits to follow the market.
  const before = JSON.stringify(plan);
  checkNextDayPlan(plan, { open: plan.entryPriceUpper * 1.2 });
  assert.equal(JSON.stringify(plan), before);
});

test("demo market: invariants hold and results never use bars after the evaluated session", async () => {
  const dataset = await demoProvider.load();
  let triggered = 0;
  for (const asOfDate of dataset.dates.slice(-40)) {
    const known = dataset.dates.filter((date) => date <= asOfDate);
    for (const stock of dataset.stocks) {
      const truncated = getSnapshot({ ...stock, tradingDates: dataset.dates }, asOfDate, DEFAULT_SETTINGS);
      const result = evaluateEntryResearch({ stock: truncated, tradingDates: known, asOf: asOfDate, settings: DEFAULT_SETTINGS });
      // Same session evaluated with the full future history and calendar available.
      const withFuture = evaluateEntryResearch({ stock: { ...stock, history: analyzeHistory(stock.history, DEFAULT_SETTINGS) },
        tradingDates: dataset.dates, asOf: asOfDate, settings: DEFAULT_SETTINGS,
        score: undefined });
      const strip = (value) => ({ ...value, nextDayPlan: { ...value.nextDayPlan, planExpiresAt: null } });
      assert.deepEqual(strip(withFuture), strip(result), `${stock.symbol} ${asOfDate}`);
      const { gateResult: gate, entryResearch: research, nextDayPlan: plan } = result;
      assert.equal(gate.status === "PASS", KEYS.every((key) => gate.conditions[key] === "PASS") && !result.dataQuality.missing.length);
      if (gate.status !== "PASS") assert.equal(research.score, null);
      if (plan.status === "NEXT_DAY_CANDIDATE") {
        triggered++;
        assert.equal(research.status, "TRIGGERED");
        assert.ok(plan.invalidationPrice < plan.entryReferencePrice && plan.entryReferencePrice < plan.entryPriceUpper);
      }
      const summary = entryResearchSummary(result);
      assert.equal(summary.score, research.score);
      assert.equal(summary.nextDayStatus, plan.status);
    }
  }
  assert.ok(triggered > 0, "the demo market produces at least one candidate");
});
