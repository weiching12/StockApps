import { test, expect } from "@playwright/test";

test("2031 comparison follows the selected market date", async ({ page, request }) => {
  const manifest = await (await request.get("/api/v1/market")).json();
  const settings = "period=9&kSmooth=3&dSmooth=3";
  await page.addInitScript(() => localStorage.setItem("stock-insight-v1",
    JSON.stringify({ favorites: ["2031"], catalogVersion: 2, settings: { period: 9, kSmooth: 3, dSmooth: 3 } })));
  await page.goto("/");
  await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false");
  await page.locator("#stock-search").fill("2031");
  const row = page.locator('#stock-rows [data-symbol="2031"]');
  for (const date of [manifest.asOf, manifest.dates.at(-2)]) {
    const response = await request.get(`/api/v1/market/summary?asOf=${date}&${settings}`);
    expect(response.ok()).toBe(true);
    const stock = (await response.json()).data.stocks.find((stock) => stock.symbol === "2031");
    expect(Number.isFinite(stock.entryScore.finalScore)).toBe(true);
    expect("entryScoreChange" in stock).toBe(false);
    await page.locator("#trade-date").selectOption(date);
    // The list and the dialog show entry research only.
    const readiness = stock.entryResearch.score;
    await expect(row.locator(".entry-score-button strong")).toHaveText(Number.isFinite(readiness) ? String(Math.round(readiness)) : "—");
    await expect(row.locator(".research-gate")).toContainText(`門檻 ${stock.entryResearch.gatePassed}/5`);
    await row.locator(".entry-score-button").click();
    await expect(page.locator("#info-dialog .research-plan-card")).toBeVisible();
    await expect(page.locator("#info-dialog .entry-legacy")).toHaveCount(0);
    await page.locator("#close-dialog").click();
  }
  // Research navigation intentionally returns to the latest session.
  const research = await (await request.get(`/api/v1/favorites/research?symbols=2031&asOf=${manifest.asOf}&${settings}`)).json();
  await page.locator('.sidebar [data-page="favorites"]').click();
  await expect(page.locator("#research-date")).toContainText(manifest.asOf);
  expect(research.data[0].symbol).toBe("2031");
  await page.locator('#research-list [data-research-symbol="2031"] .research-card-main').click();
  await expect(page.locator("#info-dialog .entry-dialog")).toBeVisible();
});

test("full listed market uses a shared summary and opens research tracking", async ({ page, request }) => {
  const manifest = await (await request.get("/api/market")).json();
  expect(manifest.stocks.length).toBeGreaterThanOrEqual(1000);
  const urls = [], errors = [];
  page.on("request", (request) => urls.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false", { timeout: 30000 });
  await expect(page.locator("#stock-rows tr").first()).toBeVisible();
  await page.locator('[data-page="favorites"]').click();
  await expect(page.locator("#research-list .research-card").first()).toBeVisible();
  expect(urls.filter((url) => /\/api\/stocks\//.test(url))).toEqual([]);
  expect(urls.filter((url) => new URL(url).pathname === "/api/v1/favorites/summary")).toEqual([]);
  expect(errors).toEqual([]);
});

test("full-market phone table and sector detail remain usable", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.goto("/");
  await expect(page.locator(".stocks-panel")).toHaveAttribute("aria-busy", "false", { timeout: 30000 });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[data-page="market"]').click();
    await expect(page.locator("#stock-rows tr").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.locator('[data-page="sectors"]').click();
    await page.locator(".sector-card").first().click();
    await expect(page.locator("#sector-dialog")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`market-sector-${width}.png`) });
    await page.keyboard.press("Escape");
  }
});

