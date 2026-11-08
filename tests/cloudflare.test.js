import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../cloudflare/worker.js";
import { syncMarket as runSyncMarket, pendingDates, scheduledDates } from "../cloudflare/sync.js";
import { CATALOG_URL, normalizeCatalog, normalizeFlows, normalizePrices, reportUrl } from "../cloudflare/adapters/twse.js";
import { MANIFEST_KEY, SYNC_KEY, shardKey, stageKey } from "../cloudflare/storage/market-keys.js";
import { SHARD_COUNT, shardOf } from "../shared/market-codec.js";
import { createManifest } from "../cloudflare/snapshots/market-format.js";
import { marketDay, mergeShard, taipeiDate } from "../shared/market.js";
import { combineChunks } from "../src/provider.js";
import { getSnapshot } from "../src/indicators.js";

import { testStore } from "./helpers/t86-db.js";
import { etfCatalog } from "./helpers/etf-catalog.js";
const syncMarket = (env, options) => {
  env.MARKET_DATA.testStore ??= testStore().store;
  return runSyncMarket(env, { ...options, t86Store: env.MARKET_DATA.testStore });
};

const fixture = JSON.parse(readFileSync(new URL("./fixtures/twse-20261016.json", import.meta.url)));
const date = "2026-10-16";
const catalog = normalizeCatalog(fixture.companies);
const priceReport = () => normalizePrices(structuredClone(fixture.prices), date);
const flowReport = () => normalizeFlows(structuredClone(fixture.flows), date);
const market = () => marketDay(catalog, priceReport(), flowReport());
function datasetParts(days = [market()], stocks = catalog, generation = "test-20261016") {
  return { manifest: createManifest(stocks, days.map((day) => day.date), generation, "2026-10-16T14:00:00Z", days.at(-1).coverage),
    chunks: Array.from({ length: SHARD_COUNT }, (_, index) => ({ ...mergeShard(stocks, index, null, days), generation, index })) };
}
function memoryKV(entries = []) {
  const data = new Map(entries), writes = [], deletes = [];
  return { data, writes, deletes,
    async get(key, type) { const value = data.get(key); return value === undefined ? null : type === "json" ? JSON.parse(value) : value; },
    async put(key, value) { data.set(key, value); writes.push(key); },
    async delete(key) { data.delete(key); deletes.push(key); },
  };
}

test("whole-market URLs exclude warrants and never query a stock id", () => {
  const price = reportUrl("prices", date), flows = reportUrl("flows", date);
  assert.equal(price.searchParams.get("type"), "ALLBUT0999");
  assert.equal(flows.searchParams.get("selectType"), "ALLBUT0999");
  assert.equal(flows.searchParams.get("date"), "20261016");
  assert.throws(() => reportUrl("prices", "2026-02-30"));
  assert.equal(taipeiDate(new Date("2026-10-16T17:00:00Z")), "2026-10-17");
});

test("official company identities keep industry, listing date and six-digit DR codes", () => {
  assert.equal(catalog.find((stock) => stock.symbol === "2330").sector, "半導體業");
  assert.equal(catalog.find((stock) => stock.symbol === "911622").sector, "存託憑證");
  assert.equal(catalog.find((stock) => stock.symbol === "3026").listedOn, "2002-08-26");
  assert.throws(() => normalizeCatalog([...fixture.companies, fixture.companies[0]]), /duplicate/);
  assert.throws(() => normalizeCatalog([{ ...fixture.companies[0], 產業別: "99" }]), /Invalid/);
});

test("real TWSE rows preserve share units and foreign/dealer classification", () => {
  const day = market();
  assert.deepEqual(day.records["2330"], [date, 2430, 2445, 2420, 2420, 43046982, 11295871, 33342013, 1791240, 1081000, 924365, 1960293]);
  const { manifest, chunks } = datasetParts();
  const dataset = combineChunks(manifest, chunks);
  const stock = getSnapshot(dataset.stocks.find((stock) => stock.symbol === "2330"), date);
  assert.equal(stock.latest.institutions.find((item) => item.name === "自營商").buy, 924365);
  assert.equal(stock.latest.institutionalNet, -22371830);
});

