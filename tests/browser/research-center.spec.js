import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

test("research center preserves favorites and opens existing score detail", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="favorites"]').first().click();
  await expect(page.locator("#page-title")).toContainText("自選");
  await expect(page.locator("#page-description")).toContainText("進場研究");
  await expect(page.locator(".date-control")).toBeHidden();
  await expect(page.locator("#watchlist h2")).toHaveCount(0);
  await expect(page.locator("#legacy-watchlist")).toBeHidden();
  await expect(page.locator("#research-stats")).toContainText("自選股票");
  await expect(page.locator("#research-stats .research-stat-label")).toHaveText(["自選股票", "明日進場候選", "今日候選失效"]);
  await expect(page.locator("#research-stats .research-stat strong").first()).toContainText("檔");
  await expect(page.locator("#research-list table")).toBeVisible();
  // The list shows entry research, not the V1.2 score; v4 has no readiness score, so the second
  // column names the gate result and the list leads with next-day candidates.
  await expect(page.locator("#research-list thead th")).toHaveText(["股票", "初步門檻", "股價", "進場研究"]);
  await expect(page.locator("#research-sort")).toHaveValue("nextDay");
  await expect(page.locator('#research-sort option[value="readiness"]')).toHaveCount(0);
  const gates = await page.locator("#research-list .research-card .research-score-button .research-gate").allTextContents();
  expect(gates.length).toBeGreaterThan(0);
  expect(gates.every((value) => value === "通過" || value === "待確認" || /^(—|\S+( 等 \d+ 項)?)$/.test(value))).toBe(true);
  const card = page.locator("#research-list .research-card").first();
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
  await expect(page.locator("#research-note-form")).toHaveCount(0);
  await expect(page.locator("#dialog-heading")).not.toContainText("株研評分");
});

test("research table rows open score details across the row", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="favorites"]').first().click();
  await page.locator("#research-list .research-card .research-price").first().click();
  await expect(page.locator("#info-dialog .entry-dialog")).toBeVisible();
});

test("a saved stock opens the same detail from tracking and the market list, without the retired tracking history", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="favorites"]').first().click();
  const symbol = await page.locator("#research-list .research-card").first().getAttribute("data-research-symbol");
  await page.locator(`#research-list .research-card[data-research-symbol="${symbol}"] .research-card-main`).click();
  await expect(page.locator("#info-dialog .entry-dialog")).toBeVisible();
  await expect(page.locator("#info-dialog")).not.toContainText("研究追蹤");
  await expect(page.locator(".research-detail, .research-review-detail")).toHaveCount(0);
});

test("pointer clicks do not leave a focus ring but keyboard focus remains visible", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-page="favorites"]').first().click();
  const card = page.locator("#research-list .research-card-main").first();
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
  await page.locator('[data-page="favorites"]').first().click();
  await expect(page.locator(".page-heading")).toHaveClass(/sr-only/);
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
    // No page heading: the 個股／ETF switch (when ETFs are favorited) and the figures come first; the session date sits under the list.
    const layout = await page.locator(".research-center").evaluate((node) => {
      // On phones the switch floats at the bottom of the screen, so the figures lead the page there.
      const kinds = document.querySelector(".research-kind"), floating = !kinds.hidden && getComputedStyle(kinds).position === "fixed";
      const stats = (kinds.hidden || floating ? node.querySelector("#research-stats") : kinds).getBoundingClientRect();
      const list = node.querySelector("#research-list").getBoundingClientRect();
      const date = node.querySelector("#research-date").getBoundingClientRect();
      // Filters are tabs that scroll inside their own row; the sort menu stays on screen.
      const tabs = node.querySelector(".research-filter-tabs").getBoundingClientRect();
      const sort = node.querySelector("#research-sort").getBoundingClientRect();
      return { statsTop: stats.top, listBottom: list.bottom, dateTop: date.top, dateRight: date.right, viewportWidth: window.innerWidth,
        controlsFit: tabs.left >= 0 && tabs.right <= window.innerWidth + 1 && sort.left >= 0 && sort.right <= window.innerWidth + 1 };
    });
    expect(layout.statsTop).toBeLessThan(110);
    expect(layout.dateTop).toBeGreaterThanOrEqual(layout.listBottom);
    expect(layout.dateRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.controlsFit).toBe(true);
    const bounds = await page.locator(".research-center").evaluate((node) => ({
      left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right,
      width: window.innerWidth,
    }));
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
    const scoreAlignment = await page.locator('#research-list .research-card').first().evaluate(row => {
      const table = row.closest('table');
      const textRight = node => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect().right; };
      return { header: textRight(table.querySelector('thead th:nth-child(2)')),
        score: textRight(row.querySelector('.research-score-button .research-gate')),
        scoreTop: row.querySelector('.research-score-button .research-gate').getBoundingClientRect().top,
        deltaTop: row.querySelector('.research-price strong').getBoundingClientRect().top };
    });
    // The 12px gate text lines up with the heading and the close within about 2px (different sizes).
    expect(Math.abs(scoreAlignment.header - scoreAlignment.score)).toBeLessThanOrEqual(3);
    expect(Math.abs(scoreAlignment.scoreTop - scoreAlignment.deltaTop)).toBeLessThanOrEqual(3);
    const badgeLayout = await page.locator('#research-list .research-card > th').first().evaluate(cell => {
      const heading = cell.querySelector('.research-stock-head').getBoundingClientRect();
      const badges = cell.querySelector('.research-stock-badges').getBoundingClientRect();
      const bounds = cell.getBoundingClientRect();
      return { headingBottom: heading.bottom, badgesTop: badges.top, badgesRight: badges.right, cellRight: bounds.right };
    });
    expect(badgeLayout.badgesTop).toBeGreaterThan(badgeLayout.headingBottom);
    expect(badgeLayout.badgesRight).toBeLessThanOrEqual(badgeLayout.cellRight);
  }
  await page.locator('[data-research-filter="gatePass"]').click();
  await expect(page.locator('[data-research-filter="gatePass"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-research-filter="all"]').click();
  await expect(page.locator('[data-research-filter="all"]')).toHaveAttribute("aria-pressed", "true");
  // Waiting stocks are read from 門檻通過; there is no tab for them alone.
  await expect(page.locator("[data-research-filter]")).toHaveText(["全部自選", "明日候選", "門檻通過", "訊號觸發"]);
  await page.locator("#research-list .research-card-main").first().click();
  await expect(page.locator("#info-dialog")).toBeVisible();
});

