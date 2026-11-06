import { test, expect } from '@playwright/test';

test('desktop worktable removes nationality entry and visit registration ignores legacy stored nationality', async ({ page }) => {
  const browserId = '11111111-1111-4111-8111-111111111111';
  const legacyNationality = '舊版自填國籍不應傳送';
  await page.addInitScript(({ browserId, legacyNationality }) => {
    localStorage.setItem('stock-insight-browser-id', browserId);
    localStorage.setItem('stock-insight-nationality', legacyNationality);
  }, { browserId, legacyNationality });
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: null } }));
  const writes = [];
  await page.route('**/api/v1/presence', route => {
    if (route.request().method() === 'POST') writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { recorded: true } });
  });
  await page.setViewportSize({ width: 1440, height: 956 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /主頁面/ })).toBeVisible();
  await expect(page.getByText('訪客資料說明', { exact: true })).toHaveCount(0);
  await expect(page.locator('#visitor-nationality-form, .visitor-info')).toHaveCount(0);
  await expect(page.getByLabel(/國籍/)).toHaveCount(0);

  // The worktable is explicitly demo mode; exercise its actual production recorder
  // with an intercepted HTTP endpoint rather than sending data to any real backend.
  await page.evaluate(async () => {
    const { startPresence } = await import('/src/presence.js');
    const handle = startPresence(document.getElementById('online-count'), { demo: false });
    await handle.refresh();
    handle.stop();
  });
  expect(writes).toHaveLength(1);
  expect(writes[0].id).toBe(browserId);
  expect(writes[0].visitId).toMatch(/^[a-f0-9-]{36}$/i);
  expect(writes[0]).not.toHaveProperty('nationality');
  expect(JSON.stringify(writes)).not.toContain(legacyNationality);
});
