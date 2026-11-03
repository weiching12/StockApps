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
  await expect(page.locator("#info-dialog .entry-dialog")).toBeVisible();
  await expect(page.locator(".research-detail")).toHaveCount(0);
  await expect(page.locator(".entry-summary")).not.toContainText("基礎分數");
  await expect(page.locator("#research-note-form")).toHaveCount(0);
  await expect(page.locator("#dialog-heading")).not.toContainText("株研評分");
});

test("research table rows open score details across the row", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  await page.locator(".research-card .research-price").first().click();
  await expect(page.locator("#info-dialog .entry-dialog")).toBeVisible();
});

test("a saved stock opens the same detail from tracking and the market list, without the retired tracking history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "株研追蹤" }).first().click();
  const symbol = await page.locator(".research-card").first().getAttribute("data-research-symbol");
  await page.locator(`.research-card[data-research-symbol="${symbol}"] .research-card-main`).click();
  await expect(page.locator("#info-dialog .entry-dialog")).toBeVisible();
  await expect(page.locator("#info-dialog")).not.toContainText("研究追蹤");
  await expect(page.locator(".research-detail, .research-review-detail")).toHaveCount(0);
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

test("phone tracking cards align the code and name and open the detail without overflow", async ({ page }) => {
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
  await expect(page.locator("#info-dialog .entry-dialog")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
