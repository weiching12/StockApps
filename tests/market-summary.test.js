import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createManifest } from "../cloudflare/snapshots/market-format.js";
import { marketDay, mergeShard } from "../shared/market.js";
import { normalizeCatalog, normalizeFlows, normalizePrices } from "../cloudflare/adapters/twse.js";
import { MarketSummaryService } from "../cloudflare/services/market-summary-service.js";
import { getSnapshot, getStockInstitutionEstimate, getDominantInstitution } from "../shared/indicators.js";
import { SHARD_COUNT, expandStock, shardOf } from "../shared/market-codec.js";
import { loadMarketSummary } from "../src/provider.js";
import { MarketRepository } from "../cloudflare/repositories/market-repository.js";
import { MarketSummaryCoordinator } from "../cloudflare/summary-coordinator.js";
import { MANIFEST_KEY, shardKey } from "../cloudflare/storage/market-keys.js";
import { testDatabase } from "./helpers/t86-db.js";
import { CorporateActionRepository } from "../cloudflare/corporate-actions/repository.js";
import { durableStorage } from "./helpers/durable-storage.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/twse-20261016.json", import.meta.url)));
const catalog = normalizeCatalog(fixture.companies);
const date = "2026-10-16";
const day = marketDay(catalog, normalizePrices(fixture.prices, date), normalizeFlows(fixture.flows, date));
const manifest = createManifest(catalog, [date], "summary-test", "2026-10-16T12:00:00Z", day.coverage);
const shards = Array.from({ length: SHARD_COUNT }, (_, index) =>
  ({ ...mergeShard(catalog, index, null, [day]), generation: manifest.generation, index }));
const service = new MarketSummaryService({
  market: async () => manifest,
  shards: async (_generation, indices) => indices.map((index) => shards[index]),
});

test("market summary matches existing indicators and omits market history", async () => {
  const result = await service.summary(date, { period: 9, kSmooth: 3, dSmooth: 3 });
  assert.equal(result.data.stocks.length, catalog.length);
  assert.equal(result.meta.asOf, date);
  assert.ok(!("history" in result.data.stocks[0]));
  assert.ok(!("institutionalSummary" in result.data.stocks[0]));
  for (const row of result.data.stocks) {
    const compact = shards[shardOf(row.symbol)].stocks.find((stock) => stock.symbol === row.symbol);
    const original = getSnapshot({ ...expandStock(catalog.find((stock) => stock.symbol === row.symbol), compact.history),
      tradingDates: manifest.dates }, date, result.meta.settings);
    assert.deepEqual(row.latest, original.latest);
    assert.deepEqual(row.signal, original.signal);
    assert.deepEqual(row.priceVolume, original.priceVolume);
    assert.deepEqual(row.trend, original.trend);
    assert.equal(row.entryScore.modelVersion, "entry-score-v1.2");
    assert.equal(row.entryScore.totalScore, null);
    assert.ok(!("entryScoreChange" in row), "the retired V1.2 day-over-day change is not computed");
    assert.ok(row.entryScore.missingData.length > 0);
    assert.ok(!("categories" in row.entryScore));
    assert.deepEqual(row.dominantInstitution, getDominantInstitution(original.latest?.institutions));
    assert.equal(row.money.day.total, getStockInstitutionEstimate(original, "total", "day", manifest.dates));
  }
  const favorites = await service.favorites([catalog[0].symbol], date, result.meta.settings);
  assert.deepEqual(favorites.data[0].institutionalSummary,
    getSnapshot({ ...expandStock(catalog[0], shards[shardOf(catalog[0].symbol)].stocks
      .find((stock) => stock.symbol === catalog[0].symbol).history), tradingDates: manifest.dates },
    date, result.meta.settings).institutionalSummary);
  assert.equal(favorites.data[0].dayInstitutionNet.total,
    result.data.stocks.find((stock) => stock.symbol === catalog[0].symbol).latest?.institutionalNet ?? null);
  assert.equal(result.data.sentiment.date, date);
  assert.equal(result.data.sentiment.status, "insufficient");
  assert.equal(result.data.sentiment.requestedDate, date);
  assert.equal(result.data.sentiment.series.at(-1).components.trend, null);
  assert.equal(result.data.sentiment.series.at(-1).components.momentum, null);
  assert.ok(Number.isFinite(result.data.sentiment.latestEffectiveWeight));
  assert.ok(result.data.sectors.day.length > 0);
  const sector = await service.sector(catalog[0].sector, date, result.meta.settings);
  assert.equal(sector.data.name, catalog[0].sector);
  assert.ok(sector.data.members.length > 0);
  await assert.rejects(service.summary("2026-10-17", result.meta.settings), { code: "INVALID_QUERY" });
});

