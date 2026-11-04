import test from "node:test";
import assert from "node:assert/strict";
import { priceBaseline, reviewEventTimeline } from "../shared/research-review.js";
import { addResearchPeriod, loadResearchStore, removeResearchPeriod } from "../src/ui/research-store.js";
import { HistoryService } from "../cloudflare/services/history-service.js";

const dates = ["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09",
  "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19",
  "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27",
  "2026-10-28", "2026-10-29", "2026-10-30"];

test("joining before and after close or on a weekend uses only the latest validated data already available", () => {
  for (const joinedAt of ["2026-10-02T04:00:00Z", "2026-10-02T08:00:00Z", "2026-10-04T08:00:00Z"]) {
    const known = joinedAt < "2026-10-02T08:00:00Z" ? "2026-10-01" : "2026-10-02";
    const price = priceBaseline({ close: 100 }, { asOf: known, capturedAt: joinedAt, source: "verified-summary" });
    assert.equal(price.asOf, known);
  }
  assert.equal(priceBaseline({ close: null }, { asOf: dates[0] }), null);
  assert.equal(priceBaseline({ close: 0 }, { asOf: dates[0] }), null);
});

test("legacy and rejoined periods never backfill an original join price", () => {
  const store = loadResearchStore(null, ["2330"], "2026-10-25T00:00:00Z");
  const legacy = store.periods[0];
  assert.equal(legacy.baseline, null);
  removeResearchPeriod(store, "2330", "2026-10-25T01:00:00Z");
  const newer = addResearchPeriod(store, { symbol: "2330", baseline: priceBaseline({ close: 120 }, { asOf: dates.at(-1) }) }, "2026-10-25T02:00:00Z");
  assert.equal(newer.baseline.close, 120);
  assert.equal(newer.firstValidPriceBaseline, null);
  assert.equal(store.periods.length, 2);
});

test("a missing session yields an observed-after-gap event instead of an exact transition day", () => {
  const base = { id: "a", asOf: dates[0], symbol: "2330", valid: true, modelVersion: "v1", strategy: "swing",
    configId: "a", priceBasis: "unadjusted", baseScore: 60, finalScore: 60,
    categories: Object.fromEntries(["trend", "momentum", "priceVolume", "institutional", "entryRisk"].map((key) => [key, { score: 60 }])),
    conditions: Object.fromEntries(["trend", "momentum", "priceVolume", "institutional", "entryRisk"].map((key) => [key, { status: "PASS" }])),
    passedCount: 4, totalConditions: 5, cap: {} };
  const history = [base, { asOf: dates[1], valid: false }, { ...base, id: "c", asOf: dates[2], passedCount: 5 }];
  const timeline = reviewEventTimeline(history, dates);
  assert.equal(timeline[0].type, "observed-after-gap");
  assert.match(timeline[0].reason, /前期資料不足/);
});

test("review API is read-only, one symbol, and bounded to 120 actual market dates", async () => {
  const allDates = Array.from({ length: 130 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
  const service = new HistoryService({ stock: async () => ({ source: "twse", asOf: allDates.at(-1), updatedAt: "t",
    stock: { tradingDates: allDates, history: allDates.map((date) => ({ date, close: 100 })) } }) },
  { window: async (sessions) => ({ coveredDates: new Set(sessions), eventsBySymbol: new Map() }), revision: async () => "r1" });
  const response = await service.review("2330");
  assert.equal(response.data.dates.length, 120);
  assert.equal(response.data.bars.length, 120);
  assert.equal(response.data.corporateActions.coveredDates.length, 119);
});
