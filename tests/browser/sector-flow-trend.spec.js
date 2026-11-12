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
    // Three institutions and the total, besides the run traces and the price area.
    await expect(trend.locator("[data-flow-plot] path:is(.foreign, .trust, .dealer, .total):not(.sector-flow-run)")).toHaveCount(4);
    await expect(trend.locator(".sector-flow-cell > span:first-child")).toHaveText(["外資", "投信", "自營商", "合計"]);
    await expect(trend.locator("[data-flow-date]")).toHaveText(/^近 20 日累計 · 至 \d{2}\/\d{2}$/);
    await expect(trend.locator('[data-flow-cell="total"] strong')).toHaveText(await cardTotal());
    // Only a run that goes against the sector's price is marked, as a badge where it began: a short date
    // and the turn, nothing about the price. Selling into a rising price or buying into a falling one is
    // covered by the unit tests; here the badge is checked for shape and size.
    await expect(trend.locator(".sector-flow-runs, .sector-flow-streaks")).toHaveCount(0);
    for (const mark of await trend.locator("[data-flow-streak]").all()) {
      const badge = mark.locator("b");
      await expect(badge).toHaveText(/^\d{2}\/\d{2} (轉[買賣]|起[買賣]超)$/);
      await expect(badge).toHaveClass(/sector-flow-badge/);
      await expect(badge).toHaveCSS("font-size", "11px");
      await expect(badge).toHaveCSS("border-radius", /^(9{3}|[1-9]\d{2,}|\d+\.?\d*)px$/);
    }
    const runs = await trend.evaluate((section) => {
      const plot = section.querySelector("[data-flow-plot]").getBoundingClientRect();
      const rings = [...section.querySelectorAll("[data-flow-streak] i")].map((ring) => ring.getBoundingClientRect());
      const labels = [...section.querySelectorAll("[data-flow-streak] b")].map((label) => label.getBoundingClientRect());
      const overlap = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      return { traces: section.querySelectorAll("path.sector-flow-run").length, marks: rings.length,
        onPlot: rings.every((ring) => ring.left + ring.width / 2 >= plot.left - 1 && ring.right - ring.width / 2 <= plot.right + 1 && ring.top + ring.height / 2 >= plot.top - 1 && ring.top + ring.height / 2 <= plot.bottom + 1),
        apart: labels.every((label, index) => labels.slice(index + 1).every((other) => !overlap(label, other))) };
    });
    expect(runs.traces).toBeGreaterThanOrEqual(runs.marks);
    expect(runs.onPlot).toBe(true);
    expect(runs.apart).toBe(true);
    // A badge under an institution's figure only where the chart marks it; the others stay empty.
    const badges = trend.locator("[data-flow-run]:not([hidden])");
    expect(await badges.count()).toBeGreaterThanOrEqual(await trend.locator("[data-flow-streak]").count());
    for (const run of await badges.allTextContents()) expect(run).toMatch(/^(連[買賣] \d+\+? 日|轉[買賣]|[買賣]超 1 日)$/);
    for (const key of await trend.locator("[data-flow-streak]").evaluateAll((marks) => marks.map((mark) => mark.dataset.flowStreak)))
      await expect(trend.locator(`[data-flow-run="${key}"]`)).toBeVisible();
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
  // The price readout follows the same day.
  const price = page.locator("#sector-dialog [data-flow-price]");
  const firstDayPrice = await price.textContent();
  await page.keyboard.press("End");
  await expect(price).not.toHaveText(firstDayPrice);
  // A badge under a figure is on while the chart highlights that institution's run: marked on the chart's
  // turn day or later, so the latest day shows it and the first day, before any turn, does not.
  const marked = await page.locator("#sector-dialog [data-flow-streak]").evaluateAll((marks) => marks.map((mark) => mark.dataset.flowStreak));
  for (const key of marked) await expect(page.locator(`#sector-dialog [data-flow-run="${key}"]`)).toBeVisible();
  await page.keyboard.press("Home");
  for (const key of marked) await expect(page.locator(`#sector-dialog [data-flow-run="${key}"]`)).toBeHidden();
  // On the first day no run can reach further back than that one session.
  for (const run of await page.locator("#sector-dialog [data-flow-run]").allTextContents()) expect(run).toMatch(/^([買賣]超 1 日)?$/);
  await page.keyboard.press("ArrowRight");
  await expect(plot).toHaveAttribute("aria-valuenow", "2");
  await page.keyboard.press("End");
  await expect(date).toHaveText(latest);
  await expect(plot).toHaveAttribute("aria-valuetext", /外資 [+-]?[\d,.]+、投信/);
});
