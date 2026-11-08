import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../cloudflare/worker.js";
import { normalizeEtfCatalog, normalizeCatalog, normalizePrices, normalizeFlows } from "../cloudflare/adapters/twse.js";
import { marketDay, mergeShard, combineCatalogs } from "../shared/market.js";
import { createManifest } from "../cloudflare/snapshots/market-format.js";
import { SHARD_COUNT, shardOf } from "../shared/market-codec.js";
import { MANIFEST_KEY, shardKey } from "../cloudflare/storage/market-keys.js";
import { combineChunks } from "../src/provider.js";
import { isEtf } from "../src/market-codec.js";
import { prepareEtfRelease } from "../scripts/prepare-etfs.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/twse-20261016.json", import.meta.url)));
const rawCatalog = { stat: "OK", fields: ["上市日期", "證券代號", "證券簡稱", "發行人", "標的指數"], data: [
  ["2003.06.30", "0050", "元大台灣50", "元大", "台灣50"],
  ["2014.10.31", "00632R", "元大台灣50反1", "元大", "台灣50反1"],
  ["2011.09.26(新臺幣)<br>2016.08.08(人民幣)", "006205(新臺幣)<br>00625K(人民幣)", "富邦上証(新臺幣)<br>富邦上証+R(人民幣)", "富邦", "上証180"],
] };

test("ETF catalog explicitly marks TWD funds and parses primary dual-currency counters", () => {
  const etfs = normalizeEtfCatalog(rawCatalog);
  assert.equal(etfs.length, 3);
  assert.deepEqual(etfs.map((stock) => stock.symbol), ["0050", "006205", "00632R"]);
  assert.ok(etfs.every((stock) => isEtf(stock) && stock.currency === "TWD" && stock.sector === "ETF"));
  assert.equal(etfs.find((stock) => stock.symbol === "006205").listedOn, "2011-09-26");
  for (const mutate of [(b) => { b.data[0][0] = "2026.02.30"; }, (b) => { b.data[0][1] = "not-a-code"; },
    (b) => { b.data.push(b.data[0]); }, (b) => { b.fields[0] = "changed"; }, (b) => { b.data[0][2] = "<script>x</script>"; }]) {
    const body = structuredClone(rawCatalog); mutate(body);
    assert.throws(() => normalizeEtfCatalog(body));
  }
  assert.throws(() => combineCatalogs(etfs, etfs), /Duplicate/);
});

test("letter ETF shards are deterministic and numeric stock shards retain existing URLs", () => {
  for (const symbol of ["0050", "006208", "2330", "910322"])
    assert.equal(shardOf(symbol), Number(symbol) % SHARD_COUNT);
  for (const symbol of ["00632R", "00631L", "00981A", "00953B"]) {
    assert.ok(shardOf(symbol) >= 0 && shardOf(symbol) < SHARD_COUNT);
    assert.equal(shardOf(symbol), shardOf(symbol));
  }
  assert.throws(() => shardOf("NaN"));
});

test("latest-session ETF release preserves every company history and serves letter symbols", async () => {
  const date = "2026-10-16", companies = normalizeCatalog(fixture.companies);
  const day = marketDay(companies, normalizePrices(fixture.prices, date), normalizeFlows(fixture.flows, date));
  const prior = { ...day, date: "2026-10-15", records: Object.fromEntries(Object.entries(day.records)
    .map(([symbol, row]) => [symbol, ["2026-10-15", ...row.slice(1)]])) };
  const manifest = createManifest(companies, [prior.date, date], "before-etfs", "2026-10-16T12:00:00Z", day.coverage);
  const chunks = Array.from({ length: SHARD_COUNT }, (_, index) => ({
    ...mergeShard(companies, index, null, [prior, day]), generation: manifest.generation, index,
  }));
  const prices = structuredClone(fixture.prices), flows = structuredClone(fixture.flows);
  const price = prices.tables[0].data.find((row) => row[0] === "2330");
  const flow = flows.data.find((row) => row[0] === "2330");
  for (const symbol of ["0050", "00632R"]) {
    prices.tables[0].data.push([symbol, ...price.slice(1)]);
    flows.data.push([symbol, "ETF fixture", ...flow.slice(2)]);
  }
  const result = prepareEtfRelease({ manifest, chunks, rawCatalog, rawPrices: prices, rawFlows: flows,
    recentCounts: Array(5).fill(flows.data.length), now: new Date("2026-10-20T05:00:00Z") });
  const decoded = combineChunks(result.manifest, result.chunks);
  assert.equal(result.report.companyHistoriesUnchanged, true);
  assert.equal(decoded.stocks.filter(isEtf).length, 3);
  assert.equal(decoded.stocks.find((stock) => stock.symbol === "2330").history.length, 2);
  assert.equal(decoded.stocks.find((stock) => stock.symbol === "0050").history.length, 1);
  assert.equal(decoded.stocks.find((stock) => stock.symbol === "006205").history.length, 0);
  assert.equal(result.manifest.previousGeneration, manifest.generation);
  assert.ok(result.manifest.coverage.missingPrices.includes("006205"));
  const values = new Map([[MANIFEST_KEY, JSON.stringify(result.manifest)], ...result.chunks.map((chunk, index) =>
    [shardKey(result.manifest.generation, index), JSON.stringify(chunk)])]);
  const response = await worker.fetch(new Request("https://stock.test/api/stocks/00632R"), {
    MARKET_DATA: { get: async (key, type) => type === "json" ? JSON.parse(values.get(key) ?? "null") : values.get(key) },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stock.symbol, "00632R");
  assert.throws(() => prepareEtfRelease({ manifest, chunks, rawCatalog, rawPrices: prices, rawFlows: flows, recentCounts: [] }), /PendingConfirmation/);
});
