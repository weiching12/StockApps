import { test, expect } from "@playwright/test";

test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const openSector = async (page, window = "day") => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="sectors"]').click();
  await page.locator(`[data-sector-window="${window}"]`).click();
  await page.locator("#sector-grid .sector-card").first().click();
  await expect(page.locator("#sector-dialog")).toBeVisible();
};

for (const width of [320, 390, 1440]) {
  test(`the sector detail opens on a 20-day cumulative trend whose last point matches the 20-day figures at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // The ranking on 20 日 shows the same total the trend ends on.
    await page.goto("/");
    const cardTotal = async () => (await page.locator("#sector-grid .sector-card [data-sector-amount]").first().textContent()).replace(/ 億$/, "");
    await openSector(page, "20");
    const trend = page.locator("#sector-dialog .sector-flow-trend");
    // Three institutions and the total, besides the price area.
    await expect(trend.locator("[data-flow-plot] path:is(.foreign, .trust, .dealer, .total)")).toHaveCount(4);
    await expect(trend.locator(".sector-flow-cell > span:first-child")).toHaveText(["外資", "投信", "自營商", "合計"]);
    await expect(trend.locator("[data-flow-date]")).toHaveText(/^近 20 日累計 · 至 \d{2}\/\d{2}$/);
    await expect(trend.locator('[data-flow-cell="total"] strong')).toHaveText(await cardTotal());
    // Runs and turns are no longer marked on the flow chart; 法人轉買 marks stocks in the list below instead.
    await expect(trend.locator("[data-flow-streak], [data-flow-run], path.sector-flow-run")).toHaveCount(0);
    await expect(trend.locator("[data-flow-price]")).toHaveText(/^[+-]?\d+\.\d{2}%$/);
    // The price change is a pale area inside the same plot, not a chart of its own.
    await expect(trend.locator("[data-flow-plot] path.price-area")).toHaveCount(1);
    await expect(trend.locator("[data-flow-price-plot]")).toHaveCount(0);
    // The detail no longer repeats the figures as a table.
    await expect(page.locator("#sector-dialog [data-sector-period], #sector-dialog details")).toHaveCount(0);
    const fits = await page.locator("#sector-dialog").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth
      && [...dialog.querySelectorAll(".sector-flow-cell strong")].every((value) => value.scrollWidth <= value.parentElement.clientWidth + 1));
    expect(fits).toBe(true);
  });
}

test("tapping or arrowing through the chart reads out that day and returns to the latest with End", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openSector(page);
  const plot = page.locator("#sector-dialog [data-flow-plot]");
  const date = page.locator("#sector-dialog [data-flow-date]");
  const latest = await date.textContent();
  const box = await plot.boundingBox();
  await page.mouse.click(box.x + 6, box.y + box.height / 2);
  await expect(date).toHaveText(/^累計至 \d{2}\/\d{2}$/);
  await expect(plot).toHaveAttribute("aria-valuenow", "1");
  // As on the stock price chart, the picked day's readout takes the title's place.
  const pick = page.locator("#sector-dialog [data-flow-pick]");
  await expect(pick).toBeVisible();
  await expect(pick.locator("[data-flow-pick-date]")).toHaveText(/^\d{2}\/\d{2} 累計$/);
  await expect(page.locator("#sector-dialog [data-flow-title]")).toBeHidden();
  // Like the stock chart, moving the mouse without pressing previews nothing.
  await page.mouse.move(box.x + box.width - 6, box.y + box.height / 2);
  await expect(plot).toHaveAttribute("aria-valuenow", "1");
  // The price readout follows the same day.
  const price = page.locator("#sector-dialog [data-flow-price]");
  const firstDayPrice = await price.textContent();
  await page.keyboard.press("End");
  await expect(price).not.toHaveText(firstDayPrice);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(plot).toHaveAttribute("aria-valuenow", "2");
  await page.keyboard.press("End");
  await expect(date).toHaveText(latest);
  await expect(plot).toHaveAttribute("aria-valuetext", /外資 [+-]?[\d,.]+、投信/);
  // A click outside the chart brings back the title and the latest session.
  await page.mouse.click(box.x + 6, box.y + box.height / 2);
  await expect(page.locator("#sector-dialog [data-flow-pick]")).toBeVisible();
  await page.locator("#sector-dialog .sector-flow-note").click();
  await expect(page.locator("#sector-dialog [data-flow-title]")).toBeVisible();
  await expect(page.locator("#sector-dialog [data-flow-pick]")).toBeHidden();
  await expect(date).toHaveText(latest);
});
