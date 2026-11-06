import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { normalizeCatalog, normalizePrices, normalizeFlows, marketDay, createManifest, mergeShard } from "../../cloudflare/twse.js";
import { MarketSummaryService } from "../../cloudflare/services/market-summary-service.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/twse-20261016.json", import.meta.url), "utf8"));
const date = "2026-10-16", catalog = normalizeCatalog(fixture.companies);
const day = marketDay(catalog, normalizePrices(fixture.prices, date), normalizeFlows(fixture.flows, date));
const original = createManifest(catalog, [date], "native-fixture", `${date}T12:00:00Z`, day.coverage);
const chunks = Array.from({ length: 128 }, (_, index) => ({ ...mergeShard(catalog, index, null, [day]), generation: original.generation, index }));
const summary = await new MarketSummaryService({ market: async () => original,
  shards: async (_generation, indices) => indices.map((index) => chunks[index]) }).summary(date, { period: 9, kSmooth: 3, dSmooth: 3 });

async function setup(page, { pushEnabled = false } = {}) {
  const calls = [];
  let generation = original.generation;
  await page.route("**/src/native/bootstrap.js", (route) => route.fulfill({ contentType: "application/javascript", body: `
    import { createNativeStorage } from '/src/native/storage.js';
    import { createNativeRuntime } from '/src/native/runtime.js';
    import { startNativePush } from '/src/native/push.js';
    const listeners = new Map(), pushListeners = new Map();
    window.__nativeListeners = listeners;
    window.__prompts = 0;
    export async function prepareNativeStorage(options) {
      const storage = await createNativeStorage({ ...options, preferences: {
        get: async () => ({ value: localStorage.getItem('__nativeTestPrefs') }),
        set: async ({value}) => localStorage.setItem('__nativeTestPrefs', value)
      }}); window.__nativeStorage = storage; return storage;
    }
    export async function startNativeApp(options) {
      const runtime = await createNativeRuntime({ ...options, platform: 'ios', app: {
        getState: async () => ({isActive:true}),
        addListener: async (name, callback) => { listeners.set(name, callback); return {remove:async()=>listeners.delete(name)}; }
      }}); window.__nativeRuntime=runtime; return runtime;
    }
    export async function enableNativePush(options) {
      return startNativePush({ ...options, push: {
        checkPermissions:async()=>({receive:window.__granted?'granted':'prompt'}),
        requestPermissions:async()=>{window.__prompts++;window.__granted=true;return {receive:'granted'};},
        addListener:async(name,callback)=>{pushListeners.set(name,callback);return {remove:async()=>pushListeners.delete(name)};},
        register:async()=>pushListeners.get('registration')({value:'ab'.repeat(32)}), unregister:async()=>{}
      }});
    }
  ` }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    calls.push(url.pathname);
    expect(url.origin).toBe("https://stock-insight-tw.stock-insight-tw.workers.dev");
    const body = url.pathname === "/api/v1/market" ? { ...original, generation,
      chunks: original.chunks.map((_, i) => `/api/v1/market/snapshots/${generation}/shards/${i}`) }
      : url.pathname === "/api/v1/market/summary" ? { ...summary, meta: { ...summary.meta, generation } }
      : url.pathname === "/api/v1/favorites/research" ? { data: (url.searchParams.get("symbols") || "").split(",").map((symbol) =>
        ({ symbol, latest: null, previous: null, events: [], history: [] })), meta: { asOf: date, revisions: [] } }
      : url.pathname === "/api/v1/push/native/config" ? { enabled: pushEnabled, environment: "sandbox" }
      : url.pathname === "/api/v1/push/native/subscriptions" ? { subscribed: route.request().method() === "POST" } : {};
    await route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }, json: body });
  });
  await page.goto("/");
  await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => page.evaluate(() => Boolean(window.__nativeRuntime))).toBe(true);
  return { calls, changeGeneration: () => { generation = "native-fixture-v2"; } };
}

// Phones reach settings through the menu; wider screens show the button directly.
async function openSettings(page) {
  const menu = page.getByRole("button", { name: "更多選單" });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole("menuitem", { name: "設定" }).click();
  } else await page.locator('.sidebar-bottom > [data-dialog="settings"]').click();
}

test("iPhone entry hydrates native favorites and settings and leaves web app services unused", async ({ page }) => {
  const { calls } = await setup(page);
  await page.locator('[data-page="market"]').first().click();
  const favorite = page.locator('#stock-rows [data-favorite="2330"]');
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await favorite.click();
  await openSettings(page);
  await page.locator("#theme").selectOption("dark");
  await page.evaluate(() => window.__nativeStorage.flush());
  expect(await page.evaluate(() => window.__prompts)).toBe(0);
  await expect(page.locator("#push-notifications")).toBeDisabled();
  await page.reload();
  await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  expect(calls.some((path) => ["/api/v1/presence", "/api/v1/push/config"].includes(path))).toBe(false);
});

test("iPhone return refreshes a changed generation and restores the selected page", async ({ page }) => {
  const server = await setup(page);
  await page.locator('.sidebar [data-page="favorites"]').click();
  await page.evaluate(async () => {
    await window.__nativeRuntime.checkForUpdates(true);
    await window.__nativeListeners.get('appStateChange')({isActive:false});
  });
  const reads = server.calls.filter((path) => path === "/api/v1/market").length;
  server.changeGeneration();
  await page.evaluate(() => window.__nativeRuntime.checkForUpdates(true));
  expect(server.calls.filter((path) => path === "/api/v1/market")).toHaveLength(reads);
  await page.evaluate(() => { void window.__nativeListeners.get('appStateChange')({isActive:true}); });
  await expect(page.locator("#required-update-dialog")).toBeVisible();
  await expect(page.locator("#page-title")).toContainText("自選");
  await page.keyboard.press("Escape");
  await expect(page.locator("#required-update-dialog")).toBeVisible();
  await Promise.all([page.waitForEvent("load"), page.locator("#apply-app-update").click()]);
  await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#required-update-dialog")).toBeHidden();
  await expect(page.locator("#page-title")).toContainText("自選");
  expect(server.calls.filter((path) => path === "/api/v1/market/summary")).toHaveLength(2);
});

test("iPhone notification permission is requested only after an explicit tap", async ({ page }) => {
  await setup(page, { pushEnabled: true });
  await openSettings(page);
  await expect(page.locator("#push-notifications")).toBeEnabled();
  expect(await page.evaluate(() => window.__prompts)).toBe(0);
  await page.locator("#push-notifications").click();
  await expect(page.locator("#push-notifications")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__prompts)).toBe(1);
  await page.locator("#push-notifications").click();
  await expect(page.locator("#push-notifications")).toHaveAttribute("aria-pressed", "false");
});
