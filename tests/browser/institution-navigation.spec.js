import { test, expect } from '@playwright/test';

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

for (const width of [390, 1440]) {
  test(`institution detail links to the matching stock and sector at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 956 });
    await page.goto('/');
    await page.locator('#stock-rows tr[data-symbol="2330"] .stock-name').click();
    const entryBounds = await page.locator('#info-dialog').boundingBox();
    const entryInset = await page.locator('.entry-dialog').evaluate(node => node.getBoundingClientRect().left - node.closest('dialog').getBoundingClientRect().left);
    const sector = await page.locator('.entry-dialog-sector').textContent();
    // The sector link sits with the institutional inputs in the structure explanation.
    const help = page.locator('.research-structure-help');
    await help.locator('summary').click();
    await help.locator('[data-institution-sector="2330"]').click();
    await expect(page.locator('#info-dialog')).toBeHidden();
    await expect(page.locator('#sector-dialog')).toBeVisible();
    if (width <= 520) {
      const sectorBounds = await page.locator('#sector-dialog').boundingBox();
      expect(entryBounds.width).toBe(sectorBounds.width);
      expect(entryBounds.x).toBe(sectorBounds.x);
      expect(entryBounds.y + entryBounds.height).toBe(sectorBounds.y + sectorBounds.height);
      expect(entryBounds.y + entryBounds.height).toBe(956);
      expect(entryInset).toBe(Number.parseFloat(await page.locator('#sector-dialog-content').evaluate(node => getComputedStyle(node).paddingLeft)));
    }
    await expect(page.locator('#sector-dialog-heading')).toHaveText(sector);
    await expect(page.locator('.sidebar [data-page="market"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#sector-flow h3')).toContainText(sector);
    const stock = page.locator('[data-sector-stock="2330"]');
    await expect(stock).toHaveAttribute('data-sector-target', 'true');
    await expect(stock).toBeFocused();
    await expect(stock).toBeInViewport();
    await page.locator(width <= 520 ? '.sector-dialog-handle' : '#close-sector-dialog').click();
    await expect(page.locator('#sector-dialog')).toBeHidden();
    await expect(page.locator('#page-title')).toContainText('市場觀察清單');
  });
}
