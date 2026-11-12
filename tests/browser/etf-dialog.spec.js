import { test, expect } from "@playwright/test";

test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const openEtf = async (page, symbol) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="etf"]').click();
  await page.locator(`#stock-rows tr[data-symbol="${symbol}"] .stock-name`).click();
  await expect(page.locator("#info-dialog .etf-dialog")).toBeVisible();
};

for (const width of [320, 390, 1280]) {
  test(`an ETF opens on its technical read, trend, flows and fund facts instead of entry research at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openEtf(page, "00878");
    const dialog = page.locator("#info-dialog");
    const order = await dialog.locator(".entry-dialog > *").evaluateAll((nodes) => nodes.map((node) => node.className.split(" ").find((name) => name !== "etf-section")));
    expect(order).toEqual(["entry-dialog-header", "etf-summary", "entry-price-chart", "etf-performance", "etf-flow", "etf-fund", "helper-text"]);
    await expect(dialog.locator(".research-plan-card, .research-gates, .research-not-evaluated")).toHaveCount(0);
    await expect(dialog.locator(".entry-dialog-quote strong")).toHaveText(/^[\d,]+\.\d{2}$/);
    await expect(dialog.locator(".etf-summary dt")).toHaveText(["趨勢", "量價", "KD", "季線"]);
    await expect(dialog.locator(".etf-summary dd").nth(2)).toHaveText(/^\d+\.\d{2} \/ \d+\.\d{2}$/);
    // The same chart as a stock, without plan levels.
    await expect(dialog.locator(".entry-chart-plot")).toBeVisible();
    await expect(dialog.locator(".entry-chart-plan-toggle")).toHaveCount(0);
    await expect(dialog.locator(".etf-performance dt")).toHaveText(["近 5 日", "近 20 日", "距 30 日高點", "距 30 日低點"]);
    for (const value of await dialog.locator(".etf-performance dd").allTextContents()) expect(value).toMatch(/^[+-]?\d+\.\d{2}%$/);
    await expect(dialog.locator(".etf-flow dt")).toHaveText(["當日", "近 5 日", "近 20 日"]);
    for (const value of await dialog.locator(".etf-flow dd").allTextContents()) expect(value).toMatch(/^[+-]?[\d,.]+ (億|萬)$/);
    await expect(dialog.locator(".etf-flow-parts span")).toHaveText([/^外資 /, /^投信 /, /^自營商 /]);
    const fund = dialog.locator(".etf-fund");
    await expect(fund.locator(".etf-facts dt")).toHaveText(["追蹤指數", "基金類型", "上市日期", "規模（估算）"]);
    await expect(fund.locator(".etf-fund-block h4")).toHaveText([/^折溢價/, /^配息/]);
    await expect(fund.locator(".etf-fund-block").first().locator("dt")).toHaveText(["市價", "預估淨值", "溢價"]);
    await expect(fund.locator(".etf-fund-block").nth(1).locator("dt")).toHaveText(["近一年殖利率", "近一年配息", "下次除息"]);
    await expect(fund.locator(".etf-fund-block").nth(1).locator("dd").first()).toHaveText(/^\d+\.\d{2}%$/);
    // The next distribution is announced without an amount: it says so and stays out of the paid table.
    await expect(fund.locator(".etf-fund-block").nth(1).locator("small").last()).toHaveText("金額未公告");
    await expect(fund.locator(".etf-dividends tbody tr")).toHaveCount(4);
    await expect(dialog.locator(".entry-disclaimer")).toContainText("不判斷進場時機");
    const layout = await dialog.evaluate((node) => ({ fits: node.scrollWidth <= node.clientWidth,
      inside: [...node.querySelectorAll(".etf-tiles dd, .etf-facts dd, .etf-dividends td")].every((cell) => cell.scrollWidth <= cell.clientWidth + 1),
      gap: node.querySelector(".etf-summary").getBoundingClientRect().top - node.querySelector(".entry-dialog-header").getBoundingClientRect().bottom }));
    expect(layout.fits).toBe(true);
    expect(layout.inside).toBe(true);
    expect(layout.gap).toBeLessThan(24);
  });
}

test("an ETF trading below its estimated NAV is labelled a discount in the falling colour", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openEtf(page, "0050");
  const premium = page.locator("#info-dialog .etf-fund-block").first().locator("div").nth(2);
  await expect(premium.locator("dt")).toHaveText("折價");
  await expect(premium.locator("dd")).toHaveText("-0.10%");
  await expect(premium.locator("dd")).toHaveClass(/down/);
});
