import { test, expect } from "@playwright/test";

// A stock picked in a sector's sheet (法人買株) opens over that sheet, on wide screens as on phones;
// the desktop side drawer is non-modal and would otherwise sit under the sheet, out of sight.
for (const width of [1280, 390]) {
  test(`a stock chosen in a sector sheet shows above the sheet at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
    await page.goto("/?glass=1");
    await page.locator('[data-market-view-choice="sectors"]').first().click();
    await page.locator("#sector-grid [data-sector-details]").first().click();
    const name = page.locator("#sector-dialog .sector-stock-name").first();
    await expect(name).toBeVisible();
    const symbol = await name.evaluate((button) => button.closest("tr").dataset.sectorStock);
    await name.click();
    const info = page.locator("#info-dialog");
    await expect(info).toHaveAttribute("data-entry-symbol", symbol);
    // After the drawer has slid in.
    await page.waitForTimeout(400);
    const topmost = await info.evaluate((dialog) => {
      const box = dialog.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(120, box.height / 2))?.closest("dialog")?.id;
    });
    expect(topmost).toBe("info-dialog");
    // Closing the stock returns to the sheet, still open.
    await page.keyboard.press("Escape");
    await expect(info).not.toHaveAttribute("open", "");
    await expect(page.locator("#sector-dialog")).toHaveAttribute("open", "");
  });
}

// Wide screens: the stock opens in the right-hand drawer like everywhere else, and the sheet steps aside to
// the left (its stock list turning to cards when it narrows); closing the stock, by its button, Escape or a
// click on the sheet, brings the sheet back to the centre at once, with the sheet still open.
for (const width of [1280, 900]) test(`a stock from a sector sheet opens on the right with the sheet aside at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 860 });
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
  await page.goto("/?glass=1");
  await page.locator('[data-market-view-choice="sectors"]').first().click();
  await page.locator("#sector-grid [data-sector-details]").first().click();
  const sheet = page.locator("#sector-dialog"), info = page.locator("#info-dialog");
  await expect(sheet.locator(".sector-stock-name").first()).toBeVisible();
  const centre = await sheet.boundingBox();
  for (const close of ["button", "escape", "sheet"]) {
    await sheet.locator(".sector-stock-name").first().click();
    await expect(info).toHaveAttribute("data-entry-drawer", "true");
    await expect(sheet).toHaveClass(/is-beside-stock/);
    await page.waitForTimeout(400);
    const placed = await page.evaluate(() => {
      const s = document.querySelector("#sector-dialog").getBoundingClientRect(), i = document.querySelector("#info-dialog").getBoundingClientRect();
      return { sheetLeft: s.left < 40, apart: s.right <= i.left + 1, drawerAtRight: Math.round(i.right) === innerWidth,
        backdrop: getComputedStyle(document.querySelector("#info-dialog"), "::backdrop").backgroundColor,
        cards: getComputedStyle(document.querySelector(".sector-stock-table")).display === "block",
        narrow: document.querySelector(".sector-stock-section").clientWidth <= 680 };
    });
    expect(placed).toMatchObject({ sheetLeft: true, apart: true, drawerAtRight: true, backdrop: "rgba(0, 0, 0, 0)" });
    // A narrow sheet lists its stocks as cards; a roomy one keeps the table.
    expect(placed.cards, `${width}px`).toBe(placed.narrow);
    if (close === "button") await info.locator("#close-dialog").click();
    if (close === "escape") await page.keyboard.press("Escape");
    if (close === "sheet") await page.mouse.click(60, 300);
    await expect(info).not.toHaveAttribute("open", "");
    await expect(sheet).toHaveAttribute("open", "");
    await expect(sheet).not.toHaveClass(/is-beside-stock/);
    await expect.poll(async () => Math.round((await sheet.boundingBox()).x), close).toBe(Math.round(centre.x));
  }
});

// With a stock open beside the sheet, the sheet still answers: its close button closes the sheet and the stock,
// and another stock in it opens in the drawer in place of the first.
test("beside an open stock, the sheet's close button closes both and its other stocks open in turn", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
  await page.goto("/?glass=1");
  await page.locator('[data-market-view-choice="sectors"]').first().click();
  // A sector with at least two stocks.
  const cards = page.locator("#sector-grid [data-sector-details]");
  const sheet = page.locator("#sector-dialog"), info = page.locator("#info-dialog");
  for (let index = 0; ; index++) {
    await cards.nth(index).click();
    await expect(sheet.locator(".sector-stock-name").first()).toBeVisible();
    if (await sheet.locator("tr[data-sector-stock]").count() > 1) break;
    await page.keyboard.press("Escape");
  }
  const symbols = await sheet.locator("tr[data-sector-stock]").evaluateAll((rows) => rows.map((row) => row.dataset.sectorStock));
  await sheet.locator(".sector-stock-name").first().click();
  await expect(info).toHaveAttribute("data-entry-symbol", symbols[0]);
  await page.waitForTimeout(400);
  // The sheet still scrolls under the open stock: wheel over it until the second stock is in view.
  const target = sheet.locator(`tr[data-sector-stock="${symbols[1]}"]`);
  await page.mouse.move(200, 400);
  for (let step = 0; step < 20 && !(await target.evaluate((row) => { const box = row.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; })); step++) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(80);
  }
  const second = await target.boundingBox();
  expect(second.y + second.height).toBeLessThanOrEqual(860);
  await page.mouse.click(second.x + 40, second.y + second.height / 2);
  await expect(info).toHaveAttribute("data-entry-symbol", symbols[1]);
  await expect(info).toHaveAttribute("open", "");
  await expect(sheet).toHaveClass(/is-beside-stock/);
  const close = await sheet.locator("#close-sector-dialog").boundingBox();
  await page.mouse.click(close.x + close.width / 2, close.y + close.height / 2);
  await expect(info).not.toHaveAttribute("open", "");
  await expect(sheet).not.toHaveAttribute("open", "");
});
