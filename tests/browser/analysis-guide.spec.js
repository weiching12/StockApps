import { test, expect } from "@playwright/test";

// The 初步門檻 column heading opens 株研分析說明 at its gate section, and the guide states the model's
// five vetoes with the live thresholds (home, search and favorites share the heading markup); the sidebar opens it too.
test("the gate column heading opens the analysis guide at the preliminary gate", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/");
  const link = page.locator('.table-scroll thead [data-analysis="gate"]');
  await expect(link).toHaveText("初步門檻");
  await link.click();
  const dialog = page.locator("#info-dialog");
  await expect(dialog.locator("#dialog-heading")).toHaveText("株研分析說明");
  await expect(dialog.locator("#analysis-gate h3")).toHaveText("初步門檻");
  await expect(dialog.locator(".analysis-veto dt")).toHaveText([/趨勢遭破壞/, /近期放量下跌/, /過度延伸/, /法人明顯賣壓/, /流動性不足/]);
  // Thresholds come from the current model (v4: NT$300 million average traded value).
  await expect(dialog.locator(".analysis-veto").nth(4)).toContainText("低於 3 億元即否決");
  await expect(dialog.locator("#analysis-gate")).toBeInViewport();
  await page.keyboard.press("Escape");
  // The sidebar entry opens the same guide.
  await page.locator('.sidebar .nav-item[data-dialog="analysis"]').click();
  await expect(dialog.locator("#dialog-heading")).toHaveText("株研分析說明");
});

// The 進場研究 column heading opens the guide's research section: the two signals with the live model's
// numbers, what each status in the column means, and the next-day plan.
test("the research column heading opens the guide at 進場研究", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/");
  await page.locator('.table-scroll thead [data-analysis="research"]').click();
  const dialog = page.locator("#info-dialog");
  await expect(dialog.locator("#dialog-heading")).toHaveText("株研分析說明");
  const section = dialog.locator("#analysis-research");
  await expect(section).toBeInViewport();
  await expect(section.locator("h3")).toHaveText("進場研究");
  await expect(section.locator("h4")).toHaveText(["進場訊號一：順勢回踩恢復", "進場訊號二：整理區間向上突破", "有效期間", "清單上的「進場研究」", "明日進場評估與價格計畫"]);
  // Numbers from the live model (v4): MA20 + 0.5 × ATR14, a 20-session range within 4 × ATR14, RVOL20 ≥ 1.5,
  // a signal valid on its trigger day only, an opening cap of + 0.5 × ATR14 and an 8% loss limit.
  await expect(section).toContainText("MA20 ＋ 0.5 × ATR14");
  await expect(section).toContainText("前 20 個交易日的最高價與最低價構成整理區間，振幅不超過 4 × ATR14");
  await expect(section).toContainText("RVOL20 ≥ 1.5");
  await expect(section).toContainText("只在觸發當天有效");
  await expect(section).toContainText("參考買入價 ＋ 0.5 × ATR14");
  await expect(section).toContainText("不超過 8%");
  await expect(section.locator(".signal-rules dt").first()).toHaveText("明日可進場");
});

// From the stock drawer on a wide screen the guide opens in its own panel on the left and the stock stays
// on the right, so both read side by side; Escape closes the guide alone. Phones keep one dialog with a way back.
test("from the stock drawer the guide opens on the left beside the stock", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/?glass=1");
  await page.locator('#stock-rows tr[data-symbol="2454"] .stock-name').click();
  const info = page.locator("#info-dialog"), guide = page.locator("#guide-dialog");
  await info.locator(".research-signal-how > summary").click();
  await info.locator(".research-signal-how-more button").click();
  await expect(guide).toHaveAttribute("open", "");
  await expect(guide.locator("#guide-heading")).toHaveText("株研分析說明");
  await expect(guide.locator("#analysis-research")).toBeInViewport();
  await expect(info.locator(".entry-dialog")).toBeVisible();
  const sides = await page.evaluate(() => {
    const g = document.querySelector("#guide-dialog").getBoundingClientRect(), i = document.querySelector("#info-dialog").getBoundingClientRect();
    return { apart: g.right <= i.left, leftOfStock: g.left < i.left };
  });
  expect(sides).toEqual({ apart: true, leftOfStock: true });
  // The gate note's link reuses the same panel.
  await info.locator(".research-gate-hint [data-analysis=\"gate\"]").click();
  await expect(guide.locator("#analysis-gate")).toBeInViewport();
  await guide.locator("#guide-content").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("Escape");
  await expect(guide).not.toHaveAttribute("open", "");
  await expect(info).toHaveAttribute("open", "");
  // On a phone the guide takes the dialog and leads back to the stock.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?glass=1");
  await page.locator('#stock-rows tr[data-symbol="2454"] .stock-name').click();
  await info.locator(".research-gate-hint [data-analysis=\"gate\"]").click();
  await expect(guide).not.toHaveAttribute("open", "");
  await expect(info.locator("#dialog-heading")).toHaveText("株研分析說明");
  await expect(info.locator(".analysis-back")).toContainText("2454");
});
