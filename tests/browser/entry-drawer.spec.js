import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

test("desktop entry score opens beside the market list and switches stocks", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const rows = page.locator("#stock-rows tr[data-symbol]");
  await rows.first().locator(".entry-score-button").click();
  const dialog = page.locator("#info-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-entry-drawer", "true");
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(false);
  await dialog.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const bounds = await dialog.boundingBox();
  expect(bounds.x + bounds.width).toBeCloseTo(1280, 0);
  expect(bounds.height).toBe(800);
  await expect(rows.first()).toBeVisible();

  const nextSymbol = await rows.nth(1).getAttribute("data-symbol");
  await rows.nth(1).locator(".entry-score-button").click();
  await expect(page.locator("#dialog-heading")).toContainText(nextSymbol);
  await dialog.locator("#dialog-content").evaluate((content) => { content.scrollTop = 500; });
  const closeBounds = await page.locator("#close-dialog").boundingBox();
  expect(closeBounds.y).toBeGreaterThanOrEqual(0);
  expect(closeBounds.y + closeBounds.height).toBeLessThanOrEqual(800);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await rows.first().locator(".entry-score-button").click();
  await page.locator('[data-page="favorites"]').first().click();
  await expect(dialog).toBeHidden();
});

test("phone entry score remains a modal dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#stock-rows tr[data-symbol]").last().locator(".stock-name").click();
  const dialog = page.locator("#info-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-entry-drawer", "false");
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
  await page.locator(".info-dialog-handle").click();
  await expect(dialog).toBeHidden();
});
