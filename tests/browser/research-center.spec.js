import { test, expect } from "@playwright/test";

test("research center preserves favorites and opens existing score detail", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  await expect(page.locator("#page-title")).toContainText("株研追蹤");
  await expect(page.locator("#page-description")).toContainText("進場研究");
  await expect(page.locator(".date-control")).toBeHidden();
  await expect(page.locator("#watchlist h2")).toHaveCount(0);
  await expect(page.locator("#legacy-watchlist")).toBeHidden();
  await expect(page.locator("#research-stats")).toContainText("追蹤股票");
  await expect(page.locator("#research-stats .research-stat-label")).toHaveText(["追蹤股票", "明日進場候選", "初步門檻通過"]);
  await expect(page.locator("#research-stats .research-stat strong").first()).toContainText("檔");
  await expect(page.locator("#research-list table")).toBeVisible();
  // The list shows entry research, not the V1.2 score, and leads with readiness.
  await expect(page.locator("#research-list thead th")).toHaveText(["股票", "準備度", "股價", "進場研究"]);
  await expect(page.locator("#research-sort")).toHaveValue("readiness");
  const scores = await page.locator(".research-card .research-score-button strong").allTextContents();
  const numeric = scores.map(Number).filter(Number.isFinite);
  expect(numeric).toEqual([...numeric].sort((a, b) => b - a));
  expect(scores.slice(numeric.length).every((value) => value === "—")).toBe(true);
  const card = page.locator(".research-card").first();
  await expect(card).toBeVisible();
  await expect(card.locator(".research-gate")).toBeVisible();
  // The research status sits in its own column on desktop and under the name on phones.
  await expect(card.locator(".research-chip >> visible=true").first()).toBeVisible();
  await expect(card.locator(".research-price strong")).toHaveText(/^\d+\.\d{2}$/);
  await expect(card.locator(".research-sector-badge")).not.toBeEmpty();
  await expect(card.locator(".research-sparkline")).toHaveCount(0);
  await expect(card.locator(".research-card-more")).toHaveCount(0);
  await expect(card.locator(".research-card-review")).toHaveCount(0);
  await expect(card.locator(".research-stock")).not.toContainText("評分交易日");
  await card.locator(".research-card-main").click();
  await expect(page.locator(".research-edit")).toHaveCount(0);
  await expect(page.locator(".research-detail")).toContainText("追蹤價格與評分");
  await expect(page.locator(".research-detail")).toContainText("加入時與所選日研究差異");
  await expect(page.locator(".research-detail")).not.toContainText("基礎分數");
  await expect(page.locator(".research-detail")).not.toContainText("最終分數");
  await expect(page.locator(".entry-summary")).not.toContainText("基礎分數");
  await expect(page.locator("#research-note-form")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  const same = page.locator(".research-card").first();
  await same.locator(".research-card-main").click();
  await expect(page.locator(".research-detail")).toContainText("研究追蹤");
  await expect(page.locator(".research-tracking-facts > div")).toHaveCount(2);
  await expect(page.locator(".research-tracking-facts")).toContainText("追蹤時間");
  await expect(page.locator(".research-tracking-facts")).toContainText("追蹤時評分");
  await expect(page.locator(".research-tracking-facts")).not.toContainText("最新保存快照");
  await expect(page.locator(".research-review-summary")).toHaveCount(0);
  await expect(page.locator(".research-comparison-summary")).toContainText("收盤");
  await expect(page.locator(".research-comparison-summary")).toContainText("加權總分");
  await expect(page.locator("#dialog-heading")).not.toContainText("株研評分");
});

test("research table rows open score details across the row", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  await page.locator(".research-card .research-price").first().click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator(".research-detail")).toContainText("研究追蹤");
});

test("a saved stock shows research history only when opened from research tracking", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  const symbol = await page.locator(".research-card").first().getAttribute("data-research-symbol");
  await page.getByRole("button", { name: "市場觀察清單" }).first().click();
  await page.locator(`#stock-rows tr[data-symbol="${symbol}"]`).click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator(".research-detail")).toHaveCount(0);
  await page.locator(".info-dialog-handle").click();
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  await page.locator(`.research-card[data-research-symbol="${symbol}"] .research-card-main`).click();
  await expect(page.locator(".research-detail")).toContainText("研究追蹤");
});

