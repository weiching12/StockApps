import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDatabase } from "./helpers/t86-db.js";
import { demoProvider } from "../src/data.js";
import { DEFAULT_SETTINGS, getSnapshot } from "../shared/indicators.js";
import { ENTRY_RESEARCH_MODEL } from "../shared/entry-research-model.js";
import { evaluateResearchOutcome } from "../shared/entry-research-outcome.js";
import { captureEntryResearch, retentionCutoff } from "../cloudflare/entry-research-capture.js";
import { isEtf } from "../shared/market-codec.js";
import { EntryResearchRepository } from "../cloudflare/repositories/entry-research-repository.js";
import { EntryResearchService } from "../cloudflare/services/entry-research-service.js";
import { routeApi } from "../cloudflare/api/router.js";

const dates = Array.from({ length: 40 }, (_, index) => new Date(Date.UTC(2026, 2, 1 + index)).toISOString().slice(0, 10));
const covered = (extra = {}) => ({ coveredDates: new Set(dates), eventsBySymbol: new Map(), ...extra });
const bars = (closeAt = (index) => 100 + index) => dates.map((date, index) => {
  const close = closeAt(index);
  return { date, open: close - 0.5, high: close + 1, low: close - 1, close };
});
const plan = { status: "NEXT_DAY_CANDIDATE", entryReferencePrice: 105, entryPriceUpper: 106, invalidationPrice: 100 };
const sample = (overrides = {}) => ({ symbol: "2330", tradeDate: dates[5], referenceClose: 105, nextDayPlan: plan, ...overrides });

test("outcomes stay PENDING until enough later sessions exist and never fill missing values with zero", () => {
  const early = evaluateResearchOutcome(sample({ tradeDate: dates[30] }), { tradingDates: dates, history: bars(), corporateActions: covered() });
  assert.equal(early.status, "PENDING");
  assert.equal(early.horizons[1].status, "COMPLETE");
  assert.equal(early.horizons[20].status, "PENDING");
  assert.equal(early.horizons[20].returnPercent, undefined);
  assert.equal(early.excursion.status, "PENDING");
  const done = evaluateResearchOutcome(sample(), { tradingDates: dates, history: bars(), corporateActions: covered() });
  assert.equal(done.status, "COMPLETE");
  assert.equal(done.horizons[5].close, 110);
  assert.ok(Math.abs(done.horizons[5].returnPercent - (110 / 105 - 1) * 100) < 1e-3);
  assert.ok(Math.abs(done.excursion.mfePercent - (126 / 105 - 1) * 100) < 1e-3); // highest high over 20 sessions
  assert.equal(done.excursion.hitInvalidation, false);
  assert.equal(done.excursion.targetPrice, 115);
  assert.equal(done.excursion.hitTarget, true);
});

test("corporate actions, unverified coverage and suspensions block comparisons instead of guessing", () => {
  const events = new Map([["2330", new Map([[dates[8], { kind: "息" }]])]]);
  const withEvent = evaluateResearchOutcome(sample(), { tradingDates: dates, history: bars(), corporateActions: covered({ eventsBySymbol: events }) });
  assert.equal(withEvent.horizons[1].status, "COMPLETE");
  assert.equal(withEvent.horizons[5].status, "UNAVAILABLE");
  assert.match(withEvent.horizons[5].reason, /除權息/);
  const unverified = evaluateResearchOutcome(sample(), { tradingDates: dates, history: bars(),
    corporateActions: covered({ coveredDates: new Set(dates.slice(0, 8)) }) });
  assert.equal(unverified.horizons[1].status, "COMPLETE");
  assert.equal(unverified.horizons[5].status, "PENDING");
  const history = bars().filter((bar) => bar.date !== dates[9]); // suspended session
  const suspended = evaluateResearchOutcome(sample(), { tradingDates: dates, history, corporateActions: covered() });
  assert.equal(suspended.horizons[5].status, "UNAVAILABLE");
});

