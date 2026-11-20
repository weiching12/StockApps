import { test, expect } from "@playwright/test";

// The ETF view offers its categories as chips with counts; choosing one narrows the list, and the
// market list's own filters are not affected.
for (const width of [390, 1280]) {
  test(`the ETF view filters by category at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
    await page.goto("/?glass=1");
    await page.locator('[data-market-view-choice="etf"]').first().click();
    const chips = page.locator("#etf-category-chips button");
    await expect(page.locator(".etf-category-nav")).toBeVisible();
    await expect(page.locator(".sector-nav")).toBeHidden();
    // The demo's two ETFs are both domestic: 全部 and 國內股票, each with its count; empty categories are left out.
    await expect(chips).toHaveText(["全部2", "國內股票2"]);
    await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
    const rows = page.locator("#stock-rows tr[data-symbol]");
    await expect(rows).toHaveCount(2);
    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(chips.first()).toHaveAttribute("aria-pressed", "false");
    await expect(rows).toHaveCount(2);
    // Back on the market list the sector chips return, and the ETF chips go.
    await page.locator('[data-market-view-choice="list"]').first().click();
    await expect(page.locator(".etf-category-nav")).toBeHidden();
    await expect(page.locator(".sector-nav")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

// Choosing a category animates as the market list's sector chips do: the same buttons stay (only the choice
// moves, so the colours fade and the press shrinks the chip), with the same animation and transition as them.
test("ETF category chips animate like the sector chips", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
  await page.goto("/?glass=1");
  const sector = await page.locator("#sector-chips button").nth(1).evaluate((chip) => { chip.click(); const style = getComputedStyle(chip); return { animation: style.animationName, transition: style.transitionProperty }; });
  await page.locator('[data-market-view-choice="etf"]').first().click();
  const result = await page.locator("#etf-category-chips").evaluate(async (row) => {
    const before = [...row.querySelectorAll("button")];
    before[1].click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const after = [...row.querySelectorAll("button")];
    return { sameButtons: after.length === before.length && after.every((button, index) => button === before[index]),
      pressed: after[1].getAttribute("aria-pressed"), motion: { animation: getComputedStyle(after[1]).animationName, transition: getComputedStyle(after[1]).transitionProperty } };
  });
  expect(result).toEqual({ sameButtons: true, pressed: "true", motion: sector });
  expect(sector.transition).toContain("background-color");
});
