import test from "node:test";
import assert from "node:assert/strict";
import { MarketSyncCoordinator, coordinateMarketSync } from "../cloudflare/sync/coordinator.js";
import { CoordinatorStore } from "../cloudflare/sync/coordinator-store.js";
import { MANIFEST_KEY, SYNC_KEY } from "../cloudflare/storage/market-keys.js";
import { syncMarket } from "../cloudflare/sync.js";

const time = Date.parse("2026-10-21T10:30:00Z");
const tick = (ms = time) => new Request(`https://internal/tick?time=${ms}`, { method: "POST" });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const data = new Map(), remote = new Map(), puts = [];
  const storage = { get: async (key) => structuredClone(data.get(key)),
    put: async (key, value) => { data.set(key, structuredClone(value)); },
    delete: async (key) => data.delete(key) };
  const kv = { get: async (key, type) => type === "json" ? structuredClone(remote.get(key) ?? null) :
    remote.has(key) ? JSON.stringify(remote.get(key)) : null,
  put: async (key, raw) => { puts.push(key); remote.set(key, JSON.parse(raw)); },
  delete: async (key) => remote.delete(key) };
  const env = { MARKET_DATA: kv };
  return { data, remote, puts, storage, kv, env, create: () => new MarketSyncCoordinator({ storage }, env) };
}

test("overlapping duplicate ticks execute once even across external I/O", async () => {
  const f = fixture(), coordinator = f.create(), entered = deferred(), release = deferred();
  let calls = 0;
  coordinator.run = async (env) => {
    calls++; entered.resolve(); await release.promise;
    const state = { phase: "catalog" };
    await env.MARKET_DATA.put(SYNC_KEY, JSON.stringify(state)); return state;
  };
  const first = coordinator.fetch(tick()); await entered.promise;
  const duplicate = coordinator.fetch(tick()); release.resolve();
  assert.equal((await (await first).json()).phase, "catalog");
  assert.equal((await (await duplicate).json()).duplicate, true);
  assert.equal(calls, 1); assert.equal(f.puts.length, 0);
});

test("distinct ticks run serially and restart imports durable progress, not stale KV", async () => {
  const f = fixture(), c = f.create(); let active = 0, max = 0;
  c.run = async (env) => {
    max = Math.max(max, ++active);
    await Promise.resolve();
    const prior = await env.MARKET_DATA.get(SYNC_KEY, "json");
    const state = { phase: "shards", nextShard: (prior?.nextShard ?? 0) + 32 };
    await env.MARKET_DATA.put(SYNC_KEY, JSON.stringify(state)); active--; return state;
  };
  await Promise.all([c.fetch(tick()), c.fetch(tick(time + 60000))]);
  assert.equal(max, 1); assert.equal(f.data.get("progress").nextShard, 64);
  f.remote.set(SYNC_KEY, { nextShard: 0 });
  const restarted = f.create(); restarted.run = c.run;
  await restarted.fetch(tick(time + 120000));
  assert.equal(f.data.get("progress").nextShard, 96);
  assert.equal((await (await restarted.fetch(tick())).json()).duplicate, true);
});

test("unhandled errors release the queue and permit retry of the same timestamp", async () => {
  const f = fixture(), c = f.create(); let calls = 0;
  c.run = async () => { if (++calls === 1) throw new Error("interrupted"); return { phase: "catalog" }; };
  await assert.rejects(c.fetch(tick()), /interrupted/);
  assert.equal((await c.fetch(tick())).status, 200); assert.equal(calls, 2);
});

test("coordinator resumes pending publication after interrupted KV write", async () => {
  const f = fixture(), adapter = new CoordinatorStore(f.storage, f.kv);
  const next = { generation: "new", previousGeneration: "old" };
  const original = f.kv.put; f.kv.put = async () => { throw new Error("KV unavailable"); };
  await assert.rejects(adapter.put(MANIFEST_KEY, JSON.stringify(next)), /KV unavailable/);
  assert.ok(f.data.has("pendingManifest"));
  f.kv.put = original;
  const restarted = new CoordinatorStore(f.storage, f.kv);
  await restarted.recoverPublication();
  assert.deepEqual(await restarted.get(MANIFEST_KEY, "json"), next);
  assert.deepEqual(f.remote.get(MANIFEST_KEY), next);
  assert.equal(f.data.has("pendingManifest"), false);
});

test("published generation recovery never creates a self-referencing previous generation", async () => {
  const f = fixture();
  const state = { date: "2026-10-21", slot: "18:30", generation: "new", phase: "publish", reportDates: ["2026-10-21"] };
  f.remote.set(SYNC_KEY, state);
  f.remote.set(MANIFEST_KEY, { generation: "new", previousGeneration: "old" });
  const result = await syncMarket(f.env, { now: new Date(time), t86Store: {} });
  assert.equal(result.phase, "done");
  assert.equal(f.remote.get(MANIFEST_KEY).previousGeneration, "old");
  assert.deepEqual(f.puts, [SYNC_KEY]);
});

