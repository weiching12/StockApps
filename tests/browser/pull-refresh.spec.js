import { test, expect } from '@playwright/test';

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

test.use({ viewport: { width: 390, height: 956 }, hasTouch: true });

async function drag(page, target, dx = 0, dy = 150) {
  const box = await target.boundingBox();
  const x = Math.min(page.viewportSize().width - 24, box.x + box.width / 2), y = box.y + 12;
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 10, y: y + dy * i / 10 }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.refreshCount = 0;
    window.clickCount = 0;
    window.addEventListener('stockapps:refresh', event => {
      event.preventDefault(); event.stopImmediatePropagation(); window.refreshCount++;
    }, true);
  });
  await page.goto('/');
  await expect(page.locator('#stock-rows tr[data-symbol] .stock-name').first()).toBeVisible();
  await page.evaluate(() => {
    const region = document.createElement('section');
    region.id = 'gesture-region';
    region.innerHTML = `<button id="gesture-button">按鈕區域</button><a id="gesture-link" href="#changed">連結區域</a>
      <div id="gesture-table" class="table-scroll" style="width:280px;overflow:auto"><table style="width:900px"><tr><td style="height:60px">表格區域</td></tr></table></div>
      <div id="nested-scroll" style="height:80px;overflow:auto"><div style="height:300px">可捲動區域</div></div>
      <input id="gesture-input" aria-label="測試輸入欄位">`;
    region.style.cssText = 'position:relative;z-index:30;background:white;padding:12px';
    document.querySelector('main').prepend(region);
    region.addEventListener('click', () => window.clickCount++);
    // Child handlers must not prevent page-level gesture recognition.
    region.addEventListener('touchmove', event => event.stopPropagation());
    window.scrollTo(0, 0);
  });
});

for (const selector of ['#gesture-button', '#gesture-link', '#gesture-table td', '#nested-scroll']) {
  test(`pull refresh starts on ${selector} without activating it`, async ({ page }) => {
    await drag(page, page.locator(selector));
    await expect.poll(() => page.evaluate(() => window.refreshCount)).toBe(1);
    expect(await page.evaluate(() => window.clickCount)).toBe(0);
    expect(new URL(page.url()).hash).toBe('');
  });
}

test('table horizontal scrolling and ordinary taps remain available', async ({ page }) => {
  await page.locator('#gesture-button').tap();
  expect(await page.evaluate(() => window.clickCount)).toBe(1);
  await drag(page, page.locator('#gesture-table'), -110, 15);
  expect(await page.evaluate(() => window.refreshCount)).toBe(0);
  await expect.poll(() => page.locator('#gesture-table').evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
});

test('short pulls, scrolled containers, inputs and dialogs do not refresh the page', async ({ page }) => {
  await drag(page, page.locator('#gesture-button'), 0, 45);
  expect(await page.evaluate(() => window.refreshCount)).toBe(0);
  await page.locator('#nested-scroll').evaluate(node => { node.scrollTop = 160; });
  await drag(page, page.locator('#nested-scroll'));
  await drag(page, page.locator('#gesture-input'));
  expect(await page.evaluate(() => window.refreshCount)).toBe(0);
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = '<p style="height:180px">視窗內容</p>';
    document.body.append(dialog); dialog.showModal();
  });
  await drag(page, page.locator('dialog[open]'));
  expect(await page.evaluate(() => window.refreshCount)).toBe(0);
});

test('a pull while the document is scrolled only scrolls back toward the top', async ({ page }) => {
  await page.evaluate(() => window.scrollTo(0, 300));
  await drag(page, page.locator('#stock-rows tr[data-symbol] .stock-name').first());
  expect(await page.evaluate(() => window.refreshCount)).toBe(0);
});

test('cancelling a ready pull clears it and the next pull still works', async ({ page }) => {
  const target = page.locator('#gesture-button');
  const box = await target.boundingBox();
  const client = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2, y = box.y + 12;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 150 }] });
  await expect(page.locator('#pull-refresh')).toHaveClass(/is-ready/);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(page.locator('#pull-refresh')).not.toHaveClass(/is-pulling|is-ready/);
  expect(await page.evaluate(() => window.refreshCount)).toBe(0);
  await client.detach();
  await drag(page, target);
  expect(await page.evaluate(() => window.refreshCount)).toBe(1);
});

test('the page never rubber-bands on phones, and a pull on the fitted list at its top still refreshes', async ({ page }) => {
  await page.evaluate(() => document.querySelector('#gesture-region').remove());
  expect(await page.evaluate(() => [document.documentElement, document.body].map((node) => getComputedStyle(node).overscrollBehaviorY)))
    .toEqual(['none', 'none']);
  await expect(page.locator('.stocks-panel')).toHaveClass(/is-fitted/);
  expect(await page.locator('.stocks-panel .table-scroll').evaluate((node) => node.scrollTop)).toBe(0);
  await drag(page, page.locator('#stock-rows tr[data-symbol]').first());
  await expect.poll(() => page.evaluate(() => window.refreshCount)).toBe(1);
});
