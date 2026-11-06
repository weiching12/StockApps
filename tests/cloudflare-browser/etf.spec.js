import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { normalizeCatalog, normalizePrices, normalizeFlows, marketDay, mergeShard, createManifest, SHARD_COUNT } from "../../cloudflare/twse.js";
import { prepareEtfRelease } from "../../scripts/prepare-etfs.js";
import { MarketSummaryService } from "../../cloudflare/services/market-summary-service.js";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const fixture = JSON.parse(readFileSync(new URL("../fixtures/twse-20261016.json", import.meta.url)));
const date = "2026-10-16", companies = normalizeCatalog(fixture.companies);
const day = marketDay(companies, normalizePrices(fixture.prices, date), normalizeFlows(fixture.flows, date));
const manifest = createManifest(companies, [date], "stock-only", "2026-10-16T12:00:00Z", day.coverage);
const chunks = Array.from({ length: SHARD_COUNT }, (_, index) => ({ ...mergeShard(companies, index, null, [day]), generation: manifest.generation, index }));
const etfRows = [["2003.06.30", "0050", "元大台灣50"], ["2014.10.31", "00632R", "元大台灣50反1"], ["2025.05.27", "00981A", "主動統一台股增長"]];
const prices = structuredClone(fixture.prices), flows = structuredClone(fixture.flows);
const priceRow = prices.tables[0].data.find((row) => row[0] === "2330");
const flowRow = flows.data.find((row) => row[0] === "2330");
for (const [, symbol, name] of etfRows) {
  prices.tables[0].data.push([symbol, ...priceRow.slice(1)]);
  flows.data.push([symbol, name, ...flowRow.slice(2)]);
}
const extended = prepareEtfRelease({ manifest, chunks, rawCatalog: { stat: "OK", fields: ["上市日期", "證券代號", "證券簡稱"], data: etfRows },
  rawPrices: prices, rawFlows: flows, recentCounts: Array(5).fill(flows.data.length) });
const versioned = (value) => ({ ...value, chunks: value.chunks.map((_, index) =>
  `/api/v1/market/snapshots/${value.generation}/shards/${index}`) });

test("ETF search and favorites work while every industry ranking and detail excludes ETFs", async ({ page }) => {
  let includeEtfs = false;
  const currentData = () => includeEtfs ? extended : { manifest, chunks };
  const services = [false, true].map((withEtfs) => {
    const data = withEtfs ? extended : { manifest, chunks };
    return new MarketSummaryService({ market: async () => data.manifest,
      shards: async (_generation, indices) => indices.map((index) => data.chunks[index]) });
  });
  const summaries = await Promise.all(services.map((service, index) =>
    service.summary((index ? extended : { manifest }).manifest.asOf, { period: 9, kSmooth: 3, dSmooth: 3 })));
  await page.addInitScript(() => {
    if (!localStorage.getItem("stock-insight-v1")) localStorage.setItem("stock-insight-v1", JSON.stringify({ favorites: ["2330", "3026"], catalogVersion: 2 }));
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/presence") return route.fulfill({ json: { today: 1 } });
    const current = currentData();
    if (path === "/api/v1/market") return route.fulfill({ json: versioned(current.manifest) });
    if (path === "/api/v1/market/summary") return route.fulfill({ json: summaries[Number(includeEtfs)] });
    if (path === "/api/v1/favorites/summary") return route.fulfill({ json:
      await services[Number(includeEtfs)].favorites(new URL(route.request().url()).searchParams.get("symbols").split(","),
        current.manifest.asOf, { period: 9, kSmooth: 3, dSmooth: 3 }) });
    if (path === "/api/v1/favorites/research") return route.fulfill({ json: {
      data: new URL(route.request().url()).searchParams.get("symbols").split(",").map((symbol) => ({ symbol,
        latest: null, previous: null, comparison: null, events: [], history: [], timeline: [] })),
      meta: { asOf: current.manifest.asOf, previousDate: null, revisions: [], source: "saved", coverage: 0 } } });
    if (path.startsWith("/api/v1/sectors/")) return route.fulfill({ json:
      await services[Number(includeEtfs)].sector(decodeURIComponent(path.split("/").at(-1)),
        current.manifest.asOf, { period: 9, kSmooth: 3, dSmooth: 3 }) });
    return route.fulfill({ status: 404 });
  });
  const ready = () => expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
  const sectorValues = () => page.locator("#sector-grid .sector-card").evaluateAll((cards) => cards.map((card) => ({
    name: card.dataset.sectorName, amount: card.querySelector("[data-sector-amount]").textContent,
    lots: card.querySelector("[data-sector-lots]").textContent, breadth: card.querySelector("[data-sector-breadth]").textContent,
  })));
  await page.goto("/"); await ready();
  await page.locator('[data-page="market"]').first().click();
  await page.locator("#sector-ranking").evaluate((ranking) => { ranking.open = true; });
  const before = {};
  for (const window of ["day", "5", "20"]) {
    await page.locator(`[data-sector-window="${window}"]`).click(); before[window] = await sectorValues();
  }
  includeEtfs = true;
  await page.reload(); await ready();
  await page.locator('.sidebar [data-page="market"]').click();
  await page.locator('#sector-chips [data-sector-chip="ETF"]').click();
  await expect(page.locator("#stock-rows tr")).toHaveCount(3);
  await page.locator("#stock-search").fill("00632R");
  await expect(page.locator('#stock-rows [data-symbol="00632R"] .stock-close')).not.toHaveText("");
  await expect(page.locator('#stock-rows [data-symbol="00632R"] .signal-cell')).toContainText("資料不足");
  await page.locator('#stock-rows [data-favorite="00632R"]').click();
  await page.locator('[data-page="favorites"]').click();
  await expect(page.locator('#research-list .research-card[data-research-symbol="00632R"]')).toBeVisible();
  await page.locator('[data-page="market"]').first().click();
  await page.locator('#sector-chips [data-sector-chip="all"]').click();
  await page.locator("#sector-ranking").evaluate((ranking) => { ranking.open = true; });
  for (const window of ["day", "5", "20"]) {
    await page.locator(`[data-sector-window="${window}"]`).click();
    expect(await sectorValues()).toEqual(before[window]);
  }
  await expect(page.locator('[data-sector-name="ETF"]')).toHaveCount(0);
  await page.locator("#sector-grid .sector-card").first().click();
  await expect(page.locator("#sector-dialog")).toBeVisible();
  for (const [, symbol] of etfRows) await expect(page.locator(`[data-sector-stock="${symbol}"]`)).toHaveCount(0);
});