test("partial sector totals exclude missing data and leave unavailable constituent values blank", async ({ page, request }, testInfo) => {
  test.setTimeout(60000);
  const manifest = await (await request.get("/api/market")).json();
  const chunks = await Promise.all(manifest.chunks.map(async (path) => {
    const response = await request.get(path);
    expect(response.ok(), `Unable to load ${path}`).toBeTruthy();
    return response.json();
  }));
  await page.goto("/");
  await expect(page.locator("#load-status")).toBeHidden({ timeout: 30000 });
  const histories = new Map(chunks.flatMap((chunk) => chunk.stocks).map((stock) => [stock.symbol, new Map(stock.history.map((row) => [row[0], row]))]));
  const amount = (shares, unit = false) => shares === null ? ""
    : `${shares > 0 ? "+" : ""}${(shares / 1000).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(shares / 1000) ? 0 : 2, maximumFractionDigits: Number.isInteger(shares / 1000) ? 0 : 2 })}${unit ? " 張" : ""}`;
  const percent = (value) => `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const money = (value) => value === null ? "" : `${value > 0 ? "+" : ""}${(value / 100000000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 億`;
  const expected = (sector, days) => {
    const stocks = manifest.stocks.filter((stock) => stock.sector === sector);
    const dates = manifest.dates.slice(-days);
    const rows = stocks.map((stock) => dates.map((date) => histories.get(stock.symbol).get(date)))
      .filter((rows) => rows.length === days && rows.every((row) => row && row.slice(6).every(Number.isFinite)));
    const net = (offset) => rows.length ? rows.reduce((total, history) => total + history.reduce((sum, row) => sum + row[offset] - row[offset + 1], 0), 0) : null;
    const parts = [6, 8, 10].map(net);
    const cash = [6, 8, 10].map((offset) => rows.length ? rows.reduce((total, history) => total
      + history.reduce((sum, row) => sum + (row[offset] - row[offset + 1]) * row[4], 0), 0) : null);
    const volumes = rows.flat().map((row) => row[5]);
    const volume = rows.length && volumes.every(Number.isFinite) ? volumes.reduce((a, b) => a + b, 0) : 0;
    const total = rows.length ? parts.reduce((a, b) => a + b, 0) : null;
    const ratio = (shares) => shares === null || !volume ? "" : percent(shares / volume * 100);
    return { total, parts, cash, ratios: [total, ...parts].map(ratio),
      money: rows.length ? cash.reduce((a, b) => a + b, 0) : null, available: rows.length, expected: stocks.length };
  };
  // ETFs are excluded from sector rankings, so only an inactive company has a sector card to check.
  const unpriced = manifest.stocks.find((stock) => manifest.coverage.inactive.includes(stock.symbol) && stock.sector !== "ETF");
  const sectors = [...new Set(["電子零組件業", unpriced?.sector].filter(Boolean))];
  await page.locator('[data-page="sectors"]').click();
  for (const sector of sectors) {
    for (const [key, days] of [["day", 1], ["5", 5], ["20", 20]]) {
      const result = expected(sector, days);
      await page.locator(`[data-sector-window="${key}"]`).click();
      const card = page.locator(`[data-sector-details="${sector}"]`);
      await expect(card.locator("[data-sector-lots]")).toHaveText(amount(result.total, true));
      await expect(card.locator("[data-sector-amount]")).toHaveText(money(result.money));
      await expect(card.locator("[data-sector-coverage]")).toHaveCount(0);
    }
    await page.locator(`[data-sector-details="${sector}"]`).click();
    for (const [key, days] of [["day", 1], ["5", 5], ["20", 20]]) {
      const result = expected(sector, days);
      const summary = page.locator(`#sector-dialog [data-sector-period="${key}"]`);
      await expect(summary.locator('[data-sector-ratio="total"]')).toHaveText(result.ratios[0]);
      await expect(summary.locator('[data-sector-money="total"]')).toHaveText(money(result.money));
      for (const [i, name] of ["外資", "投信", "自營商"].entries()) {
        await expect(summary.locator(`[data-sector-ratio="${name}"]`)).toHaveText(result.ratios[i + 1]);
        await expect(summary.locator(`[data-sector-money="${name}"]`)).toHaveText(money(result.cash[i]));
      }
      await expect(summary.locator("[data-sector-coverage]")).toHaveCount(0);
    }
    if (sector === unpriced?.sector) {
      const row = page.locator(`[data-sector-stock="${unpriced.symbol}"]`);
      await expect(row.locator(".sector-stock-close")).toHaveText("—");
      await expect(row.locator('[data-sector-net="day"] strong')).toHaveText("");
    }
    if (sector === "電子零組件業") {
      if (manifest.coverage.missingInstitutions.includes("4943"))
        await expect(page.locator('[data-sector-stock="4943"] [data-sector-net="day"] strong')).toHaveText("");
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.locator("#sector-dialog").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        if (width === 390) await page.screenshot({ path: testInfo.outputPath("partial-sector-390.png") });
      }
    }
    await page.keyboard.press("Escape");
  }
});
