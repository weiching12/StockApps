import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createManifest, marketDay, mergeShard, normalizeCatalog, normalizeFlows, normalizePrices, SHARD_COUNT } from "../../cloudflare/twse.js";
import { MarketSummaryService } from "../../cloudflare/services/market-summary-service.js";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const fixture = JSON.parse(readFileSync(new URL("../fixtures/twse-20261016.json", import.meta.url)));
const catalog = normalizeCatalog(fixture.companies);
const date = "2026-10-16";
const day = marketDay(catalog, normalizePrices(fixture.prices, date), normalizeFlows(fixture.flows, date));
const manifest = createManifest(catalog, [date], "summary-loading", "2026-10-16T12:00:00Z", day.coverage);
const chunks = Array.from({ length: SHARD_COUNT }, (_, index) =>
  ({ ...mergeShard(catalog, index, null, [day]), generation: manifest.generation, index }));
const service = new MarketSummaryService({ market: async () => manifest,
  shards: async (_generation, indices) => indices.map((index) => chunks[index]) });
const summary = await service.summary(date, { period: 9, kSmooth: 3, dSmooth: 3 });
const versionedManifest = { ...manifest, chunks: manifest.chunks.map((_, index) =>
  `/api/v1/market/snapshots/${manifest.generation}/shards/${index}`) };
const defer = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("market shell waits for one backend summary and never requests history shards", async ({ page }) => {
  const waiting = defer(), paths = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    paths.push(path);
    if (path === "/api/v1/presence") return route.fulfill({ json: { today: 1 } });
    if (path === "/api/v1/market") return route.fulfill({ json: versionedManifest });
    if (path === "/api/v1/market/summary") {
      await waiting.promise;
      return route.fulfill({ json: summary });
    }
    return route.fulfill({ status: 404 });
  });
  try {
    await page.goto("/");
    await expect(page.locator("#trade-date")).toBeDisabled();
    waiting.resolve();
    await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("#stock-rows tr")).toHaveCount(manifest.coverage.traded);
    expect(paths.filter((path) => path.includes("/shards/"))).toEqual([]);
    expect(paths.filter((path) => path === "/api/v1/market/summary")).toHaveLength(1);
    await page.locator("#stock-search").fill("2330");
    await expect(page.locator("#stock-rows tr")).toHaveCount(1);
  } finally { waiting.resolve(); }
});

test("failed summary keeps the shell usable and retry loads the complete result", async ({ page }) => {
  let fail = true;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/presence") return route.fulfill({ json: { today: 1 } });
    if (path === "/api/v1/market") return route.fulfill({ json: versionedManifest });
    if (path === "/api/v1/market/summary") return route.fulfill(fail ? { status: 503, body: "unavailable" } : { json: summary });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await expect(page.locator("#load-status")).toBeVisible();
  fail = false;
  await page.locator("#reload-data").click();
  await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#stock-rows tr")).toHaveCount(manifest.coverage.traded);
});

test("home screen launch downloads market data while the launch animation plays", async ({ page }) => {
  // Emulate an installed app so the 1.8 s branded launch animation runs.
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = nativeMatchMedia(query);
      return query === "(display-mode: standalone)" ? new Proxy(result, { get: (target, key) =>
        key === "matches" ? true : typeof target[key] === "function" ? target[key].bind(target) : target[key] }) : result;
    };
  });
  const requested = {};
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requested[path] ??= Date.now();
    if (path === "/api/v1/presence") return route.fulfill({ json: { today: 1 } });
    if (path === "/api/v1/market") return route.fulfill({ json: versionedManifest });
    if (path === "/api/v1/market/summary") return route.fulfill({ json: summary });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/is-standalone/);
  await expect(page.locator("#app-splash")).toBeVisible();
  // Both requests start while the splash still covers the app, not after it leaves.
  await expect.poll(() => Boolean(requested["/api/v1/market/summary"])).toBe(true);
  await expect(page.locator("#app-splash")).toBeVisible();
  await expect(page.locator("#app-splash")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#stock-rows tr")).toHaveCount(manifest.coverage.traded);
});

test("switching dates fetches that date once and reuses the result", async ({ page }) => {
  const next = "2026-10-19";
  const future = { ...day, date: next, records: Object.fromEntries(Object.entries(day.records).map(([symbol, row]) => {
    const close = row[4] * 2;
    return [symbol, [next, row[1], Math.max(row[2], close), row[3], close, ...row.slice(5)]];
  })) };
  const datedManifest = createManifest(catalog, [date, next], "summary-dates", "2026-10-19T12:00:00Z", future.coverage);
  const datedChunks = Array.from({ length: SHARD_COUNT }, (_, index) =>
    ({ ...mergeShard(catalog, index, null, [day, future]), generation: datedManifest.generation, index }));
  const datedService = new MarketSummaryService({ market: async () => datedManifest,
    shards: async (_generation, indices) => indices.map((index) => datedChunks[index]) });
  const datesRequested = [];
  const historicalResponse = defer();
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path === "/api/v1/presence") return route.fulfill({ json: { today: 1 } });
    if (path === "/api/v1/market") return route.fulfill({ json: { ...datedManifest, chunks: datedManifest.chunks.map((_, index) =>
      `/api/v1/market/snapshots/${datedManifest.generation}/shards/${index}`) } });
    if (path === "/api/v1/market/summary") {
      datesRequested.push(url.searchParams.get("asOf"));
      if (url.searchParams.get("asOf") === date) await historicalResponse.promise;
      return route.fulfill({ json: await datedService.summary(url.searchParams.get("asOf"),
        { period: 9, kSmooth: 3, dSmooth: 3 }) });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
  await page.locator("#trade-date").selectOption(date);
  await expect(page.locator("#date-loading")).toBeVisible();
  await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "true");
  historicalResponse.resolve();
  await expect(page.locator("#table-summary")).toContainText(date);
  await expect(page.locator("#date-loading")).toBeHidden();
  await page.locator("#trade-date").selectOption(next);
  await expect(page.locator("#table-summary")).toContainText(next);
  expect(datesRequested).toEqual([next, date]);
});
