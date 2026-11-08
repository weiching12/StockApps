// Actual workerd + SQLite DO storage, isolated from production and upstream APIs.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { fileURLToPath } from "node:url";

const source = `
import { MarketSyncCoordinator } from "./cloudflare/sync/coordinator.js";
import { SYNC_KEY } from "./cloudflare/storage/market-keys.js";
export class TestCoordinator extends MarketSyncCoordinator {
  constructor(ctx, env) {
    super(ctx, env);
    this.run = async (env) => {
      const before = await env.MARKET_DATA.get(SYNC_KEY, "json");
      await new Promise((resolve) => setTimeout(resolve, 25));
      const state = { phase: "shards", steps: (before?.steps ?? 0) + 1 };
      await env.MARKET_DATA.put(SYNC_KEY, JSON.stringify(state));
      return state;
    };
  }
}
export default { fetch() { return new Response("test only"); } };
`;
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: source, resolveDir: root }, bundle: true,
  write: false, format: "esm", platform: "browser", target: "es2022" });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
  compatibilityDate: "2026-10-17", kvNamespaces: ["MARKET_DATA"],
  durableObjects: { MARKET_SYNC: { className: "TestCoordinator", useSQLite: true } } }));
try {
  const namespace = await mf.getDurableObjectNamespace("MARKET_SYNC");
  const object = namespace.get(namespace.idFromName("test-sync"));
  const time = Date.parse("2026-10-21T10:30:00Z");
  const tick = async (timestamp) => {
    const response = await object.fetch(`https://internal/tick?time=${timestamp}`, { method: "POST" });
    assert.equal(response.status, 200); return response.json();
  };
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => tick(time)));
  assert.equal(duplicates.filter((result) => !result.duplicate).length, 1);
  assert.ok(duplicates.every((result) => result.steps === 1));
  const distinct = await Promise.all([tick(time + 60000), tick(time + 120000)]);
  assert.deepEqual(distinct.map((result) => result.steps), [2, 3]);
  assert.equal((await tick(time)).duplicate, true);
  const kv = await mf.getKVNamespace("MARKET_DATA");
  assert.equal(await kv.get("twse:v2:sync"), null);
  console.log("PASS workerd: concurrent deduplication, serialized phases, durable checkpoints, no KV progress writes");
} finally { await mf.dispose(); }