test("pointer clicks do not leave a focus ring but keyboard focus remains visible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  const card = page.locator(".research-card-main").first();
  await card.click();
  await page.locator(".info-dialog-handle").click();
  await expect(page.locator("#info-dialog")).toBeHidden();
  await card.focus();
  await expect(card).toBeFocused();
  expect(await card.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
  await page.keyboard.press("Tab");
  await card.focus();
  expect(await card.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
});

test.use({ viewport: { width: 390, height: 844 } });
test("phone research cards fit the viewport and remain operable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  await expect(page.locator("#page-description")).toBeVisible();
  await expect(page.locator("#research-list .research-card").first()).toBeVisible();
  await expect(page.locator('.research-mobile-detail')).toHaveCount(0);
  for (const width of [320, 390, 483]) {
    await page.setViewportSize({ width, height: 844 });
    // Summary stats stay one row, with each label on a single line and nothing clipped.
    expect(await page.locator("#research-stats").evaluate((stats) => {
      const items = [...stats.querySelectorAll(".research-stat")].map((item) => item.getBoundingClientRect());
      const labels = [...stats.querySelectorAll(".research-stat-label")];
      return stats.scrollWidth <= stats.clientWidth && items.length === 3 && items.every((item) => Math.abs(item.top - items[0].top) < 1)
        && labels.every((label) => label.scrollWidth <= label.clientWidth && label.getBoundingClientRect().height < 24);
    }), `stats at ${width}px`).toBe(true);
    const heading =await page.locator(".page-heading").evaluate((node) => {
      const title = node.querySelector("#page-title").getBoundingClientRect();
      const date = node.querySelector("#research-date").getBoundingClientRect();
      const description = node.querySelector("#page-description").getBoundingClientRect();
      return { titleRight: title.right, dateLeft: date.left, dateRight: date.right, dateBottom: date.bottom, descriptionTop: description.top, viewportWidth: window.innerWidth };
    });
    expect(heading.dateLeft).toBeGreaterThanOrEqual(heading.titleRight - 1);
    expect(heading.dateRight).toBeLessThanOrEqual(heading.viewportWidth + 1);
    expect(heading.dateBottom).toBeLessThan(heading.descriptionTop);
    const bounds = await page.locator(".research-center").evaluate((node) => ({
      left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right,
      width: window.innerWidth,
    }));
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
    const scoreAlignment = await page.locator('.research-card').first().evaluate(row => {
      const table = row.closest('table');
      const textRight = node => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect().right; };
      return { header: textRight(table.querySelector('thead th:nth-child(2)')),
        score: textRight(row.querySelector('.research-score-button strong')),
        scoreTop: row.querySelector('.research-score-button strong').getBoundingClientRect().top,
        deltaTop: row.querySelector('.research-price strong').getBoundingClientRect().top };
    });
    expect(Math.abs(scoreAlignment.header - scoreAlignment.score)).toBeLessThanOrEqual(1);
    expect(Math.abs(scoreAlignment.scoreTop - scoreAlignment.deltaTop)).toBeLessThanOrEqual(1);
    const badgeLayout = await page.locator('.research-card > th').first().evaluate(cell => {
      const heading = cell.querySelector('.research-stock-head').getBoundingClientRect();
      const badges = cell.querySelector('.research-stock-badges').getBoundingClientRect();
      const bounds = cell.getBoundingClientRect();
      return { headingBottom: heading.bottom, badgesTop: badges.top, badgesRight: badges.right, cellRight: bounds.right };
    });
    expect(badgeLayout.badgesTop).toBeGreaterThan(badgeLayout.headingBottom);
    expect(badgeLayout.badgesRight).toBeLessThanOrEqual(badgeLayout.cellRight);
  }
  await page.locator("#research-filter").selectOption("gatePass");
  await page.locator("#research-filter").selectOption("all");
  await page.locator("#research-list .research-card-main").first().click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  const facts = await page.locator(".research-tracking-facts").evaluate((node) => {
    const rows = [...node.children].map((row) => row.getBoundingClientRect());
    const bounds = node.getBoundingClientRect();
    return { width: bounds.width, scrollWidth: node.scrollWidth, singleColumn: rows.every((row, index) => index === 0 || row.top > rows[index - 1].top) };
  });
  expect(facts.scrollWidth).toBeLessThanOrEqual(facts.width + 1);
  expect(facts.singleColumn).toBe(true);
});

test("research tracking always compares the latest available trading day", async ({ page }) => {
  await page.goto("/");
  await page.locator("#trade-date").selectOption("2026-10-15");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  await expect(page.locator(".date-control")).toBeHidden();
  await expect(page.locator("#research-date")).toHaveText("交易日 2026-10-16");
  await expect(page.locator(".research-card").first()).not.toContainText("評分交易日");
});

