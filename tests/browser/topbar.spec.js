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

test("the trading-day menu sits in the top bar on wider screens and in the page heading on phones", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "home"));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/");
  const control = page.locator(".date-control");
  await expect(page.locator(".topbar .date-control")).toBeVisible();
  await expect(page.locator(".page-heading .date-control")).toHaveCount(0);
  // The menu shows its whole date, and the bell (shown here; demo mode hides it) sits beside it in the bar.
  const placed = await page.evaluate(() => {
    document.querySelector(".date-notification-button").hidden = false;
    const select = document.querySelector("#trade-date"), bell = document.querySelector(".date-notification-button").getBoundingClientRect();
    const bar = document.querySelector(".topbar").getBoundingClientRect(), box = select.getBoundingClientRect();
    return { fits: select.scrollWidth <= select.clientWidth + 1, inBar: box.top >= bar.top && box.bottom <= bar.bottom && bell.top >= bar.top && bell.bottom <= bar.bottom,
      bellAfter: bell.left >= box.right, countdownHidden: getComputedStyle(document.querySelector("#update-countdown")).display === "none" };
  });
  expect(placed).toEqual({ fits: true, inBar: true, bellAfter: true, countdownHidden: true });
  // The data status (countdown or update time) sits under the menu, lined up with it, and the account
  // stays beside them: nothing wraps onto a second row, from the narrowest bar to a wide screen.
  for (const width of [701, 891, 1280]) {
    await page.setViewportSize({ width, height: 860 });
    const layout = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const select = rect("#trade-date"), status = rect("#data-status small"), account = rect(".topbar .account-menu"), search = rect(".topbar-search"), bar = rect(".topbar");
      return { under: status.top >= select.bottom - 1 && Math.abs(status.left - select.left) <= 6,
        accountBeside: account.left >= Math.max(select.right, status.right) && account.bottom <= status.bottom + 1,
        searchFirst: search.right < select.left, inBar: status.bottom <= bar.bottom };
    });
    expect(layout, `${width}px`).toEqual({ under: true, accountBeside: true, searchFirst: true, inBar: true });
  }
  await page.setViewportSize({ width: 1280, height: 860 });
  // Choosing another day still drives the page.
  const second = await page.locator("#trade-date option").nth(1).getAttribute("value");
  await page.locator("#trade-date").selectOption(second);
  await expect(page.locator("#trade-date")).toHaveValue(second);
  // The market list reads the chosen day too, so the bar keeps the menu there.
  await page.locator('.nav-item[data-page="market"]').first().click();
  await expect(page.locator(".topbar #trade-date")).toBeVisible();
  await expect(page.locator("#trade-date")).toHaveValue(second);
  // 法人買株 and ETF rank the same chosen day, so the menu stays with that day rather than turning into the latest.
  for (const view of ["sectors", "etf"]) {
    await page.locator(`[data-market-view-choice="${view}"]`).first().click();
    await expect(page.locator(".topbar #trade-date"), view).toBeVisible();
    await expect(page.locator("#trade-date"), view).toHaveValue(second);
    await expect(page.locator("#data-status strong"), view).toBeHidden();
  }
  await page.locator('[data-market-view-choice="list"]').first().click();
  await page.locator('.nav-item[data-page="favorites"]').first().click();
  await expect(control).toBeHidden();
  // A phone has no top bar: the menu returns to the heading.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".page-heading .date-control")).toHaveCount(1);
  await page.locator('.nav-item[data-page="home"]').first().click();
  await expect(page.locator(".page-heading #trade-date")).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 860 });
  await expect(page.locator(".topbar #trade-date")).toBeVisible();
});
