import { test, expect } from "@playwright/test";

test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const openMarket = async (page) => {
  await page.goto("/?glass=1");
  await page.locator('[data-page="market"]').first().click();
  const tabs = page.locator(".table-toolbar > .filter-tabs");
  await expect(tabs).toBeVisible();
  return tabs;
};
/** The liquid layer's blobs against the buttons they stand for. */
const blobs = (tabs) => tabs.evaluate((group) => {
  const buttons = [...group.querySelectorAll(":scope > button")].map((button) => button.getBoundingClientRect());
  const shapes = [...group.querySelectorAll(".pill-goo-layer > i")];
  return { count: shapes.length, buttons: buttons.length,
    matched: shapes.every((shape, index) => { const box = shape.getBoundingClientRect(), button = buttons[index];
      return Math.abs(box.left - button.left) < 1.5 && Math.abs(box.width - button.width) < 1.5 && Math.abs(box.top - button.top) < 1.5; }),
    chosen: shapes.findIndex((shape) => shape.classList.contains("is-chosen")),
    pressed: [...group.querySelectorAll(":scope > button")].findIndex((button) => button.getAttribute("aria-pressed") === "true"),
    radii: shapes.map((shape) => getComputedStyle(shape).borderRadius), filter: getComputedStyle(group.querySelector(".pill-goo-layer")).filter,
    layerShown: getComputedStyle(group.querySelector(".pill-goo-layer")).display !== "none",
    buttonBackground: getComputedStyle(group.querySelector(":scope > button")).backgroundColor };
});

for (const [width, theme] of [[390, "dark"], [320, "light"], [1280, "dark"]]) {
  test(`glass filters draw their pills on a liquid layer that follows the buttons at ${width}px (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    const tabs = await openMarket(page);
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    expect(await page.evaluate(() => document.documentElement.classList.contains("glass-preview"))).toBe(true);
    const rest = await blobs(tabs);
    expect(rest).toMatchObject({ layerShown: true, matched: true });
    expect(rest.count).toBe(rest.buttons);
    expect(rest.chosen).toBe(rest.pressed);
    expect(rest.filter).toContain("pill-goo");
    expect(rest.buttonBackground).toBe("rgba(0, 0, 0, 0)");
    // Choose another filter: while the pieces move, the blobs keep following; at rest they line up again.
    await tabs.locator('[data-view="below"]').click();
    await expect(tabs.locator('[data-view="below"]')).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(150);
    expect((await blobs(tabs)).matched).toBe(true);
    await page.waitForTimeout(1000);
    const after = await blobs(tabs);
    expect(after).toMatchObject({ matched: true });
    expect(after.chosen).toBe(after.pressed);
    // Options sharing a piece are square where they meet, so a joined piece has no waist at rest.
    expect(after.radii[0]).toMatch(/^10px 0px 0px 10px$/);
    expect(after.radii[1]).toMatch(/^0px 10px 10px 0px$/);
  });
}

test("on a phone the market filters sit centred when they fit, and scroll with a fading edge when they do not", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  const tabs = await openMarket(page);
  const placement = () => tabs.evaluate((group) => {
    const buttons = [...group.querySelectorAll(":scope > button")].map((button) => button.getBoundingClientRect()), row = group.parentElement.getBoundingClientRect();
    return { offset: Math.round((buttons[0].left + buttons.at(-1).right) / 2 - (row.left + row.right) / 2), overflowing: group.classList.contains("is-overflowing"),
      mask: getComputedStyle(group).maskImage };
  });
  const fit = await placement();
  expect(fit.overflowing).toBe(false);
  expect(Math.abs(fit.offset)).toBeLessThanOrEqual(1);
  expect(fit.mask).toBe("none");
  // Squeeze the row: it scrolls from the start and fades at the edge instead.
  await tabs.evaluate((group) => { group.querySelector("button").style.minWidth = "320px"; });
  await expect.poll(async () => (await placement()).overflowing).toBe(true);
  expect((await placement()).mask).not.toBe("none");
});

test("reduced effects and the classic style keep the plain pills", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  const tabs = await openMarket(page);
  await page.evaluate(() => { document.documentElement.dataset.effects = "reduced"; });
  expect((await blobs(tabs)).layerShown).toBe(false);
  expect((await blobs(tabs)).buttonBackground).not.toBe("rgba(0, 0, 0, 0)");
  await page.evaluate(() => { delete document.documentElement.dataset.effects; document.documentElement.classList.remove("glass-preview"); });
  expect((await blobs(tabs)).layerShown).toBe(false);
});

test("the 自選 filters use the same liquid layer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.goto("/?glass=1");
  await page.locator('[data-page="favorites"]').first().click();
  const tabs = page.locator(".research-filter-tabs");
  await expect(tabs).toBeVisible();
  const state = await blobs(tabs);
  expect(state).toMatchObject({ layerShown: true, matched: true });
  expect(state.chosen).toBe(state.pressed);
});