test("simulated trades fill at the next open only within the plan and include costs", () => {
  const notCandidate = evaluateResearchOutcome(sample({ nextDayPlan: { status: "WAIT_TRIGGER" } }), { tradingDates: dates, history: bars(), corporateActions: covered() });
  assert.equal(notCandidate.trade.status, "NOT_APPLICABLE");
  const gapUp = bars(); gapUp[6] = { ...gapUp[6], open: 107 };
  assert.equal(evaluateResearchOutcome(sample(), { tradingDates: dates, history: gapUp, corporateActions: covered() }).trade.status, "OPEN_ABOVE_UPPER");
  const gapDown = bars(); gapDown[6] = { ...gapDown[6], open: 100 };
  assert.equal(evaluateResearchOutcome(sample(), { tradingDates: dates, history: gapDown, corporateActions: covered() }).trade.status, "OPEN_BELOW_INVALIDATION");
  const filled = evaluateResearchOutcome(sample(), { tradingDates: dates, history: bars(), corporateActions: covered() }).trade;
  assert.equal(filled.status, "FILLED");
  assert.equal(filled.fillDate, dates[6]);
  assert.equal(filled.fillPrice, 105.5);
  const exit5 = filled.exits[5];
  assert.equal(exit5.exitReason, "HORIZON");
  assert.equal(exit5.exitDate, dates[11]);
  assert.ok(exit5.netReturnPercent < exit5.grossReturnPercent, "commission, tax and slippage reduce the result");
  // A close below invalidation exits at the following open, never at an assumed intraday price.
  const falling = bars((index) => index <= 7 ? 100 + index : 95);
  const stopped = evaluateResearchOutcome(sample(), { tradingDates: dates, history: falling, corporateActions: covered() }).trade.exits[5];
  assert.equal(stopped.exitReason, "STOP");
  assert.equal(stopped.exitDate, dates[9]);
  assert.equal(stopped.exitPrice, 94.5);
});

// --- Capture job against real SQLite with the D1 interface ---
const dataset = await demoProvider.load();
// ETFs are not researched, so only companies are saved as samples.
const companies = dataset.stocks.filter((stock) => !isEtf(stock)).length;
function marketAt(asOf, generation) {
  const known = dataset.dates.filter((date) => date <= asOf);
  const stocks = dataset.stocks.map((stock) => {
    const snapshot = getSnapshot({ ...stock, tradingDates: known }, asOf, DEFAULT_SETTINGS);
    snapshot.history = snapshot.history.slice(-80);
    return snapshot;
  });
  const actions = { revision: async () => "actions-1",
    window: async (window) => ({ coveredDates: new Set(window), eventsBySymbol: new Map() }) };
  return () => ({ market: { market: async () => ({ asOf, generation }) }, actions,
    summary: { snapshots: async () => ({ asOf, dates: known, stocks }) } });
}
function database() {
  const db = testDatabase();
  db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0010_entry_research.sql", import.meta.url), "utf8"));
  return db;
}