test("research tracking always compares the latest available trading day", async ({ page }) => {
  await page.goto("/");
  // The trading-day choice lives on home.
  await page.locator('[data-page="home"]').first().click();
  await page.locator("#trade-date").selectOption("2026-10-15");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-page="favorites"]').first().click();
  await expect(page.locator(".date-control")).toBeHidden();
  await expect(page.locator("#research-date")).toHaveText("交易日 2026-10-16");
  await expect(page.locator("#research-list .research-card").first()).not.toContainText("評分交易日");
});

test("reloading the phone keeps the selected main page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator('[data-page="favorites"]').first().click();
  await page.reload();
  await expect(page.locator("#page-title")).toContainText("自選");
  await page.locator('[data-page="market"]').first().click();
  await page.reload();
  await expect(page.locator("#page-title")).toContainText("市場觀察清單");
});

test("desktop date label and selector stay on one line", async ({ page }) => {
  await page.setViewportSize({ width: 830, height: 956 });
  await page.goto("/");
  await page.locator('[data-page="home"]').first().click();
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
  await page.locator('[data-page="favorites"]').first().click();
  const card = page.locator("#research-list .research-card").first();
  await expect(card.locator(".research-card-review")).toHaveCount(0);
  const alignment = await card.locator(".research-stock-head").evaluate((node) => {
    const code = node.querySelector(".research-code").getBoundingClientRect();
    const name = node.querySelector("strong").getBoundingClientRect();
    return { codeY: code.y, nameY: name.y, gap: name.left - code.right };
  });
  expect(Math.abs(alignment.codeY - alignment.nameY)).toBeLessThan(5);
  expect(alignment.gap).toBeGreaterThanOrEqual(0);
  await page.locator("#research-list .research-card-main").first().click();
  await expect(page.locator("#info-dialog .entry-dialog")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("favorites switch between companies and ETFs instead of listing ETFs under the companies", async ({ page }) => {
  await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem("stock-insight-v1") || "{}");
    if (!saved.etfSplitSeeded) localStorage.setItem("stock-insight-v1", JSON.stringify({ ...saved, catalogVersion: 2, etfSplitSeeded: true, favorites: ["2330", "0050", "00878"] }));
  });
  await page.goto("/");
  await page.locator('[data-page="favorites"]').first().click();
  const kinds = page.locator(".research-kind");
  await expect(kinds.locator("button")).toHaveText(["個股 1", "ETF 2"]);
  await expect(kinds.locator('[data-research-kind="stocks"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#research-list .research-card")).toHaveCount(1);
  await expect(page.locator("#research-list")).not.toContainText("ETF 不評估");
  await expect(page.locator("#research-stats .research-stat strong").first()).toHaveText("1檔");
  await expect(page.locator("#research-etfs")).toBeHidden();
  await kinds.locator('[data-research-kind="etfs"]').click();
  const etfs = page.locator("#research-etfs");
  await expect(etfs).toBeVisible();
  await expect(page.locator("#research-stats")).toBeHidden();
  await expect(page.locator(".research-controls")).toBeHidden();
  await expect(page.locator("#research-list")).toBeHidden();
  await expect(etfs.locator(".research-card")).toHaveCount(2);
  await expect(etfs.locator("thead th")).toHaveText(["ETF", "股價／今日", "收藏後"]);
  await etfs.locator('.research-card[data-research-symbol="0050"] td').first().click();
  await expect(page.locator("#info-dialog .etf-dialog")).toBeVisible();
});

test("without favorite ETFs there is no 個股／ETF switch", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("stock-insight-v1", JSON.stringify({ catalogVersion: 2, favorites: ["2330", "2317"] })));
  await page.goto("/");
  await page.locator('[data-page="favorites"]').first().click();
  await expect(page.locator("#research-list .research-card")).toHaveCount(2);
  await expect(page.locator(".research-kind")).toBeHidden();
  await expect(page.locator("#research-etfs")).toBeHidden();
});
