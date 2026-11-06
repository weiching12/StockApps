import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const rows = (page) => page.locator("#stock-rows tr[data-symbol]");

test("phone filters are sector chips, search, one sideways chip row, then sort", async ({ page }) => {
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(rows(page).first()).toBeVisible();
    await expect(page.locator("#market-research-filter")).toBeHidden();
    await expect(page.locator("[data-research-chip]")).toHaveCount(0);
    const box = (selector) => page.locator(selector).boundingBox();
    const [sectors, search, tabs, sort] = await Promise.all(["#sector-chips", "#stock-search", ".filter-tabs", "#market-sort"].map(box));
    expect(sectors.y, `${width}: sectors first`).toBeLessThan(search.y);
    expect(search.y, `${width}: search above chips`).toBeLessThan(tabs.y);
    expect(tabs.y + tabs.height, `${width}: chips above sort`).toBeLessThanOrEqual(sort.y + 1);
    const layout = await page.locator(".filter-tabs").evaluate((row) => ({
      oneLine: new Set([...row.querySelectorAll("button")].map((button) => Math.round(button.getBoundingClientRect().top))).size === 1,
      sectorsOneLine: new Set([...document.querySelectorAll("#sector-chips button")].map((button) => Math.round(button.getBoundingClientRect().top))).size === 1,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(layout, `${width}px`).toEqual({ oneLine: true, sectorsOneLine: true, pageOverflow: false });
  }
});

test("phone view chips toggle off and combine with a sector", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(rows(page).first()).toBeVisible();
  const total = await page.locator("#table-summary").textContent();
  await page.locator('#sector-chips [data-sector-chip="半導體"]').click();
  await expect(page.locator("#table-summary")).not.toHaveText(total);
  const sector = await page.locator("#table-summary").textContent();
  await page.locator('[data-view="favorites"]').click();
  await expect(page.locator("#table-summary")).not.toHaveText(sector);
  await page.locator('[data-view="favorites"]').click();
  await expect(page.locator('[data-view="all"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#table-summary")).toHaveText(sector);
});

test("desktop keeps its tabs and research menu, and a menu choice cannot move the tab indicator", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator("#market-research-filter")).toBeVisible();
  const above = page.locator('[data-view="above"]');
  await page.locator("#market-research-filter").selectOption("gatePass");
  await above.click();
  const aligned = await page.locator(".filter-tabs").evaluate((group) => {
    const target = group.querySelector('[data-view="above"]').getBoundingClientRect();
    return Math.abs(parseFloat(group.style.getPropertyValue("--segment-width")) - target.width) < 1;
  });
  expect(aligned).toBe(true);
  // Desktop tabs stay a single choice: re-clicking does not clear, and 全部 keeps the menu.
  await above.click();
  await expect(above).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-view="all"]').click();
  await expect(page.locator("#market-research-filter")).toHaveValue("gatePass");
});
