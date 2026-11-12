import { test, expect } from "@playwright/test";

test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const openEtf = async (page, symbol) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="etf"]').click();
  await page.locator(`#stock-rows tr[data-symbol="${symbol}"] .stock-name`).click();
  await expect(page.locator("#info-dialog .etf-dialog")).toBeVisible();
};
/** Moves the monthly chart's selection to a month with the keyboard, as a reader would. */
const chooseMonth = async (page, month) => {
  const plot = page.locator("#info-dialog .entry-chart-plot");
  const months = JSON.parse(await plot.getAttribute("data-points")).map((point) => point.month);
  await plot.focus();
  await page.keyboard.press("Home");
  for (let step = 0; step < months.indexOf(month); step++) await page.keyboard.press("ArrowRight");
  await expect(plot).toHaveAttribute("aria-valuenow", String(months.indexOf(month) + 1));
  return months;
};

for (const width of [320, 390, 1280]) {
  test(`an ETF leads with its distribution dates, then its year by month with that month's holdings, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openEtf(page, "00878");
    const dialog = page.locator("#info-dialog");
    const order = await dialog.locator(".entry-dialog > *").evaluateAll((nodes) => nodes.map((node) => node.className.split(" ").find((name) => name !== "etf-section")));
    expect(order).toEqual(["entry-dialog-header", "etf-dividend-card", "entry-price-chart", "etf-month", "etf-dividend-history", "etf-fund", "etf-technical", "helper-text"]);
    await expect(dialog.locator(".research-plan-card, .research-gates, .research-not-evaluated")).toHaveCount(0);
    await expect(dialog.locator(".entry-dialog-quote strong")).toHaveText(/^[\d,]+\.\d{2}$/);
    // Nothing in the dialog leads to another site.
    await expect(dialog.locator(".entry-dialog a[href]")).toHaveCount(0);

    // How it pays and the next distribution: last day to buy, ex-date, pay date, amount.
    const card = dialog.locator(".etf-dividend-card");
    await expect(card.locator(".etf-frequency")).toHaveText("季配息");
    await expect(card.locator(".etf-dividend-when")).toHaveText("下次配息");
    await expect(card.locator(".etf-dividend-dates dt")).toHaveText(["最後買進日", "除息日", "領息日", "每單位配息"]);
    await expect(card.locator(".etf-dividend-dates dd")).toHaveText(["11/16（一）", "11/17（二）", "12/11（五）", "未公告"]);
    await expect(card.locator(".etf-dividend-year small").last()).toHaveText("共 4 次");

    // The year by month: no range choice, no moving averages, no plan levels, no institution line.
    const chart = dialog.locator(".entry-price-chart");
    await expect(chart.locator("h3")).toHaveText("近一年月線圖");
    await expect(chart).toHaveAttribute("data-monthly", "true");
    await expect(chart.locator("[data-chart-range], .entry-chart-plan-toggle, .entry-institution-bar")).toHaveCount(0);
    await expect(chart.locator(".entry-chart-legend button")).toHaveText(["月底收盤價", "月成交量"]);
    const points = JSON.parse(await chart.locator(".entry-chart-plot").getAttribute("data-points"));
    expect(points.length).toBeGreaterThan(5);
    expect(points.length).toBeLessThanOrEqual(13);
    expect(new Set(points.map((point) => point.month)).size).toBe(points.length);
    await expect(chart.locator(".entry-chart-dates span")).toHaveText([points[0].month, points.at(-1).month]);
    // Ex-dividend and payment lanes, each mark over its month's point.
    await expect(chart.locator(".etf-event-lane > span")).toHaveText(["除息", "發息"]);
    const marks = await chart.evaluate((node) => {
      const plot = node.querySelector(".entry-chart-plot").getBoundingClientRect();
      const months = JSON.parse(node.querySelector(".entry-chart-plot").dataset.points).map((point) => point.month);
      const x = (month) => plot.left + (8 + months.indexOf(month) * 584 / (months.length - 1)) / 600 * plot.width;
      const centers = (lane) => [...node.querySelectorAll(`.etf-event-lane.${lane} i`)].map((mark) => { const box = mark.getBoundingClientRect(); return box.left + box.width / 2; });
      return { ex: centers("ex"), pay: centers("pay"), expectedEx: ["2026-08", "2026-05", "2026-02"].filter((month) => months.includes(month)).map(x).sort((a, b) => a - b),
        expectedPay: ["2026-09", "2026-06", "2026-03"].filter((month) => months.includes(month)).map(x).sort((a, b) => a - b) };
    });
    expect(marks.ex.length).toBe(marks.expectedEx.length);
    marks.ex.sort((a, b) => a - b).forEach((center, index) => expect(Math.abs(center - marks.expectedEx[index])).toBeLessThan(2));
    marks.pay.sort((a, b) => a - b).forEach((center, index) => expect(Math.abs(center - marks.expectedPay[index])).toBeLessThan(2));

    // Under the chart: the latest month first. Its report is not out yet, so the previous one is shown and named.
    const visible = dialog.locator(".etf-month-panel:not([hidden])");
    await expect(visible).toHaveCount(1);
    await expect(visible.locator("h3")).toContainText("2026 年 10 月");
    await expect(visible.locator(".etf-month-events")).toHaveText("這個月沒有除息或發息。");
    await expect(visible.locator("h4")).toHaveText("成分股 前 5 大 · 2026 年 09 月月報");
    await expect(visible.locator(".etf-note")).toContainText("這個月的月報尚未公布");
    await expect(visible.locator(".etf-holding-list li")).toHaveCount(5);
    await expect(visible.locator(".etf-holding-weight").first()).toHaveText("9.65%");
    await expect(visible.locator("button.etf-holding-name")).toHaveCount(4);
    await expect(visible.locator("span.etf-holding-name")).toHaveCount(1);

    // Choosing August on the chart shows August's ex-dividend day and August's own report.
    await chooseMonth(page, "2026-08");
    await expect(chart.locator(".entry-chart-selected-date")).toHaveText("2026/08");
    await expect(visible).toHaveCount(1);
    await expect(visible.locator("h3")).toContainText("2026 年 08 月");
    await expect(visible.locator(".etf-month-events")).toHaveText("08/18 除息 0.420 元");
    await expect(visible.locator("h4")).toHaveText("成分股 前 5 大 · 2026 年 08 月月報");
    await expect(visible.locator(".etf-note")).not.toContainText("尚未公布");
    await expect(visible.locator(".etf-holding-weight").first()).not.toHaveText("9.65%");
    await chooseMonth(page, "2026-09");
    await expect(visible.locator(".etf-month-events")).toHaveText("09/11 發息 0.420 元");
    const bars = await visible.locator(".etf-holding-bar").evaluateAll((nodes) => nodes.map((node) => parseFloat(node.style.getPropertyValue("--share"))));
    expect(Math.max(...bars)).toBe(100);

    await expect(dialog.locator(".etf-dividend-history tbody tr")).toHaveCount(5);
    const fund = dialog.locator(".etf-fund");
    await expect(fund.locator(".etf-facts dt")).toHaveText(["追蹤指數", "基金類型", "發行公司", "上市日期", "基金規模", "受益人數"]);
    await expect(fund.locator(".etf-fund-block").first().locator("dt")).toHaveText(["市價", "預估淨值", "溢價"]);
    // Technicals and flows are secondary: folded until asked for.
    const technical = dialog.locator(".etf-technical");
    await expect(technical.locator(".etf-tiles").first()).toBeHidden();
    await technical.locator("summary").click();
    await expect(technical.locator(".etf-tiles").first().locator("dt")).toHaveText(["趨勢", "量價", "KD", "季線"]);
    await expect(technical.locator(".etf-performance dt")).toHaveText(["近 5 日", "近 20 日", "距 30 日高點", "距 30 日低點"]);
    await expect(technical.locator(".etf-flow dt")).toHaveText(["當日", "近 5 日", "近 20 日"]);
    const layout = await dialog.evaluate((node) => ({ fits: node.scrollWidth <= node.clientWidth,
      inside: [...node.querySelectorAll(".etf-tiles dd, .etf-facts dd, .etf-dividends td, .etf-month-panel:not([hidden]) li")].every((cell) => cell.scrollWidth <= cell.clientWidth + 1),
      gap: node.querySelector(".etf-dividend-card").getBoundingClientRect().top - node.querySelector(".entry-dialog-header").getBoundingClientRect().bottom,
      lanes: [...node.querySelectorAll(".etf-event-lane > div")].every((lane) => Math.abs(lane.getBoundingClientRect().left - node.querySelector(".entry-chart-plot").getBoundingClientRect().left) < 2) }));
    expect(layout.fits).toBe(true);
    expect(layout.inside).toBe(true);
    expect(layout.gap).toBeLessThan(24);
    expect(layout.lanes).toBe(true);
  });
}

test("with nothing announced, the latest distribution is shown as already past, and a discount reads in the falling colour", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openEtf(page, "0050");
  const card = page.locator("#info-dialog .etf-dividend-card");
  await expect(card.locator(".etf-frequency")).toHaveText("半年配息");
  await expect(card.locator(".etf-dividend-when")).toContainText("最近一次配息");
  await expect(card.locator(".etf-dividend-when small")).toHaveText("已除息，下次尚未公告");
  await expect(card.locator(".etf-dividend-dates dd")).toHaveText(["07/20（一）", "07/21（二）", "08/10（一）", "0.600 元"]);
  const premium = page.locator("#info-dialog .etf-fund-block").first().locator("div").nth(2);
  await expect(premium.locator("dt")).toHaveText("折價");
  await expect(premium.locator("dd")).toHaveText("-0.10%");
  await expect(premium.locator("dd")).toHaveClass(/down/);
});

test("a holding that is a listed stock opens that stock's own dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openEtf(page, "0050");
  await page.locator('#info-dialog .etf-month-panel:not([hidden]) button[data-entry-score="2330"]').click();
  await expect(page.locator("#info-dialog #dialog-heading")).toHaveText("2330 台積電");
  await expect(page.locator("#info-dialog .etf-dialog")).toHaveCount(0);
  // A stock keeps the daily chart with its three ranges.
  await expect(page.locator("#info-dialog [data-chart-range]")).toHaveText(["1 月", "3 月", "1 年"]);
});
