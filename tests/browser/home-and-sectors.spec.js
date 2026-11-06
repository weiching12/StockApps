import { test, expect } from "@playwright/test";

const signedIn = { user: { username: "tester", role: "user", mustChangePassword: false } };

test("the app opens on home with the mood and only today's next-day candidates", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-title")).toContainText("主頁面");
  await expect(page.locator("#market-sentiment")).toBeVisible();
  await expect(page.locator(".stocks-panel")).toBeHidden();
  await expect(page.locator("#trade-date")).toBeHidden();
  // The demo session has no candidates, and stocks that only cleared the gates are not listed.
  await expect(page.locator("#home-count")).toHaveText("明日候選 0 檔");
  await expect(page.locator("#home-list")).toContainText("本日沒有明日進場候選");
  await expect(page.locator("[data-home-list]")).toHaveCount(0);
  await expect(page.locator("#home-list tr.research-card")).toHaveCount(0);
});

test("candidates sort by readiness and a row opens the stock", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#home-count")).toHaveText("明日候選 0 檔");
  await page.evaluate(async () => {
    const { renderHomeView } = await import("/src/ui/home.js");
    const stock = (symbol, name, score, nextDayStatus = "NEXT_DAY_CANDIDATE") => ({ symbol, name, latest: { close: 100, changePercent: 1 },
      entryResearch: { score, status: "TRIGGERED", nextDayStatus, gateStatus: "PASS", gateConditions: {} } });
    renderHomeView({ state: { homeExpanded: false }, stocks: [stock("2454", "聯發科", 70), stock("2330", "台積電", 90), stock("2303", "聯電", 99, "WAIT_TRIGGER")],
      loading: false, loadFailed: false, asOf: "2026-10-16", loadingIcon: () => "", esc: String,
      number: (value, digits = 0) => value.toFixed(digits), percent: (value) => `${value}%`, direction: () => "up" });
  });
  await expect(page.locator("#home-count")).toHaveText("明日候選 2 檔");
  const rows = page.locator("#home-list tr.research-card");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute("data-research-symbol", "2330");
  await rows.first().locator(".research-price").click();
  await expect(page.locator("#dialog-heading")).toContainText("2330");
});

test("home fits a phone and the phone bar has no ranking page", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await expect(page.locator("#home-count")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await expect(page.locator('[data-page="sectors"]')).toHaveCount(0);
  await expect(page.locator(".nav-item[data-page] >> visible=true")).toHaveCount(3);
});

test("a saved ranking page reopens as the market list", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "sectors"));
  await page.goto("/");
  await expect(page.locator("#page-title")).toContainText("市場觀察清單");
});

test("choosing a sector narrows the list and shows that level's institutional flows", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  const list = page.locator("#stock-rows tr[data-symbol]");
  await expect(list.first()).toBeVisible();
  await expect(page.locator("#sector-flow")).toBeHidden();
  await expect(page.locator("#sub-sector-chips")).toBeHidden();
  await expect(page.locator("#sector-ranking")).toBeVisible();

  await page.locator('#sector-chips [data-sector-chip="半導體"]').click();
  await expect(page.locator('#stock-rows tr[data-symbol="2330"]')).toBeVisible();
  await expect(page.locator('#stock-rows tr[data-symbol="2454"]')).toBeVisible();
  await expect(page.locator('#stock-rows tr[data-symbol="2308"]')).toHaveCount(0);
  await expect(page.locator("#sector-ranking")).toBeHidden();
  const flow = page.locator("#sector-flow");
  await expect(flow.locator("h3")).toHaveText("半導體 法人動向");
  await expect(flow).toContainText("非買進訊號");
  await expect(flow.locator(".sector-flow-period")).toHaveCount(3);
  await expect(flow.locator("[data-sector-open]")).toHaveCount(0);
  const whole = await flow.locator(".sector-flow-period strong").first().textContent();

  await page.locator('#sub-sector-chips [data-sector-chip="IC設計"]').click();
  await expect(page.locator('#stock-rows tr[data-symbol="2454"]')).toBeVisible();
  await expect(page.locator('#stock-rows tr[data-symbol="2330"]')).toHaveCount(0);
  await expect(flow.locator("h3")).toHaveText("IC設計 法人動向");
  await expect(flow.locator(".sector-flow-period strong").first()).not.toHaveText(whole);
  await expect(page.locator('#sector-chips [data-sector-chip="半導體"]')).toHaveAttribute("aria-pressed", "true");
  await flow.locator("[data-sector-open]").click();
  await expect(page.locator("#sector-dialog-heading")).toHaveText("IC設計");
  await page.locator("#close-sector-dialog").click();

  await page.locator('[data-sector-chip="ETF"]').click();
  await expect(page.locator('#stock-rows tr[data-symbol="0050"]')).toBeVisible();
  await expect(flow).toBeHidden();
  await page.locator('#sector-chips [data-sector-chip="all"]').click();
  await expect(page.locator("#sector-ranking")).toBeVisible();
  await expect(flow).toBeHidden();
});

test("flows follow the market list's selected session", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('#sector-chips [data-sector-chip="半導體"]').click();
  const amount = page.locator("#sector-flow .sector-flow-period strong").first();
  const latest = await amount.textContent();
  const options = page.locator("#trade-date option");
  await page.locator("#trade-date").selectOption(await options.nth(3).getAttribute("value"));
  await expect(amount).not.toHaveText(latest);
});

test("the market card keeps one status and leaves readiness to the detail on phones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  const row = page.locator("#stock-rows tr[data-symbol]").first();
  await expect(row.locator(".research-chip")).toBeVisible();
  await expect(row.locator(".research-score-button")).toBeHidden();
  await expect(row.locator(".research-gate")).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 844 });
  await expect(row.locator(".research-score-button")).toBeVisible();
});

test.describe("backtest needs an account", () => {
  const account = (page, body) => page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: body }));

  test("visitors never see it, even from a saved page", async ({ page }) => {
    await account(page, { user: null });
    await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "backtest"));
    await page.goto("/");
    await expect(page.locator("#page-title")).toContainText("主頁面");
    await expect(page.locator('[data-page="backtest"]')).toBeHidden();
    await expect(page.locator("#backtest-page")).toBeHidden();
  });

  test("a signed-in account keeps it in the navigation and returns to it after a reload", async ({ page }) => {
    await account(page, signedIn);
    await page.goto("/");
    const nav = page.locator('[data-page="backtest"]');
    await expect(nav).toBeVisible();
    await nav.click();
    await expect(page.locator("#backtest-page")).toBeVisible();
    await page.reload();
    await expect(page.locator("#page-title")).toContainText("策略回測");
  });

  test("the phone bar still fits at its narrowest with the extra item", async ({ page }) => {
    await account(page, signedIn);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/");
    await expect(page.locator('[data-page="backtest"]')).toBeVisible();
    const fit = await page.locator(".sidebar").evaluate((bar) => {
      const items = [...bar.querySelectorAll(".nav-item")].filter((item) => item.getClientRects().length);
      return { pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, inside: items.every((item) => item.getBoundingClientRect().right <= innerWidth + 1) };
    });
    expect(fit).toEqual({ pageOverflow: false, inside: true });
  });

  test("an account still on a temporary password does not get it", async ({ page }) => {
    await account(page, { user: { ...signedIn.user, mustChangePassword: true } });
    await page.goto("/");
    await expect(page.locator(".account-identity").first()).toBeVisible();
    await expect(page.locator('[data-page="backtest"]')).toBeHidden();
  });
});
