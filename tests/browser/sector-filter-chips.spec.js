import { test, expect } from "@playwright/test";

const openSectors = async (page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "法人買株" }).locator("visible=true").first().click();
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

test("every phone chip fits at 390px and can be reached by scrolling at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSectors(page);
  const last = page.locator('[data-sector-window="20"]');
  const toolbar = page.locator("#sector-page .sector-toolbar");
  expect((await last.boundingBox()).x + (await last.boundingBox()).width).toBeLessThanOrEqual((await toolbar.boundingBox()).x + (await toolbar.boundingBox()).width);
  await page.setViewportSize({ width: 320, height: 844 });
  await last.click();
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-sector-window="day"]')).toHaveAttribute("aria-pressed", "false");
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
