import { test, expect } from '@playwright/test';

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

for (const width of [320, 375, 390, 1440]) {
  test(`sector institutional periods sit side by side with aligned rows at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.locator('[data-page="market"]').first().click();
  await page.locator("#sector-ranking > summary").click();
    await page.locator('#sector-grid .sector-card').first().click();
    await expect(page.locator('#sector-dialog')).toBeVisible();
    const grid = page.locator('#sector-dialog .sector-summary-grid');
    await expect(grid.locator('.sector-summary-labels span')).toHaveText(['', '合計', '外資', '投信', '自營商']);
    await expect(grid.locator('.sector-summary-period h4')).toHaveText(['當日', '5 日', '20 日']);
    const layout = await grid.evaluate((node) => {
      const periods = [...node.querySelectorAll('.sector-summary-period')];
      const rows = periods.map((period) => [...period.querySelectorAll('h4, .sector-summary-values, dd')]
        .map((cell) => Math.round(cell.getBoundingClientRect().top)));
      const labels = [...node.querySelectorAll('.sector-summary-labels span')].map((label) => Math.round(label.getBoundingClientRect().top));
      const tops = periods.map((period) => Math.round(period.getBoundingClientRect().top));
      const wrapped = [...node.querySelectorAll('.institution-money, .institution-lots')]
        .filter((value) => value.getBoundingClientRect().height > Number.parseFloat(getComputedStyle(value).lineHeight) * 1.5)
        .map((value) => value.textContent);
      return { rows, labels, tops, wrapped, fits: node.scrollWidth <= node.clientWidth };
    });
    // One row of three period columns, each with the same five row positions as the label column.
    expect(new Set(layout.tops).size).toBe(1);
    for (const rows of layout.rows) expect(rows).toEqual(layout.labels);
    expect(layout.wrapped).toEqual([]);
    expect(layout.fits).toBe(true);
    // Screen readers still hear each institution name with its value.
    await expect(grid.locator('[data-sector-period="day"] dt')).toHaveText(['外資', '投信', '自營商']);
  });
}
