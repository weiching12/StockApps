import { test, expect } from "@playwright/test";

const openStock = async (page, symbol) => {
  await page.goto("/");
  await page.locator(`#stock-rows tr[data-symbol="${symbol}"] .entry-score-button`).click();
  await expect(page.locator("#info-dialog .research-gates")).toBeVisible();
};

test("a vetoed stock shows the gates right after the next-day card and opens its first triggered veto", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStock(page, "2317");
  const dialog = page.locator("#info-dialog");
  const order = await dialog.locator(".entry-dialog > section, .entry-dialog > p").evaluateAll((nodes) => nodes.map((node) => node.className.split(" ")[0]));
  // The data warning appears only when prices carry one; price and date are not repeated.
  expect(order.filter((name) => name !== "research-basic").slice(0, 4)).toEqual(["entry-price-chart", "research-gates", "research-plan-card", "research-not-evaluated"]);
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
  const order = await dialog.locator(".entry-dialog > section").evaluateAll((nodes) => nodes.map((node) => node.className.split(" ")[0]));
  expect(order.indexOf("research-gates")).toBe(order.indexOf("research-plan-card") - 1);
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
  await expect(section.locator(".research-signal-how")).toContainText("形成條件");
  await expect(section.locator(".research-signal-how")).toContainText("3 個交易日內有效");
  const setups = section.locator(".research-setup");
  await expect(setups.locator("summary strong")).toHaveText(["順勢回踩恢復", "整理區間向上突破"]);
  // An earlier signal is shown as judged on its signal day; the other pattern on today's close.
  await expect(setups.first().locator(".research-setup-state")).toContainText("觸發");
  await expect(setups.first().locator(".research-setup-basis")).toHaveText("依 10/09 收盤判定");
  await expect(setups.first().locator(".research-checks li")).toHaveCount(5);
  await expect(setups.nth(1).locator(".research-checks li")).toHaveCount(4);
  await expect(setups.first().locator("h4")).toHaveText(["形成條件", "觸發條件"]);
  await expect(setups.first().locator(".research-checks li small").first()).not.toBeEmpty();
});
