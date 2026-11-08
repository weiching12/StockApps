import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { syncT86, T86_RUNNING_TIMEOUT_MS } from "../cloudflare/t86-sync.js";
import { T86_QUERY } from "../cloudflare/t86-validator.js";
import { syncMarket } from "../cloudflare/sync.js";
import { MANIFEST_KEY, SYNC_KEY } from "../cloudflare/storage/market-keys.js";
import { testStore } from "./helpers/t86-db.js";

const date = "2026-10-19", start = new Date("2026-10-19T10:30:00Z");
function report() {
  const body = JSON.parse(readFileSync(new URL("./fixtures/twse-20261016.json", import.meta.url))).flows;
  body.date = "20261019";
  body.data = Array.from({ length: 100 }, (_, i) => [String(1000 + i), ...body.data[0].slice(1)]);
  return body;
}
const running = (raw = null) => ({ RunId: "interrupted-original", TradeDate: date, SyncTime: start.toISOString(),
  Source: "TWSE T86", QueryKey: T86_QUERY, Slot: "18:30", RecordCount: 0, Status: "Running",
  DataHash: null, ValidationResult: [{ rule: "transport", passed: true }], ErrorMessage: null,
  RawJson: raw, HttpStatus: raw === null ? null : 200, VersionId: null });

