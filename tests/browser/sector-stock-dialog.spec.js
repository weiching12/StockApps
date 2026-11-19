import { test, expect } from "@playwright/test";

// A stock picked in a sector's sheet (法人買株) opens over that sheet, on wide screens as on phones;
// the desktop side drawer is non-modal and would otherwise sit under the sheet, out of sight.
for (const width of [1280, 390]) {
  test(`a stock chosen in a sector sheet shows above the sheet at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
    await page.goto("/?glass=1");
    await page.locator('[data-market-view-choice="sectors"]').first().click();
    await page.locator("#sector-grid [data-sector-details]").first().click();
    const name = page.locator("#sector-dialog .sector-stock-name").first();
    await expect(name).toBeVisible();
    const symbol = await name.evaluate((button) => button.closest("tr").dataset.sectorStock);
    await name.click();
    const info = page.locator("#info-dialog");
    await expect(info).toHaveAttribute("data-entry-symbol", symbol);
    const topmost = await info.evaluate((dialog) => {
      const box = dialog.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(120, box.height / 2))?.closest("dialog")?.id;
    });
    expect(topmost).toBe("info-dialog");
    // Closing the stock returns to the sheet, still open.
    await page.keyboard.press("Escape");
    await expect(info).not.toHaveAttribute("open", "");
    await expect(page.locator("#sector-dialog")).toHaveAttribute("open", "");
  });
}
