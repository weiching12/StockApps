import { test, expect } from "@playwright/test";

// The 初步門檻 column heading opens 株研分析說明 at its gate section, and the guide states the model's
// five vetoes with the live thresholds (home, search and favorites share the heading markup); the sidebar opens it too.
test("the gate column heading opens the analysis guide at the preliminary gate", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/");
  const link = page.locator(".table-scroll thead .column-guide-link");
  await expect(link).toHaveText("初步門檻");
  await link.click();
  const dialog = page.locator("#info-dialog");
  await expect(dialog.locator("#dialog-heading")).toHaveText("株研分析說明");
  await expect(dialog.locator("#analysis-gate h3")).toHaveText("初步門檻");
  await expect(dialog.locator(".analysis-veto dt")).toHaveText([/趨勢遭破壞/, /近期放量下跌/, /過度延伸/, /法人明顯賣壓/, /流動性不足/]);
  // Thresholds come from the current model (v4: NT$300 million average traded value).
  await expect(dialog.locator(".analysis-veto").nth(4)).toContainText("低於 3 億元即否決");
  await expect(dialog.locator("#analysis-gate")).toBeInViewport();
  await page.keyboard.press("Escape");
  // The sidebar entry opens the same guide.
  await page.locator('.sidebar .nav-item[data-dialog="analysis"]').click();
  await expect(dialog.locator("#dialog-heading")).toHaveText("株研分析說明");
});
