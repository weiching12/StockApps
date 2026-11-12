import { test, expect } from "@playwright/test";

// The local market has no ETF, so one listed stock is presented as an ETF: the manifest and summary are
// relabelled on the way to the page, its analysis stays real and the fund facts are supplied here.
const relabel = (value, symbol) => {
  if (Array.isArray(value)) return value.map((item) => relabel(item, symbol));
  if (!value || typeof value !== "object") return value;
  const copy = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relabel(item, symbol)]));
  if (copy.symbol === symbol && "name" in copy) Object.assign(copy, { sector: "ETF", assetType: "etf", currency: "TWD", entryResearch: null });
  return copy;
};
const fund = (symbol) => ({ data: { symbol,
  profile: { fundType: "國內成分證券指數股票型基金", indexName: "測試指數", issuer: "測試投信", inceptionDate: "2020-07-10", listedDate: "2020-07-20", units: 1e9 },
  nav: { date: "2026-10-16", estimated: 20, marketPrice: 20.1, premiumPercent: 0.5, previous: 19.9 }, size: 2e10, sizeBasis: "reported", holders: 12345,
  dividends: [{ exDate: "2026-11-17", lastBuyDate: "2026-11-16", recordDate: null, payDate: "2026-12-11", amount: 0.45 },
    { exDate: "2026-08-18", lastBuyDate: "2026-08-17", recordDate: null, payDate: "2026-09-11", amount: 0.42 }],
  frequency: { code: "quarterly", label: "季配息" },
  trailing: { from: "2025-10-16", to: "2026-10-16", count: 1, amount: 0.42, yieldPercent: 2.1 },
  upcoming: { exDate: "2026-11-17", lastBuyDate: "2026-11-16", payDate: "2026-12-11", amount: 0.45 },
  latest: { exDate: "2026-08-18", lastBuyDate: "2026-08-17", payDate: "2026-09-11", amount: 0.42 },
  holdings: { basis: "monthly-top-10", months: [{ month: "2026-09", items: [{ rank: 1, kind: "國內上市", code: "2330", name: "台積電", weight: 30.5 }, { rank: 2, kind: "國外", code: "US0378331005", name: "APPLE INC", weight: 4.25 }] }] } },
meta: { asOf: "2026-10-16", priceBasis: "unadjusted", navBasis: "estimated", updatedAt: "2026-10-16T12:40:00.000Z" } });

async function openAsEtf(page, fundResponse) {
  const symbol = (await (await page.request.get("/api/v1/stocks?limit=1")).json()).data[0].symbol;
  for (const pattern of ["**/api/v1/market", "**/api/v1/market/summary*"])
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: relabel(await response.json(), symbol) });
    });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route(`**/api/v1/stocks/${symbol}/fund`, async (route) => { await held; await fundResponse(route, symbol); });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="etf"]').click();
  await page.locator(`#stock-rows tr[data-symbol="${symbol}"] .stock-name`).click();
  return { dialog: page.locator("#info-dialog"), release };
}

test("an ETF shows what the list knows at once, then its chart and fund facts when they arrive", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const { dialog, release } = await openAsEtf(page, (route, symbol) => route.fulfill({ json: fund(symbol) }));
  await expect(dialog.locator(".etf-dialog")).toBeVisible();
  // Before the analysis and fund facts arrive: header, summary and placeholders, no entry research.
  await expect(dialog.locator(".entry-dialog-quote strong")).not.toBeEmpty();
  await expect(dialog.locator(".etf-dividend-card.etf-pending")).toBeVisible();
  await expect(dialog.locator(".etf-technical summary")).toBeVisible();
  await expect(dialog.locator(".research-plan-card, .research-not-evaluated")).toHaveCount(0);
  release();
  await expect(dialog.locator(".entry-chart-plot")).toBeVisible();
  await expect(dialog.locator(".etf-frequency")).toHaveText("季配息");
  await expect(dialog.locator(".etf-dividend-dates dd")).toHaveText(["11/16（一）", "11/17（二）", "12/11（五）", "0.450 元"]);
  await expect(dialog.locator(".etf-dividend-year dd")).toHaveText(["2.10%", "0.420 元"]);
  await expect(dialog.locator(".etf-dividend-history tbody tr")).toHaveCount(2);
  await expect(dialog.locator(".etf-facts dd")).toHaveText(["測試指數", "國內成分證券指數股票型基金", "測試投信", "2020-07-20", "200 億元", "12,345 人"]);
  await expect(dialog.locator(".etf-fund-block").first().locator("dd")).toHaveText(["20.10", "20.00", "+0.50%"]);
  // The year arrives with the analysis: a monthly chart with distribution lanes and the month panel under it.
  await expect(dialog.locator(".entry-price-chart h3")).toHaveText("近一年月線圖");
  await expect(dialog.locator(".entry-price-chart [data-chart-range]")).toHaveCount(0);
  await expect(dialog.locator(".etf-event-lane > span")).toHaveText(["除息", "發息"]);
  const shown = dialog.locator(".etf-month-panel:not([hidden])");
  await expect(shown.locator("h4")).toHaveText("成分股 前 2 大 · 2026 年 09 月月報");
  await expect(shown.locator(".etf-holding-weight")).toHaveText(["30.50%", "4.25%"]);
  await expect(dialog.locator(".entry-dialog a[href]")).toHaveCount(0);
  await dialog.locator(".etf-technical summary").click();
  await expect(dialog.locator(".etf-performance dd").first()).toHaveText(/^[+-]?\d+\.\d{2}%$/);
  await expect(dialog.locator(".etf-flow dt")).toHaveText(["當日", "近 5 日", "近 20 日"]);
  await expect(dialog.locator(".etf-pending, .entry-chart-pending")).toHaveCount(0);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("fund facts that cannot be read leave the rest of the ETF dialog in place", async ({ page }) => {
  const { dialog, release } = await openAsEtf(page, (route) => route.fulfill({ status: 503, json: { error: { code: "DATA_UNAVAILABLE", message: "x" } } }));
  release();
  await expect(dialog.locator(".entry-chart-plot")).toBeVisible();
  await expect(dialog.locator(".etf-dividend-card .etf-empty")).toHaveText("配息資料暫時無法讀取。");
  await expect(dialog.locator(".etf-fund, .etf-dividend-history, .etf-month")).toHaveCount(0);
  await expect(dialog.locator(".etf-technical summary")).toBeVisible();
});