test("daily capture saves every listed stock once, keeps first captures and completes outcomes later", async () => {
  const db = database(), env = { T86_DB: db };
  const first = dataset.dates[120], later = dataset.dates[150];
  const saved = await captureEntryResearch(env, { createServices: marketAt(first, "g1"), now: () => new Date("2026-08-01T12:00:00Z") });
  assert.equal(saved.status, "saved");
  assert.equal(saved.inserted, companies, "failed-gate stocks are saved too");
  const counts = db.sqlite.prepare("SELECT GateStatus, COUNT(*) AS n FROM entry_research_samples GROUP BY GateStatus").all();
  assert.ok(counts.some((row) => row.GateStatus === "FAIL"));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM entry_research_samples WHERE Symbol GLOB '00*'").get().n, 0, "ETFs are never sampled");
  const failed = db.sqlite.prepare("SELECT * FROM entry_research_samples WHERE GateStatus='FAIL' LIMIT 1").get();
  assert.equal(failed.ReadinessScore, null);
  assert.equal(failed.NextDayStatus, "NOT_ELIGIBLE");
  assert.ok(JSON.parse(failed.DetailJson).gate.reasons.length > 0);
  // Later cron ticks for the same revision do nothing.
  assert.equal((await captureEntryResearch(env, { createServices: marketAt(first, "g1") })).status, "already-saved");
  // A corrected publication of the same date is recorded but never overwrites the samples.
  const before = db.sqlite.prepare("SELECT DetailJson, CapturedAt FROM entry_research_samples WHERE Symbol='2330' AND TradeDate=?").get(first);
  const corrected = await captureEntryResearch(env, { createServices: marketAt(first, "g1-corrected"), now: () => new Date("2026-08-01T13:00:00Z") });
  assert.equal(corrected.inserted, 0);
  assert.equal(corrected.skipped, companies);
  assert.deepEqual(db.sqlite.prepare("SELECT DetailJson, CapturedAt FROM entry_research_samples WHERE Symbol='2330' AND TradeDate=?").get(first), before);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM entry_research_runs").get().n, 2);
  const pending = db.sqlite.prepare("SELECT Status, Return20 FROM entry_research_outcomes WHERE TradeDate=?").all(first);
  assert.ok(pending.every((row) => row.Status === "PENDING" && row.Return20 === null));
  // Thirty sessions later the earlier samples' outcomes are complete.
  const next = await captureEntryResearch(env, { createServices: marketAt(later, "g2"), now: () => new Date("2026-09-15T12:00:00Z") });
  assert.equal(next.inserted, companies);
  assert.ok(next.outcomeUpdates >= companies);
  const complete = db.sqlite.prepare("SELECT Status, Return5, Return20, Mfe20, Mae20 FROM entry_research_outcomes WHERE TradeDate=?").all(first);
  assert.ok(complete.every((row) => row.Status === "COMPLETE" && Number.isFinite(row.Return20) && row.Mfe20 >= row.Mae20));
  db.sqlite.close();
});

test("samples API filters saved research and returns explanations on request", async () => {
  const db = database(), env = { T86_DB: db };
  await captureEntryResearch(env, { createServices: marketAt(dataset.dates[150], "g1") });
  const services = { market: {}, entryResearch: new EntryResearchService(new EntryResearchRepository(db)), signedInUser: async () => ({ user: { username: "t" } }) };
  const get = async (query) => {
    const response = await routeApi(new Request(`https://example.test/api/v1/research/samples${query}`), env, services);
    return { status: response.status, body: await response.json() };
  };
  // A sample stored for an ETF before they were excluded stays out of every result.
  db.sqlite.exec("PRAGMA foreign_keys=OFF");
  const columns = db.sqlite.prepare("PRAGMA table_info(entry_research_samples)").all().map(({ name }) => name);
  db.sqlite.prepare(`INSERT INTO entry_research_samples (${columns.join(",")}) SELECT ${columns.map((name) => name === "Symbol" ? "'0050'" : name).join(",")} FROM entry_research_samples LIMIT 1`).run();
  db.sqlite.exec("PRAGMA foreign_keys=ON");
  const all = await get("?limit=5");
  assert.equal(all.status, 200);
  assert.equal(all.body.meta.total, companies);
  assert.equal((await get("?symbol=0050")).body.meta.total, 0);
  assert.equal(all.body.data.length, 5);
  assert.equal(all.body.meta.provisional, true);
  assert.equal(all.body.data[0].detail, undefined);
  const failed = await get("?gate=FAIL&limit=200");
  assert.ok(failed.body.data.length > 0 && failed.body.data.every((row) => row.gate.status === "FAIL" && row.readiness.score === null));
  const one = await get(`?symbol=2330&from=${dataset.dates[150]}&to=${dataset.dates[150]}&detail=1`);
  assert.equal(one.body.data.length, 1);
  assert.ok(one.body.data[0].detail.gate.conditions.trend.reason);
  assert.equal(one.body.data[0].outcome.status, "PENDING");
  for (const bad of ["?gate=MAYBE", "?from=2026-13-01", "?minScore=120", "?minScore=80&maxScore=10", "?symbol=../x", "?limit=500"])
    assert.equal((await get(bad)).status, 400, bad);
  db.sqlite.close();
});

