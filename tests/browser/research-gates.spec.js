import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const openStock = async (page, symbol) => {
  await page.goto("/");
  await page.locator(`#stock-rows tr[data-symbol="${symbol}"] .stock-name`).click();
  await expect(page.locator("#info-dialog .research-gates")).toBeVisible();
};

test("a vetoed stock leads with the next-day card, then the chart and the gates, and opens its first triggered veto", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStock(page, "2317");
  const dialog = page.locator("#info-dialog");
  const order = await dialog.locator(".entry-dialog > section, .entry-dialog > p").evaluateAll((nodes) => nodes.map((node) => node.className.split(" ")[0]));
  // The data warning appears only when prices carry one; price and date are not repeated.
  expect(order.filter((name) => name !== "research-basic").slice(0, 4)).toEqual(["research-plan-card", "entry-price-chart", "research-gates", "research-not-evaluated"]);
  await expect(dialog.locator(".research-basic-price")).toHaveCount(0);
  await expect(dialog.locator(".research-readiness, .research-signal, .research-price-plan")).toHaveCount(0);
  const tiles = dialog.locator(".research-gate-tile");
  await expect(tiles).toHaveCount(5);
  await expect(tiles.locator("strong")).toHaveText(["趨勢", "放量下跌", "過度延伸", "法人賣壓", "流動性"]);
  const opened = await dialog.locator(".research-gate-choice:checked").getAttribute("value");
  await expect(dialog.locator(`.research-gate-tile[data-gate="${opened}"] small`)).toHaveText("觸發");
  const panel = dialog.locator(`.research-gate-panel[data-gate="${opened}"]`);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("計算方式");
  // References are extra detail: collapsed until asked for.
  await expect(panel.locator(".research-references")).toBeHidden();
  await panel.locator(".research-reference-details summary").click();
  await expect(panel.locator(".research-references a").first()).toHaveAttribute("target", "_blank");
  await expect(panel.locator(".research-gate-note")).toContainText("尚未以歷史資料驗證");
  await expect(dialog.locator(".research-gate-panel:visible")).toHaveCount(1);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("a passing stock keeps the research order and opens a gate panel when its icon is chosen", async ({ page }) => {
  await openStock(page, "2330");
  const dialog = page.locator("#info-dialog");
  await expect(dialog.locator(".research-gates h3 small")).toHaveText("皆未觸發");
  await expect(dialog.locator(".research-gate-panel:visible")).toHaveCount(0);
  await expect(dialog.locator(".research-readiness")).toBeVisible();
  // A price-data note, when present, sits right under the chart and is not part of the order.
  const order = (await dialog.locator(".entry-dialog > section").evaluateAll((nodes) => nodes.map((node) => node.className.split(" ")[0])))
    .filter((name) => name !== "research-basic");
  const at = (name) => order.indexOf(name);
  // The conclusion first, the chart behind it, then the detail in decision order.
  expect(at("research-plan-card")).toBe(0);
  expect([at("research-plan-card"), at("entry-price-chart"), at("research-gates"), at("research-signal"), at("research-readiness"), at("research-price-plan")])
    .toEqual([...Array(6).keys()]);
  await dialog.locator('.research-gate-tile[data-gate="liquidity"]').click();
  await expect(dialog.locator('.research-gate-panel[data-gate="liquidity"]')).toBeVisible();
  await expect(dialog.locator('.research-gate-panel[data-gate="liquidity"]')).toContainText("平均成交金額");
  // Arrow keys move between gates like any radio group.
  await dialog.locator('.research-gate-choice[value="liquidity"]').focus();
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.locator('.research-gate-panel[data-gate="institutional"]')).toBeVisible();
  await expect(dialog.locator(".research-gate-panel:visible")).toHaveCount(1);
});

test("the market list names the first triggered veto", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('#stock-rows tr[data-symbol="2317"] .research-gate')).toHaveText("過度延伸 等 2 項");
  await expect(page.locator('#stock-rows tr[data-symbol="2330"] .research-gate')).toHaveText("初步門檻通過");
});