test("unpriced/odd-lot-only and absent stocks stay in catalog without invented OHLC or zero institutions", () => {
  const day = market();
  assert.ok(day.coverage.inactive.includes("1538"));
  assert.ok(day.coverage.missingPrices.includes("1516"));
  assert.ok(day.coverage.missingInstitutions.includes("1213"));
  assert.deepEqual(day.records["1213"].slice(6), Array(6).fill(null));
  const { manifest, chunks } = datasetParts();
  const data = combineChunks(manifest, chunks);
  assert.equal(data.stocks.length, catalog.length);
  assert.equal(getSnapshot(data.stocks.find((s) => s.symbol === "1538"), date).latest, null);
  assert.equal(getSnapshot(data.stocks.find((s) => s.symbol === "1213"), date).latest.institutionalNet, null);
});

test("dates, schema drift, duplicate rows, malformed numbers and truncated reports fail closed", () => {
  assert.throws(() => normalizeFlows(fixture.flows, "2026-10-15"), /date mismatch/);
  const mutations = [
    (d) => { d.fields[2] = "changed column"; },
    (d) => { d.data.push(d.data[0]); },
    (d) => { d.data[0][2] = "--"; },
    (d) => { d.data[0][18] = "123"; },
    (d) => { d.total = d.data.length + 1; },
  ];
  for (const mutate of mutations) { const d = structuredClone(fixture.flows); mutate(d); assert.throws(() => normalizeFlows(d, date)); }
  const prices = structuredClone(fixture.prices);
  prices.tables[0].data[0][5] = "0";
  assert.throws(() => normalizePrices(prices, date), /OHLC/);
  assert.equal(normalizePrices({ stat: "很抱歉，沒有符合條件的資料!" }, date), null);
  assert.throws(() => normalizePrices({ stat: "rate limit" }, date), /unavailable/);
});

test("archived fields9/data9 report schema uses names rather than fixed column positions", () => {
  const table = fixture.prices.tables[0];
  const legacy = { stat: "OK", date: "20261016", fields9: [...table.fields].reverse(), data9: table.data.map((row) => [...row].reverse()) };
  assert.deepEqual(normalizePrices(legacy, date), priceReport());
});

test("new listings never create pre-listing rows, and missing institutions cannot erase good history", () => {
  const day = market();
  const stocks = catalog.map((stock) => stock.symbol === "2330" ? { ...stock, listedOn: "2026-10-17" } : stock);
  assert.equal(marketDay(stocks, priceReport(), flowReport()).records["2330"], undefined);
  const index = shardOf("2330");
  const previous = mergeShard(catalog, index, null, [day]);
  const partial = structuredClone(day);
  partial.records["2330"].fill(null, 6);
  assert.throws(() => mergeShard(catalog, index, previous, [partial]), /erase complete/);
});

test("suspended sessions break institutional streak/window without rolling old price into today's rankings", () => {
  const { manifest, chunks } = datasetParts();
  const stock = combineChunks(manifest, chunks).stocks.find((s) => s.symbol === "2330");
  stock.tradingDates.push("2026-10-19");
  const result = getSnapshot(stock, "2026-10-19");
  assert.equal(result.latest, null);
  assert.equal(result.institutionalSummary.total.net5, null);
  assert.equal(result.institutionalSummary.institutions["外資"].streak.direction, "unknown");
});

test("generation mixing and incomplete company coverage cannot be rendered", () => {
  const { manifest, chunks } = datasetParts();
  const invalid = structuredClone(chunks);
  invalid[0].generation = "old";
  assert.throws(() => combineChunks(manifest, invalid), /generation/);
  const missing = structuredClone(chunks);
  missing[shardOf("2330")].stocks = [];
  assert.throws(() => combineChunks(manifest, missing), /coverage/);
  const bad = structuredClone(chunks);
  bad[shardOf("2330")].stocks.find((s) => s.symbol === "2330").history[0][1] = null;
  assert.throws(() => combineChunks(manifest, bad), /history/);
});

