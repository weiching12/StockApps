import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

test("market table and research tracking share favorites without the retired card view", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto("/");
  await expect(page.locator("#stock-rows tr").first()).toBeVisible();
  const star = page.locator("#stock-rows [data-favorite]").first();
  const symbol = await star.getAttribute("data-favorite");
  await star.click();
  await page.locator('.sidebar [data-page="favorites"]').click();
  await expect(page.locator("#research-list")).toBeVisible();
  await expect(page.locator(`#research-list .research-card[data-research-symbol="${symbol}"]`)).toBeVisible();
  await expect(page.locator("#watchlist-grid, #institution-overview, #institution-dialog")).toHaveCount(0);
  expect(requests).not.toContain("/api/v1/favorites/summary");
});

test("market and sector navigation remain usable after opening tracking", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar [data-page="favorites"]').click();
  await expect(page.locator("#research-list")).toBeVisible();
  await page.locator('.sidebar [data-page="market"]').click();
  await expect(page.locator("#stock-rows tr").first()).toBeVisible();
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="sectors"]').click();
  await expect(page.locator("#sector-grid .sector-card").first()).toBeVisible();
});
