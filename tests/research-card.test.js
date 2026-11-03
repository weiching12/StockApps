import test from "node:test";
import assert from "node:assert/strict";
import { researchCardPrice } from "../src/ui/research.js";

const keys = ["trend", "momentum", "priceVolume", "institutional", "entryRisk"];
function snapshot(asOf, finalScore, options = {}) {
  const conditions = Object.fromEntries(keys.map((key) => [key, { status: options.failed === key ? "FAIL" : "PASS" }]));
  return {
    id: `${asOf}-${finalScore}`, asOf, valid: true, symbol: "2330", modelVersion: "entry-score-v1.2",
    strategy: "swing-trend", configId: options.configId ?? "default", priceBasis: "unadjusted",
    source: "daily", baseScore: finalScore, finalScore, conditions,
    categories: Object.fromEntries(keys.map((key) => [key, { score: finalScore, creditedContribution: finalScore / 5 }])),
    passedCount: options.failed ? 4 : 5, totalConditions: 5,
    cap: { enabled: false, value: null, reason: null }, ...options,
  };
}

test("card price shows an absolute closing-price difference from the saved join baseline", () => {
  const period = { baseline: { asOf: "2026-10-22", close: 48.2, priceBasis: "unadjusted" } };
  const result = researchCardPrice(period, { latest: { asOf: "2026-10-28", close: 47.5, valid: false } });
  assert.equal(result.close, 47.5);
  assert(Math.abs(result.delta + .7) < 1e-10);
  assert.equal(result.baseline.asOf, "2026-10-22");
});

test("a saved join snapshot can supply its observed close but a later first-valid baseline cannot", () => {
  const row = { latest: { asOf: "2026-10-28", close: 52 } };
  assert.equal(researchCardPrice({ addedSnapshot: { asOf: "2026-10-22", close: 50, priceBasis: "reference-adjusted" } }, row).delta, 2);
  assert.equal(researchCardPrice({ firstValidPriceBaseline: { asOf: "2026-10-27", close: 51 } }, row).delta, null);
});

test("card price rejects stale closes, later join dates and different price bases", () => {
  const baseline = { asOf: "2026-10-22", close: 50, priceBasis: "unadjusted" };
  assert.equal(researchCardPrice({ baseline }, { latest: { asOf: "2026-10-27", close: 51 } }, { latest: { date: "2026-10-27", close: 51 } }, "2026-10-28").close, null);
  assert.equal(researchCardPrice({ baseline: { ...baseline, asOf: "2026-10-29" } }, { latest: { asOf: "2026-10-28", close: 52 } }).delta, null);
  assert.equal(researchCardPrice({ baseline: { ...baseline, priceBasis: "adjusted" } }, { latest: { asOf: "2026-10-28", close: 52 } }).delta, null);
});