test("public API is cache-only, returns company snapshots and never contacts upstream", async () => {
  const { manifest, chunks } = datasetParts();
  const kv = memoryKV([[MANIFEST_KEY, JSON.stringify(manifest)], ...chunks.map((chunk, index) => [shardKey(manifest.generation, index), JSON.stringify(chunk)])]);
  const env = { MARKET_DATA: kv };
  assert.equal((await worker.fetch(new Request("https://example.test/api/market"), env)).status, 200);
  const response = await worker.fetch(new Request("https://example.test/api/stocks/2330"), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).stock.history[0].close, 2420);
  assert.equal((await worker.fetch(new Request("https://example.test/api/stocks/0050"), env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://example.test/api/market", { method: "POST" }), env)).status, 405);
  assert.equal(kv.writes.length, 0);
  assert.equal((await worker.fetch(new Request("https://example.test/api/market"), { MARKET_DATA: memoryKV() })).status, 503);
});

test("failed T86 acquisition runs once per round and preserves the public manifest", async () => {
  const { manifest } = datasetParts(); manifest.asOf = "2026-10-15";
  const kv = memoryKV([[MANIFEST_KEY, JSON.stringify(manifest)]]);
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(null, { status: 429 }); };
  for (let minute = 0; minute < 180; minute++)
    await syncMarket({ MARKET_DATA: kv }, { now: new Date(Date.UTC(2026, 9, 16, 13, minute)), fetcher });
  assert.equal(calls, 1);
  assert.deepEqual(await kv.get(MANIFEST_KEY, "json"), manifest);
  assert.equal(kv.writes.filter((key) => key === MANIFEST_KEY).length, 0);
});

test("full nightly sync makes four spaced upstream calls and publishes a complete generation within ten minutes", async () => {
  // Expand real field structures to an entire market, keeping this integration deterministic.
  const companies = Array.from({ length: 1000 }, (_, index) => ({ 公司代號: String(1000 + index), 公司簡稱: `公司${index}`, 產業別: "24", 上市日期: "20000101" }));
  const prices = structuredClone(fixture.prices), flows = structuredClone(fixture.flows);
  const priceTemplate = prices.tables[0].data.find((row) => row[0] === "2330");
  const flowTemplate = flows.data.find((row) => row[0] === "2330");
  prices.tables[0].data = companies.map((row) => [row.公司代號, ...priceTemplate.slice(1)]);
  flows.data = companies.map((row) => [row.公司代號, ...flowTemplate.slice(1)]);
  const kv = memoryKV(), calls = [];
  let currentMinute = 0;
  const fetcher = async (input) => {
    const url = new URL(input); calls.push({ minute: currentMinute, url: url.href });
    if (url.pathname.endsWith("/ETF/list")) return Response.json(etfCatalog);
    return Response.json(url.href === CATALOG_URL ? companies : url.pathname.includes("T86") ? flows : prices);
  };
  for (; currentMinute < 11; currentMinute++) {
    await syncMarket({ MARKET_DATA: kv }, { now: new Date(Date.UTC(2026, 9, 16, 13, currentMinute)), fetcher });
    if (currentMinute < 10) assert.equal(kv.data.has(MANIFEST_KEY), false);
  }
  assert.deepEqual(calls.map((call) => call.minute), [0, 1, 2, 3]);
  assert.equal(calls.length, 4);
  const manifest = await kv.get(MANIFEST_KEY, "json");
  assert.equal(manifest.stocks.length, 1001);
  assert.equal(manifest.asOf, date);
  const chunks = await Promise.all(manifest.chunks.map((_, i) => kv.get(shardKey(manifest.generation, i), "json")));
  assert.equal(combineChunks(manifest, chunks).stocks.length, 1001);
  assert.ok(kv.writes.length < 250);
  assert.equal((await kv.get(SYNC_KEY, "json")).phase, "done");
});

test("cron starts Taipei 18:30, continues both rounds through 23:59 and requires no API token", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers.crons, ["30-59 10 * * mon-fri", "* 11-15 * * mon-fri"]);
  assert.equal(config.secrets, undefined);
});

test("catch-up dates include missed weekdays, skip weekends and bound a nightly backlog", () => {
  assert.deepEqual(pendingDates("2026-10-15", "2026-10-19"), ["2026-10-16", "2026-10-19"]);
  assert.deepEqual(pendingDates("2026-10-16", "2026-10-18"), []);
  assert.equal(pendingDates("2026-08-01", "2026-10-19").length, 10);
  const manifest = { asOf: "2026-10-15", dates: ["2026-10-13", "2026-10-14", "2026-10-15"] };
  assert.deepEqual(scheduledDates(manifest, "2026-10-16"), ["2026-10-14", "2026-10-15", "2026-10-16"]);
  assert.deepEqual(scheduledDates(manifest, "2026-10-19"), ["2026-10-16", "2026-10-19"]);
});

