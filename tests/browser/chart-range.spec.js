import { test, expect } from "@playwright/test";

test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

for (const width of [320, 390, 1280]) {
  test(`the chart switches between a month and longer ranges without leaving the dialog at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.locator('[data-page="market"]').first().click();
    await page.locator('#stock-rows tr[data-symbol="2330"] .stock-name').click();
    const dialog = page.locator("#info-dialog"), chart = dialog.locator(".entry-price-chart");
    await expect(chart.locator("h3")).toHaveText("30 個交易日走勢圖");
    const ranges = chart.locator("[data-chart-range]");
    await expect(ranges).toHaveText(["1 月", "3 月", "1 年"]);
    await expect(chart.locator('[data-chart-range][aria-pressed="true"]')).toHaveText("1 月");
    const lastPoint = async () => JSON.parse(await chart.locator(".entry-chart-plot").getAttribute("data-points")).at(-1);
    const month = await lastPoint();

    await chart.locator('[data-chart-range="60"]').click();
    await expect(chart.locator("h3")).toHaveText("60 個交易日走勢圖");
    await expect(chart.locator(".entry-chart-plot")).toHaveAttribute("aria-valuemax", "60");
    await expect(chart.locator('[data-chart-range][aria-pressed="true"]')).toHaveText("3 月");
    await expect(chart).not.toHaveClass(/dense/);
    // The range ends on the same session with the same figures.
    expect(await lastPoint()).toEqual(month);

    // Demo history holds 180 sessions: a year shows them all and says how many.
    await chart.locator('[data-chart-range="260"]').click();
    await expect(chart.locator("h3")).toHaveText("180 個交易日走勢圖");
    await expect(chart).toHaveClass(/dense/);
    await expect(chart.locator('[data-chart-range][aria-pressed="true"]')).toHaveText("1 年");
    const first = JSON.parse(await chart.locator(".entry-chart-plot").getAttribute("data-points"))[0].date;
    await expect(chart.locator(".entry-chart-dates span").first()).toHaveText(first);
    // Only the selected session keeps its dot, and bars stay apart.
    const drawn = await chart.evaluate((node) => {
      const dots = [...node.querySelectorAll(".entry-chart-points circle")];
      const bars = [...node.querySelectorAll(".entry-chart-volume")].map((bar) => bar.getBoundingClientRect());
      return { visible: dots.filter((dot) => getComputedStyle(dot).opacity !== "0").length, dots: dots.length,
        apart: bars.every((bar, index) => !index || bar.left >= bars[index - 1].right - 0.5) };
    });
    expect(drawn.dots).toBeGreaterThan(100);
    expect(drawn.visible).toBe(1);
    expect(drawn.apart).toBe(true);
    // Scrubbing still reads a day out of the longer series.
    await chart.locator(".entry-chart-plot").focus();
    await page.keyboard.press("Home");
    await expect(chart.locator(".entry-chart-plot")).toHaveAttribute("aria-valuenow", "1");
    // The rest of the dialog is untouched, and the series toggles still work on the redrawn chart.
    await expect(dialog.locator(".research-gates")).toBeVisible();
    await chart.locator('[data-chart-series="ma60"]').click();
    await expect(chart).toHaveClass(/hide-ma60/);
    await chart.locator('[data-chart-range="30"]').click();
    await expect(chart.locator("h3")).toHaveText("30 個交易日走勢圖");
    expect(await lastPoint()).toEqual(month);
    const layout = await dialog.evaluate((node) => { const row = node.querySelector(".entry-chart-ranges").getBoundingClientRect(), box = node.querySelector(".entry-price-chart").getBoundingClientRect();
      return { fits: node.scrollWidth <= node.clientWidth, inside: row.left >= box.left - 1 && row.right <= box.right + 1 }; });
    expect(layout).toEqual({ fits: true, inside: true });
  });
}

test("the institution line keeps one layout while the chart is scrubbed, however long the figures", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.locator('[data-page="market"]').first().click();
    await page.locator('#stock-rows tr[data-symbol="2330"] .stock-name').click();
    const chart = page.locator("#info-dialog .entry-price-chart"), bar = chart.locator(".entry-institution-bar");
    const shape = () => bar.evaluate((node) => { const box = node.getBoundingClientRect();
      const cells = [...node.querySelectorAll(".entry-institution-legend span")].map((cell) => cell.getBoundingClientRect());
      return { height: Math.round(box.height), tops: new Set(cells.map((cell) => Math.round(cell.top))).size, inside: cells.every((cell) => cell.right <= box.right + 1),
        apart: cells.every((cell, index) => !index || cell.left >= cells[index - 1].right - 1) }; });
    const latest = await shape();
    expect(latest).toMatchObject({ tops: 1, inside: true, apart: true });
    // Far larger figures than any real day: the three columns hold and the block keeps its height.
    await bar.evaluate((node) => { for (const value of node.querySelectorAll(".entry-institution-legend b")) value.textContent = "12,345,678 張"; });
    expect(await shape()).toEqual(latest);
    await chart.locator(".entry-chart-plot").focus();
    await page.keyboard.press("Home");
    expect((await shape()).height).toBe(latest.height);
    await chart.locator('[data-chart-range="260"]').click();
    await expect(chart.locator('[data-chart-range][aria-pressed="true"]')).toHaveText("1 年");
    expect(await shape()).toEqual(latest);
  }
});

test("sector choices list the busiest sector of the day first, and its sub-industries the same way", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  const turnover = await page.locator("#stock-rows tr[data-symbol]").first().evaluate(() => null);
  expect(turnover).toBeNull();
  const chips = page.locator("#sector-chips button");
  await expect(chips.first()).toHaveText("全部");
  const names = (await chips.allTextContents()).slice(1);
  expect(names.length).toBeGreaterThan(2);
  // Turnover per sector, read from the list itself: close × volume is not shown, so compare with the
  // order the app computed from its own snapshots through the same helper.
  const expected = await page.evaluate(async () => {
    const { sectorTree, sectorTurnover } = await import("/src/ui/sectors.js");
    const { demoProvider } = await import("/src/data.js");
    const { getSnapshot } = await import("/shared/indicators.js");
    const dataset = await demoProvider.load();
    const stocks = dataset.stocks.filter((stock) => stock.sector !== "ETF");
    const snapshots = stocks.map((stock) => getSnapshot({ ...stock, tradingDates: dataset.dates }, dataset.dates.at(-1), { period: 9, kSmooth: 3, dSmooth: 3 }));
    const tree = sectorTree(stocks, sectorTurnover(snapshots)), byName = sectorTree(stocks);
    return { ordered: [...tree.groups.map((group) => group.name), ...tree.plain], named: [...byName.groups.map((group) => group.name), ...byName.plain], tree };
  });
  expect(names).toEqual(expected.ordered);
  expect(expected.ordered).not.toEqual(expected.named);
  const group = expected.tree.groups.find((item) => item.subs.length > 1);
  if (group) {
    await page.locator(`#sector-chips button[data-sector-chip="${group.name}"]`).click();
    await expect(page.locator("#sub-sector-chips button")).toHaveText([`全部${group.name}`, ...group.subs]);
  }
});
