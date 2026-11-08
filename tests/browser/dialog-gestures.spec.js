import { test, expect } from '@playwright/test';

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));
test.use({ viewport: { width: 479, height: 956 }, hasTouch: true });

async function swipe(page, target, distance = 120) {
  const box = await target.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 6; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + distance * i / 6 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

test('phone entry pulls down to a next-day assessment preview, expands upward and closes only after a second pull', async ({ page }) => {
  await page.goto('/');
  const trigger = page.locator('#stock-rows tr[data-symbol] .stock-name').first();
  await trigger.click();
  const dialog = page.locator('#info-dialog');
  await expect(page.locator('#close-dialog')).toBeHidden();
  await expect(page.locator('#dialog-heading')).not.toContainText('株研評分');
  const favorite = await page.locator('.entry-dialog-title .favorite-button').boundingBox();
  const title = await page.locator('#dialog-heading').boundingBox();
  expect(favorite.x).toBeGreaterThan(title.x + title.width);
  await swipe(page, page.locator('.entry-dialog-meta'), 45);
  await expect(dialog).toBeVisible();
  await swipe(page, page.locator('.entry-dialog-meta'));
  await expect(dialog).toHaveAttribute('data-mobile-sheet', 'preview');
  await expect(dialog).toBeVisible();
  // The preview keeps the stock identity and its price chart; research detail waits for expansion.
  await expect(page.locator('.entry-price-chart')).toBeVisible();
  await expect(page.locator('.research-plan-card')).toBeHidden();
  await expect(page.locator('.research-gates')).toBeHidden();
  await expect.poll(async () => {
    const bounds = await dialog.boundingBox();
    return Math.round(bounds.y + bounds.height);
  }).toBe(956);
  const previewBounds = await dialog.boundingBox();
  const cardBounds = await page.locator('.entry-price-chart').boundingBox();
  expect(cardBounds.y + cardBounds.height).toBeLessThanOrEqual(previewBounds.y + previewBounds.height);
  await swipe(page, page.locator('.entry-dialog-meta'), -120);
  await expect(dialog).not.toHaveAttribute('data-mobile-sheet', 'preview');
  await expect(page.locator('.research-gates')).toBeVisible();
  await dialog.evaluate(node => { node.scrollTop = 240; });
  await page.locator('.info-dialog-handle').scrollIntoViewIfNeeded();
  await swipe(page, page.locator('.info-dialog-handle'));
  await expect(dialog).toHaveAttribute('data-mobile-sheet', 'preview');
  expect(await dialog.evaluate(node => node.scrollTop)).toBe(0);
  await page.locator('.info-dialog-handle').press('ArrowUp');
  await swipe(page, page.locator('.entry-dialog-meta'));
  await expect(dialog).toHaveAttribute('data-mobile-sheet', 'preview');
  await swipe(page, page.locator('.entry-dialog-meta'));
  await expect(dialog).toBeHidden();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('data-mobile-sheet', 'preview');
  await page.locator('.info-dialog-handle').click();
  await expect(dialog).toBeHidden();
});

test('entry preview supports keyboard controls and a full pull can close directly', async ({ page }) => {
  await page.goto('/');
  const trigger = page.locator('#stock-rows tr[data-symbol] .stock-name').first();
  const dialog = page.locator('#info-dialog');
  const handle = page.locator('.info-dialog-handle');
  await trigger.click();
  await handle.press('ArrowDown');
  await expect(dialog).toHaveAttribute('data-mobile-sheet', 'preview');
  await handle.press('ArrowUp');
  await expect(dialog).not.toHaveAttribute('data-mobile-sheet', 'preview');
  await handle.press('ArrowDown');
  await handle.press('ArrowDown');
  await expect(dialog).toBeHidden();
  await trigger.click();
  const bounds = await dialog.boundingBox();
  await swipe(page, handle, Math.max(250, bounds.height * .7));
  await expect(dialog).toBeHidden();
});

test('phone sector content supports pull-down while scrolled content stays readable', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="sectors"]').click();
  await page.locator('.sector-card').first().click();
  const dialog = page.locator('#sector-dialog');
  await expect(dialog).toBeVisible();
  await swipe(page, page.locator('#sector-dialog-heading'));
  await expect(dialog).toBeHidden();
  await page.locator('.sector-card').first().click();
  await dialog.evaluate(node => { node.scrollTop = 250; });
  const box = await dialog.boundingBox();
  await page.mouse.move(box.x + 25, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 25, box.y + 240, { steps: 6 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
});

test("the sector detail closes by pulling down on tablets too, without a close button", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="sectors"]').click();
  await page.locator("#sector-grid .sector-card").first().click();
  const dialog = page.locator("#sector-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#close-sector-dialog")).toBeHidden();
  const handle = page.locator(".sector-dialog-handle");
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 260, { steps: 8 });
  await page.mouse.up();
  await expect(dialog).toBeHidden();
});

test("desktop keeps the sector detail's close button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="sectors"]').click();
  await page.locator("#sector-grid .sector-card").first().click();
  await expect(page.locator("#close-sector-dialog")).toBeVisible();
  await expect(page.locator(".sector-dialog-handle")).toBeHidden();
});

test("a pull that starts on scrolled sector content scrolls to the top, then closes in the same gesture", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="sectors"]').click();
  await page.locator(".sector-card").first().click();
  const dialog = page.locator("#sector-dialog");
  await expect(dialog).toBeVisible();
  await dialog.evaluate((node) => { node.scrollTop = 120; });
  expect(await dialog.evaluate((node) => node.scrollTop)).toBeGreaterThan(1);
  const box = await page.locator("#sector-dialog-content").boundingBox();
  const x = box.x + box.width / 2, y = box.y + 60;
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 30; step++) {
    // Content scrolls back to the top first (as a phone does), then the finger keeps pulling.
    if (step === 8) await dialog.evaluate((node) => { node.scrollTop = 0; });
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + step * 16 }] });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
  await expect(dialog).toBeHidden();
});

test("a leftover fraction of a pixel of scroll does not block pulling the sector detail closed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="sectors"]').click();
  await page.locator(".sector-card").first().click();
  const dialog = page.locator("#sector-dialog");
  await dialog.evaluate((node) => { node.scrollTop = 0.6; });
  await swipe(page, page.locator("#sector-dialog-heading"), 300);
  await expect(dialog).toBeHidden();
});

test("an iOS bounce past the top closes the sector detail even when the touch went to native scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="sectors"]').click();
  await page.locator(".sector-card").first().click();
  const dialog = page.locator("#sector-dialog");
  await expect(dialog).toBeVisible();
  // A small bounce stays open; Chromium never reports negative offsets, so the iOS value is stubbed.
  const bounce = (offset) => dialog.evaluate((node, value) => {
    Object.defineProperty(node, "scrollTop", { configurable: true, get: () => value });
    node.dispatchEvent(new Event("scroll"));
    delete node.scrollTop;
  }, offset);
  await bounce(-30);
  await expect(dialog).toBeVisible();
  await bounce(-90);
  await expect(dialog).toBeHidden();
});
