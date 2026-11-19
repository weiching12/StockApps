import { test, expect } from "@playwright/test";

test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const openMarket = async (page) => {
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await expect(page.locator('#stock-rows tr[data-symbol="2330"]')).toBeVisible();
};
const count = (page) => page.locator("#favorite-count");
/** Where the toast is drawn and whether an open dialog sits over it. */
const toastPlacement = (page) => page.evaluate(() => {
  const toast = document.querySelector("#toast"), box = toast.getBoundingClientRect();
  const dialog = document.querySelector("dialog[open]"), area = dialog?.getBoundingClientRect();
  const overlaps = area && box.left < area.right && area.left < box.right && box.top < area.bottom && area.top < box.bottom;
  return { inDialog: Boolean(dialog?.contains(toast)), overlapsDialog: Boolean(overlaps),
    insideDialog: Boolean(area && box.left >= area.left - 1 && box.right <= area.right + 1 && box.bottom <= area.bottom + 1),
    onScreen: box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && box.top >= 0,
    centre: (box.left + box.right) / 2, dialogCentre: area ? (area.left + area.right) / 2 : null };
});

test("a star in the list names the stock, and the nav count follows it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openMarket(page);
  const star = page.locator('#stock-rows tr[data-symbol="2330"] [data-favorite]');
  const before = Number(await count(page).textContent());
  const wasFavorite = await star.getAttribute("aria-pressed") === "true";
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", String(!wasFavorite));
  const toast = page.locator("#toast");
  await expect(toast).toHaveClass(/visible/);
  await expect(toast).toHaveText(`已將 2330 台積電${wasFavorite ? "移出" : "加入"}自選`);
  await expect(count(page)).toHaveText(String(before + (wasFavorite ? -1 : 1)));
  expect(await toastPlacement(page)).toMatchObject({ inDialog: false, onScreen: true });
  await star.click();
  await expect(toast).toHaveText(`已將 2330 台積電${wasFavorite ? "加入" : "移出"}自選`);
  await expect(count(page)).toHaveText(String(before));
});

for (const [width, kind, inside] of [[390, "phone sheet", true], [1280, "desktop drawer", false]]) {
  test(`the dialog's star shows its message over the ${kind}, keeps focus there and updates the list`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openMarket(page);
    await page.locator('#stock-rows tr[data-symbol="2454"] .stock-name').click();
    const dialog = page.locator("#info-dialog"), star = dialog.locator("[data-favorite]");
    await expect(star).toBeVisible();
    const row = page.locator('#stock-rows tr[data-symbol="2454"] [data-favorite]');
    const before = Number(await count(page).textContent());
    const wasFavorite = await star.getAttribute("aria-pressed") === "true";
    await star.focus();
    await page.keyboard.press("Enter");
    await expect(star).toHaveAttribute("aria-pressed", String(!wasFavorite));
    await expect(row).toHaveAttribute("aria-pressed", String(!wasFavorite));
    await expect(count(page)).toHaveText(String(before + (wasFavorite ? -1 : 1)));
    // Before: hidden behind the phone's modal sheet, and partly under the desktop drawer. The phone's modal
    // makes the page inert, so the message moves into it; the drawer is not modal, so it stays on the page above it.
    const toast = page.locator("#toast");
    await expect(toast).toHaveClass(/visible/);
    await expect(toast).toHaveText(`已將 2454 聯發科${wasFavorite ? "移出" : "加入"}自選`);
    // The drawer may still be sliding in on a busy machine, so the placement is checked until it settles.
    await expect(async () => {
      const placed = await toastPlacement(page);
      expect(placed).toMatchObject({ inDialog: inside, insideDialog: true, onScreen: true });
      expect(Math.abs(placed.centre - placed.dialogCentre)).toBeLessThan(2);
    }).toPass({ timeout: 3000 });
    if (!inside) expect(Number(await toast.evaluate((node) => getComputedStyle(node).zIndex))).toBeGreaterThan(Number(await dialog.evaluate((node) => getComputedStyle(node).zIndex)));
    await expect(toast).toBeVisible();
    // Focus does not jump to the list behind the dialog.
    await expect(star).toBeFocused();
    // Closing the dialog brings the next message back to the page.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await row.click();
    await expect(toast).toHaveText(`已將 2454 聯發科${wasFavorite ? "加入" : "移出"}自選`);
    expect(await toastPlacement(page)).toMatchObject({ inDialog: false, onScreen: true });
  });
}

test("on a phone the message stays at the bottom of the sheet after it has been scrolled", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMarket(page);
  await page.locator('#stock-rows tr[data-symbol="2454"] .stock-name').click();
  const dialog = page.locator("#info-dialog");
  await expect(dialog.locator("[data-favorite]")).toBeVisible();
  // Open the sheet fully and scroll it well down; the star stays in the sticky header.
  await dialog.evaluate((node) => { node.dataset.mobileSheet = "full"; node.scrollTop = 600; });
  await expect.poll(() => dialog.evaluate((node) => node.scrollTop)).toBeGreaterThan(100);
  await dialog.locator("[data-favorite]").click();
  await expect(page.locator("#toast")).toHaveClass(/visible/);
  const placed = await toastPlacement(page);
  expect(placed).toMatchObject({ inDialog: true, onScreen: true });
  // Scrolling while the message shows keeps it in place.
  // Let the 0.2s slide-in settle before measuring.
  await page.waitForTimeout(300);
  const before = await page.locator("#toast").boundingBox();
  await dialog.evaluate((node) => { node.scrollTop -= 200; node.dispatchEvent(new Event("scroll")); });
  await expect.poll(async () => Math.round((await page.locator("#toast").boundingBox()).y)).toBe(Math.round(before.y));
});
