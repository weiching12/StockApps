import { test, expect } from "@playwright/test";

// Switching the chart range redraws the chart; the plan levels stay as the viewer left them,
// rather than coming back on for a next-day candidate whose levels start shown.
test("the chart range switch keeps the plan levels off once they are turned off", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "home"));
  await page.goto("/");
  const cards = page.locator("#home-list tr.research-card");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  const dialog = page.locator("#info-dialog"), chart = dialog.locator(".entry-price-chart");
  const symbols = await cards.evaluateAll((rows) => rows.map((row) => row.dataset.entryScore).slice(0, 12));
  let found = false;
  for (const symbol of symbols) {
    await page.locator(`#home-list tr.research-card[data-entry-score="${symbol}"] .research-card-main`).click();
    await expect(chart.locator(".entry-chart-plot")).toBeVisible({ timeout: 20_000 });
    if (await chart.locator(".entry-chart-plan-toggle").count()) { found = true; break; }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
  test.skip(!found, "no stock on the home list has plan levels in the local data");
  const plan = () => chart.locator(".entry-chart-plan-toggle");
  if (await plan().getAttribute("aria-pressed") === "true") await plan().click();
  await expect(plan()).toHaveAttribute("aria-pressed", "false");
  for (const range of ["60", "260", "30"]) {
    await chart.locator(`[data-chart-range="${range}"]`).click();
    await expect(chart.locator(`[data-chart-range="${range}"]`)).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await expect(chart.locator(".entry-chart-plot")).toHaveAttribute("aria-valuemax", /\d+/);
    await expect(plan()).toHaveAttribute("aria-pressed", "false");
    await expect(chart).toHaveClass(/hide-plan/);
  }
  // Turned back on, they stay on through another switch.
  await plan().click();
  await chart.locator('[data-chart-range="60"]').click();
  await expect(chart.locator('[data-chart-range="60"]')).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await expect(plan()).toHaveAttribute("aria-pressed", "true");
  await expect(chart).not.toHaveClass(/hide-plan/);
});
