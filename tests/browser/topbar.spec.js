import { test, expect } from "@playwright/test";

test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const open = async (page, width = 1280) => {
  await page.setViewportSize({ width, height: 860 });
  await page.goto("/");
  await expect(page.locator("#stock-rows tr[data-symbol]").first()).toBeVisible();
};

test("the top bar has a search box, the data status and the account, without the breadcrumb", async ({ page }) => {
  await open(page);
  const bar = page.locator(".topbar");
  await expect(bar.locator(".breadcrumb, #breadcrumb-current")).toHaveCount(0);
  await expect(bar.locator("#topbar-search")).toBeVisible();
  await expect(bar.locator("#topbar-search")).toHaveAttribute("placeholder", "搜尋代碼或名稱");
  // Demo data says so and names its trading day; the account entry stays on the right.
  await expect(bar.locator("#data-status strong")).toHaveText("示範資料 · 2026/10/16");
  await expect(bar.locator("#account-menu")).toBeVisible();
  await expect(bar.locator(".demo-badge")).toHaveCount(0);
  const layout = await bar.evaluate((node) => {
    const box = node.getBoundingClientRect(), search = node.querySelector(".topbar-search").getBoundingClientRect();
    const status = node.querySelector("#data-status").getBoundingClientRect();
    return { searchLeft: search.left - box.left, statusBeforeEdge: box.right - status.right > 0, noOverlap: search.right <= status.left, height: Math.round(box.height) };
  });
  expect(layout.searchLeft).toBeLessThan(40);
  expect(layout.noOverlap).toBe(true);
  expect(layout.height).toBeLessThanOrEqual(64);
});

test("typing lists matching stocks; arrows move, Enter opens the stock and Escape closes", async ({ page }) => {
  await open(page);
  const input = page.locator("#topbar-search"), list = page.locator("#topbar-search-results");
  await input.fill("23");
  await expect(list).toBeVisible();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  const options = list.locator('[role="option"]');
  expect(await options.count()).toBeGreaterThan(1);
  expect(await options.count()).toBeLessThanOrEqual(9);
  // Codes that start with the query come first; each row shows the close and change.
  await expect(options.first()).toContainText(/^\s*23\d\d/);
  await expect(options.first().locator(".topbar-search-change")).toHaveText(/^[+-]?\d+\.\d{2}%$/);
  await expect(input).toHaveAttribute("aria-activedescendant", "topbar-option-0");
  await input.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", "topbar-option-1");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  const symbol = await options.nth(1).getAttribute("data-symbol");
  await input.press("Enter");
  await expect(page.locator("#info-dialog #dialog-heading")).toContainText(symbol);
  await expect(list).toBeHidden();
  await expect(input).toHaveValue("");
  await page.keyboard.press("Escape");
  // A name works too, and Escape first closes the list, then clears the box.
  await input.fill("台積");
  await expect(options.first()).toContainText("2330");
  await input.press("Escape");
  await expect(list).toBeHidden();
  await expect(input).toHaveValue("台積");
  await input.press("Escape");
  await expect(input).toHaveValue("");
  // Nothing found says so.
  await input.fill("zzzz");
  await expect(list.locator(".topbar-search-note")).toHaveText("沒有符合的股票");
});

test("a click on a result opens it, and / focuses the box from anywhere", async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("/");
  const input = page.locator("#topbar-search");
  await expect(input).toBeFocused();
  await page.keyboard.type("聯發");
  await page.locator('#topbar-search-results [data-symbol="2454"]').click();
  await expect(page.locator("#info-dialog #dialog-heading")).toHaveText("2454 聯發科");
});

test("more matches than fit lead to the search page with the same query", async ({ page }) => {
  await open(page);
  const input = page.locator("#topbar-search");
  await input.fill("2");
  const all = page.locator("#topbar-search-results [data-show-all]");
  await expect(all).toHaveText(/^查看全部 \d+ 筆結果$/);
  await all.click();
  await expect(page.locator("#stock-search")).toHaveValue("2");
  await expect(page.locator("#search-results")).toBeVisible();
});

test("on phones the top bar stays hidden and / still opens the search page", async ({ page }) => {
  await open(page, 390);
  await expect(page.locator(".topbar")).toBeHidden();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("/");
  await expect(page.locator("#stock-search")).toBeFocused();
});

test("the result list sits above the page content below the bar", async ({ page }) => {
  await open(page);
  await page.locator("#topbar-search").fill("23");
  const list = page.locator("#topbar-search-results");
  await expect(list).toBeVisible();
  const covered = await list.evaluate((node) => [...node.querySelectorAll('[role="option"]')].every((option) => {
    const box = option.getBoundingClientRect();
    return node.contains(document.elementFromPoint(box.left + 20, box.top + box.height / 2));
  }));
  expect(covered).toBe(true);
});
