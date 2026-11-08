import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { syncMarket } from "../cloudflare/sync.js";
import { MANIFEST_KEY, SYNC_KEY, shardKey } from "../cloudflare/storage/market-keys.js";
import { SHARD_COUNT, shardOf } from "../shared/market-codec.js";
import { testStore } from "./helpers/t86-db.js";
import { etfCatalog } from "./helpers/etf-catalog.js";
import { MarketSyncCoordinator } from "../cloudflare/sync/coordinator.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/twse-20261016.json", import.meta.url)));

function setup(coordinated = false, withHistory = false) {
  const { db, store } = testStore(1000);
  if (withHistory) db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0003_market_history.sql", import.meta.url), "utf8"));
  const data = new Map(), calls = [], writes = [], deletes = [];
  const companies = Array.from({ length: 1000 }, (_, i) => ({ 公司代號: String(1000 + i),
    公司簡稱: `公司${i}`, 產業別: "24", 上市日期: "20000101" }));
  let corrected = false;
  const kv = { get: async (k, t) => t === "json" ? JSON.parse(data.get(k) ?? "null") : data.get(k) ?? null,
    put: async (k, v, options) => { writes.push({ key: k, options }); data.set(k, v); }, delete: async (k) => { deletes.push(k); data.delete(k); } };
  const fetcher = async (input) => {
    const url = new URL(input);
    const date = url.searchParams.get("date");
    calls.push([url.pathname, date]);
    if (url.hostname.startsWith("openapi")) return Response.json(companies);
    if (url.pathname.endsWith("/ETF/list")) return Response.json(etfCatalog);
    if (url.pathname.includes("MI_INDEX")) {
      const body = structuredClone(fixture.prices);
      body.date = date;
      const row = body.tables[0].data.find((r) => r[0] === "2330");
      body.tables[0].data = companies.map((c) => [c.公司代號, ...row.slice(1)]);
      body.tables[0].data.push(["0050", ...row.slice(1)]);
      if (corrected) {
        const col = body.tables[0].fields.indexOf("成交股數");
        body.tables[0].data[0][col] = "1234567";
      }
      return Response.json(body);
    }
    const body = structuredClone(fixture.flows);
    body.date = date;
    body.data = companies.map((c) => [c.公司代號, ...body.data[0].slice(1)]);
    body.data.push(["0050", "元大台灣50", ...body.data[0].slice(2)]);
    // Only the historical report changes; today's institution Hash stays equal.
    if (corrected && date === "20261014") for (const col of [2, 4, 18])
      body.data[0][col] = String(Number(body.data[0][col].replaceAll(",", "")) + 100);
    return Response.json(body);
  };
  const durable = new Map();
  const coordinator = new MarketSyncCoordinator({ storage: {
    get: async (key) => structuredClone(durable.get(key)),
    put: async (key, value) => durable.set(key, structuredClone(value)),
    delete: async (key) => durable.delete(key),
  } }, { MARKET_DATA: kv, T86_DB: db, MARKET_HISTORY_ENABLED: withHistory ? "1" : "0" });
  coordinator.run = (env, options) => syncMarket(env, { ...options, t86Store: store, fetcher });
  const run = async (date, hour, minutes = 85) => {
    for (let minute = 0; minute < minutes; minute++) {
      const now = new Date(Date.parse(`${date}T${hour}:30:00Z`) + minute * 60000);
      if (coordinated) {
        const tick = () => new Request(`https://internal/tick?time=${now.getTime()}`, { method: "POST" });
        await Promise.all([coordinator.fetch(tick()), coordinator.fetch(tick())]);
      } else await syncMarket({ MARKET_DATA: kv }, { t86Store: store, fetcher, now });
    }
    const finalState = coordinated ? durable.get("progress") : JSON.parse(data.get(SYNC_KEY));
    assert.equal(finalState.phase, "done");
    assert.equal(finalState.failures, 0);
    return JSON.parse(data.get(MANIFEST_KEY));
  };
  const history = (manifest) => JSON.parse(data.get(shardKey(manifest.generation, 1000 % SHARD_COUNT)))
    .stocks.find((s) => s.symbol === "1000").history;
  return { db, store, calls, data, writes, deletes, run, history, correct: () => { corrected = true; } };
}

test("20:30 publishes corrected volume even when today's T86 is unchanged", async () => {
  const f = setup();
  try {
    const early = await f.run("2026-10-19", "10");
    const priorVolume = f.history(early).at(-1)[5];
    f.correct();
    const late = await f.run("2026-10-19", "12");
    assert.equal(late.t86Hash, early.t86Hash);
    assert.equal(late.t86VersionId, early.t86VersionId);
    assert.notEqual(late.generation, early.generation);
    assert.notEqual(priorVolume, 1234567);
    assert.equal(f.history(late).at(-1)[5], 1234567);
    assert.equal(f.calls.filter(([p]) => p.includes("T86")).length, 2);
    assert.equal(f.calls.filter(([p]) => p.includes("MI_INDEX")).length, 2);
    assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM t86_versions WHERE TradeDate='2026-10-19'").get().n, 1);
  } finally { f.db.sqlite.close(); }
});

