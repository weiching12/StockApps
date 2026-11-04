import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createManifest, marketDay, mergeShard, normalizeCatalog, normalizeFlows, normalizePrices, SHARD_COUNT } from "../../cloudflare/twse.js";
import { MarketSummaryService } from "../../cloudflare/services/market-summary-service.js";
import { EntryResearchService } from "../../cloudflare/services/entry-research-service.js";
import { ENTRY_RESEARCH_MODEL_VERSION } from "../../shared/entry-research-model.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/twse-20261016.json", import.meta.url)));
const catalog = normalizeCatalog(fixture.companies);
const date = "2026-10-16";
const day = marketDay(catalog, normalizePrices(fixture.prices, date), normalizeFlows(fixture.flows, date));
const manifest = createManifest(catalog, [date], "backtest-page", "2026-10-16T12:00:00Z", day.coverage);
const chunks = Array.from({ length: SHARD_COUNT }, (_, index) =>
  ({ ...mergeShard(catalog, index, null, [day]), generation: manifest.generation, index }));
const summary = await new MarketSummaryService({ market: async () => manifest,
  shards: async (_generation, indices) => indices.map((index) => chunks[index]) }).summary(date, { period: 9, kSmooth: 3, dSmooth: 3 });
const versionedManifest = { ...manifest, chunks: manifest.chunks.map((_, index) => `/api/v1/market/snapshots/${manifest.generation}/shards/${index}`) };

// Aggregate rows as the repository returns them; the real service shapes the response.
const dates = Array.from({ length: 36 }, (_, index) => new Date(Date.UTC(2026, 7, 3 + index)).toISOString().slice(0, 10));
const stats = (prefix, count, wins, average, win, loss) => ({ [`${prefix}Count`]: count, [`${prefix}Wins`]: wins,
  [`${prefix}Average`]: average, [`${prefix}AverageWin`]: win, [`${prefix}AverageLoss`]: loss });
const repository = (empty) => ({ backtest: async () => empty ? { totals: { Samples: 0 }, buckets: [], setups: [], horizons: {}, daily: [], distribution: [] } : {
  totals: { Samples: 39600, Sessions: 36, FirstDate: dates[0], LastDate: dates.at(-1), GatePass: 2100, Triggered: 420, Candidates: 260,
    Filled: 210, TradePending: 12, OutcomesComplete: 30000, ...stats("Trade", 198, 109, 1.21, 4.8, -3.2),
    ...stats("Forward", 30000, 15500, 0.4, 3.1, -2.6), AverageMfe: 7.4, AverageMae: -5.1, ExcursionCount: 30000 },
  buckets: [{ Bucket: 60, Samples: 700, ...stats("Trade", 40, 20, 0.3, 3.9, -3.5), ...stats("Forward", 650, 330, 0.2, 3, -2.8) },
    { Bucket: 80, Samples: 300, ...stats("Trade", 12, 8, 2.4, 5, -2.8), ...stats("Forward", 280, 160, 0.9, 3.4, -2.4) }],
  setups: [{ SetupType: "PULLBACK_RECOVERY", Samples: 1300, Candidates: 150, ...stats("Trade", 120, 64, 0.8, 4.1, -3), ...stats("Forward", 1200, 610, 0.3, 3, -2.7) },
    { SetupType: "RANGE_BREAKOUT", Samples: 800, Candidates: 110, ...stats("Trade", 78, 45, 1.9, 5.6, -3.4), ...stats("Forward", 760, 400, 0.6, 3.3, -2.5) }],
  horizons: { ...stats("Trade5", 205, 110, 0.6, 3, -2.2), ...stats("Forward5", 32000, 16000, 0.2, 2, -1.8),
    ...stats("Trade10", 198, 109, 1.21, 4.8, -3.2), ...stats("Forward10", 30000, 15500, 0.4, 3.1, -2.6),
    ...stats("Trade20", 160, 90, 2.1, 7, -4.4), ...stats("Forward20", 26000, 13500, 0.8, 4.5, -3.6) },
  daily: dates.map((tradeDate, index) => ({ TradeDate: tradeDate, Samples: 1100, GatePass: 50 + index, Candidates: 3 + index % 9,
    Trades: index % 7 === 6 ? 0 : 5 + index % 4, TradeAverage: Math.sin(index / 3) * 2 + 0.4 })),
  distribution: [-10, -4, -3, -2, -1, 0, 1, 2, 3, 6, 10].map((bin) => ({ Bin: bin, Count: 30 - Math.abs(bin) * 2 })),
} });
const sample = (symbol, tradeDate, detail) => ({ symbol, name: symbol === "2330" ? "台積電" : "台泥", tradeDate, modelVersion: "entry-research-v1",
  source: "daily", close: 100, gate: { status: "PASS", passed: 5, total: 5, conditions: {} },
  readiness: { score: 82, structure: 80, signal: 85, timing: 78 }, entryStatus: "TRIGGERED", setupType: "RANGE_BREAKOUT", signalDate: tradeDate,
  nextDay: { status: "NEXT_DAY_CANDIDATE", entryReferencePrice: 100, entryPriceUpper: 101.5, invalidationPrice: 96, riskPercent: 4, atr14: 3 },
  dataQuality: "VALID", priceBasis: "unadjusted", capturedAt: `${tradeDate}T12:00:00Z`,
  outcome: { status: "COMPLETE", returns: { 1: 0.5, 5: 2.1, 10: 3.4, 20: -1.2 }, mfe20: 6, mae20: -3, hitInvalidation: false, hitTarget: true,
    trade: { status: "FILLED", fillDate: dates[1], fillPrice: 100.5, netReturns: { 5: 1.6, 10: 2.9, 20: -1.8 } } },
  ...(detail && { detail: { gate: { status: "PASS", passedCount: 5, reasons: [], conditions: { trend: { status: "PASS", reason: "收盤價站上 MA20 與 MA60" } } },
    research: { status: "TRIGGERED", triggeredConditions: ["收盤突破 20 日整理區間上緣"] },
    nextDayPlan: { status: "NEXT_DAY_CANDIDATE", referenceClose: 100, entryReferencePrice: 100, entryPriceUpper: 101.5, invalidationPrice: 96, riskPercent: 4 },
    dataQuality: { status: "VALID" }, provisional: true } }),
});

