import { test, expect } from "@playwright/test";

test("entry score stays usable in the market list, detail dialog and phone scroll", async ({ page }) => {
  await page.goto("/");
  // The list shows the entry readiness score; the V1.2 score lives in the dialog's legacy section.
  await expect(page.locator('[data-sort-heading="readiness"]')).toContainText("進場準備度");
  await expect(page.locator('[data-sort-heading="entryScore"]')).toHaveCount(0);
  const headingColors = await page.locator('[data-sort-heading="readiness"]').evaluate((heading) =>
    ({ heading: getComputedStyle(heading).color, button: getComputedStyle(heading.querySelector("button")).color }));
  expect(headingColors.button).toBe(headingColors.heading);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  const darkHeadingColors = await page.locator('[data-sort-heading="readiness"]').evaluate((heading) =>
    ({ heading: getComputedStyle(heading).color, button: getComputedStyle(heading.querySelector("button")).color }));
  expect(darkHeadingColors.button).toBe(darkHeadingColors.heading);
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  const rows = page.locator("#stock-rows tr");
  await expect(rows.first().locator(".entry-score-button")).toBeVisible();
  const scoreColor = await rows.first().locator(".entry-score-button strong").evaluate((element) => getComputedStyle(element).color);
  await rows.first().locator(".entry-score-button").hover();
  expect(await rows.first().locator(".entry-score-button strong").evaluate((element) => getComputedStyle(element).color))
    .toBe(scoreColor);
  await expect(rows.first().locator(".entry-score-button strong")).toHaveText(/^(\d+|—)$/);
  await expect(rows.first().locator(".research-gate")).toContainText(/門檻 \d\/5/);
  const firstListScore = await rows.first().locator(".entry-score-button strong").textContent();
  const firstSymbol = await rows.first().getAttribute("data-symbol");
  await rows.first().locator(".entry-score-button").click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator(".entry-summary-date")).toHaveAttribute("datetime", await page.locator("#trade-date").inputValue());
  await expect(page.locator(".entry-summary-date")).toHaveCSS("font-size", "11px");
  await expect(page.locator(".entry-dialog-sector")).not.toBeEmpty();
  await expect(page.locator("#dialog-heading")).toHaveText(new RegExp(`^${firstSymbol} .+$`));
  await expect(page.locator("#dialog-content")).toContainText("波段順勢進場");
  await expect(page.locator("#dialog-content")).toContainText("進場位置與風險");
  await expect(page.locator(".entry-summary-reason")).toHaveCount(0);
  // The dialog's readiness matches the list, and the V1.2 score is labelled as the old composite.
  if (firstListScore === "—") await expect(page.locator(".research-readiness .research-empty")).toBeVisible();
  else await expect(page.locator(".research-readiness-score strong")).toHaveText(firstListScore);
  await expect(page.locator(".entry-legacy > h3")).toContainText("舊版株研評分 V1.2");
  await expect(page.locator(".entry-summary-head strong")).toHaveAttribute("data-score-target", /\d/);
  await expect(page.locator(".entry-summary-facts")).toHaveCount(0);
  const chart = page.locator(".entry-price-chart");
  const plot = chart.locator(".entry-chart-plot");
  await expect(chart.locator("h3")).toBeVisible();
  await expect(chart.locator(".entry-chart-readout")).toBeHidden();
  await expect(chart.locator(".entry-chart-points circle")).toHaveCount(30);
  await expect(chart.locator(".entry-chart-bars rect")).toHaveCount(30);
  const chartPoints = JSON.parse(await plot.getAttribute("data-points"));
  const barClasses = await chart.locator(".entry-chart-bars rect").evaluateAll((bars) =>
    bars.map((bar) => bar.getAttribute("class")));
  chartPoints.forEach((point, index) => {
    const tone = point.changePercent > 0 ? "up" : point.changePercent < 0 ? "down" : "flat";
    expect(barClasses[index]).toContain(tone);
  });
  await expect(chart.locator(".entry-chart-ma")).toHaveAttribute("d", /[ML]/);
  await expect(chart.locator(".entry-chart-ma20")).toHaveAttribute("d", /[ML]/);
  await expect(chart.locator(".entry-chart-legend")).toContainText("月線 MA20");
  await expect(chart.locator(".entry-chart-k, .entry-chart-d")).toHaveCount(0);
  await expect(chart.locator(".entry-chart-scale")).toContainText("高");
  const closePrices = chartPoints.map((point) => point.close).filter((close) => Number.isFinite(close) && close > 0);
  await expect(chart.locator(".entry-chart-scale span").first()).toContainText(Math.max(...closePrices).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  await expect(chart.locator(".entry-chart-scale span").last()).toContainText(Math.min(...closePrices).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const chartLayout = await chart.evaluate((element) => {
    const labels = [...element.querySelectorAll(".entry-chart-scale span")];
    const region = element.querySelector(".entry-chart-price-region");
    const scale = element.querySelector(".entry-chart-scale");
    const plot = element.querySelector(".entry-chart-plot");
    const circles = [...plot.querySelectorAll(".entry-chart-points circle")];
    const prices = JSON.parse(plot.dataset.points).map((point) => point.close);
    const lowIndex = prices.indexOf(Math.min(...prices.filter((price) => Number.isFinite(price) && price > 0)));
    const circle = circles.find((point) => Number(point.dataset.index) === lowIndex);
    const lowCenter = labels[1].getBoundingClientRect().top + labels[1].getBoundingClientRect().height / 2;
    const lowPointY = plot.getBoundingClientRect().top + Number(circle.getAttribute("cy")) / 210 * plot.getBoundingClientRect().height;
    return { border: getComputedStyle(element).borderTopWidth, lowOffset: Math.abs(lowCenter - lowPointY), scaleWidth: scale.getBoundingClientRect().width, plotRatio: plot.getBoundingClientRect().width / region.getBoundingClientRect().width };
  });
  expect(chartLayout.border).toBe("0px");
  expect(chartLayout.lowOffset).toBeLessThan(12);
  expect(chartLayout.scaleWidth).toBeLessThanOrEqual(44);
  expect(chartLayout.plotRatio).toBeGreaterThan(0.84);
  for (const [series, selector] of [["close", ".entry-chart-close"], ["ma20", ".entry-chart-ma20"],
    ["ma60", ".entry-chart-ma"], ["volume", ".entry-chart-bars"]]) {
    const legend = chart.locator(`[data-chart-series="${series}"]`);
    await legend.click();
    await expect(legend).toHaveAttribute("aria-pressed", "false");
    await expect(chart.locator(selector)).toBeHidden();
    await legend.click();
    await expect(chart.locator(selector)).toBeVisible();
  }
  await expect(chart.locator(".entry-chart-range")).toHaveCount(0);
  const closes = JSON.parse(await plot.getAttribute("data-points")).map((point) => point.close)
    .filter((close) => Number.isFinite(close) && close > 0);
  const trend = closes.at(-1) > closes[0] ? "up" : closes.at(-1) < closes[0] ? "down" : "flat";
  await expect(chart).toHaveAttribute("data-trend", trend);
  const { stroke, tone } = await chart.evaluate((element) => {
    const kind = element.dataset.trend;
    const raw = getComputedStyle(document.documentElement).getPropertyValue(
      kind === "up" ? "--up" : kind === "down" ? "--down" : "--accent");
    const probe = document.createElement("span");
    probe.style.color = raw;
    element.append(probe);
    const tone = getComputedStyle(probe).color;
    probe.remove();
    return { stroke: getComputedStyle(element.querySelector("svg path")).stroke, tone };
  });
  expect(stroke).toBe(tone);
  const box = await plot.boundingBox();
  await page.mouse.click(box.x + 10, box.y + box.height / 2);
  await expect(chart.locator("h3")).toBeVisible();
  await expect(plot).toHaveAttribute("aria-valuenow", "1");
  await page.keyboard.press("ArrowRight");
  await expect(plot).toHaveAttribute("aria-valuenow", "2");
  await expect(chart.locator(".entry-chart-readout")).toBeVisible();
  await expect(page.locator(".entry-core-panel .entry-condition")).toHaveCount(5);
  await expect(page.locator(".entry-summary .entry-core-panel .entry-condition")).toHaveCount(5);
  await expect(page.locator(".entry-dialog-title [data-favorite]")).toHaveCount(1);
  await expect(page.locator("#info-dialog .dialog-top .eyebrow")).toBeHidden();
  const dialogFavorite = page.locator(".entry-dialog-title [data-favorite]");
  const wasFavorite = await dialogFavorite.getAttribute("aria-pressed");
  await dialogFavorite.click();
  await expect(dialogFavorite).toHaveAttribute("aria-pressed", wasFavorite === "true" ? "false" : "true");
  await expect(page.locator(`#stock-rows [data-favorite="${firstSymbol}"]`))
    .toHaveAttribute("aria-pressed", wasFavorite === "true" ? "false" : "true");
  await expect(page.locator(".entry-condition-icon svg")).toHaveCount(5);
  await expect(page.locator(".entry-condition-data").first()).toBeHidden();
  await expect(page.locator(".entry-condition:not([open]) .entry-category")).toHaveCount(5);
  await expect(page.locator(".entry-category").first()).toBeVisible();
  await expect(page.locator(".entry-category").last()).toBeVisible();
  await page.locator(".entry-condition summary").first().click();
  await expect(page.locator(".entry-condition-data").first()).toBeVisible();
  await page.locator(".entry-condition summary").nth(1).click();
  const kdChart = page.locator(".entry-condition-kd-chart");
  await expect(page.locator(".entry-condition").nth(1).locator(".entry-condition-data")).toHaveCount(0);
  await expect(kdChart.locator(".entry-condition-kd-values")).toHaveCount(0);
  await expect(kdChart.locator("svg .entry-kd-point-label")).toHaveCount(4);
  await expect(kdChart.locator("svg .entry-kd-point-label").first()).toContainText("K ");
  await expect(kdChart.locator("svg")).toHaveAttribute("aria-label", /判斷使用的 3 個交易日/);
  await expect(kdChart.locator(".entry-chart-dates span")).toHaveCount(3);
  await expect(kdChart.locator(".entry-chart-k")).toHaveAttribute("d", /[ML]/);
  await expect(kdChart.locator(".entry-chart-d")).toHaveAttribute("d", /[ML]/);
  await kdChart.locator('[data-chart-series="k"]').click();
  await expect(kdChart.locator(".entry-chart-k")).toBeHidden();
  await kdChart.locator('[data-chart-series="k"]').click();
  await expect(kdChart.locator(".entry-chart-k")).toBeVisible();
  await expect(page.locator(".entry-dialog-meta")).not.toContainText("未還原價格");
  await expect(page.locator(".entry-category")).toHaveCount(5);
  await expect(page.locator(".entry-categories")).toHaveCount(0);
  await expect(page.locator(".entry-condition .entry-category")).toHaveCount(5);
  await expect(page.locator(".entry-category").first().locator(".entry-category-values > span")).toContainText("權重 25% · 計入分數");
  await expect(page.locator(".entry-category").first().locator("strong")).toHaveText(/^\d+\.\d{2} 分$/);
  const excluded = page.locator(".entry-category.excluded");
  if (await excluded.count()) {
    await expect(excluded.first().locator(".entry-category-values > span")).toContainText("計入分數 0.00");
    await expect(page.locator(".entry-summary-head span")).toHaveText("核心條件不通過");
  }
  await expect(page.locator(".entry-summary .entry-core-panel > .entry-more:last-child > details")).toHaveCount(2);
  await expect(page.locator(".entry-more > details[open]")).toHaveCount(0);
  await page.locator(".entry-more > details").first().locator("summary").click();
  await expect(page.locator(".entry-more .entry-guide-item").first()).toBeVisible();
  await page.locator(".entry-metrics summary").click();
  await expect(page.locator(".entry-metrics .entry-guide-item")).toHaveCount(4);
  await page.locator("#close-dialog").click();
  await rows.first().locator(".price-cell").click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await page.locator("#close-dialog").click();
  await rows.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#info-dialog")).toBeVisible();
  await page.locator("#close-dialog").click();
  await rows.first().locator("[data-favorite]").click();
  await expect(page.locator("#info-dialog")).toBeHidden();
  await page.locator('[data-sort="readiness"]').click();
  const scores = await rows.locator(".entry-score-button strong").allTextContents();
  const numeric = scores.map((value) => Number(value)).filter(Number.isFinite);
  expect(numeric).toEqual([...numeric].sort((a, b) => b - a));
  await page.locator('[data-sort="readiness"]').click();
  const ascending = (await rows.locator(".entry-score-button strong").allTextContents()).map(Number).filter(Number.isFinite);
  expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
  // Phones show one card per stock without horizontal scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows.first().locator(".entry-score-button")).toBeVisible();
  const bounds = await page.locator(".table-scroll").evaluate((element) =>
    ({ client: element.clientWidth, content: element.scrollWidth }));
  expect(bounds.content).toBeLessThanOrEqual(bounds.client);
  await rows.first().locator(".entry-score-button").click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator(".entry-price-chart svg circle")).toHaveCount(30);
  const chartBounds = await page.locator(".entry-price-chart").evaluate((element) =>
    ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(chartBounds.scroll).toBeLessThanOrEqual(chartBounds.width);
  for (const width of [320, 414, 471, 510]) {
    await page.setViewportSize({ width, height: 956 });
    const layout = await page.locator(".entry-summary").evaluate((element) => {
      const dialog = element.closest("dialog");
      const core = element.querySelector(".entry-core-panel");
      const card = element.querySelector(".entry-category");
      const bounds = element.getBoundingClientRect();
      const dialogBounds = dialog.getBoundingClientRect();
      const coreBounds = core.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      const headBounds = element.querySelector(".entry-summary-head").getBoundingClientRect();
      const dateBounds = element.querySelector(".entry-summary-date").getBoundingClientRect();
      return {
        left: bounds.left - dialogBounds.left,
        right: dialogBounds.right - bounds.right,
        coreLeft: coreBounds.left - bounds.left,
        cardLeft: cardBounds.left - coreBounds.left,
        dateGap: headBounds.top - dateBounds.bottom,
        overflow: element.scrollWidth - element.clientWidth,
      };
    });
    expect(layout.left).toBe(16);
    expect(layout.right).toBe(16);
    expect(layout.coreLeft).toBe(13);
    expect(layout.cardLeft).toBe(8);
    expect(layout.dateGap).toBeLessThanOrEqual(2);
    expect(layout.overflow).toBe(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".info-dialog-handle").click();
  await expect(page.locator("#info-dialog")).toBeHidden();
  await rows.last().locator(".entry-score-button").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await rows.last().locator(".entry-score-button").click();
  await expect(page.locator(".entry-dialog")).toBeVisible();
  const dialogBounds = await page.locator("#info-dialog").boundingBox();
  const closeBounds = await page.locator(".info-dialog-handle").boundingBox();
  expect(dialogBounds.y).toBeGreaterThanOrEqual(0);
  expect(dialogBounds.y + dialogBounds.height).toBeLessThanOrEqual(844);
  expect(closeBounds.y).toBeGreaterThanOrEqual(dialogBounds.y);
  expect(closeBounds.y + closeBounds.height).toBeLessThanOrEqual(dialogBounds.y + dialogBounds.height);
  await page.locator(".info-dialog-handle").click();
  await expect(page.locator("#info-dialog")).toBeHidden();
});