test("first browser load requests only manifest and latest summary", async () => {
  const result = await service.summary(date, { period: 9, kSmooth: 3, dSmooth: 3 });
  const calls = [];
  const fetcher = async (path, options) => {
    calls.push(path);
    if (path.startsWith("/api/v1/market/summary")) assert.equal(options.cache, "no-cache");
    return Response.json(path === "/api/v1/market" ? manifest : result);
  };
  const loaded = await loadMarketSummary(fetcher, { settings: result.meta.settings });
  assert.equal(loaded.summary.meta.generation, manifest.generation);
  assert.deepEqual(calls, ["/api/v1/market", "/api/v1/market/summary?period=9&kSmooth=3&dSmooth=3&asOf=2026-10-16"]);
});

test("historical summary uses only rows through the requested trading day", async () => {
  const next = "2026-10-19";
  const future = { ...day, date: next, records: Object.fromEntries(Object.entries(day.records).map(([symbol, row]) =>
    [symbol, [next, ...row.slice(1, 4), row[4] * 2, ...row.slice(5)]])) };
  const twoDayManifest = createManifest(catalog, [date, next], "two-day", "2026-10-19T12:00:00Z", future.coverage);
  const twoDayShards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    ({ ...mergeShard(catalog, index, null, [day, future]), generation: twoDayManifest.generation, index }));
  const twoDayService = new MarketSummaryService({ market: async () => twoDayManifest,
    shards: async (_generation, indices) => indices.map((index) => twoDayShards[index]) });
  const historical = await twoDayService.summary(date, { period: 9, kSmooth: 3, dSmooth: 3 });
  const latest = await twoDayService.summary(next, { period: 9, kSmooth: 3, dSmooth: 3 });
  assert.deepEqual(historical.data.stocks.map((stock) => stock.latest),
    (await service.summary(date, { period: 9, kSmooth: 3, dSmooth: 3 })).data.stocks.map((stock) => stock.latest));
  assert.equal(historical.data.sentiment.date, date);
  assert.notDeepEqual(historical.data.stocks.map((stock) => stock.latest?.close),
    latest.data.stocks.map((stock) => stock.latest?.close));
  const historicalSector = await twoDayService.sector(catalog[0].sector, date, historical.meta.settings);
  const latestSector = await twoDayService.sector(catalog[0].sector, next, latest.meta.settings);
  assert.equal(historicalSector.meta.asOf, date);
  assert.equal(latestSector.meta.asOf, next);
  assert.ok(historicalSector.data.members.every(({ stock }) => stock.latest?.date <= date));
});

test("backend KD and moving average match the former 45-session browser calculation", async () => {
  const days = Array.from({ length: 45 }, (_, index) => {
    const sessionDate = new Date(Date.UTC(2026, 7, index + 1)).toISOString().slice(0, 10);
    return { ...day, date: sessionDate, records: Object.fromEntries(
      Object.entries(day.records).map(([symbol, row]) => {
        const close = row[4] + index * 0.25 + Math.sin(index / 3);
        return [symbol, [sessionDate, close, close + 2, close - 2, close, ...row.slice(5)]];
      })) };
  });
  const dates = days.map((item) => item.date);
  const market = createManifest(catalog, dates, "indicator-test", "2026-09-14T12:00:00Z", day.coverage);
  const historyShards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    ({ ...mergeShard(catalog, index, null, days), generation: market.generation, index }));
  const historicalService = new MarketSummaryService({ market: async () => market,
    shards: async (_generation, indices) => indices.map((index) => historyShards[index]) });
  const settings = { period: 9, kSmooth: 3, dSmooth: 3 };
  const asOf = dates[39];
  const summary = await historicalService.summary(asOf, settings);
  for (const row of summary.data.stocks) {
    const compact = historyShards[shardOf(row.symbol)].stocks.find((item) => item.symbol === row.symbol);
    const stock = { ...expandStock(catalog.find((item) => item.symbol === row.symbol), compact.history), tradingDates: dates };
    const previous = getSnapshot(stock, asOf, settings);
    assert.deepEqual(row.latest, previous.latest);
    assert.deepEqual(row.signal, previous.signal);
    assert.deepEqual(row.priceVolume, previous.priceVolume);
    assert.deepEqual(row.trend, previous.trend);
  }
  const futureChanged = structuredClone(days.at(-1));
  futureChanged.records = Object.fromEntries(Object.entries(futureChanged.records).map(([symbol, row]) =>
    [symbol, [row[0], 1, 10000, 1, 10000, ...row.slice(5)]]));
  const changedShards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    ({ ...mergeShard(catalog, index, null, [...days.slice(0, -1), futureChanged]),
      generation: market.generation, index }));
  const unchangedPast = await new MarketSummaryService({ market: async () => market,
    shards: async (_generation, indices) => indices.map((index) => changedShards[index]) }).summary(asOf, settings);
  assert.deepEqual(unchangedPast.data.stocks, summary.data.stocks);
});

