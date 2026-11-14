import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

test("entry score stays usable in the market list, detail dialog and phone scroll", async ({ page }) => {
  await page.goto("/");
  // The list shows the entry readiness score; the retired V1.2 score is shown nowhere.
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
  // Default order leads with stocks that passed the veto gates.
  await expect(rows.first().locator(".research-gate")).toHaveText("初步門檻通過");
  const firstListScore = await rows.first().locator(".entry-score-button strong").textContent();
  const firstSymbol = await rows.first().getAttribute("data-symbol");
  await rows.first().locator(".entry-score-button").click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator(".entry-dialog-meta")).toContainText(await page.locator("#trade-date").inputValue());
  await expect(page.locator(".entry-dialog-sector")).not.toBeEmpty();
  await expect(page.locator("#dialog-heading")).toHaveText(new RegExp(`^${firstSymbol} .+$`));
  await expect(page.locator("#dialog-content")).toContainText("波段順勢進場");
  await expect(page.locator(".entry-legacy, .entry-summary, .entry-condition")).toHaveCount(0);
  await expect(page.locator("#dialog-content")).not.toContainText("株研評分");
  // The dialog's readiness matches the list, and the structure component explains its inputs.
  if (firstListScore === "—") await expect(page.locator(".research-readiness .research-empty")).toBeVisible();
  else {
    await expect(page.locator(".research-readiness-score strong")).toHaveText(firstListScore);
    const help = page.locator(".research-structure-help");
    await expect(help).not.toHaveAttribute("open", "");
    await help.locator("summary").click();
    await expect(help.locator(".research-structure-formula")).toContainText(/構面強度 = （趨勢 [\d.]+ ＋ 法人 [\d.]+）÷ 2 = [\d.]+/);
    await expect(help.locator(".research-structure-checks li")).toHaveCount(4);
    await expect(help).toContainText("近五日收盤站上月線");
    await expect(help).toContainText("占比分數");
  }
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
  // The clicked day stays in place of the title after the button is released.
  await expect(chart.locator("h3")).toBeHidden();
  await expect(plot).toHaveAttribute("aria-valuenow", "1");
  await page.keyboard.press("ArrowRight");
  await expect(plot).toHaveAttribute("aria-valuenow", "2");
  await expect(chart.locator(".entry-chart-readout")).toBeVisible();
  await expect(page.locator(".entry-dialog-title [data-favorite]")).toHaveCount(1);
  await expect(page.locator("#info-dialog .dialog-top .eyebrow")).toBeHidden();
  const dialogFavorite = page.locator(".entry-dialog-title [data-favorite]");
  const wasFavorite = await dialogFavorite.getAttribute("aria-pressed");
  await dialogFavorite.click();
  await expect(dialogFavorite).toHaveAttribute("aria-pressed", wasFavorite === "true" ? "false" : "true");
  await expect(page.locator(`#stock-rows [data-favorite="${firstSymbol}"]`))
    .toHaveAttribute("aria-pressed", wasFavorite === "true" ? "false" : "true");
  await expect(page.locator(".entry-dialog-meta")).not.toContainText("未還原價格");
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
  await expect(rows.first().locator(".stock-name")).toBeVisible();
  const bounds = await page.locator(".table-scroll").evaluate((element) =>
    ({ client: element.clientWidth, content: element.scrollWidth }));
  expect(bounds.content).toBeLessThanOrEqual(bounds.client);
  await rows.first().locator(".stock-name").click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator(".entry-price-chart svg circle")).toHaveCount(30);
  const chartBounds = await page.locator(".entry-price-chart").evaluate((element) =>
    ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(chartBounds.scroll).toBeLessThanOrEqual(chartBounds.width);
  for (const width of [320, 414, 471, 510]) {
    await page.setViewportSize({ width, height: 956 });
    const layout = await page.locator(".entry-dialog").evaluate((element) => {
      const dialog = element.closest("dialog");
      const bounds = element.getBoundingClientRect(), dialogBounds = dialog.getBoundingClientRect();
      // The pinned header bleeds to the dialog edges by design; every section below stays inside.
      const sections = [...element.children].filter((child) => !child.matches(".entry-dialog-header"));
      return { left: bounds.left - dialogBounds.left, right: dialogBounds.right - bounds.right,
        overflow: Math.max(0, ...sections.map((child) => Math.round(child.getBoundingClientRect().right - bounds.right))) };
    });
    expect(layout.left).toBe(16);
    expect(layout.right).toBe(16);
    expect(layout.overflow).toBe(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".info-dialog-handle").click();
  await expect(page.locator("#info-dialog")).toBeHidden();
  await rows.last().locator(".stock-name").scrollIntoViewIfNeeded();
  // On phones only the list scrolls; the page itself stays put.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.locator(".table-scroll").evaluate((table) => table.scrollTop)).toBeGreaterThan(0);
  await rows.last().locator(".stock-name").click();
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
