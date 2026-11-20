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

// The buttons travel as the gaps open and close, but evenly: each moves one way only (no spring that
// overshoots and comes back) and keeps its width (no border or weight change on choosing), which is what
// read as the row trembling.
for (const [width, page0, group, attr, from, to] of [
  [390, "market", ".table-toolbar > .filter-tabs", "data-view", "favorites", "oversold"],
  [1280, "market", ".table-toolbar > .filter-tabs", "data-view", "all", "below"],
  [1280, "favorites", ".research-filter-tabs", "data-research-filter", "candidate", "triggered"],
]) test(`filter buttons move without trembling at ${width}px (${page0})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((value) => sessionStorage.setItem("stock-insight-current-page", value), page0);
  await page.goto("/?glass=1");
  const row = page.locator(group);
  await row.locator(`[${attr}="${from}"]`).click();
  await page.waitForTimeout(1000);
  const motion = row.evaluate((node) => new Promise((resolve) => {
    const buttons = [...node.querySelectorAll(":scope > button")], lefts = buttons.map(() => []), widths = buttons.map(() => []);
    const began = performance.now();
    const frame = () => {
      buttons.forEach((button, index) => { lefts[index].push(button.offsetLeft); widths[index].push(button.offsetWidth); });
      if (performance.now() - began < 1000) return requestAnimationFrame(frame);
      const turns = lefts.map((xs) => { let count = 0, dir = 0; for (let k = 1; k < xs.length; k++) { const d = Math.sign(xs[k] - xs[k - 1]); if (d && dir && d !== dir) count++; if (d) dir = d; } return count; });
      resolve({ moved: Math.max(...lefts.map((xs) => Math.max(...xs) - Math.min(...xs))), turns: Math.max(...turns),
        widthChange: Math.max(...widths.map((ws) => Math.max(...ws) - Math.min(...ws))) });
    };
    requestAnimationFrame(frame);
  }));
  await row.locator(`[${attr}="${to}"]`).click();
  const result = await motion;
  expect(result.moved, "the buttons travel with the opening gaps").toBeGreaterThanOrEqual(8);
  expect(result.turns, "no button comes back on itself").toBe(0);
  expect(result.widthChange, "no button changes width").toBe(0);
});
