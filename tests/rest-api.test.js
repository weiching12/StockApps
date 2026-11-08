import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/worker.js";
import { MANIFEST_KEY, shardKey } from "../cloudflare/storage/market-keys.js";
import { shardOf } from "../src/market-codec.js";

function fixture() {
  const manifest = { schemaVersion: 2, source: "twse", generation: "test", dates: ["2026-10-20"],
    asOf: "2026-10-20", updatedAt: "2026-10-20T12:00:00Z",
    stocks: [{ symbol: "2330", name: "台積電", sector: "半導體", assetType: "stock" },
      { symbol: "0050", name: "元大台灣50", sector: "ETF", assetType: "etf" }],
    chunks: Array.from({ length: 128 }, (_, i) => `/api/market/test/${i}`) };
  const values = new Map([[MANIFEST_KEY, manifest]]);
  for (const stock of manifest.stocks) values.set(shardKey("test", shardOf(stock.symbol)), {
    generation: "test", index: shardOf(stock.symbol), stocks: [{ symbol: stock.symbol,
      history: [["2026-10-20", 100, 102, 99, 101, 10000, 500, 200, 0, 0, 0, 0]] }] });
  let writes = 0;
  const env = { MARKET_DATA: { get: async (key) => structuredClone(values.get(key) ?? null),
    put: async () => { writes++; }, delete: async () => { writes++; } } };
  return { values, env, writes: () => writes,
    get: (path, method = "GET") => worker.fetch(new Request(`https://example.test${path}`, { method }), env) };
}

test("versioned market links resolve and stock/history resources agree with legacy endpoints", async () => {
  const f = fixture();
  const market = await (await f.get("/api/v1/market")).json();
  assert.match(market.chunks[0], /^\/api\/v1\/market\/snapshots\/test\/shards\/0$/);
  const path = market.chunks[shardOf("2330")];
  assert.equal((await f.get(path)).headers.get("cache-control"), "public, max-age=86400, immutable");
  const legacy = await (await f.get("/api/stocks/2330")).json();
  assert.deepEqual(await (await f.get("/api/v1/stocks/2330")).json(), legacy);
  assert.deepEqual((await (await f.get("/api/v1/stocks/2330/history")).json()).data, legacy.stock.history);
  assert.equal((await f.get("/api/v1/stocks/0050")).status, 200);
  assert.equal(f.writes(), 0);
});

test("stock collection filters metadata with bounded pagination and no history reads", async () => {
  const f = fixture();
  const etfs = await (await f.get("/api/v1/stocks?type=etf&limit=1")).json();
  assert.equal(etfs.data[0].symbol, "0050"); assert.equal(etfs.meta.total, 1);
  assert.equal((await (await f.get("/api/v1/stocks?q=2330")).json()).data[0].symbol, "2330");
  assert.equal((await (await f.get("/api/v1/stocks?offset=2")).json()).data.length, 0);
  for (const query of ["limit=0", "limit=201", "offset=-1", "limit=no", "type=invalid"])
    assert.equal((await f.get(`/api/v1/stocks?${query}`)).status, 400);
});

test("errors, methods and HEAD are consistent without exposing storage errors", async () => {
  const f = fixture();
  const missing = await f.get("/api/v1/stocks/9999");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "STOCK_NOT_FOUND");
  assert.equal((await f.get("/api/v1/unknown")).status, 404);
  const method = await f.get("/api/v1/stocks", "POST");
  assert.equal(method.status, 405); assert.equal(method.headers.get("allow"), "GET, HEAD");
  for (const path of ["/api/v1/market", "/api/v1/stocks/2330", "/api/v1/stocks/9999"])
    assert.equal(await (await f.get(path, "HEAD")).text(), "");
  f.values.clear();
  const unavailable = await f.get("/api/v1/market");
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, "DATA_UNAVAILABLE");
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
});

test("versioned presence keeps same-origin protection and method policy", async () => {
  const f = fixture();
  const forbidden = await worker.fetch(new Request("https://example.test/api/v1/presence", {
    method: "POST", headers: { Origin: "https://other.test" } }), f.env);
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, "PRESENCE_ERROR");
  assert.equal((await f.get("/api/v1/presence", "DELETE")).headers.get("allow"), "GET, POST");
});