test("D1 history rebuilds the next KV snapshot even when the old KV shard is unavailable", async () => {
  const f = setup(true, true);
  try {
    const first = await f.run("2026-10-19", "10");
    for (let index = 0; index < SHARD_COUNT; index++) f.data.delete(shardKey(first.generation, index));
    const next = await f.run("2026-10-20", "10");
    assert.deepEqual(f.history(next).map((row) => row[0]), ["2026-10-19", "2026-10-20"]);
    assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM market_history_manifests").get().n, 2);
  } finally { f.db.sqlite.close(); }
});

test("coordinated full pipeline publishes once per changed round and never writes progress to KV", async () => {
  const f = setup(true);
  try {
    const first = await f.run("2026-10-19", "10");
    assert.equal(f.writes.length, 133);
    const unchanged = await f.run("2026-10-19", "12");
    assert.equal(f.writes.length, 137);
    assert.equal(unchanged.generation, first.generation);
    assert.equal(f.writes.filter(({ key }) => key === MANIFEST_KEY).length, 1);
    assert.equal(f.writes.filter(({ key }) => key === SYNC_KEY).length, 0);
    assert.equal(f.calls.filter(([path]) => path.includes("T86")).length, 2);
    const next = await f.run("2026-10-20", "10");
    assert.deepEqual(f.history(next).map((row) => row[0]), ["2026-10-19", "2026-10-20"]);
  } finally { f.db.sqlite.close(); }
});

test("Friday rechecks both preceding sessions despite unchanged current T86", async () => {
  const f = setup();
  try {
    await f.run("2026-10-14", "10");
    await f.run("2026-10-15", "10");
    const early = await f.run("2026-10-16", "10");
    const before = f.history(early).find((r) => r[0] === "2026-10-14")[6];
    f.calls.length = 0;
    f.correct();
    const late = await f.run("2026-10-16", "12");
    assert.equal(late.t86Hash, early.t86Hash);
    assert.equal(f.history(late).find((r) => r[0] === "2026-10-14")[6], before + 100);
    assert.deepEqual(f.calls.filter(([p]) => p.includes("MI_INDEX")).map(([, d]) => d),
      ["20261014", "20261015", "20261016"]);
    assert.deepEqual(f.calls.filter(([p]) => p.includes("T86")).map(([, d]) => d),
      ["20261016", "20261014", "20261015"]);
  } finally { f.db.sqlite.close(); }
});

test("nightly sync retains the ETF session and accumulates the following trading day", async () => {
  const f = setup();
  try {
    const first = await f.run("2026-10-19", "10");
    const second = await f.run("2026-10-20", "10");
    const history = (manifest) => JSON.parse(f.data.get(shardKey(manifest.generation, shardOf("0050"))))
      .stocks.find((stock) => stock.symbol === "0050").history;
    assert.deepEqual(history(first).map((row) => row[0]), ["2026-10-19"]);
    assert.deepEqual(history(second).map((row) => row[0]), ["2026-10-19", "2026-10-20"]);
    assert.equal(second.stocks.filter((stock) => stock.assetType !== "etf").length, 1000);
  } finally { f.db.sqlite.close(); }
});

 test("unchanged evening skips publication while pending notification retries are checkpointed", async () => {
  const f = setup();
  try {
    const early = await f.run("2026-10-19", "10");
    const initial = f.writes.length;
    const late = await f.run("2026-10-19", "12");
    const writes = f.writes.slice(initial);
    assert.equal(late.generation, early.generation);
    assert.equal(JSON.parse(f.data.get(SYNC_KEY)).result, "Unchanged");
    assert.equal(writes.filter(({ key }) => key !== SYNC_KEY).length, 4);
    assert.equal(writes.filter(({ key }) => key === SYNC_KEY).length, 23);
    assert.equal(writes.filter(({ key }) => key.includes(":shard:") || key === MANIFEST_KEY).length, 0);
    assert.equal(f.deletes.length, 0);
    for (const { key, options } of f.writes) {
      assert.equal(options?.expirationTtl, key === SYNC_KEY || key === MANIFEST_KEY || key.includes(":shard:") ? undefined : 86400);
    }
  } finally { f.db.sqlite.close(); }
 });

test("legacy manifests without fingerprints receive a full baseline publication", async () => {
  const f = setup();
  try {
    const early = await f.run("2026-10-19", "10");
    const legacy = { ...early }; delete legacy.catalogHash; delete legacy.dayHashes;
    f.data.set(MANIFEST_KEY, JSON.stringify(legacy));
    const late = await f.run("2026-10-19", "12");
    assert.notEqual(late.generation, early.generation);
    assert.equal(typeof late.catalogHash, "string");
  } finally { f.db.sqlite.close(); }
});
