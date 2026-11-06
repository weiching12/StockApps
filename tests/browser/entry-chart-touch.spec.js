import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

test("phone chart shows the touched trading day without a separate slider", async ({ page }) => {
  await page.goto("/");
  await page.locator("#stock-rows tr[data-symbol] .stock-name").first().click();
  const chart = page.locator(".entry-price-chart");
  const plot = chart.locator(".entry-chart-plot");
  // The chart follows the research sections; bring it on screen before touching it.
  await plot.scrollIntoViewIfNeeded();
  await expect(chart.locator("h3")).toBeVisible();
  await expect(chart.locator(".entry-chart-readout")).toBeHidden();
  await expect(chart.locator(".entry-chart-latest")).toBeVisible();
  await expect(chart.locator(".entry-chart-latest strong")).toHaveCSS("font-size", "20px");
  await expect(chart.locator(".entry-chart-latest-change")).toHaveCSS("font-size", "16px");
  const today = JSON.parse(await plot.getAttribute("data-points")).at(-1);
  await expect(chart.locator(".entry-chart-latest strong")).toHaveText(today.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  await expect(plot).toHaveAttribute("aria-valuemax", "30");
  await expect(chart.locator(".entry-chart-range")).toHaveCount(0);
  const first = await chart.locator(".entry-chart-points circle").first().boundingBox();
  await page.touchscreen.tap(first.x + first.width / 2, first.y + first.height / 2);
  await expect(plot).toHaveAttribute("aria-valuenow", "1");
  expect(await plot.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
  await expect(chart.locator("h3")).toBeVisible();
  await expect(chart.locator(".entry-chart-hint")).toHaveCount(0);
  const last = await chart.locator(".entry-chart-points circle").last().boundingBox();
  await page.touchscreen.tap(last.x + last.width / 2, last.y + last.height / 2);
  await expect(plot).toHaveAttribute("aria-valuenow", "30");
  const box = await plot.boundingBox();
  const stableY = box.y;
  const y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width - 8, y, id: 1 }] });
  await page.waitForTimeout(450);
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: first.x + first.width / 2, y, id: 1 }] });
  await expect(chart.locator(".entry-chart-readout")).toBeVisible();
  await expect(chart.locator("h3")).toBeHidden();
  await expect(chart.locator(".entry-chart-latest")).toBeHidden();
  expect((await plot.boundingBox()).y).toBe(stableY);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(plot).toHaveAttribute("aria-valuenow", "1");
  const firstDate = JSON.parse(await plot.getAttribute("data-points"))[0].date.slice(5).replace("-", "/");
  await expect(chart.locator(".entry-chart-selected-date")).toHaveText(firstDate);
  await expect(chart.locator(".entry-chart-selected-volume")).toContainText("張");
  await expect(chart.locator(".entry-chart-selected-change")).toContainText("%");
  await expect(chart.locator("h3")).toBeVisible();
  await expect(chart.locator(".entry-chart-readout")).toBeHidden();
  await expect(chart.locator(".entry-chart-latest")).toBeVisible();
  expect((await plot.boundingBox()).y).toBe(stableY);
  expect(await chart.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("dragging the phone chart after a hold does not scroll the detail panel", async ({ page }) => {
  await page.goto("/");
  await page.locator("#stock-rows tr[data-symbol] .stock-name").first().click();
  const dialog = page.locator("#info-dialog");
  const plot = dialog.locator(".entry-chart-plot");
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  const startScroll = await dialog.evaluate((element) => element.scrollTop);
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width - 12, y: box.y + box.height * 0.35, id: 1 }] });
  await page.waitForTimeout(450);
  await expect(dialog.locator(".entry-chart-readout")).toBeVisible();
  for (let step = 1; step <= 5; step++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width - 12 - step * (box.width - 24) / 5, y: box.y + box.height * (0.35 + step * 0.08), id: 1 }] });
  }
  await expect(dialog.locator(".entry-chart-readout")).toBeVisible();
  await expect.poll(async () => Number(await plot.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(2);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(await dialog.evaluate((element) => element.scrollTop)).toBe(startScroll);
});

test("a quick vertical swipe on the phone chart scrolls the detail panel instead of scrubbing", async ({ page }) => {
  await page.goto("/");
  await page.locator("#stock-rows tr[data-symbol] .stock-name").first().click();
  const dialog = page.locator("#info-dialog");
  const plot = dialog.locator(".entry-chart-plot");
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  const startScroll = await dialog.evaluate((element) => element.scrollTop);
  const startIndex = await plot.getAttribute("aria-valuenow");
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width * 0.3, y = box.y + box.height * 0.8;
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  for (let step = 1; step <= 6; step++)
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - step * 25, id: 1 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(startScroll);
  await expect(plot).toHaveAttribute("aria-valuenow", startIndex);
  await expect(dialog.locator(".entry-chart-readout")).toBeHidden();
});

test("touching a market row does not leave a blue focus outline", async ({ page }) => {
  await page.goto("/");
  const row = page.locator("#stock-rows tr[data-symbol]").first();
  await row.tap();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await page.locator(".info-dialog-handle").tap();
  await expect(page.locator("#info-dialog")).toBeHidden();
  await row.focus();
  expect(await row.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
  await page.keyboard.press("Tab");
  await row.focus();
  expect(await row.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
});

test("mouse clicking a market row does not leave a blue focus outline", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  const row = page.locator("#stock-rows tr[data-symbol]").first();
  await row.click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await page.locator("#close-dialog").click();
  await row.focus();
  expect(await row.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
  await page.keyboard.press("Tab");
  await row.focus();
  expect(await row.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  await context.close();
});
