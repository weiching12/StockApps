import test from "node:test";
import assert from "node:assert/strict";
import { researchCardPrice } from "../src/ui/research.js";

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