async function routeApi(page, { empty = false } = {}) {
  const requests = [];
  const service = new EntryResearchService(repository(empty));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/presence") return route.fulfill({ json: { today: 1 } });
    if (url.pathname === "/api/v1/market") return route.fulfill({ json: versionedManifest });
    if (url.pathname === "/api/v1/market/summary") return route.fulfill({ json: summary });
    if (url.pathname === "/api/v1/research/backtest") {
      requests.push(url.search);
      // The provisional-parameters note applies to the live model.
      return route.fulfill({ json: await service.backtest({ modelVersion: ENTRY_RESEARCH_MODEL_VERSION, horizon: Number(url.searchParams.get("horizon") ?? 10) }) });
    }
    if (url.pathname === "/api/v1/research/samples") {
      const detail = url.searchParams.get("detail") === "1";
      const data = empty ? [] : detail ? [sample(url.searchParams.get("symbol"), url.searchParams.get("from"), true)]
        : [sample("2330", dates.at(-1)), sample("1101", dates.at(-2))];
      return route.fulfill({ json: { data, meta: { modelVersion: "entry-research-v1", total: data.length, limit: 50, offset: 0, provisional: true } } });
    }
    return route.fulfill({ status: 404 });
  });
  return requests;
}

test("backtest page shows scoped results, follows filters and opens a saved sample", async ({ page }) => {
  const requests = await routeApi(page);
  await page.goto("/");
  await page.locator('.sidebar [data-page="backtest"]').click();
  await expect(page.locator("#page-title")).toContainText("策略回測");
  await expect(page.locator("#backtest-scope")).toContainText(`${dates[0].replaceAll("-", "/")}～${dates.at(-1).replaceAll("-", "/")}，36 個交易日`);
  await expect(page.locator("#backtest-scope")).toContainText("暫定參數");
  await expect(page.locator(".backtest-tile", { hasText: "研究樣本" })).toContainText("39,600");
  await expect(page.locator(".backtest-tile", { hasText: "勝率" })).toContainText("55.1%");
  await expect(page.locator(".backtest-line")).toHaveCount(1);
  await expect(page.locator("#backtest-buckets-title + .backtest-table-wrap tbody tr")).toHaveCount(6);
  await expect(page.locator("#backtest-buckets-title + .backtest-table-wrap tbody tr.thin")).toHaveCount(5);
  await expect(page.locator(".backtest-note")).toContainText("6 個月");
  // Hovering the curve shows the date's values.
  await page.locator(".backtest-chart .backtest-hit").nth(10).hover();
  await expect(page.locator("#backtest-tooltip")).toBeVisible();
  await expect(page.locator("#backtest-tooltip")).toContainText(dates[11]);
  // Filters are sent to the API.
  await page.locator('#backtest-filters select[name="setup"]').selectOption("RANGE_BREAKOUT");
  await expect.poll(() => requests.at(-1)).toContain("setup=RANGE_BREAKOUT");
  await page.locator('[data-backtest-horizon="20"]').click();
  await expect.poll(() => requests.at(-1)).toContain("horizon=20");
  await expect(page.locator('[data-backtest-horizon="20"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#backtest-trades-title")).toContainText("持有 20 日");
  // A sample opens its saved explanation.
  await page.locator('[data-backtest-sample="2330"]').click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator("#dialog-content")).toContainText("收盤後保存");
  await expect(page.locator("#dialog-content")).toContainText("收盤突破 20 日整理區間上緣");
  await expect(page.locator("#dialog-content")).toContainText("+2.90%");
});

test("backtest page explains an empty sample store on phones without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeApi(page, { empty: true });
  await page.goto("/");
  await page.locator('.sidebar [data-page="backtest"]').click();
  await expect(page.locator(".backtest-empty-state")).toContainText("尚未累積研究樣本");
  await expect(page.locator(".backtest-empty-state")).toContainText("6 個月");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("backtest results fit a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeApi(page);
  await page.goto("/");
  await page.locator('.sidebar [data-page="backtest"]').click();
  await expect(page.locator(".backtest-line")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('.sidebar [data-page="backtest"]')).toBeInViewport();
});
