import { test, expect } from '@playwright/test';
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
  const trigger = page.locator('#stock-rows .entry-score-button').first();
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
  // The preview keeps the stock identity, price and next-day assessment; detail waits for expansion.
  await expect(page.locator('.research-plan-card')).toBeVisible();
  await expect(page.locator('.research-basic')).toBeVisible();
  await expect(page.locator('.entry-price-chart')).toBeHidden();
  await expect(page.locator('.entry-summary')).toBeHidden();
  await expect.poll(async () => {
    const bounds = await dialog.boundingBox();
    return Math.round(bounds.y + bounds.height);
  }).toBe(956);
  const previewBounds = await dialog.boundingBox();
  const cardBounds = await page.locator('.research-plan-card').boundingBox();
  expect(cardBounds.y + cardBounds.height).toBeLessThanOrEqual(previewBounds.y + previewBounds.height);
  await swipe(page, page.locator('.entry-dialog-meta'), -120);
  await expect(dialog).not.toHaveAttribute('data-mobile-sheet', 'preview');
  await expect(page.locator('.entry-summary')).toBeVisible();
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
  const trigger = page.locator('#stock-rows .entry-score-button').first();
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
  await page.locator('[data-page="sectors"]').click();
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

test('a three-day research price chart has an unfilled price line and unbroken legend labels', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { researchPriceChart } = await import('/src/ui/research-review.js');
    const dates = ['2026-10-22', '2026-10-27', '2026-10-28'];
    const element = document.createElement('div'); element.id = 'chart-preview';
    element.style.width = '280px';
    element.innerHTML = researchPriceChart({ symbol: '2031', baseline: { asOf: dates[0], close: 48.2, priceBasis: 'unadjusted' } },
      { review: { dates, bars: dates.map((date, index) => ({ date, close: [48.2, 48.8, 47.5][index] })), priceBasis: 'unadjusted',
        corporateActions: { coveredDates: dates.slice(1), events: [], revisionId: 'verified' } }, history: [] }, String);
    document.body.append(element);
  });
  await expect(page.locator('#chart-preview .price-line')).toHaveCSS('fill', 'none');
  await expect(page.locator('#chart-preview .price-line')).toHaveCSS('stroke', 'rgb(225, 153, 113)');
  expect(await page.locator('#chart-preview .research-chart-plot').getAttribute('aria-valuetext')).not.toContain('公司行動待查核');
  const wraps = await page.locator('#chart-preview .research-series-key').evaluateAll(elements => elements.map(element => {
    const range = document.createRange(); range.selectNodeContents(element); return new Set([...range.getClientRects()].map(rect => rect.top)).size;
  }));
  expect(wraps.every(lines => lines <= 2)).toBe(true);
});
