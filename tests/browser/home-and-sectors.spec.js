import { test, expect } from "@playwright/test";

const signedIn = { user: { username: "tester", role: "user", mustChangePassword: false } };

test("the app opens on home with the mood and only today's next-day candidates", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-title")).toContainText("主頁面");
  await expect(page.locator("#market-sentiment")).toBeVisible();
  await expect(page.locator(".stocks-panel")).toBeHidden();
  await expect(page.locator("#trade-date")).toBeVisible();
  await expect(page.locator("#update-countdown")).toBeAttached();
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
  await expect(page.locator(".nav-item[data-page] >> visible=true")).toHaveCount(4);
});

test("a saved ranking page reopens as the market page's ranking view", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "sectors"));
  await page.goto("/");
  await expect(page.locator('[data-market-view-choice="sectors"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sector-page")).toBeVisible();
});

test("the market page's title is a switch between the list and the ranking, each on its own panel", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  const views = page.locator(".market-views button");
  await expect(views).toHaveText(["市場觀察清單", "法人買株"]);
  await expect(page.locator("#page-title")).toHaveClass(/sr-only/);
  await expect(page.locator(".market-header")).toHaveClass(/panel/);
  await expect(page.locator(".market-header #sector-chips")).toBeVisible();
  await expect(page.locator(".stocks-panel")).toBeVisible();
  await expect(page.locator("#sector-page")).toBeHidden();
  await expect(page.locator(".stocks-panel #sector-page")).toHaveCount(0);
  await views.nth(1).click();
  await expect(page.locator("#sector-page")).toBeVisible();
  await expect(page.locator("#sector-page")).toHaveClass(/panel/);
  await expect(page.locator(".stocks-panel")).toBeHidden();
  await expect(page.locator("#page-description")).toContainText("非買進訊號");
  await expect(page.locator(".market-header .sector-toolbar")).toBeVisible();
  await expect(page.locator(".market-header .sector-nav")).toBeHidden();
  await expect(page.locator("#sector-grid .sector-card").first()).toBeVisible();
  await page.locator('[data-page="home"]').first().click();
  await expect(page.locator("#page-title")).not.toHaveClass(/sr-only/);
  await expect(page.locator(".market-header")).toBeHidden();
});

test("choosing a sector narrows the list and shows that level's institutional flows", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  const list = page.locator("#stock-rows tr[data-symbol]");
  await expect(list.first()).toBeVisible();
  await expect(page.locator("#sector-flow")).toBeHidden();
  await expect(page.locator("#sub-sector-chips")).toBeHidden();

  await page.locator('#sector-chips [data-sector-chip="半導體"]').click();
  await expect(page.locator('#stock-rows tr[data-symbol="2330"]')).toBeVisible();
  await expect(page.locator('#stock-rows tr[data-symbol="2454"]')).toBeVisible();
  await expect(page.locator('#stock-rows tr[data-symbol="2308"]')).toHaveCount(0);
  const flow = page.locator("#sector-flow");
  await expect(flow.locator("h3")).toHaveText("半導體 法人動向");
  await expect(flow.locator(".sector-flow-foot")).toHaveCount(0);
  await expect(flow.locator(".sector-flow-period")).toHaveCount(3);
  await expect(flow.locator("[data-sector-open]")).toHaveCount(0);
  const whole = await flow.locator(".sector-flow-period strong").first().textContent();

  await page.locator('#sub-sector-chips [data-sector-chip="IC設計"]').click();
  await expect(page.locator('#stock-rows tr[data-symbol="2454"]')).toBeVisible();
  await expect(page.locator('#stock-rows tr[data-symbol="2330"]')).toHaveCount(0);
  await expect(flow.locator("h3")).toHaveText("IC設計 法人動向");
  await expect(flow.locator(".sector-flow-period strong").first()).not.toHaveText(whole);
  await expect(page.locator('#sector-chips [data-sector-chip="半導體"]')).toHaveAttribute("aria-pressed", "true");
  await expect(flow.locator(".sector-flow-head [data-sector-open]")).toHaveText("查看明細");
  await flow.locator("[data-sector-open]").click();
  await expect(page.locator("#sector-dialog-heading")).toHaveText("IC設計");
  await page.locator("#close-sector-dialog").click();

  await page.locator('[data-sector-chip="ETF"]').click();
  await expect(page.locator('#stock-rows tr[data-symbol="0050"]')).toBeVisible();
  await expect(flow).toBeHidden();
  await page.locator('#sector-chips [data-sector-chip="all"]').click();
  await expect(flow).toBeHidden();
});

