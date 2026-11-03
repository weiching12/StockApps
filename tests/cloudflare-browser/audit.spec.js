import { test, expect } from "@playwright/test";
import { demoProvider } from "../../src/data.js";
import { MarketSummaryService } from "../../cloudflare/services/market-summary-service.js";
import { AnalysisService } from "../../cloudflare/services/analysis-service.js";
import { SHARD_COUNT, shardOf } from "../../shared/market-codec.js";

const demo = await demoProvider.load();
const stocks = demo.stocks.slice(0, 2).map((stock) => ({ ...stock, tradingDates: demo.dates }));
const manifest = { schemaVersion: 2, source: "twse", generation: "audit-fixture", dates: demo.dates,
  asOf: demo.info.asOf, updatedAt: `${demo.info.asOf}T12:00:00Z`,
  stocks: stocks.map(({ history, tradingDates, ...stock }) => ({ ...stock,
    assetType: "stock", currency: "TWD", listedOn: demo.dates[0] })),
  chunks: Array.from({ length: SHARD_COUNT }, (_, index) => `/api/v1/market/snapshots/audit-fixture/shards/${index}`) };
const chunks = Array.from({ length: SHARD_COUNT }, (_, index) => ({ generation: manifest.generation, index,
  stocks: stocks.filter((stock) => shardOf(stock.symbol) === index).map((stock) => ({ symbol: stock.symbol,
    history: stock.history.map((bar) => [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume,
      ...bar.institutions.flatMap((item) => [item.buy, item.sell])]) })) }));
const market = { market: async () => manifest,
  shards: async (_generation, indices) => indices.map((index) => chunks[index]),
  stock: async (symbol) => ({ asOf: manifest.asOf, stock: stocks.find((stock) => stock.symbol === symbol) }) };
const summary = new MarketSummaryService(market), analysis = new AnalysisService(market);
const defer = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function setup(page, intercept = async () => false) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (await intercept(route, url)) return;
    const path = url.pathname, date = url.searchParams.get("asOf") || manifest.asOf;
    const settings = Object.fromEntries(["period", "kSmooth", "dSmooth"].map((key) =>
      [key, Number(url.searchParams.get(key) || (key === "period" ? 9 : 3))]));
    const symbol = path.match(/^\/api\/v1\/stocks\/([^/]+)\/analysis$/)?.[1];
    const sector = path.match(/^\/api\/v1\/sectors\/([^/]+)$/)?.[1];
    const body = path === "/api/v1/market" ? manifest
      : path === "/api/v1/market/summary" ? await summary.summary(date, settings)
        : path === "/api/v1/favorites/summary" ? await summary.favorites(url.searchParams.get("symbols").split(","), date, settings)
          : symbol ? await analysis.stock(symbol, { asOf: date, settings })
            : sector ? await summary.sector(decodeURIComponent(sector), date, settings)
              : path === "/api/v1/presence" ? { today: 1 }
                : path === "/api/v1/push/config" ? { enabled: false } : null;
    await route.fulfill(body ? { json: body } : { status: 404 });
  });
  await page.goto("/");
  await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
}

test("cached date selection clears loading and ignores a late failure", async ({ page }) => {
  const waiting = defer(), entered = defer(), oldDate = demo.dates.at(-2);
  await setup(page, async (route, url) => {
    if (url.pathname !== "/api/v1/market/summary" || url.searchParams.get("asOf") !== oldDate) return false;
    entered.resolve(); await waiting.promise;
    await route.fulfill({ status: 503, json: { error: { message: "obsolete request failed" } } });
    return true;
  });
  try {
    await page.locator("#trade-date").selectOption(oldDate);
    await entered.promise;
    await page.locator("#trade-date").selectOption(manifest.asOf);
    await expect(page.locator("#date-loading")).toBeHidden();
    await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
    waiting.resolve();
    await expect(page.locator("#trade-date")).toHaveValue(manifest.asOf);
    await expect(page.locator("#table-summary")).toContainText(manifest.asOf);
    await expect(page.locator("#toast")).not.toContainText("obsolete request failed");
  } finally { waiting.resolve(); }
});

test("late entry detail cannot replace a subsequently opened settings dialog", async ({ page }) => {
  const waiting = defer(), entered = defer();
  await setup(page, async (route, url) => {
    const symbol = url.pathname.match(/\/stocks\/([^/]+)\/analysis$/)?.[1];
    if (!symbol) return false;
    entered.resolve(); await waiting.promise;
    await route.fulfill({ json: await analysis.stock(symbol, { asOf: manifest.asOf }) });
    return true;
  });
  try {
    await page.locator(".entry-score-button").first().click();
    await entered.promise;
    await page.locator("#close-dialog").click();
    await page.getByRole("button", { name: "設定", exact: true }).click();
    waiting.resolve();
    await expect(page.locator("#settings-form")).toBeVisible();
    await expect(page.locator("#dialog-heading")).toHaveText("設定");
  } finally { waiting.resolve(); }
});

