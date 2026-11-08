import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

async function loadFixture(page) {
  await page.route("**/src/provider.js*", (route) => route.fulfill({ contentType: "application/javascript",
    body: `import { demoProvider } from "/src/data.js";
      export async function loadMarketSummary() { throw new Error("API loading is unavailable in this demo fixture"); }
      export async function loadDataset() {
        const data = await demoProvider.load();
        const dates = data.dates.slice(-6);
        data.stocks = data.stocks.slice(0, 4).map((stock, index) => ({ ...stock,
          symbol: String(9001 + index), name: ["每日買賣交錯", "連續賣超", "淨額為零", "歷史缺漏"][index], sector: "測試產業", tradingDates: data.dates,
          history: dates.map((date, day) => {
            const close = [100, 120, 80, 150, 200, 250][day];
            const net = index === 0 ? [0, 10000, -5000, 0, 20000, 10000][day] : index === 1 ? -20000 : index === 2 ? 0 : 1000;
            return { date, open: close, high: close, low: close, close, volume: index === 3 ? 0 : 100000,
              institutions: ["外資", "投信", "自營商"].map((name, category) => ({ name,
                buy: category === 0 ? Math.max(0, net) : 0, sell: category === 0 ? Math.max(0, -net) : 0 })) };
          }).filter((_, day) => index !== 3 || day !== 3) }));
        return data;
      }` }));
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="sectors"]').click();
}

test("sector breadth follows the selected complete monetary window", async ({ page }) => {
  await loadFixture(page);
  for (const [period, text] of [["day", "買超 2／4 檔"], ["5", "買超 1／3 檔"], ["20", ""]]) {
    await page.locator(`[data-sector-window="${period}"]`).click();
    await expect(page.locator('[data-sector-breadth]')).toHaveText(text);
  }
});

test("stock ratios and mini bars distinguish signed, zero and missing values", async ({ page }) => {
  await loadFixture(page);
  await page.locator('.sector-card').click();
  const row = (symbol) => page.locator(`[data-sector-stock="${symbol}"]`);
  for (const [symbol, text] of [["9001", "占量 +10.00%"], ["9002", "占量 -20.00%"], ["9003", "占量 0.00%"], ["9004", ""]])
    await expect(row(symbol).locator('[data-institution-ratio="day"]')).toHaveText(text);
  await expect(row("9001").locator('.sector-stock-name')).toHaveText(/^9001\s*每日買賣交錯$/);
  const bars = row("9001").locator('.institution-sparkline rect');
  await expect(bars).toHaveCount(5);
  expect(await bars.evaluateAll((elements) => elements.map((bar) => Number(bar.dataset.flowAmount))))
    .toEqual([1200000, -400000, 0, 4000000, 2500000]);
  expect(await bars.evaluateAll((elements) => elements.map((bar) => bar.getAttribute("class"))))
    .toEqual(["up", "down", "neutral", "up", "up"]);
  await expect(row("9004").locator('.institution-sparkline .unknown')).toHaveCount(0);
  expect(await row("9004").locator('.institution-sparkline rect').evaluateAll((bars) => bars.map((bar) => bar.getAttribute("x"))))
    .toEqual(["8", "26", "62", "80"]);
  await expect(row("9004").locator('[data-sector-net="5"] .institution-money')).toHaveText("");
  await expect(row("9003").locator('.institution-sparkline .neutral')).toHaveCount(5);
  await expect(row("9001").locator('.institution-sparkline')).toHaveAccessibleName(/左至右由舊至新.*獨立比例尺/);
});

test("new institutional information fits phone and desktop layouts", async ({ page }, testInfo) => {
  await loadFixture(page);
  for (const width of [320, 390, 700, 701, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('[data-sector-breadth]')).toHaveCSS("font-size", "12px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.sector-card').click();
    const issues = await page.locator('.sector-stock-table').evaluate((table) => {
      const elements = [...table.querySelectorAll('th, td, .institution-sparkline, [data-institution-ratio]')];
      return elements.filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => element.className || element.tagName);
    });
    expect(issues, `Institution cells at ${width}px`).toEqual([]);
    await expect(page.locator('[data-institution-ratio]').first()).toHaveCSS("font-size", "12px");
    if ([390, 1440].includes(width)) {
      await page.locator('[data-sector-stock="9001"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`institution-extras-${width}.png`) });
    }
    expect(await page.locator('#sector-dialog').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.locator('#sector-dialog').press("Escape");
  }
});