test("interrupted publication retries its uncheckpointed notification once", async () => {
  const f = fixture();
  f.remote.set(SYNC_KEY, { date: "2026-10-21", slot: "18:30", generation: "new", phase: "publish",
    reportDates: ["2026-10-21"] });
  f.remote.set(MANIFEST_KEY, { generation: "new", asOf: "2026-10-21" });
  const calls = [];
  const options = { t86Store: {}, pushServiceFactory: () => ({ notifyPublished: async (manifest) => {
    calls.push(manifest); return { sent: 1, removed: 0, failed: 0, hasMore: false };
  } }) };
  const recovered = await syncMarket(f.env, { now: new Date(time), ...options });
  assert.equal(recovered.phase, "done");
  assert.equal(recovered.notificationPending, undefined);
  assert.deepEqual(calls, [{ generation: "new", asOf: "2026-10-21" }]);
  await syncMarket(f.env, { now: new Date(time + 60000), ...options });
  assert.equal(calls.length, 1);
});

test("failed notifications retry without republishing or blocking completed market data", async () => {
  const f = fixture();
  f.remote.set(SYNC_KEY, { date: "2026-10-21", slot: "18:30", generation: "new", phase: "done",
    reportDates: ["2026-10-21"], notificationPending: { generation: "new", asOf: "2026-10-21" } });
  f.remote.set(MANIFEST_KEY, { generation: "new", asOf: "2026-10-21" });
  let calls = 0;
  const options = { t86Store: {}, pushServiceFactory: () => ({ notifyPublished: async () =>
    ++calls === 1 ? { sent: 0, removed: 0, failed: 1, hasMore: false }
      : { sent: 1, removed: 0, failed: 0, hasMore: false } }) };
  const failed = await syncMarket(f.env, { now: new Date(time), ...options });
  assert.equal(failed.phase, "done");
  assert.equal(failed.notificationPending.generation, "new");
  assert.equal(failed.notificationRetryAfter, time + 5 * 60000);
  await syncMarket(f.env, { now: new Date(time + 4 * 60000), ...options });
  assert.equal(calls, 1);
  const retried = await syncMarket(f.env, { now: new Date(time + 5 * 60000), ...options });
  assert.equal(calls, 2);
  assert.equal(retried.notificationPending, undefined);
  assert.equal(retried.notificationRetryAfter, undefined);
  assert.equal(f.puts.filter((key) => key === MANIFEST_KEY).length, 0);
});

test("missing push configuration leaves the published notification pending", async () => {
  const f = fixture();
  f.remote.set(SYNC_KEY, { date: "2026-10-21", slot: "18:30", generation: "new", phase: "done",
    reportDates: ["2026-10-21"], notificationPending: { generation: "new", asOf: "2026-10-21" } });
  f.remote.set(MANIFEST_KEY, { generation: "new", asOf: "2026-10-21" });
  const state = await syncMarket(f.env, { now: new Date(time), t86Store: {},
    pushServiceFactory: () => ({ notifyPublished: async () => ({ sent: 0, skipped: true }) }) });
  assert.deepEqual(state.notificationPending, { generation: "new", asOf: "2026-10-21" });
  assert.equal(state.notificationRetryAfter, time + 5 * 60000);
});

test("once imported, a coordinator head never regresses to eventually consistent KV", async () => {
  const f = fixture(), adapter = new CoordinatorStore(f.storage, f.kv);
  f.remote.set(MANIFEST_KEY, { generation: "old" });
  assert.equal((await adapter.get(MANIFEST_KEY, "json")).generation, "old");
  await adapter.put(MANIFEST_KEY, JSON.stringify({ generation: "new" }));
  f.remote.set(MANIFEST_KEY, { generation: "old" });
  assert.equal((await adapter.get(MANIFEST_KEY, "json")).generation, "new");
});

test("invalid/outside-window requests do not execute; missing binding fails closed", async () => {
  const f = fixture(), c = f.create(); c.run = async () => { throw new Error("must not execute"); };
  assert.equal((await c.fetch(new Request("https://internal/tick?time=no", { method: "POST" }))).status, 400);
  assert.equal((await c.fetch(new Request("https://internal/tick"))).status, 404);
  assert.equal((await (await c.fetch(tick(Date.parse("2026-10-24T10:30:00Z")))).json()).phase, "outside-window");
  await assert.rejects(coordinateMarketSync({}, time), /binding required/);
});

test("Cron bridge uses one object name and forwards only the scheduled timestamp", async () => {
  const env = { MARKET_SYNC: { getByName(name) {
    assert.equal(name, "stock-insight-market-sync");
    return { fetch: async (request) => {
      assert.equal(request.method, "POST"); assert.equal(new URL(request.url).searchParams.get("time"), String(time));
      return Response.json({ phase: "catalog" });
    } };
  } } };
  assert.equal((await coordinateMarketSync(env, time)).phase, "catalog");
});

test("persisted cooldown and three-failure stop preserve the public manifest", async () => {
  const f = fixture(), c = f.create(); let calls = 0;
  const manifest = { generation: "good", asOf: "2026-10-20", stocks: [], dates: ["2026-10-20"] };
  f.remote.set(MANIFEST_KEY, manifest);
  f.remote.set(SYNC_KEY, { date: "2026-10-21", slot: "18:30", generation: "candidate",
    phase: "catalog", failures: 0 });
  c.run = (env, options) => syncMarket(env, { ...options, t86Store: {}, fetcher: async () => {
    calls++; return Response.json([]);
  } });
  for (const minute of [0, 1, 29, 30, 31, 60, 61, 90]) await c.fetch(tick(time + minute * 60000));
  assert.equal(calls, 3);
  assert.equal(f.data.get("progress").failures, 3);
  assert.deepEqual(f.remote.get(MANIFEST_KEY), manifest);
  assert.equal(f.puts.length, 0);
});
