import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

test("market note and desktop table remain readable in both themes", async ({ page }) => {
  await page.goto("/");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [898, 1440]) {
      await page.setViewportSize({ width, height: 956 });
      const layout = await page.locator(".table-scroll").evaluate((region) => {
        const note = document.querySelector(".signal-note");
        const row = region.querySelector("#stock-rows tr");
        const net = row.querySelector(".net-cell-desktop");
        const header = region.querySelector("thead th:last-child");
        return {
          noteBackground: getComputedStyle(note).backgroundColor,
          noteColor: getComputedStyle(note).color,
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
      if (theme === "dark") {
        expect(layout.noteBackground).toBe("rgb(20, 34, 56)");
        expect(layout.noteColor).toBe("rgb(229, 237, 248)");
      }
    }
  }
});
