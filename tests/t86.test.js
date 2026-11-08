import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { T86DataValidator, T86_FIELDS, T86_QUERY, t86DataHash } from "../cloudflare/t86-validator.js";
import { syncT86 } from "../cloudflare/t86-sync.js";
import { T86Store } from "../cloudflare/t86-store.js";
import { syncMarket, syncSlot } from "../cloudflare/sync.js";
import { MANIFEST_KEY, SYNC_KEY } from "../cloudflare/storage/market-keys.js";
import { testDatabase, testStore } from "./helpers/t86-db.js";
import { etfCatalog } from "./helpers/etf-catalog.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/twse-20261016.json", import.meta.url)));
const date = "2026-10-19";
export function report(count = 100) {
  const body = structuredClone(fixture.flows);
  body.date = "20261019";
  body.data = Array.from({ length: count }, (_, i) => [String(1000 + i), ...body.data[0].slice(1)]);
  return body;
}
const validate = (body, options = {}) => new T86DataValidator().validate({ httpStatus: 200,
  rawJson: JSON.stringify(body), tradeDate: date, recentCounts: [100, 100, 100, 100, 100], ...options });
const ingest = (store, body, options = {}) => syncT86({}, { tradeDate: date, rawJson: JSON.stringify(body),
  httpStatus: 200, now: new Date("2026-10-19T10:30:00Z"), store, ...options });

test("T86 maps all 19 full names independently of incoming order, normalizes dates and hashes semantic data", async () => {
  const body = report(), original = validate(body);
  assert.equal(original.valid, true);
  assert.equal(original.rows[0].length, 19);
  body.fields.reverse(); body.data = body.data.reverse().map((r) => r.reverse());
  body.date = "2026/10/19";
  const reversed = validate(body);
  assert.deepEqual(reversed.rows, original.rows);
  assert.equal(await t86DataHash(reversed.rows, date), await t86DataHash(original.rows, date));
  assert.notEqual(await t86DataHash(original.rows, "20261016"), await t86DataHash(original.rows, date));
  for (const field of T86_FIELDS) {
    const missing = report(); missing.fields[missing.fields.indexOf(field)] = "changed column";
    assert.equal(validate(missing).status, "Failed", field);
  }
});

test("HTTP must equal 200 and JSON/stat/date failures never become zero records or yesterday's report", () => {
  for (const status of [201, 204, 301, 403, 429, 500]) assert.equal(validate(report(), { httpStatus: status }).status, "Failed");
  for (const rawJson of ["<html>Denied</html>", "null", "[]", "{"])
    assert.equal(validate(null, { rawJson }).status, "Failed");
  for (const date of ["20261016", "20260230", "1151019", null]) {
    const body = report(); body.date = date; assert.equal(validate(body).status, "Failed");
  }
  assert.equal(validate({ stat: "rate limited" }).status, "Failed");
  assert.equal(validate({ stat: "很抱歉，沒有符合條件的資料!" }).status, "NoData");
  assert.equal(validate({ ...report(0), data: [] }).status, "NoData");
});

test("row lengths, code/name, duplicate codes/fields and query drift are mandatory gates", () => {
  const mutations = [
    (b) => { delete b.fields; }, (b) => { b.data = {}; },
    (b) => { b.fields[0] = b.fields[1]; }, (b) => { b.selectType = "ALL"; },
    (b) => { b.data[0].pop(); }, (b) => { b.data[0].push("extra"); },
    (b) => { b.data[0][0] = "  "; }, (b) => { b.data[0][1] = ""; },
    (b) => { b.data[1][0] = ` ${b.data[0][0]} `; }, (b) => { b.total = b.data.length + 1; },
  ];
  for (const mutate of mutations) { const body = report(); mutate(body); assert.equal(validate(body).status, "Failed"); }
});

test("every numeric field rejects invalid values instead of filling zero; buys/sells reject negatives", () => {
  for (let col = 2; col < 19; col++) for (const bad of ["--", "", null, "1.5", "1e3", "1,23", "9007199254740992"]) {
    const body = report(); body.data[0][col] = bad;
    assert.equal(validate(body).status, "Failed", `${T86_FIELDS[col]} ${bad}`);
  }
  for (const col of [2, 3, 5, 6, 8, 9, 12, 13, 15, 16]) {
    const body = report(); body.data[0][col] = "-1"; assert.equal(validate(body).status, "Failed");
  }
  const zero = report(); zero.data = zero.data.map((r) => [...r.slice(0, 2), ...Array(17).fill("0")]);
  assert.equal(validate(zero).valid, true);
});