test("flows follow the market list's selected session", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('#sector-chips [data-sector-chip="半導體"]').click();
  const amount = page.locator("#sector-flow .sector-flow-period strong").first();
  const latest = await amount.textContent();
  const options = page.locator("#trade-date option");
  // The trading-day choice lives on home.
  await page.locator('[data-page="home"]').first().click();
  await page.locator("#trade-date").selectOption(await options.nth(3).getAttribute("value"));
  await page.locator('[data-page="market"]').first().click();
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

test("the trading day is chosen on home and the market list follows it", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await expect(page.locator(".date-control")).toBeHidden();
  await page.locator('[data-page="home"]').first().click();
  await expect(page.locator(".date-control")).toBeVisible();
  const older = await page.locator("#trade-date option").nth(2).getAttribute("value");
  await page.locator("#trade-date").selectOption(older);
  await page.locator('[data-page="market"]').first().click();
  await expect(page.locator("#table-summary")).toContainText(older);
  await page.locator('[data-page="home"]').first().click();
  await expect(page.locator("#trade-date")).toHaveValue(older);
});

test("search suggests the session's most traded stocks and a tap searches it", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="search"]').first().click();
  const chips = page.locator("[data-search-suggestion]");
  await expect(page.locator("#search-suggestions h3")).toContainText("熱門查詢");
  await expect(chips).toHaveCount(8);
  const symbol = await chips.first().getAttribute("data-search-suggestion");
  await chips.first().click();
  await expect(page.locator("#stock-search")).toHaveValue(symbol);
  await expect(page.locator("#search-results tr.research-card").first()).toHaveAttribute("data-research-symbol", symbol);
  await expect(page.locator("#search-suggestions")).toBeHidden();
});

test("on phones the market list fills the screen to its footer and only its rows scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="list"]').click();
  const footer = page.locator(".table-footer");
  await expect(footer).toBeVisible();
  const layout = await page.evaluate(() => {
    const footerBottom = document.querySelector(".table-footer").getBoundingClientRect().bottom, table = document.querySelector(".table-scroll");
    return { footerInView: footerBottom <= innerHeight && footerBottom > innerHeight - 40, pageScroll: document.documentElement.scrollHeight - innerHeight, tableScrolls: table.scrollHeight > table.clientHeight,
      pageFooter: getComputedStyle(document.querySelector(".page-footer")).display };
  });
  expect(layout).toEqual({ footerInView: true, pageScroll: 0, tableScrolls: true, pageFooter: "none" });
  await page.locator(".table-scroll").evaluate((table) => { table.scrollTop = 400; });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // Choosing a sector grows the header; the list shrinks so the footer stays on screen.
  await page.locator('#sector-chips [data-sector-chip="半導體"]').click();
  await expect.poll(() => page.evaluate(() => document.querySelector(".table-footer").getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".stocks-panel")).not.toHaveClass(/is-fitted/);
});

test("only home shows the trading day and the update countdown, at every width", async ({ page }) => {
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.locator('[data-page="home"]').first().click();
    await expect(page.locator("#trade-date")).toBeVisible();
    for (const target of ["market", "favorites", "search"]) {
      await page.locator(`[data-page="${target}"]`).first().click();
      await expect(page.locator(".date-control"), `${width}px ${target}`).toBeHidden();
      await expect(page.locator("#update-countdown"), `${width}px ${target}`).toBeHidden();
    }
    await page.locator('[data-page="market"]').first().click();
    await page.locator('[data-market-view-choice="sectors"]').click();
    await expect(page.locator("#update-countdown")).toBeHidden();
  }
});

test("opening the app builds home only; the market list renders when it is opened", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#home-count")).toContainText("檔");
  await expect(page.locator("#stock-rows tr")).toHaveCount(0);
  await expect(page.locator("#sector-chips button")).toHaveCount(0);
  await expect(page.locator("#favorite-count")).not.toBeEmpty();
  await page.locator('[data-page="market"]').first().click();
  await expect(page.locator("#stock-rows tr[data-symbol]").first()).toBeVisible();
  await expect(page.locator("#sector-chips button").first()).toBeVisible();
});

test("the phone list hides its scrollbar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="list"]').click();
  expect(await page.locator(".table-scroll").evaluate((table) => getComputedStyle(table).scrollbarWidth)).toBe("none");
});

test("choosing a chip keeps each chip row where it was scrolled", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="list"]').click();
  const first = page.locator("#sector-chips");
  await first.evaluate((row) => { row.scrollLeft = row.scrollWidth; });
  const left = await first.evaluate((row) => row.scrollLeft);
  expect(left).toBeGreaterThan(0);
  await first.locator("button").last().click();
  expect(await first.evaluate((row) => row.scrollLeft)).toBe(left);
  await page.locator('#sector-chips [data-sector-chip="半導體"]').click();
  const second = page.locator("#sub-sector-chips");
  await second.evaluate((row) => { row.scrollLeft = row.scrollWidth; });
  const subLeft = await second.evaluate((row) => row.scrollLeft);
  await second.locator("button").last().click();
  await expect(second.locator("button").last()).toHaveAttribute("aria-pressed", "true");
  expect(await second.evaluate((row) => row.scrollLeft)).toBe(subLeft);
});

test("the market header sits right under the phone bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  const gap = await page.evaluate(() => document.querySelector(".market-header").getBoundingClientRect().top - document.querySelector(".sidebar").getBoundingClientRect().bottom);
  expect(gap).toBeLessThanOrEqual(12);
});
