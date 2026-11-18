import { test, expect } from "@playwright/test";

test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "favorites"); } catch { /* about:blank */ }
}));

const openFavorites = async (page) => {
  await page.goto("/");
  await page.locator('[data-page="favorites"]').first().click();
  const kinds = page.locator(".research-kind");
  // Demo favourites hold both companies and an ETF, so the switch is offered.
  await expect(kinds).toBeVisible();
  return kinds;
};

for (const width of [320, 390]) {
  test(`on a ${width}px phone the 個股／ETF switch floats at the bottom centre over the list and still switches`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    const kinds = await openFavorites(page);
    const placed = () => kinds.evaluate((node) => {
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      // Centred on the area fixed boxes use (desktop Chrome keeps a scrollbar gutter; phones overlay theirs).
      const probe = Object.assign(document.createElement("div"), { style: "position:fixed;left:0;right:0;top:0;height:1px" });
      document.body.append(probe); const area = probe.getBoundingClientRect().width; probe.remove();
      return { position: style.position, zIndex: Number(style.zIndex), centre: Math.round(box.left + box.width / 2 - area / 2),
        gapBelow: Math.round(innerHeight - box.bottom), translucent: /rgba?\(.*,\s*0?\.\d+\)|\/ 0?\.\d+/.test(style.backgroundColor), blur: style.backdropFilter.includes("blur") };
    });
    await page.waitForTimeout(400); // the switch rises into place when the page shows
    const first = await placed();
    expect(first.position).toBe("fixed");
    expect(Math.abs(first.centre)).toBeLessThanOrEqual(1);
    expect(first.gapBelow).toBeGreaterThanOrEqual(10);
    expect(first.gapBelow).toBeLessThan(48);
    expect(first.translucent).toBe(true);
    expect(first.blur).toBe(true);
    expect(first.zIndex).toBeGreaterThan(30);
    // It stays put while the list scrolls under it, and nothing covers it.
    await page.mouse.wheel(0, 2000);
    expect((await placed()).gapBelow).toBe(first.gapBelow);
    const onTop = await kinds.evaluate((node) => { const box = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)); });
    expect(onTop).toBe(true);
    // The last card can be scrolled clear of it.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const clear = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("#research-list > *")].filter((node) => node.getClientRects().length);
      const last = cards.at(-1)?.getBoundingClientRect(), kinds = document.querySelector(".research-kind").getBoundingClientRect();
      return !last || last.bottom <= kinds.top + 1;
    });
    expect(clear).toBe(true);
    // Switching works from the floating position.
    await kinds.locator('[data-research-kind="etfs"]').click();
    await expect(kinds.locator('[data-research-kind="etfs"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#research-etfs")).toBeVisible();
    await expect(page.locator("#research-list")).toBeHidden();
    await kinds.locator('[data-research-kind="stocks"]').click();
    await expect(page.locator("#research-list")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Other pages do not show it.
    await page.locator('[data-page="market"]').first().click();
    await expect(kinds).toBeHidden();
  });
}

test("on a phone a page message shows above the floating switch", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  const kinds = await openFavorites(page);
  const kindsTop = (await kinds.boundingBox()).y;
  await page.evaluate(() => { const node = document.querySelector("#toast"); node.textContent = "測試訊息"; node.classList.add("visible"); });
  const toast = await page.locator("#toast").boundingBox();
  expect(toast.y + toast.height).toBeLessThanOrEqual(kindsTop);
});

test("on tablets and desktops the switch stays at the top of the list", async ({ page }) => {
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const kinds = await openFavorites(page);
    expect(await kinds.evaluate((node) => getComputedStyle(node).position)).not.toBe("fixed");
    const order = await kinds.evaluate((node) => node.compareDocumentPosition(document.querySelector("#research-stats")) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order).toBeTruthy();
    expect((await kinds.boundingBox()).y).toBeLessThan((await page.locator("#research-stats").boundingBox()).y);
  }
});

test("on a phone the switch can be pressed and slid to the other option, and the new list slides in", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  const kinds = await openFavorites(page);
  await expect(kinds.locator('[data-research-kind="stocks"]')).toHaveAttribute("aria-pressed", "true");
  // Far down the list first: switching brings the new list back to its top.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const from = await kinds.locator('[data-research-kind="stocks"]').boundingBox();
  const to = await kinds.locator('[data-research-kind="etfs"]').boundingBox();
  const y = from.y + from.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x + from.width / 2, y, id: 1 }] });
  const startLeft = await kinds.evaluate((node) => parseFloat(node.style.getPropertyValue("--segment-left")));
  const mid = from.x + from.width / 2 + (to.x - from.x) / 2;
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: mid, y, id: 1 }] });
  // The capsule follows the finger while it is held, before anything is chosen.
  await expect(kinds).toHaveClass(/is-dragging/);
  expect(await kinds.evaluate((node) => parseFloat(node.style.getPropertyValue("--segment-left")))).toBeGreaterThan(startLeft + 10);
  await expect(kinds.locator('[data-research-kind="stocks"]')).toHaveAttribute("aria-pressed", "true");
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: to.x + to.width / 2, y, id: 1 }] });
  await expect(kinds.locator('[data-research-kind="etfs"]')).toHaveClass(/is-under-finger/);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(kinds).not.toHaveClass(/is-dragging/);
  await expect(kinds.locator('[data-research-kind="etfs"]')).toHaveAttribute("aria-pressed", "true");
  const etfs = page.locator("#research-etfs");
  await expect(etfs).toBeVisible();
  await expect(etfs).toHaveClass(/research-kind-enter-right/);
  await expect(etfs).not.toHaveClass(/research-kind-enter-right/, { timeout: 2000 });
  await expect.poll(() => page.evaluate(() => document.querySelector(".research-center").getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
  // A slide that ends back on the chosen option changes nothing.
  const back = await kinds.locator('[data-research-kind="etfs"]').boundingBox();
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: back.x + back.width / 2, y, id: 2 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: back.x + back.width / 2 - 12, y, id: 2 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(kinds.locator('[data-research-kind="etfs"]')).toHaveAttribute("aria-pressed", "true");
  // A tap still switches, and the companies slide in from the left.
  await kinds.locator('[data-research-kind="stocks"]').click();
  await expect(page.locator("#research-list")).toBeVisible();
  await expect(page.locator("#research-list")).toHaveClass(/research-kind-enter-left/);
});

test("reduced effects switch without the slide", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  const kinds = await openFavorites(page);
  await kinds.locator('[data-research-kind="etfs"]').click();
  await expect(page.locator("#research-etfs")).toBeVisible();
  await expect(page.locator("#research-etfs")).not.toHaveClass(/research-kind-enter/);
});
