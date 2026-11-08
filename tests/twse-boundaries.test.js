import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SHARD_COUNT } from "../shared/market-codec.js";
import * as adapter from "../cloudflare/adapters/twse.js";
import * as market from "../shared/market.js";
import * as keys from "../cloudflare/storage/market-keys.js";
import { createManifest } from "../cloudflare/snapshots/market-format.js";

test("TWSE storage keys keep their published names", () => {
  assert.equal(keys.MANIFEST_KEY, "twse:v2:market");
  assert.equal(keys.SYNC_KEY, "twse:v2:sync");
  assert.equal(keys.shardKey("current", 127), "twse:v2:current:shard:127");
  assert.equal(keys.stageKey("current", "prices"), "twse:v2:current:prices");
});

test("source parsing, market rules, and published snapshots preserve the pre-refactor JSON", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/twse-20261016.json", import.meta.url)));
  const date = "2026-10-16";
  const catalog = adapter.normalizeCatalog(fixture.companies);
  const prices = adapter.normalizePrices(fixture.prices, date);
  const flows = adapter.normalizeFlows(fixture.flows, date);
  const day = market.marketDay(catalog, prices, flows);
  const chunks = Array.from({ length: SHARD_COUNT }, (_, index) => market.mergeShard(catalog, index, null, [day]));
  const manifest = createManifest(catalog, [date], "boundary-fixture", "2026-10-16T14:00:00Z", day.coverage, "previous-fixture");
  // Captured from the original twse.js before moving functions. Includes field
  // ordering, missing/inactive records, null institutions, and all 128 chunks.
  const digest = createHash("sha256").update(JSON.stringify({ catalog, prices, flows, day, chunks, manifest })).digest("hex");
  assert.equal(digest, "98f9f20b17c70f91de6995dc9ec243a17aac26056404111ea369edafedbf3081");
  assert.equal(manifest.chunks[127], "/api/market/boundary-fixture/127");
});

test("shared market rules and their dependencies stay independent of transport and storage", () => {
  const sharedRoot = new URL("../shared/", import.meta.url);
  const visited = new Set();
  function inspect(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    assert.ok(url.href.startsWith(sharedRoot.href), `Shared dependency escaped to ${url.href}`);
    const source = readFileSync(url, "utf8");
    assert.doesNotMatch(source, /\b(?:fetch|Request|Response|URLSearchParams)\b|\/api\/|twse:v2:/, url.href);
    for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g)) {
      assert.ok(match[1].startsWith("."), `Unexpected runtime dependency: ${match[1]}`);
      inspect(new URL(match[1], url));
    }
  }
  inspect(new URL("market.js", sharedRoot));
  assert.ok(visited.has(new URL("market-codec.js", sharedRoot).href));
});

test("TWSE transport retains injected fetch, JSON validation, and fail-closed errors", async () => {
  let called;
  const url = adapter.reportUrl("prices", "2026-10-16");
  const data = { stat: "OK" };
  assert.deepEqual(await adapter.fetchJson(url, async (input, options) => {
    called = { input, options };
    return { ok: true, async json() { return data; } };
  }), data);
  assert.equal(called.input, url);
  assert.deepEqual(called.options.headers, { Accept: "application/json" });
  assert.ok(called.options.signal instanceof AbortSignal);
  await assert.rejects(adapter.fetchJson(url, async () => ({ ok: false, status: 429 })),
    { message: "TWSE HTTP 429; stop and retry later" });
  await assert.rejects(adapter.fetchJson(url, async () => ({ ok: true, async json() { throw new Error("HTML"); } })),
    { message: "TWSE returned non-JSON data; stop and retry later" });
});