test("industry page and detail retain the latest session after historical market browsing", async ({ page }) => {
  const requested = [];
  await setup(page, async (_route, url) => {
    if (url.pathname.startsWith("/api/v1/sectors/")) requested.push(url.searchParams.get("asOf"));
    return false;
  });
  await page.locator("#trade-date").selectOption(demo.dates.at(-2));
  await expect(page.locator("#table-summary")).toContainText(demo.dates.at(-2));
  await page.locator('.sidebar [data-page="sectors"]').click();
  await page.locator(".sector-card").first().click();
  await expect(page.locator("#sector-dialog-meta")).toContainText(manifest.asOf);
  expect(requested).toEqual([manifest.asOf]);
});

test("switching back to an in-flight date shares one summary request", async ({ page }) => {
  const waiting = defer(), entered = defer(), oldDate = demo.dates.at(-2);
  let calls = 0;
  await setup(page, async (route, url) => {
    if (url.pathname !== "/api/v1/market/summary" || url.searchParams.get("asOf") !== oldDate) return false;
    calls++; entered.resolve(); await waiting.promise;
    await route.fulfill({ json: await summary.summary(oldDate, { period: 9, kSmooth: 3, dSmooth: 3 }) });
    return true;
  });
  try {
    await page.locator("#trade-date").selectOption(oldDate);
    await entered.promise;
    await page.locator("#trade-date").selectOption(manifest.asOf);
    await page.locator("#trade-date").selectOption(oldDate);
    waiting.resolve();
    await expect(page.locator("#table-summary")).toContainText(oldDate);
    await expect(page.locator("#date-loading")).toBeHidden();
    expect(calls).toBe(1);
  } finally { waiting.resolve(); }
});

test("reopening pending stock details shares one analysis request", async ({ page }) => {
  const waiting = defer(), entered = defer();
  let calls = 0;
  await setup(page, async (route, url) => {
    const symbol = url.pathname.match(/\/stocks\/([^/]+)\/analysis$/)?.[1];
    if (!symbol) return false;
    calls++; entered.resolve(); await waiting.promise;
    await route.fulfill({ json: await analysis.stock(symbol, { asOf: manifest.asOf }) });
    return true;
  });
  try {
    await page.locator(".entry-score-button").first().click();
    await entered.promise;
    await page.locator("#close-dialog").click();
    await page.locator(".entry-score-button").first().click();
    waiting.resolve();
    await expect(page.locator("#dialog-content .entry-chart-plot svg")).toBeVisible();
    expect(calls).toBe(1);
  } finally { waiting.resolve(); }
});

test("reopening a sector shares a pending request and retries after failure", async ({ page }) => {
  const waiting = defer(), entered = defer();
  let calls = 0;
  await setup(page, async (route, url) => {
    if (!url.pathname.startsWith("/api/v1/sectors/")) return false;
    calls++;
    if (calls === 1) {
      entered.resolve(); await waiting.promise;
      await route.fulfill({ status: 503, json: { error: { message: "sector temporarily unavailable" } } });
      return true;
    }
    return false;
  });
  try {
    await page.locator('.sidebar [data-page="sectors"]').click();
    await page.locator(".sector-card").first().click();
    await entered.promise;
    await page.locator("#close-sector-dialog").click();
    await page.locator(".sector-card").first().click();
    waiting.resolve();
    await expect(page.locator("#sector-dialog-content")).toContainText("sector temporarily unavailable");
    expect(calls).toBe(1);
    await page.locator("#close-sector-dialog").click();
    await page.locator(".sector-card").first().click();
    await expect(page.locator(".sector-stock-table tbody tr").first()).toBeVisible();
    expect(calls).toBe(2);
  } finally { waiting.resolve(); }
});

test("removing all favorites invalidates pending research and allows the same selection to reload", async ({ page }) => {
  const symbol = stocks[0].symbol, waiting = defer(), entered = defer();
  let calls = 0;
  await page.addInitScript((symbol) => localStorage.setItem("stock-insight-v1",
    JSON.stringify({ favorites: [symbol], catalogVersion: 2 })), symbol);
  await setup(page, async (route, url) => {
    if (url.pathname !== "/api/v1/favorites/research") return false;
    calls++;
    const stale = calls === 1;
    if (stale) { entered.resolve(); await waiting.promise; }
    await route.fulfill({ json: { data: [{ symbol, latest: null, previous: null,
      comparison: { status: "missing-current", events: [], summary: "缺少當日評分快照" },
      events: [], history: [], timeline: [] }], meta: { asOf: manifest.asOf, revisions: stale ? [{}, {}] : [] } } });
    return true;
  });
  try {
    await entered.promise;
    const favorite = page.locator(`#stock-rows [data-favorite="${symbol}"]`);
    await favorite.click();
    await expect(favorite).toHaveAttribute("aria-pressed", "false");
    const finished = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/favorites/research");
    waiting.resolve();
    await finished;
    await expect(page.locator("#research-date")).not.toContainText("修訂版本");
    await favorite.click();
    // One initial request, one join-snapshot read and one new research load.
    await expect.poll(() => calls).toBe(3);
    await page.locator('.sidebar [data-page="favorites"]').click();
    await expect(page.locator("#research-list .research-card")).toHaveCount(1);
    await expect(page.locator("#research-list")).not.toContainText("讀取研究快照中");
  } finally { waiting.resolve(); }
});
