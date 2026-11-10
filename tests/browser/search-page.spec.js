import { test, expect } from "@playwright/test";

test("search is its own page in the navigation; the market list keeps its field behind an icon", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await expect(page.locator(".stocks-panel .list-search")).toBeHidden();
  await page.locator('[data-page="search"]').first().click();
  await expect(page.locator("#page-title")).toContainText("搜尋");
  await expect(page.locator(".page-heading")).toHaveClass(/sr-only/);
  await expect(page.locator("#stock-search")).toBeFocused();
  await expect(page.locator(".stocks-panel")).toBeHidden();
  await expect(page.locator("#search-summary")).toContainText("輸入代碼或名稱");
});

test("the market list's search icon opens a field in place of the menus and closing restores the list", async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.locator('[data-page="market"]').first().click();
    const rows = page.locator("#stock-rows tr[data-symbol]"), field = page.locator("#list-search");
    await expect(rows.first()).toBeVisible();
    const all = await rows.count();
    await page.locator("[data-list-search-open]").click();
    await expect(field).toBeFocused();
    await expect(page.locator("#market-sort")).toBeHidden();
    await field.fill("2330");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-symbol", "2330");
    await page.locator("[data-list-search-close]").click();
    await expect(field).toBeHidden();
    await expect(page.locator("#market-sort")).toBeVisible();
    await expect(rows).toHaveCount(all);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("the ETF view shows only a search field, and switching views starts from the whole list again", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="etf"]').click();
  const rows = page.locator("#stock-rows tr[data-symbol]"), field = page.locator("#list-search");
  await expect(field).toBeVisible();
  await expect(page.locator(".stocks-panel .filter-tabs, #market-sort, #market-research-filter, [data-list-search-open], [data-list-search-close]").locator("visible=true")).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  await field.fill("高股息");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-symbol", "00878");
  await page.locator('[data-market-view-choice="list"]').click();
  await expect(field).toBeHidden();
  await expect(field).toHaveValue("");
  await expect(page.locator('#stock-rows tr[data-symbol="2330"]')).toBeVisible();
});

test("matches rank codes before names and a result opens the stock", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="search"]').first().click();
  const rows = page.locator("#search-results tr.research-card");
  await page.locator("#stock-search").fill("23");
  await expect(rows.first()).toBeVisible();
  const symbols = await rows.evaluateAll((items) => items.map((row) => row.dataset.researchSymbol));
  expect(symbols.every((symbol) => symbol.includes("23"))).toBe(true);
  expect(symbols).toEqual([...symbols].sort());
  await page.locator("#stock-search").fill("台積");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-research-symbol", "2330");
  await expect(page.locator("#search-summary")).toContainText("找到 1 檔");
  await page.locator("#stock-search").fill("0050");
  await expect(rows.first()).toHaveAttribute("data-research-symbol", "0050");
  await rows.first().locator(".research-price").click();
  await expect(page.locator("#dialog-heading")).toContainText("0050");
  await page.locator("#close-dialog").click();
  await page.locator("#stock-search").fill("沒有這檔");
  await expect(rows).toHaveCount(0);
  await expect(page.locator("#search-summary")).toHaveText("沒有符合的股票。");
});

test("the slash key opens search from another page", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  // Nothing focused, so the key is not typed into a field.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("/");
  await expect(page.locator("#page-title")).toContainText("搜尋");
  await expect(page.locator("#stock-search")).toBeFocused();
});

test("search fits a phone and the phone bar keeps every item on screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: { username: "t", role: "user", mustChangePassword: false } } }));
  await page.goto("/");
  await expect(page.locator('[data-page="backtest"]')).toBeVisible();
  await page.locator('[data-page="search"]').first().click();
  await page.locator("#stock-search").fill("2");
  await expect(page.locator("#search-results tr.research-card").first()).toBeVisible();
  const fit = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    inside: [...document.querySelectorAll(".sidebar .nav-item, .nav-more-toggle")].filter((item) => item.getClientRects().length)
      .every((item) => item.getBoundingClientRect().right <= innerWidth + 1) }));
  expect(fit).toEqual({ overflow: false, inside: true });
});