test("signal analysis explains how signals are judged and lists both patterns with every condition", async ({ page }) => {
  await openStock(page, "2330");
  const section = page.locator("#info-dialog .research-signal");
  // The judging steps open as a numbered message from the 判定方式 button and close on an outside tap.
  const how = section.locator(".research-signal-how");
  await expect(how.locator("summary")).toHaveText("判定方式");
  await expect(how.locator("summary svg")).toBeVisible();
  await expect(how.locator("ol")).toBeHidden();
  await how.locator("summary").click();
  await expect(how.locator("ol")).toBeVisible();
  await expect(how.locator("li")).toHaveCount(6);
  await expect(how.locator("li").nth(1)).toContainText("形成條件");
  await expect(how.locator("li").nth(3)).toContainText("只在訊號日當天有效");
  await section.locator("h3").click();
  await expect(how.locator("ol")).toBeHidden();
  const setups = section.locator(".research-setup");
  await expect(setups.locator("summary strong")).toHaveText(["順勢回踩恢復", "整理區間向上突破"]);
  // An earlier signal is shown as judged on its signal day; the other pattern on today's close.
  await expect(setups.first().locator(".research-setup-state")).toContainText("觸發");
  // Both patterns start collapsed.
  expect(await setups.evaluateAll((nodes) => nodes.map((node) => node.open))).toEqual([false, false]);
  await setups.first().locator("summary").click();
  await expect(setups.first().locator(".research-setup-basis")).toHaveText("依 10/09 收盤判定");
  await expect(setups.first().locator(".research-checks li")).toHaveCount(5);
  await expect(setups.nth(1).locator(".research-checks li")).toHaveCount(4);
  await expect(setups.first().locator("h4")).toHaveText(["形成條件", "觸發條件"]);
  await expect(setups.first().locator(".research-checks li small").first()).not.toBeEmpty();
  await setups.nth(1).locator("summary").click();
});

test("the next-day explanation opens as a message from the info icon and closes on an outside tap", async ({ page }) => {
  await openStock(page, "2330");
  const card = page.locator("#info-dialog .research-plan-card");
  const message = card.locator(".research-plan-help p");
  await expect(message).toBeHidden();
  await card.locator(".research-plan-help summary").click();
  await expect(message).toBeVisible();
  await expect(message).not.toBeEmpty();
  await page.locator("#info-dialog .research-gates h3").click();
  await expect(message).toBeHidden();
});

test("the header carries the latest close and the next-day card opens the dialog without a repeated label", async ({ page }) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await openStock(page, "2330");
    const dialog = page.locator("#info-dialog");
    const card = dialog.locator(".research-plan-card");
    await expect(card.locator(".research-eyebrow")).toHaveCount(0);
    await expect(dialog.locator(".entry-dialog-quote strong")).toHaveText(/^[\d,]+\.\d{2}$/);
    await expect(dialog.locator(".entry-dialog-quote small")).toHaveText(/^[+-]?\d+\.\d{2}%$/);
    // Measured together: the desktop drawer may still be sliding in.
    const { gap, quoteInHeader, fits } = await dialog.evaluate((node) => {
      const header = node.querySelector(".entry-dialog-header").getBoundingClientRect();
      const quote = node.querySelector(".entry-dialog-quote").getBoundingClientRect();
      const top = node.querySelector(".research-plan-card").getBoundingClientRect().top;
      const chart = node.querySelector(".entry-price-chart").getBoundingClientRect().top;
      return { gap: top - header.bottom, quoteInHeader: quote.top >= header.top && quote.bottom <= header.bottom + 1 && quote.right <= header.right + 1,
        fits: node.scrollWidth <= node.clientWidth && top < chart };
    });
    expect(gap).toBeLessThan(24);
    expect(quoteInHeader).toBe(true);
    expect(fits).toBe(true);
    // The three plan prices line up on one baseline, whatever their labels wrap to.
    const tops = await card.locator(".research-buy-range dd").evaluateAll((cells) => cells.map((cell) => Math.round(cell.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBeLessThanOrEqual(1);
    // The data note is quiet text, not a coloured bar.
    for (const note of await dialog.locator(".research-warning").all()) await expect(note).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
});

test("one institution line sits right under the chart dates at the plot's width, split in three colors with the net amount beside its heading", async ({ page }) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await openStock(page, "2330");
    const bar = page.locator("#info-dialog .entry-institution-bar");
    await expect(bar.locator(".entry-institution-net")).toHaveText(/^淨買賣 [+-]?[\d,.]+ (億|萬)$/);
    await expect(bar.locator(".entry-institution-legend span")).toHaveText([/^外資 [\d,]+ 張$/, /^投信 [\d,]+ 張$/, /^自營商 [\d,]+ 張$/]);
    const layout = await bar.evaluate((element) => {
      const box = (node) => node.getBoundingClientRect();
      const track = element.querySelector(".entry-institution-track");
      const parts = [...track.children];
      const net = box(element.querySelector(".entry-institution-net")), title = box(element.querySelector(".entry-institution-head > span"));
      return { below: box(element).top - box(element.previousElementSibling).bottom, previous: element.previousElementSibling.className,
        netMiddleGap: Math.abs(net.top + net.height / 2 - (title.top + title.height / 2)), titleRight: title.right, netLeft: net.left, netRight: net.right,
        trackLeft: box(track).left, trackRight: box(track).right,
        // Measured together: the desktop drawer may still be sliding in.
        firstBarLeft: box(element.parentElement.querySelector(".entry-chart-volume")).left, plotRight: box(element.parentElement.querySelector(".entry-chart-plot")).right,
        widths: parts.map((part) => box(part).width), colors: parts.map((part) => getComputedStyle(part).backgroundColor) };
    });
    // The line spans the same width as the trend plot, from its first bar to its right edge.
    expect(Math.abs(layout.trackLeft - layout.firstBarLeft)).toBeLessThan(3);
    expect(Math.abs(layout.trackRight - layout.plotRight)).toBeLessThan(2);
    expect(layout.previous).toBe("entry-chart-dates");
    expect(layout.below).toBeLessThan(20);
    // The net amount shares the heading's line, flush with the line's right end.
    expect(layout.netMiddleGap).toBeLessThan(4);
    expect(layout.titleRight).toBeLessThanOrEqual(layout.netLeft);
    expect(Math.abs(layout.netRight - layout.trackRight)).toBeLessThan(2);
    expect(new Set(layout.colors).size).toBe(3);
    layout.widths.forEach((partWidth) => expect(partWidth).toBeGreaterThan(0));
  }
  // The line follows the day selected on the price chart, keeps it after release, and returns to the
  // latest session once something else is clicked.
  const bar = page.locator("#info-dialog .entry-institution-bar");
  const latestNet = await bar.locator(".entry-institution-net b").textContent();
  const box = await page.locator("#info-dialog .entry-chart-plot svg").boundingBox();
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  await page.mouse.down();
  await expect(bar.locator(".entry-institution-net b")).not.toHaveText(latestNet);
  await page.mouse.up();
  await expect(bar.locator(".entry-institution-net b")).not.toHaveText(latestNet);
  await page.locator("#info-dialog .entry-institution-bar").click();
  await expect(bar.locator(".entry-institution-net b")).toHaveText(latestNet);
});