test("an active daily acquisition is shared without a second upstream request", async () => {
  const { db, store } = testStore(100);
  let finish, started, calls = 0;
  const ready = new Promise((resolve) => { started = resolve; });
  const response = new Promise((resolve) => { finish = resolve; });
  const first = syncT86({}, { tradeDate: date, slot: "18:30", now: start, store,
    fetcher: async () => { calls++; started(); return response; } });
  await ready;
  const duplicate = await syncT86({}, { tradeDate: date, slot: "18:30", store,
    now: new Date(start.getTime() + 60000), fetcher: async () => { calls++; throw new Error("duplicate fetch"); } });
  assert.equal(duplicate.Status, "Running");
  assert.equal(await store.current(date), null);
  finish(Response.json(report()));
  const completed = await first;
  assert.equal(completed.Status, "Success");
  assert.equal(completed.RunId, duplicate.RunId);
  assert.equal(calls, 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM t86_sync_runs WHERE TradeDate=?").get(date).n, 1);
});

test("an interrupted daily attempt becomes Failed with original raw evidence and does not block 20:30", async () => {
  const { db, store } = testStore(100);
  const raw = "原始回應😀".repeat(60000);
  await store.log(running(raw));
  const previous = JSON.stringify({ asOf: "2026-10-16", dates: ["2026-10-16"], stocks: [] });
  const values = new Map([[MANIFEST_KEY, previous]]);
  const kv = { get: async (key, type) => type === "json" ? JSON.parse(values.get(key) ?? "null") : values.get(key) ?? null,
    put: async (key, value) => values.set(key, value), delete: async (key) => values.delete(key) };
  let calls = 0;
  const options = { t86Store: store, fetcher: async () => { calls++; return Response.json(report()); } };
  await syncMarket({ MARKET_DATA: kv }, { ...options, now: new Date(start.getTime() + 60000) });
  assert.equal(JSON.parse(values.get(SYNC_KEY)).phase, "t86");
  await syncMarket({ MARKET_DATA: kv }, { ...options, now: new Date(start.getTime() + T86_RUNNING_TIMEOUT_MS) });
  let state = JSON.parse(values.get(SYNC_KEY));
  assert.equal(state.phase, "done");
  assert.equal(state.t86Status, "Failed");
  assert.equal(state.failures, 0);
  assert.equal(calls, 0);
  const failed = await store.scheduledRun(date, "18:30");
  assert.equal(failed.RunId, "interrupted-original");
  assert.equal(failed.Status, "Failed");
  assert.equal(failed.SyncTime, start.toISOString());
  assert.equal(await store.raw(failed), raw);
  assert.equal(JSON.parse(failed.ValidationResult).at(-1).rule, "interruptedRun");
  assert.equal(await store.current(date), null);
  assert.equal(values.get(MANIFEST_KEY), previous);
  await syncMarket({ MARKET_DATA: kv }, { ...options, now: new Date("2026-10-19T12:30:00Z") });
  state = JSON.parse(values.get(SYNC_KEY));
  assert.equal(state.phase, "catalog");
  assert.equal(state.t86Status, "Success");
  assert.equal(calls, 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM t86_sync_runs WHERE TradeDate=?").get(date).n, 2);
});

test("simultaneous first ticks losing the unique-slot claim reuse the winning Running attempt", async () => {
  const { db, store } = testStore(100);
  const log = store.log.bind(store);
  let claim = true, calls = 0;
  store.log = async (run) => {
    if (claim) { claim = false; await log({ ...run, RunId: "winning-cron" }); }
    return log(run);
  };
  const result = await syncT86({}, { tradeDate: date, slot: "18:30", now: start, store,
    fetcher: async () => { calls++; throw new Error("duplicate upstream call"); } });
  assert.equal(result.Status, "Running");
  assert.equal(result.RunId, "winning-cron");
  assert.equal(calls, 0);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM t86_sync_runs WHERE TradeDate=?").get(date).n, 1);
});

test("an expired invocation cannot commit late or replace its Failed audit and raw chunks", async () => {
  const { db, store } = testStore(100);
  const commit = store.commit.bind(store);
  let resume, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const release = new Promise((resolve) => { resume = resolve; });
  store.commit = async (...args) => { entered(); await release; return commit(...args); };
  const rawJson = " ".repeat(300000) + JSON.stringify(report());
  const first = syncT86({}, { tradeDate: date, slot: "18:30", now: start, store, rawJson, httpStatus: 200 });
  await waiting;
  const expired = await syncT86({}, { tradeDate: date, slot: "18:30", store,
    now: new Date(start.getTime() + T86_RUNNING_TIMEOUT_MS) });
  assert.equal(expired.Status, "Failed");
  resume();
  const late = await first;
  assert.equal(late.Status, "Failed");
  assert.equal(late.ErrorMessage, expired.ErrorMessage);
  const saved = await store.getRun(expired.RunId);
  assert.equal(saved.Status, "Failed");
  assert.equal(saved.DataHash, null);
  assert.equal(await store.raw(saved), rawJson);
  assert.equal(await store.current(date), null);
  for (const table of ["t86_daily", "t86_staging", "t86_commit_guard"])
    assert.equal(db.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM t86_versions WHERE TradeDate=?").get(date).n, 0);
});

test("a conditional expiry cannot replace a result that completed after the expiry read", async () => {
  const { store } = testStore(100);
  let finish, started;
  const ready = new Promise((resolve) => { started = resolve; });
  const response = new Promise((resolve) => { finish = resolve; });
  const first = syncT86({}, { tradeDate: date, slot: "18:30", now: start, store,
    fetcher: async () => { started(); return response; } });
  await ready;
  const expire = store.expireRun.bind(store);
  store.expireRun = async (run) => {
    finish(Response.json(report()));
    assert.equal((await first).Status, "Success");
    return expire(run);
  };
  const result = await syncT86({}, { tradeDate: date, slot: "18:30", store,
    now: new Date(start.getTime() + T86_RUNNING_TIMEOUT_MS) });
  assert.equal(result.Status, "Success");
  assert.equal(result.ErrorMessage, null);
  const saved = await store.getRun(result.RunId);
  assert.equal(saved.Status, "Success");
  assert.equal(saved.ErrorMessage, null);
  assert.equal((await store.current(date)).VersionId, saved.VersionId);
});

test("a lost commit response cannot overwrite or misreport the persisted Success", async () => {
  const { store } = testStore(100);
  const commit = store.commit.bind(store);
  store.commit = async (...args) => { await commit(...args); throw new Error("commit response lost"); };
  const rawJson = " ".repeat(300000) + JSON.stringify(report());
  const result = await syncT86({}, { tradeDate: date, slot: "18:30", now: start, store, rawJson, httpStatus: 200 });
  assert.equal(result.Status, "Success");
  assert.equal(result.ErrorMessage, null);
  assert.equal((await store.current(date)).VersionId, result.VersionId);
  // Even a late chunked log must not mutate a terminal run's original evidence.
  await store.log({ ...result, Status: "Failed", ErrorMessage: "late failure", RawJson: "改寫".repeat(200000) });
  const saved = await store.getRun(result.RunId);
  assert.equal(saved.Status, "Success");
  assert.equal(saved.ErrorMessage, null);
  assert.equal(await store.raw(saved), rawJson);
});

test("the final Failed log saves large raw evidence after an earlier raw-log transaction failed", async () => {
  const { db, store } = testStore(100);
  const rawJson = " ".repeat(300000) + JSON.stringify(report());
  let failOnce = true;
  db.beforeStatement = (sql) => {
    if (failOnce && sql.startsWith("INSERT INTO t86_raw_chunks")) {
      failOnce = false;
      throw new Error("temporary raw-log database failure");
    }
  };
  const result = await syncT86({}, { tradeDate: date, slot: "18:30", now: start, store, rawJson, httpStatus: 200 });
  db.beforeStatement = null;
  assert.equal(result.Status, "Failed");
  assert.match(result.ErrorMessage, /temporary raw-log database failure/);
  const saved = await store.getRun(result.RunId);
  assert.equal(saved.Status, "Failed");
  assert.equal(saved.HttpStatus, 200);
  assert.equal(await store.raw(saved), rawJson);
  assert.ok(db.sqlite.prepare("SELECT count(*) n FROM t86_raw_chunks WHERE RunId=?").get(result.RunId).n > 0);
  assert.equal(await store.current(date), null);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM t86_daily WHERE TradeDate=?").get(date).n, 0);
});