test("foreign, foreign dealer, trust, dealer subtypes/summary and official total must reconcile", () => {
  for (const col of [4, 7, 10, 11, 14, 17, 18]) {
    const body = report(); body.data[0][col] = String(Number(body.data[0][col].replaceAll(",", "")) + 1);
    assert.equal(validate(body).status, "Failed", T86_FIELDS[col]);
  }
});

test("raw report count uses the latest-five median and 20:30 compares against the validated 18:30 round", () => {
  assert.equal(validate(report(90), { recentCounts: [200, 98, 105, 95, 100] }).valid, true);
  assert.equal(validate(report(89)).status, "Failed");
  assert.equal(validate(report(94), { slot: "20:30", earlyCount: 100 }).status, "Failed");
  assert.equal(validate(report(95), { slot: "20:30", earlyCount: 100 }).valid, true);
  assert.equal(validate(report(90), { slot: "20:30", earlyCount: null }).valid, true);
  assert.equal(validate(report(), { recentCounts: [] }).status, "PendingConfirmation");
  assert.equal(validate(report(), { recentCounts: [100, 100, 100, 100] }).status, "PendingConfirmation");
  assert.equal(new T86DataValidator({ historyRatio: .8, eveningRatio: .85 }).validate({ httpStatus: 200,
    rawJson: JSON.stringify(report(85)), tradeDate: date, recentCounts: [100, 100, 100, 100, 100], slot: "20:30", earlyCount: 100 }).valid, true);
  assert.throws(() => new T86DataValidator({ historyRatio: 0 }));
});

test("bootstrap requires approval of an exact pending report hash and never approves different data", async () => {
  const db = testDatabase(), store = new T86Store(db), body = report();
  const pending = await ingest(store, body);
  assert.equal(pending.Status, "PendingConfirmation");
  assert.equal(await store.current(date), null);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM t86_daily").get().n, 0);
  await store.statement("INSERT INTO t86_baseline_approvals VALUES(?,?,?,?,?)", T86_QUERY, date,
    pending.DataHash, "test-reviewer", "2026-10-19T10:31:00Z").run();
  assert.equal((await ingest(store, report(101))).Status, "PendingConfirmation");
  const accepted = await ingest(store, body);
  assert.equal(accepted.Status, "Success");
  assert.equal((await store.current(date)).DataHash, pending.DataHash);
});

test("successful Upsert retains versions and official totals; identical data only writes sync metadata", async () => {
  const { db, store } = testStore(100);
  const early = await ingest(store, report(), { slot: "18:30" });
  assert.equal(early.Status, "Success");
  const before = db.sqlite.prepare("SELECT * FROM t86_daily ORDER BY Symbol").all();
  const unchanged = await ingest(store, report(), { slot: "20:30", now: new Date("2026-10-19T12:30:00Z") });
  assert.equal(unchanged.Status, "Unchanged");
  assert.equal(unchanged.VersionId, early.VersionId);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM t86_daily ORDER BY Symbol").all(), before);
  const revised = report(95), changed = await ingest(store, revised, { now: new Date("2026-10-19T13:00:00Z") });
  assert.equal(changed.Status, "Success");
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM t86_daily WHERE TradeDate=?").get(date).n, 95);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM t86_versions WHERE TradeDate=?").get(date).n, 2);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM t86_staging").get().n, 0);
  const row = db.sqlite.prepare("SELECT ValuesJson,OfficialTotal FROM t86_daily LIMIT 1").get();
  assert.equal(row.OfficialTotal, JSON.parse(row.ValuesJson)[18]);
  assert.equal((await store.context(date)).earlyCount, 100);
});

