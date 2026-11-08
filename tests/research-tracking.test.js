import test from "node:test";
import assert from "node:assert/strict";
import { compareResearchSnapshots, RESEARCH_CHANGE_THRESHOLD } from "../shared/research-tracking.js";
import { researchSnapshot } from "./helpers/research-snapshot.js";
import { addResearchPeriod, activeResearchPeriod, loadResearchStore, persistResearchStore, removeResearchPeriod } from "../src/ui/research-store.js";

const keys = ["trend", "momentum", "priceVolume", "institutional", "entryRisk"];
const weights = { trend: 25, momentum: 15, priceVolume: 15, institutional: 20, entryRisk: 25 };
function score({ base = 70, final = base, failed = [], cap = { enabled: false, value: null, reason: null }, version = "entry-score-v1.2", missing = false } = {}) {
  return { modelVersion: version, strategy: "swing-trend", priceBasis: "unadjusted", weights,
    baseScore: missing ? null : base, finalScore: missing ? null : final,
    rawBaseScore: missing ? null : base + .004, rawFinalScore: missing ? null : final + .004,
    rawCategories: Object.fromEntries(keys.map((key) => [key, { score: base,
      contribution: base * weights[key] / 100, creditedContribution: failed.includes(key) ? 0 : base * weights[key] / 100 }])),
    coreConditions: Object.fromEntries(keys.map((key) => [key, { status: failed.includes(key) ? "FAIL" : "PASS", reason: key }])),
    passedCount: 5 - failed.length, totalConditions: 5, cap, metrics: { close: 80 },
    missingData: missing ? ["行情不足"] : [] };
}
const snap = (data, asOf, extra = {}) => researchSnapshot(score(data), { symbol: "2330", market: "TWSE", asOf,
  capturedAt: `${asOf}T10:00:00Z`, generation: "gen-a", settings: { period: 9, kSmooth: 3, dSmooth: 3 }, ...extra });

test("snapshot retains calculation precision, core conditions, config and genuine missing values", () => {
  const full = snap({}, "2026-10-16");
  assert.equal(full.baseScore, 70.004);
  assert.equal(full.categories.trend.contribution, 17.5);
  assert.equal(full.cap.enabled, false);
  assert.match(full.configId, /kd-9-3-3/);
  const absent = snap({ missing: true }, "2026-10-16");
  assert.equal(absent.finalScore, null);
  assert.deepEqual(absent.missingData, ["行情不足"]);
});

test("compares both scores, cap transitions, conditions and threshold with stable event keys", () => {
  const before = snap({ base: 80, final: 70, failed: ["trend"] }, "2026-10-15");
  const after = snap({ base: 85, final: 60, cap: { enabled: true, value: 60, reason: "條件不足" } }, "2026-10-16");
  const result = compareResearchSnapshots(after, before, "2026-10-15");
  assert.equal(result.baseDelta, 5);
  assert.ok(Math.abs(result.finalDelta + 10) < 1e-9);
  assert.equal(result.conditionsImproved, true);
  assert.equal(result.capChanged, true);
  assert.ok(result.events.some((event) => event.type === "cap-enabled"));
  assert.ok(result.events.some((event) => event.type === "final-score-change"));
  assert.equal(result.events.some((event) => event.type === "base-score-change"), false);
  assert.match(result.summary, /^分數下降 10\.00 分/);
  assert.doesNotMatch(result.summary, /基礎分數|最終分數/);
  assert.deepEqual(result.events.map((event) => event.key),
    compareResearchSnapshots(after, before, "2026-10-15").events.map((event) => event.key));
  assert.equal(RESEARCH_CHANGE_THRESHOLD, 10);
});

