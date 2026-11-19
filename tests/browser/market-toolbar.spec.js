import { test, expect } from "@playwright/test";

// Tablets and laptops keep the market list's filter pills and its research / sort menus on one row,
// with the menus' text whole; narrow tablets use the short pill labels to make room.
test("the market list toolbar keeps the filters and menus side by side from 701px up", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
  await page.goto("/?glass=1");
  await expect(page.locator("#market-sort")).toBeVisible();
  for (const width of [701, 760, 820, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const row = await page.evaluate(() => {
      const tabs = document.querySelector(".table-toolbar > .filter-tabs").getBoundingClientRect();
      const menus = [...document.querySelectorAll("#market-research-filter, #market-sort")];
      const boxes = menus.map((menu) => menu.getBoundingClientRect());
      return { sameRow: boxes.every((box) => Math.abs(box.top + box.height / 2 - (tabs.top + tabs.height / 2)) < 8 && box.left >= tabs.right),
        textWhole: menus.every((menu) => menu.scrollWidth <= menu.clientWidth + 1) };
    });
    expect(row, `${width}px`).toEqual({ sameRow: true, textWhole: true });
  }
});