test("a transaction failure after Upsert rolls back staging, rows, version/head and logs Failed with raw evidence", async () => {
  const { db, store } = testStore(100);
  const original = await ingest(store, report());
  const rows = db.sqlite.prepare("SELECT * FROM t86_daily").all();
  db.beforeStatement = (sql) => { if (sql.startsWith("DELETE FROM t86_staging")) throw new Error("simulated transaction failure"); };
  const failed = await ingest(store, report(95), { now: new Date("2026-10-19T12:30:00Z") });
  db.beforeStatement = null;
  assert.equal(failed.Status, "Failed");
  assert.match(failed.ErrorMessage, /transaction failure/);
  assert.equal((await store.current(date)).VersionId, original.VersionId);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM t86_daily").all(), rows);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM t86_versions WHERE TradeDate=?").get(date).n, 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM t86_staging").get().n, 0);
  const audit = await store.statement("SELECT * FROM t86_sync_runs WHERE RunId=?", failed.RunId).first();
  assert.equal(audit.Status, "Failed"); assert.equal(audit.RawJson, JSON.stringify(report(95)));
});

test("stale concurrent transaction cannot replace a later successful version", async () => {
  const { store } = testStore(100);
  const first = await ingest(store, report());
  const oldContext = await store.current(date);
  const next = await ingest(store, report(101), { now: new Date("2026-10-19T12:30:00Z") });
  const stale = { ...first, RunId: crypto.randomUUID(), VersionId: crypto.randomUUID(), Status: "Success" };
  await store.log({ ...stale, Status: "Running" });
  await assert.rejects(store.commit(stale, validate(report()).rows, oldContext), /CHECK/);
  assert.equal((await store.current(date)).VersionId, next.VersionId);
});

test("invalid/NoData/HTTP failure never touches business data, keeps raw JSON and complete audit fields", async () => {
  const { db, store } = testStore(100);
  const early = await ingest(store, report(), { slot: "18:30" });
  for (const [body, status] of [[report(94), "Failed"], [{ stat: "很抱歉，沒有符合條件的資料!" }, "NoData"],
    [{ ...report(), date: "20261016" }, "Failed"]]) {
    const run = await ingest(store, body, { now: new Date("2026-10-19T12:30:00Z"), ...(body.data?.length === 94 ? { slot: "20:30" } : {}) });
    assert.equal(run.Status, status);
    assert.equal((await store.current(date)).VersionId, early.VersionId);
    for (const field of ["TradeDate", "SyncTime", "Source", "RecordCount", "DataHash", "Status", "ValidationResult", "ErrorMessage"])
      assert.ok(Object.hasOwn(run, field), field);
  }
  const http = await syncT86({}, { tradeDate: date, store, fetcher: async () => new Response("<html>slow down</html>", { status: 429 }) });
  assert.equal(http.Status, "Failed"); assert.equal(http.RawJson, "<html>slow down</html>");
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM t86_daily WHERE TradeDate=?").get(date).n, 100);
  let calls = 0;
  const weekend = await syncT86({}, { tradeDate: "2026-10-18", store, fetcher: () => { calls++; } });
  assert.equal(weekend.Status, "Skipped"); assert.equal(calls, 0);
});

test("round selection uses Taipei 18:30 and 20:30, including boundary minutes and weekends", () => {
  for (const [time, expected] of [["10:29", null], ["10:30", "18:30"], ["12:29", "18:30"], ["12:30", "20:30"], ["15:59", "20:30"]])
    assert.equal(syncSlot(new Date(`2026-10-19T${time}:00Z`)), expected);
  assert.equal(syncSlot(new Date("2026-10-18T10:30:00Z")), null);
});

test("oversized non-JSON error responses retain exact raw Unicode in chunks without changing business data", async () => {
  const { store } = testStore(100);
  const rawJson = "錯誤😀".repeat(200000);
  const run = await syncT86({}, { tradeDate: date, rawJson, httpStatus: 500, store });
  assert.equal(run.Status, "Failed");
  const saved = await store.statement("SELECT * FROM t86_sync_runs WHERE RunId=?", run.RunId).first();
  assert.equal(saved.RawJson, null);
  assert.equal(await store.raw(saved), rawJson);
  assert.equal(await store.current(date), null);
});