test("missing previous market day, settings mismatch and incomplete data never imply zero delta", () => {
  const prior = snap({}, "2026-10-14");
  const current = snap({}, "2026-10-16");
  assert.equal(compareResearchSnapshots(current, prior, "2026-10-15").status, "missing-previous");
  assert.equal(compareResearchSnapshots(current, null, "2026-10-15").finalDelta, undefined);
  const otherModel = snap({ version: "entry-score-v2" }, "2026-10-15");
  assert.equal(compareResearchSnapshots(current, otherModel, "2026-10-15").status, "incompatible");
  const otherSettings = snap({}, "2026-10-15", { settings: { period: 12, kSmooth: 3, dSmooth: 3 } });
  assert.equal(compareResearchSnapshots(current, otherSettings, "2026-10-15").status, "incompatible");
  const otherWeights = { ...snap({}, "2026-10-15"), weights: { ...weights, trend: 30 }, configId: "custom-weights" };
  assert.equal(compareResearchSnapshots(current, otherWeights, "2026-10-15").status, "incompatible");
  assert.equal(compareResearchSnapshots(current, { ...snap({}, "2026-10-15"), priceBasis: "adjusted" }, "2026-10-15").status, "incompatible");
  const becameValid = compareResearchSnapshots(current, snap({ missing: true }, "2026-10-15"), "2026-10-15");
  assert.equal(becameValid.status, "insufficient");
  assert.equal(becameValid.events[0].type, "became-scorable");
  assert.equal(compareResearchSnapshots(current, { ...current, id: "old" }, "2026-10-16").status, "revision");
});

test("cap release and condition loss remain distinct from category score movement", () => {
  const before = snap({ base: 82, final: 60, cap: { enabled: true, value: 60, reason: "測試上限" } }, "2026-10-15");
  const after = snap({ base: 83, final: 70, failed: ["momentum"] }, "2026-10-16");
  const result = compareResearchSnapshots(after, before, "2026-10-15");
  assert.ok(result.events.some((event) => event.type === "cap-released"));
  assert.ok(result.events.some((event) => event.type === "all-conditions-lost"));
  assert.ok(Math.abs(result.baseDelta - 1) < 1e-9);
  assert.ok(Math.abs(result.finalDelta - 10) < 1e-9);
});

test("legacy favorites keep unknown original time; removing and readding starts a new period", () => {
  const storage = new Map();
  const adapter = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const store = loadResearchStore(adapter, ["2330"], "2026-10-25T00:00:00Z");
  const legacy = activeResearchPeriod(store, "2330");
  assert.equal(legacy.addedAt, null);
  assert.equal(legacy.startedAt, "2026-10-25T00:00:00Z");
  assert.equal(legacy.addedSnapshot, null);
  removeResearchPeriod(store, "2330", "2026-10-25T01:00:00Z");
  const next = addResearchPeriod(store, { symbol: "2330", market: "TWSE", snapshot: snap({ missing: true }, "2026-10-24") }, "2026-10-25T02:00:00Z");
  assert.notEqual(next.id, legacy.id);
  assert.equal(next.addedSnapshot.finalScore, null);
  assert.equal(next.firstValidSnapshot, null);
  assert.equal(next.addedSnapshot.valid, false);
  assert.equal(persistResearchStore(adapter, store), true);
  assert.equal(loadResearchStore(adapter, ["2330"]).periods.length, 2);
});

test("V3 migration removes retired local research notes without inventing a join baseline", () => {
  const saved = { version: 2, periods: [{ id: "old", symbol: "2330", removedAt: null,
    reason: "觀察趨勢延續", note: "舊備註" }] };
  let stored = JSON.stringify(saved);
  const storage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  const store = loadResearchStore(storage, ["2330"]);
  assert.equal(store.version, 3);
  assert.equal("reason" in store.periods[0], false);
  assert.equal("note" in store.periods[0], false);
  assert.equal(store.periods[0].baseline, null);
  assert.equal(persistResearchStore(storage, store), true);
  assert.equal(stored.includes("舊備註"), false);
  assert.equal(stored.includes("觀察趨勢延續"), false);
});