for (const holiday of [false, true]) test(`nightly catch-up preserves missed sessions, with holiday=${holiday}`, async () => {
  const companies = Array.from({ length: 1000 }, (_, index) => ({ 公司代號: String(1000 + index), 公司簡稱: `公司${index}`, 產業別: "24", 上市日期: "20000101" }));
  const stocks = normalizeCatalog(companies);
  const prices = structuredClone(fixture.prices), flows = structuredClone(fixture.flows);
  const p = prices.tables[0].data.find((row) => row[0] === "2330"), f = flows.data.find((row) => row[0] === "2330");
  prices.tables[0].data = companies.map((row) => [row.公司代號, ...p.slice(1)]);
  flows.data = companies.map((row) => [row.公司代號, ...f.slice(1)]);
  const prior = { date: "2026-10-08", records: Object.fromEntries(stocks.map(({ symbol }) => [symbol,
    ["2026-10-08", ...market().records["2330"].slice(1)]])), coverage: { companies: stocks.length } };
  const { manifest, chunks } = datasetParts([prior], stocks, "previous-active");
  const kv = memoryKV([[MANIFEST_KEY, JSON.stringify(manifest)], ...chunks.map((chunk, i) => [shardKey(manifest.generation, i), JSON.stringify(chunk)])]);
  const requests = [];
  const fetcher = async (input) => {
    const url = new URL(input); requests.push(url.href);
    if (url.href === CATALOG_URL) return Response.json(companies);
    if (url.pathname.endsWith("/ETF/list")) return Response.json(etfCatalog);
    const date = url.searchParams.get("date");
    if (holiday && date === "20261009") return Response.json({ stat: "很抱歉，沒有符合條件的資料!" });
    return Response.json({ ...(url.pathname.includes("T86") ? flows : prices), date });
  };
  for (let minute = 0; minute < 75; minute++)
    await syncMarket({ MARKET_DATA: kv }, { now: new Date(Date.UTC(2026, 9, 12, 13, minute)), fetcher });
  const next = await kv.get(MANIFEST_KEY, "json");
  assert.deepEqual(next.dates, holiday ? ["2026-10-08", "2026-10-12"] : ["2026-10-08", "2026-10-09", "2026-10-12"]);
  assert.equal(next.asOf, "2026-10-12");
  assert.equal(requests.length, holiday ? 5 : 6);
  const currentChunks = await Promise.all(next.chunks.map((_, i) => kv.get(shardKey(next.generation, i), "json")));
  assert.equal(combineChunks(next, currentChunks).stocks.find((stock) => stock.symbol === "1000").history.length, holiday ? 2 : 3);
});

test("a failed KV shard write keeps the old market public and resumes at its checkpoint", async () => {
  const prior = market(); prior.date = "2026-10-15";
  prior.records = Object.fromEntries(Object.entries(prior.records).map(([symbol, row]) => [symbol, [prior.date, ...row.slice(1)]]));
  const { manifest, chunks } = datasetParts([prior], catalog, "old-active");
  manifest.previousGeneration = "older-retired";
  const generation = "new-staged";
  const kv = memoryKV([[MANIFEST_KEY, JSON.stringify(manifest)],
    [shardKey("older-retired", 0), "{}"],
    ...chunks.map((chunk, i) => [shardKey(manifest.generation, i), JSON.stringify(chunk)]),
    [SYNC_KEY, JSON.stringify({ date, slot: "20:30", generation, phase: "shards", nextShard: 0, failures: 0 })],
    [stageKey(generation, "catalog"), JSON.stringify(catalog)], [stageKey(generation, "days"), JSON.stringify([market()])]]);
  const put = kv.put;
  let fail = true;
  kv.put = async (key, value) => {
    if (key === shardKey(generation, 1) && fail) { fail = false; throw new Error("KV temporarily unavailable"); }
    return put(key, value);
  };
  const options = { now: new Date("2026-10-16T13:04:00Z"), fetcher: () => { throw new Error("No upstream call expected"); } };
  const state = await syncMarket({ MARKET_DATA: kv }, options);
  assert.equal(state.nextShard, 1);
  assert.equal(state.failures, 1);
  assert.equal((await kv.get(MANIFEST_KEY, "json")).generation, "old-active");
  assert.ok(kv.deletes.includes(shardKey("older-retired", 0)));
  assert.ok(!kv.deletes.some((key) => key.startsWith("twse:v2:old-active:")));
  assert.equal((await syncMarket({ MARKET_DATA: kv }, { ...options, now: new Date("2026-10-16T13:05:00Z") })).nextShard, 1);
  assert.equal((await syncMarket({ MARKET_DATA: kv }, { ...options, now: new Date("2026-10-16T13:35:00Z") })).nextShard, 33);
  assert.equal((await kv.get(MANIFEST_KEY, "json")).generation, "old-active");
});