test("plan levels start on the chart for a next-day candidate and toggle from the chart heading; the signal day is not marked", async ({ page }) => {
  await page.goto("/");
  // Demo data may have no next-day plan today; check whichever stock carries one.
  const symbols = await page.locator("#stock-rows tr[data-symbol]").evaluateAll((rows) => rows.map((row) => row.dataset.symbol));
  for (const symbol of symbols) {
    await page.locator(`#stock-rows tr[data-symbol="${symbol}"] .stock-name`).click();
    const chart = page.locator("#info-dialog .entry-price-chart");
    await expect(chart.locator(".entry-chart-signal")).toHaveCount(0);
    const toggle = chart.locator(".entry-chart-plan-toggle");
    if (await toggle.count()) {
      // The toggle shares the heading row, right of the title, instead of taking a row of its own.
      await expect(chart.locator(".entry-chart-default > .entry-chart-plan-toggle")).toHaveCount(1);
      const row = await chart.evaluate((node) => { const title = node.querySelector("h3").getBoundingClientRect(), button = node.querySelector(".entry-chart-plan-toggle").getBoundingClientRect();
        return { level: Math.abs(title.top + title.height / 2 - (button.top + button.height / 2)), right: button.left - title.left }; });
      expect(row.level).toBeLessThan(4);
      expect(row.right).toBeGreaterThan(0);
      // Shown from the start only when the card says the stock is a next-day candidate.
      const candidate = await page.locator("#info-dialog .research-buy-range").count() > 0;
      await expect(toggle).toHaveAttribute("aria-pressed", String(candidate));
      const labels = chart.locator(".entry-chart-plan-labels");
      const shown = async () => { await expect(labels.locator("span").first()).toBeVisible(); await expect(toggle).toHaveText("隱藏計畫價位"); };
      const hidden = async () => { await expect(labels).toBeHidden(); await expect(toggle).toHaveText("顯示計畫價位"); };
      await (candidate ? shown() : hidden());
      await toggle.click();
      await (candidate ? hidden() : shown());
      await toggle.click();
      await (candidate ? shown() : hidden());
      // Named as on the decision card.
      for (const label of await labels.locator("span").allTextContents()) expect(label).toMatch(/^(買入|最高|停損) [\d,]+\.\d{2}$/);
      return;
    }
    await page.keyboard.press("Escape");
  }
  test.skip(true, "no demo stock has a next-day plan");
});

test("only the current page's panels are visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".stocks-panel")).toBeVisible();
  for (const target of ["home", "market", "favorites", "backtest"]) {
    await page.locator(`.sidebar [data-page="${target}"]`).evaluate((button) => button.click());
    const visible = await page.locator("[data-page-panel]").evaluateAll((panels) =>
      [...new Set(panels.filter((panel) => panel.getBoundingClientRect().height > 0).map((panel) => panel.dataset.pagePanel))]);
    expect(visible, target).toEqual([target]);
  }
});