test("samples, outcomes and runs older than six months are removed after each capture", async () => {
  assert.equal(retentionCutoff("2026-11-03"), "2026-05-03");
  assert.equal(retentionCutoff("2026-08-31"), "2026-02-28");
  const db = database(), env = { T86_DB: db };
  const asOf = dataset.dates[150];
  await captureEntryResearch(env, { createServices: marketAt(dataset.dates[120], "g1") });
  const old = retentionCutoff(asOf);
  // Age one saved session past the cutoff; keep one inside it.
  db.sqlite.exec("PRAGMA foreign_keys=OFF");
  for (const table of ["entry_research_outcomes", "entry_research_samples", "entry_research_runs"])
    db.sqlite.prepare(`UPDATE ${table} SET TradeDate='2000-01-03'`).run();
  db.sqlite.exec("PRAGMA foreign_keys=ON");
  const result = await captureEntryResearch(env, { createServices: marketAt(asOf, "g2") });
  assert.equal(result.pruned.samples, companies);
  assert.ok(result.pruned.outcomes > 0 && result.pruned.runs === 1);
  const dates = db.sqlite.prepare("SELECT DISTINCT TradeDate FROM entry_research_samples").all().map((row) => row.TradeDate);
  assert.deepEqual(dates, [asOf]);
  assert.ok(old < asOf);
  db.sqlite.close();
});

test("the research model keeps its provisional parameters in one versioned place", () => {
  assert.equal(ENTRY_RESEARCH_MODEL.provisional, true);
  assert.deepEqual(ENTRY_RESEARCH_MODEL.weights, { structure: 50, signal: 30, timing: 20 });
  assert.deepEqual(ENTRY_RESEARCH_MODEL.outcomeHorizons, [1, 5, 10, 20]);
  assert.throws(() => { ENTRY_RESEARCH_MODEL.plan.maxRiskPercent = 50; });
});

