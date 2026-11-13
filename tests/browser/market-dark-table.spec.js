import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

test("the desktop market table remains readable in both themes", async ({ page }) => {
  await page.goto("/");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [898, 1440]) {
      await page.setViewportSize({ width, height: 956 });
      const layout = await page.locator(".table-scroll").evaluate((region) => {
        const row = region.querySelector("#stock-rows tr");
        const net = row.querySelector(".net-cell-desktop");
        const header = region.querySelector("thead th:last-child");
        return {
          netWidth: net.getBoundingClientRect().width,
          netHeaderWidth: header.getBoundingClientRect().width,
          rowHeight: row.getBoundingClientRect().height,
          scrollsHorizontally: region.scrollWidth > region.clientWidth,
        };
      });
      expect(layout.netWidth).toBeGreaterThanOrEqual(170);
      expect(layout.netHeaderWidth).toBeCloseTo(layout.netWidth, 0);
      expect(layout.rowHeight).toBeLessThan(145);
      if (width === 898) expect(layout.scrollsHorizontally).toBe(true);
    }
  }
});

test("the KD reading note lives in the indicator guide, not above the market list", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#stock-rows tr").first()).toBeVisible();
  await expect(page.locator(".signal-note")).toHaveCount(0);
  await expect(page.locator('[data-dialog="signals"]')).toHaveCount(0);
  await page.locator('[data-dialog="methodology"]').locator("visible=true").first().click();
  const guide = page.locator("#info-dialog");
  await expect(guide.locator("#dialog-heading")).toHaveText("讀懂價格背後的訊號");
  await expect(guide).toContainText("依資料日 KD 交叉與 MA20 趨勢判讀");
  await expect(guide).toContainText("需搭配風險控管");
  await expect(guide.locator("#guide-signal .signal-rules dt").first()).toHaveText("留意買點");
});