test("failed daily rounds never publish KV; 20:30 still runs even when the early date is already current", async () => {
  const { store } = testStore(100);
  const values = new Map([[MANIFEST_KEY, JSON.stringify({ asOf: date, dates: [date], stocks: [] })]]);
  const kv = { get: async (k, t) => t === "json" ? JSON.parse(values.get(k) ?? "null") : values.get(k) ?? null,
    put: async (k, v) => values.set(k, v), delete: async (k) => values.delete(k) };
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json(report(89)); };
  const env = { MARKET_DATA: kv };
  const old = values.get(MANIFEST_KEY);
  await syncMarket(env, { t86Store: store, fetcher, now: new Date("2026-10-19T10:30:00Z") });
  assert.equal(JSON.parse(values.get(SYNC_KEY)).t86Status, "Failed");
  await syncMarket(env, { t86Store: store, fetcher, now: new Date("2026-10-19T10:31:00Z") });
  assert.equal(calls, 1);
  await syncMarket(env, { t86Store: store, fetcher, now: new Date("2026-10-19T12:30:00Z") });
  assert.equal(calls, 2);
  assert.equal(values.get(MANIFEST_KEY), old);
});

for (const evening of ["Failed", "Unchanged", "Success"]) test(`complete daily pipeline: 18:30 publishes, 20:30 ${evening} keeps or updates the correct generation`, async () => {
  const { store } = testStore(1000);
  const values = new Map(), published = [];
  const kv = { get: async (k, t) => t === "json" ? JSON.parse(values.get(k) ?? "null") : values.get(k) ?? null,
    put: async (k, v) => { values.set(k, v); if (k === MANIFEST_KEY) published.push(v); }, delete: async (k) => values.delete(k) };
  const companies = Array.from({ length: 1000 }, (_, i) => ({ 公司代號: String(1000 + i), 公司簡稱: `公司${i}`,
    產業別: "24", 上市日期: "20000101" }));
  const prices = structuredClone(fixture.prices); prices.date = "20261019";
  const template = prices.tables[0].data.find((r) => r[0] === "2330");
  prices.tables[0].data = companies.map((c) => [c.公司代號, ...template.slice(1)]);
  let round = "18:30", t86Calls = 0;
  const fetcher = async (input) => {
    const url = new URL(input);
    if (url.hostname.startsWith("openapi")) return Response.json(companies);
    if (url.pathname.endsWith("/ETF/list")) return Response.json(etfCatalog);
    if (url.pathname.includes("MI_INDEX")) return Response.json(prices);
    t86Calls++;
    const body = report(round === "20:30" && evening === "Failed" ? 940 : 1000);
    if (round === "20:30" && evening === "Success") for (const col of [2, 4, 18])
      body.data[0][col] = String(Number(body.data[0][col].replaceAll(",", "")) + 100);
    return Response.json(body);
  };
  for (let minute = 0; minute < 73; minute++) await syncMarket({ MARKET_DATA: kv }, {
    t86Store: store, fetcher, now: new Date(Date.UTC(2026, 9, 19, 10, 30 + minute)) });
  const early = values.get(MANIFEST_KEY), earlyVersion = (await store.current(date)).VersionId;
  assert.equal(published.length, 1);
  round = "20:30";
  for (let minute = 0; minute < 73; minute++) await syncMarket({ MARKET_DATA: kv }, {
    t86Store: store, fetcher, now: new Date(Date.UTC(2026, 9, 19, 12, 30 + minute)) });
  assert.equal(t86Calls, 2);
  assert.equal(JSON.parse(values.get(SYNC_KEY)).t86Status, evening);
  assert.equal(published.length, evening === "Success" ? 2 : 1);
  if (evening === "Success") {
    assert.notEqual((await store.current(date)).VersionId, earlyVersion);
    assert.equal(JSON.parse(values.get(MANIFEST_KEY)).t86VersionId, (await store.current(date)).VersionId);
  } else if (evening === "Unchanged") {
    assert.equal(values.get(MANIFEST_KEY), early);
    assert.equal((await store.current(date)).VersionId, earlyVersion);
    assert.equal(JSON.parse(values.get(MANIFEST_KEY)).t86VersionId, earlyVersion);
  } else {
    assert.equal(values.get(MANIFEST_KEY), early);
    assert.equal((await store.current(date)).VersionId, earlyVersion);
  }
});