test("D1 serves selected history shards in one database request", async () => {
  const db = testDatabase();
  try {
    db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0003_market_history.sql", import.meta.url), "utf8"));
    for (const index of [shardOf(catalog[0].symbol), shardOf(catalog[1].symbol)]) {
      db.sqlite.prepare("INSERT OR IGNORE INTO market_history_shards VALUES(?,?,?)")
        .run(manifest.generation, index, JSON.stringify(shards[index]));
    }
    let statements = 0;
    db.beforeStatement = () => { statements++; };
    const repository = new MarketRepository(null, db);
    const indices = [...new Set(catalog.slice(0, 2).map((stock) => shardOf(stock.symbol)))];
    const result = await repository.shards(manifest.generation, indices);
    assert.equal(result.length, indices.length);
    assert.equal(statements, 1);
  } finally { db.sqlite.close(); }
});

test("all 128 D1 shards fit the 100-parameter limit in two queries", async () => {
  const calls = [];
  const db = { prepare: () => ({ bind: (...values) => {
    calls.push(values);
    assert.ok(values.length <= 100);
    return { all: async () => ({ results: values.slice(1).map((index) =>
      ({ Payload: JSON.stringify(shards[index]) })) }) };
  } }) };
  const result = await new MarketRepository(null, db).shards(manifest.generation,
    Array.from({ length: SHARD_COUNT }, (_, index) => index));
  assert.equal(result.length, SHARD_COUNT);
  assert.deepEqual(calls.map((values) => values.length), [100, 30]);
});

