import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDatabase } from "./helpers/t86-db.js";
import { HistoryRepository } from "../cloudflare/repositories/history-repository.js";

test("D1 history requires all shards, preserves exact history and rejects mutations", async () => {
  const db = testDatabase();
  db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0003_market_history.sql", import.meta.url), "utf8"));
  const repository = new HistoryRepository(db);
  const manifest = { generation: "baseline", updatedAt: "2026-10-21T00:00:00Z" };
  try {
    await assert.rejects(repository.commit(manifest), /incomplete/);
    for (let index = 0; index < 128; index++) await repository.saveShard({ generation: "baseline", index,
      stocks: [{ symbol: String(1000 + index), history: [["2026-10-20", 100, 110, 90, 105, 1000, null, null, 0, 0, 0, 0]] }] });
    await repository.commit(manifest); await repository.commit(manifest);
    assert.deepEqual(await repository.manifest("baseline"), manifest);
    const shard = await repository.shard("baseline", 0);
    assert.equal(shard.stocks[0].history[0][6], null);
    await repository.saveShard(shard);
    await assert.rejects(repository.saveShard({ ...shard, stocks: [] }), /conflict/);
    await assert.rejects(repository.commit({ ...manifest, updatedAt: "changed" }), /conflict/);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM market_history_shards").get().n, 128);
  } finally { db.sqlite.close(); }
});

test("shards phase reads a tick's D1 history in two queries and stays within a free-plan invocation", async () => {
  const { shards } = await import("../cloudflare/sync/snapshot.js");
  const { SHARDS_PER_TICK } = await import("../cloudflare/sync/common.js");
  const db = testDatabase();
  db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0003_market_history.sql", import.meta.url), "utf8"));
  let queries = 0;
  const counted = { prepare: (sql) => { const statement = db.prepare(sql); const wrap = (s) => ({
    bind: (...values) => wrap(s.bind(...values)), all: () => (queries++, s.all()), first: () => (queries++, s.first()), run: () => (queries++, s.run()) });
  return wrap(statement); } };
  const history = new HistoryRepository(counted);
  try {
    for (let index = 0; index < 128; index++) await new HistoryRepository(db).saveShard({ generation: "old", index, stocks: [] });
    const store = new Map([["twse:v2:new:catalog", [{ symbol: "1101", name: "台泥", market: "TWSE" }]],
      ["twse:v2:new:days", [{ date: "2026-10-21", stocks: [] }]]]);
    const kv = { get: async (key) => store.get(key) ?? null, put: async (key, value) => store.set(key, JSON.parse(value)), delete: async () => {} };
    const state = { generation: "new", nextShard: 0, dayHashes: {} };
    queries = 0;
    await shards({ kv, state, manifest: { generation: "old", dayHashes: {} }, now: new Date(), history });
    assert.equal(state.nextShard, SHARDS_PER_TICK);
    assert.equal(queries, 2 + SHARDS_PER_TICK);
    assert.ok(queries < 50);
    // A retried tick finds the shards it already saved and writes nothing again.
    state.nextShard = 0; queries = 0;
    await shards({ kv, state, manifest: { generation: "old", dayHashes: {} }, now: new Date(), history });
    assert.equal(queries, 2);
  } finally { db.sqlite.close(); }
});