test("reloading the phone keeps the selected main page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  await page.reload();
  await expect(page.locator("#page-title")).toContainText("株研追蹤");
  await page.getByRole("button", { name: "法人買株" }).first().click();
  await page.reload();
  await expect(page.locator("#page-title")).toContainText("法人買株");
});

test("desktop market date label and selector stay on one line", async ({ page }) => {
  await page.setViewportSize({ width: 830, height: 956 });
  await page.goto("/");
  const positions = await page.locator(".date-control").evaluate((control) => {
    const label = control.querySelector("label").getBoundingClientRect();
    const select = control.querySelector("select").getBoundingClientRect();
    return { labelY: label.y, labelRight: label.right, selectY: select.y, selectLeft: select.left };
  });
  expect(Math.abs(positions.labelY - positions.selectY)).toBeLessThan(12);
  expect(positions.labelRight).toBeLessThan(positions.selectLeft);
});

test("phone history review opens on demand and chart responds to touch and keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  const card = page.locator(".research-card").first();
  await expect(card.locator(".research-card-review")).toHaveCount(0);
  const alignment = await card.locator(".research-stock-head").evaluate((node) => {
    const code = node.querySelector(".research-code").getBoundingClientRect();
    const name = node.querySelector("strong").getBoundingClientRect();
    return { codeY: code.y, nameY: name.y, gap: name.left - code.right };
  });
  expect(Math.abs(alignment.codeY - alignment.nameY)).toBeLessThan(5);
  expect(alignment.gap).toBeGreaterThanOrEqual(0);
  await page.locator(".research-card-main").first().click();
  await expect(page.locator(".research-review-detail")).not.toContainText("基準後第 5 個交易日價格變化");
  await expect(page.locator(".research-chart-heading h4")).toHaveText("個股歷史評分");
  await expect(page.locator(".research-price-chart .research-chart-heading h5")).toHaveText("追蹤價格與評分");
  await page.getByLabel("個股歷史評分說明").click();
  await expect(page.locator(".research-chart-info").first()).toContainText("沒有可用分數的日期不列入圖表");
  const scoredDates = await page.locator(".research-score-plot").evaluate((plot) => JSON.parse(decodeURIComponent(plot.dataset.points)));
  expect(scoredDates.every((point) => Number.isFinite(point.finalScore))).toBe(true);
  await expect(page.locator(".research-chart > div:last-child > span:first-child")).toHaveText(scoredDates[0].date);
  await page.getByLabel("個股歷史評分說明").click();
  await page.getByLabel("追蹤價格與評分說明").click();
  await expect(page.locator(".research-chart-info").last()).toContainText("不代表實際投資報酬");
  await expect(page.locator(".research-chart-info").last()).toContainText("變化點數");
  await page.getByLabel("追蹤價格與評分說明").click();
  const chart = page.locator(".research-chart-plot");
  await expect(chart).toBeVisible();
  await chart.focus();
  await chart.press("ArrowLeft");
  await expect(chart).toHaveAttribute("aria-valuenow", /\d+/);
  await expect(page.locator(".research-price-chart [data-review-mode]")).toHaveCount(0);
  await expect(page.locator(".research-chart-plot .price-marker")).not.toHaveCount(0);
  const series = await chart.evaluate((plot) => JSON.parse(plot.dataset.points));
  expect(series.every((point) => Object.hasOwn(point, "close") && Object.hasOwn(point, "score"))).toBe(true);
  expect(series.every((point) => Object.hasOwn(point, "priceChange") && Object.hasOwn(point, "scoreChange"))).toBe(true);
  expect(series.some((point) => Number.isFinite(point.score))).toBe(true);
  await chart.press("Home");
  await expect(chart.locator(".research-selected-date text")).toHaveText(series[0].date.slice(5).replace("-", "/"));
  await expect(page.locator(".research-comparison-summary strong")).toHaveCount(2);
  await expect(page.locator(".research-comparison-summary strong").first()).toHaveCSS("font-weight", "700");
  await expect(page.locator(".research-comparison-summary")).toContainText(series[0].priceChange);
  expect(await chart.getAttribute("aria-valuetext")).toContain(series[0].scoreChange);
  await page.locator('[data-review-range="20"]').click();
  await expect(page.locator(".research-price-chart")).toHaveAttribute("data-range", "20");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