test("Free-plan coordinator computes once and stores large summaries in bounded parts", async () => {
  const marketData = new Map([[MANIFEST_KEY, manifest]]);
  for (const shard of shards) marketData.set(shardKey(manifest.generation, shard.index), shard);
  let shardReads = 0;
  const storageData = new Map();
  const coordinator = new MarketSummaryCoordinator({ storage: durableStorage(storageData) }, { MARKET_DATA: { get: async (key) => {
    if (key.includes(":shard:")) shardReads++;
    return marketData.get(key) ?? null;
  } } });
  const url = `https://example.test/api/v1/market/summary?period=9&kSmooth=3&dSmooth=3&asOf=${date}`;
  const oldKey = `view:entry-score-v1.2-research-v2:${manifest.generation}:not-applicable:/api/v1/market/summary?period=9&kSmooth=3&dSmooth=3&asOf=${date}`;
  storageData.set(`${oldKey}:part:0`, JSON.stringify({ data: { stocks: [{ symbol: "stale" }] } }));
  storageData.set(`${oldKey}:parts`, 1);
  const first = await coordinator.fetch(new Request(url));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.data.stocks.length, catalog.length);
  assert.ok(firstBody.data.stocks.every((stock) => "priceVolume" in stock && "trend" in stock));
  assert.equal(shardReads, SHARD_COUNT);
  const again = await coordinator.fetch(new Request(url));
  assert.deepEqual(await again.json(), firstBody);
  assert.equal(shardReads, SHARD_COUNT);
  const head = await coordinator.fetch(new Request(url, { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const large = { data: "台".repeat(1_000_000) };
  await coordinator.writeCached("large", large);
  assert.ok(storageData.get("large:parts") > 1);
  assert.ok([...storageData.entries()].filter(([key]) => key.startsWith("large:part:"))
    .every(([, value]) => new TextEncoder().encode(value).length < 2_000_000));
  assert.deepEqual(await coordinator.readCached("large"), large);
});

test("corporate-action revision invalidates the cached market summary", async () => {
  const db = testDatabase();
  try {
    db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0004_corporate_actions.sql", import.meta.url), "utf8"));
    db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0005_research_snapshots.sql", import.meta.url), "utf8"));
    const marketData = new Map([[MANIFEST_KEY, manifest]]);
    for (const shard of shards) marketData.set(shardKey(manifest.generation, shard.index), shard);
    let shardReads = 0;
    const cache = new Map();
    const coordinator = new MarketSummaryCoordinator({ storage: durableStorage(cache) }, { MARKET_DATA: { get: async (key) => {
      if (key.includes(":shard:")) shardReads++;
      return marketData.get(key) ?? null;
    } }, T86_DB: db, CORPORATE_ACTIONS_ENABLED: "1" });
    const url = `https://example.test/api/v1/market/summary?period=9&kSmooth=3&dSmooth=3&asOf=${date}`;
    assert.equal((await coordinator.fetch(new Request(url))).status, 200);
    assert.equal(shardReads, SHARD_COUNT);
    await new CorporateActionRepository(db).save([date], [], "2026-10-22T12:00:00Z");
    assert.equal((await coordinator.fetch(new Request(url))).status, 200);
    assert.equal(shardReads, SHARD_COUNT * 2);
  } finally { db.sqlite.close(); }
});

test("effective query values share a summary cache despite ordering, defaults and ignored parameters", async () => {
  const values = new Map([[MANIFEST_KEY, manifest], ...shards.map(shard => [shardKey(manifest.generation, shard.index), shard])]);
  let shardReads = 0;
  const coordinator = new MarketSummaryCoordinator({ storage: durableStorage() }, {
    MARKET_DATA: { get: async key => { if (key.includes(":shard:")) shardReads++; return values.get(key) ?? null; } },
  });
  for (const query of ["", `dSmooth=03&asOf=${date}&period=09&kSmooth=3&unused=1`, `unused=2&kSmooth=3&period=9&dSmooth=3&asOf=${date}`])
    assert.equal((await coordinator.fetch(new Request(`https://example.test/api/v1/market/summary?${query}`))).status, 200);
  assert.equal(shardReads, SHARD_COUNT);
});

test("invalid summary options return the public 400 contract before reading storage", async () => {
  const coordinator = new MarketSummaryCoordinator({ storage: durableStorage() }, {
    MARKET_DATA: { get: async () => assert.fail("invalid options must not access market storage") },
  });
  for (const query of ["period=0", "kSmooth=21", "asOf=2026-02-30"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await coordinator.fetch(new Request(`https://example.test/api/v1/market/summary?${query}`, { method }));
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("cache-control"), "no-store");
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.equal((await response.json()).error.code, "INVALID_QUERY");
    }
  }
});

test("the summary never writes V1.2 research snapshots and is cached from the first request", async () => {
  const db = testDatabase();
  try {
    db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0005_research_snapshots.sql", import.meta.url), "utf8"));
    let writes = 0, shardReads = 0;
    db.beforeStatement = sql => { if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes++; };
    const values = new Map([[MANIFEST_KEY, manifest], ...shards.map(shard => [shardKey(manifest.generation, shard.index), shard])]);
    const cache = new Map();
    const coordinator = new MarketSummaryCoordinator({ storage: durableStorage(cache) }, { T86_DB: db,
      MARKET_DATA: { get: async key => { if (key.includes(":shard:")) shardReads++; return values.get(key) ?? null; } },
    });
    const request = () => new Request(`https://example.test/api/v1/market/summary?asOf=${date}`);
    const first = await coordinator.fetch(request());
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "public, max-age=60");
    assert.equal((await first.json()).meta.researchCapture, "not-required");
    const reads = shardReads;
    assert.equal((await coordinator.fetch(request())).status, 200);
    assert.equal(shardReads, reads, "the second request is served from the summary cache");
    assert.equal(writes, 0);
  } finally { db.sqlite.close(); }
});

test("a corporate-action revision changing during a read keeps the summary uncached", async () => {
  let revisionReads = 0;
  const actions = { revision: async () => ++revisionReads === 1 ? "before" : "after",
    window: async () => ({ coveredDates: new Set(), eventsBySymbol: new Map() }) };
  const summary = new MarketSummaryService(service.market, actions);
  assert.equal((await summary.summary(date, { period: 9, kSmooth: 3, dSmooth: 3 })).meta.researchCapture, "failed");
  assert.equal((await summary.summary(date, { period: 9, kSmooth: 3, dSmooth: 3 })).meta.researchCapture, "not-required");
});

test("simultaneous HEAD then GET receives a complete shared summary body", async () => {
  const values = new Map([[MANIFEST_KEY, manifest], ...shards.map((shard) =>
    [shardKey(manifest.generation, shard.index), shard])]);
  const cache = new Map();
  let release, entered;
  const blocked = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const coordinator = new MarketSummaryCoordinator({ storage: durableStorage(cache) }, { MARKET_DATA: { get: async (key) => {
    if (key.includes(":shard:")) { entered(); await blocked; }
    return values.get(key) ?? null;
  } } });
  const url = `https://example.test/api/v1/market/summary?asOf=${date}`;
  const headRequest = coordinator.fetch(new Request(url, { method: "HEAD" }));
  await started;
  const getRequest = coordinator.fetch(new Request(url));
  // Wait until GET has joined the same pending calculation.
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const [head, get] = await Promise.all([headRequest, getRequest]);
  assert.equal(await head.text(), "");
  assert.equal((await get.json()).data.stocks.length, catalog.length);
  assert.equal((await (await coordinator.fetch(new Request(url))).json()).data.stocks.length, catalog.length);
});
