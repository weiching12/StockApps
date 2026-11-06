import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const openSectors = async (page) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator("#sector-ranking > summary").click();
  await expect(page.locator("#sector-page")).toBeVisible();
};

test("sector filters read as one row of chips at every width", async ({ page }) => {
  for (const width of [320, 390, 700, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await openSectors(page);
    const chips = page.locator("#sector-page .sector-toolbar button");
    await expect(chips).toHaveText(["交易量", "買超", "賣超", "當日", "5 日", "20 日"]);
    await expect(page.locator("#sector-page .segmented-indicator").first()).toBeHidden();
    const layout = await page.locator("#sector-page .sector-toolbar").evaluate((toolbar) => {
      const boxes = [...toolbar.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
      const style = getComputedStyle(toolbar.querySelector("button"));
      return { tops: new Set(boxes.map(({ top }) => Math.round(top))).size, radius: parseFloat(style.borderRadius), height: toolbar.getBoundingClientRect().height, pageOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(layout.tops, `${width}px on one row`).toBe(1);
    expect(layout.radius).toBeGreaterThan(100);
    expect(layout.pageOverflow).toBe(false);
    if (width <= 700) expect(layout.height).toBeLessThan(50.4);
    else {
      const labels = await page.locator("#sector-page .sector-toolbar :is(.sector-sort-control, .sector-period-control) > span").evaluateAll((spans) => spans.map((span) => getComputedStyle(span).fontSize));
      expect(labels[0]).toBe(labels[1]);
    }
  }
});

test("the last phone chip can be reached by scrolling the row sideways", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openSectors(page);
  const last = page.locator('[data-sector-window="20"]');
  await last.click();
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-sector-window="day"]')).toHaveAttribute("aria-pressed", "false");
});

test("the ranking lists sub-industries only, and a row opens that sub-industry's stocks", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await openSectors(page);
  const names = await page.locator("#sector-grid .sector-card h3").allTextContents();
  expect(names).toContain("晶圓代工");
  expect(names).not.toContain("半導體");
  await expect(page.locator("#sector-page")).not.toContainText("大類");
  await page.locator('#sector-grid [data-sector-name="晶圓代工"]').click();
  await expect(page.locator("#sector-dialog-heading")).toHaveText("晶圓代工");
  await expect(page.locator('#sector-dialog [data-sector-stock="2330"]')).toBeVisible();
  await expect(page.locator('#sector-dialog [data-sector-stock="2454"]')).toHaveCount(0);
});

test("a long ranking opens on its top ten and expands to all of them", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await openSectors(page);
  const total = await page.locator("#sector-grid .sector-card").count();
  // Demo data has too few sub-industries to collapse, so its ranking shows them all.
  expect(total).toBeLessThanOrEqual(10);
  await expect(page.locator("[data-sector-expand]")).toHaveCount(0);
});

test("a stock's dialog names only its sub-industry", async ({ page }) => {
  await page.goto("/");
  await page.locator('#stock-rows tr[data-symbol="2330"] .stock-name').click();
  await expect(page.locator("#info-dialog .entry-dialog-sector")).toHaveText("晶圓代工");
});

test("the chips still change the ranking and show which is chosen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSectors(page);
  const activity = page.locator('[data-sector-sort="activity-desc"]'), buying = page.locator('[data-sector-sort="net-desc"]');
  await expect(activity).toHaveAttribute("aria-pressed", "true");
  await expect(activity).toHaveAttribute("title", /法人買賣合計金額/);
  await buying.click();
  await expect(buying).toHaveAttribute("aria-pressed", "true");
  await expect(activity).toHaveAttribute("aria-pressed", "false");
  const colors = await page.locator("#sector-page .sector-sort-tabs button").evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).borderColor));
  expect(colors[1]).not.toBe(colors[0]);
});