test("backtest API aggregates filtered samples in SQL and flags small groups", async () => {
  const db = database();
  const insert = db.sqlite.prepare(`INSERT INTO entry_research_samples(Symbol,TradeDate,ModelVersion,Source,RevisionId,Close,
    GateStatus,GatePassed,Trend,Momentum,PriceVolume,Institutional,EntryRisk,ReadinessScore,EntryStatus,SetupType,NextDayStatus,
    DataQuality,CapturedAt,DetailJson) VALUES(?,?,?,'daily','r',100,?,?,'PASS','PASS','PASS','PASS','PASS',?,?,?,?,'OK','t','{}')`);
  const outcome = db.sqlite.prepare(`INSERT INTO entry_research_outcomes(Symbol,TradeDate,ModelVersion,Status,Return5,Return10,
    Return20,Mfe20,Mae20,TradeStatus,TradeReturn5,TradeReturn10,TradeReturn20,DetailJson,UpdatedAt)
    VALUES(?,?,'entry-research-v3','COMPLETE',?,?,?,?,?,?,?,?,?,'{}','t')`);
  // Two dates: a breakout winning 10% and a pullback losing 5% on day one, a pullback winning 4% on day two.
  insert.run("1101", "2026-09-01", "entry-research-v3", "PASS", 5, 85, "TRIGGERED", "RANGE_BREAKOUT", "NEXT_DAY_CANDIDATE");
  outcome.run("1101", "2026-09-01", 6, 10, 12, 15, -3, "FILLED", 5, 10, 11);
  insert.run("1102", "2026-09-01", "entry-research-v3", "PASS", 5, 72, "TRIGGERED", "PULLBACK_RECOVERY", "NEXT_DAY_CANDIDATE");
  outcome.run("1102", "2026-09-01", -4, -5, -6, 2, -8, "FILLED", -4, -5, -7);
  insert.run("1103", "2026-09-02", "entry-research-v3", "PASS", 5, 75, "TRIGGERED", "PULLBACK_RECOVERY", "NEXT_DAY_CANDIDATE");
  outcome.run("1103", "2026-09-02", 3, 4, 2, 6, -1, "FILLED", 3, 4, null);
  insert.run("1104", "2026-09-02", "entry-research-v3", "FAIL", 3, null, "NOT_ELIGIBLE", null, "NOT_ELIGIBLE");
  outcome.run("1104", "2026-09-02", -50, -50, -50, 1, -60, "NOT_APPLICABLE", null, null, null);
  insert.run("1105", "2026-09-02", "entry-research-v0", "PASS", 5, 90, "TRIGGERED", "RANGE_BREAKOUT", "NEXT_DAY_CANDIDATE");
  const services = { market: {}, entryResearch: new EntryResearchService(new EntryResearchRepository(db)), signedInUser: async () => ({ user: { username: "t" } }) };
  const get = async (query) => {
    const response = await routeApi(new Request(`https://example.test/api/v1/research/backtest${query}`), { T86_DB: db }, services);
    return { status: response.status, body: await response.json() };
  };
  const { status, body } = await get("");
  assert.equal(status, 200);
  const { data, meta } = body;
  assert.equal(meta.horizon, 10);
  assert.equal(meta.minimumSamples, 30);
  assert.deepEqual([data.totals.samples, data.totals.gatePass, data.totals.candidates, data.totals.filled, data.totals.sessions],
    [4, 3, 3, 3, 2], "other model versions are excluded");
  assert.equal(data.trades.count, 3);
  assert.equal(data.trades.winRate, 66.7);
  assert.equal(data.trades.averageReturn, 3);
  assert.equal(data.trades.averageWin, 7);
  assert.equal(data.trades.averageLoss, -5);
  assert.equal(data.trades.insufficient, true);
  assert.equal(data.forward.count, 4, "forward returns include failed-gate samples");
  // Day one averages 2.5%, day two 4%, each on a tenth of the account (10-session holds):
  // 1.0025 × 1.004 − 1 = 0.65%; no drawdown.
  assert.deepEqual(data.equity.map(({ date, cumulativeReturn }) => [date, cumulativeReturn]), [["2026-09-01", 0.25], ["2026-09-02", 0.65]]);
  assert.equal(data.trades.maxDrawdown, 0);
  assert.deepEqual(data.readinessBuckets.map(({ min, samples }) => [min, samples]), [[0, 0], [40, 0], [60, 0], [70, 2], [80, 1], [90, 0]]);
  const pullback = data.setups.find((row) => row.setupType === "PULLBACK_RECOVERY");
  assert.deepEqual([pullback.samples, pullback.trades.count, pullback.trades.averageReturn], [2, 2, -0.5]);
  assert.deepEqual(data.horizons.map(({ days, trades }) => [days, trades.count]), [[5, 3], [10, 3], [20, 2]]);
  assert.equal(data.totals.tradePending, 0);
  assert.deepEqual(data.distribution.map(({ from, count }) => [from, count]), [[-6, 1], [4, 1], [10, 1]]);
  assert.deepEqual(data.daily.map(({ date, samples }) => [date, samples]), [["2026-09-01", 2], ["2026-09-02", 2]]);
  const longer = await get("?horizon=20&setup=PULLBACK_RECOVERY");
  assert.equal(longer.body.data.trades.count, 1);
  assert.equal(longer.body.data.totals.tradePending, 1, "a fill without a 20-session exit is pending, not zero");
  const empty = await get("?from=2027-01-01");
  assert.equal(empty.body.data.totals.samples, 0);
  assert.equal(empty.body.data.trades.averageReturn, null);
  assert.deepEqual(empty.body.data.equity, []);
  for (const bad of ["?horizon=7", "?gate=MAYBE", "?from=2026-09-05&to=2026-09-01"])
    assert.equal((await get(bad)).status, 400, bad);
  db.sqlite.close();
});

test("research samples and backtests need a signed-in session and are never cached", async () => {
  const services = { market: {}, entryResearch: new EntryResearchService(new EntryResearchRepository(database())) };
  for (const path of ["samples", "backtest"]) {
    const request = () => new Request(`https://example.test/api/v1/research/${path}`);
    const anonymous = await routeApi(request(), { T86_DB: database() }, services);
    assert.equal(anonymous.status, 401, path);
    const refused = await routeApi(request(), {}, { ...services, signedInUser: async () => ({ failure: new Response(null, { status: 403 }) }) });
    assert.equal(refused.status, 403, path);
    const allowed = await routeApi(request(), {}, { ...services, signedInUser: async () => ({ user: { username: "t" } }) });
    assert.equal(allowed.status, 200, path);
    assert.equal(allowed.headers.get("cache-control"), "no-store", path);
  }
});
