import { test, expect } from '@playwright/test';

// Phones reach settings through the menu; wider screens show the button directly.
async function openSettings(page) {
  const menu = page.getByRole('button', { name: '更多選單' });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole('menuitem', { name: '設定' }).click();
  } else await page.getByRole('button', { name: '設定', exact: true }).click();
}

for (const width of [320, 390, 700]) {
  test(`mobile settings provides a login entry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 956 });
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: null } }));
    await page.goto('/');
    await openSettings(page);
    const login = page.getByRole('dialog').getByRole('link', { name: '登入', exact: true });
    await expect(login).toBeVisible();
    await expect(login).toHaveAttribute('href', '/login.html');
    const bounds = await login.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await login.click();
    await expect(page).toHaveURL(/\/login\.html$/);
    await expect(page.getByLabel('帳號', { exact: true })).toBeVisible();
    await expect(page.getByLabel('密碼', { exact: true })).toBeVisible();
  });
}

test('desktop keeps its existing account entry in the top bar', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.goto('/');
  await expect(page.locator('#account-menu').getByRole('link', { name: '登入', exact: true })).toBeVisible();
  await openSettings(page);
  await expect(page.locator('.settings-account')).toBeHidden();
});

for (const account of [
  { role: 'user', mustChangePassword: false },
  { role: 'admin', mustChangePassword: false },
  { role: 'admin', mustChangePassword: true },
]) {
  test(`mobile settings reflects ${account.role} password-change=${account.mustChangePassword}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 956 });
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: {
      user: { id: 'settings-account', username: 'settings-account', ...account },
    } }));
    await page.goto('/');
    await openSettings(page);
    const menu = page.locator('#settings-account-menu');
    const logout = menu.getByRole('button', { name: '登出', exact: true });
    await expect(logout).toBeVisible();
    await expect(menu.getByRole('link', { name: '登入', exact: true })).toHaveCount(0);
    expect((await logout.boundingBox()).height).toBeGreaterThanOrEqual(44);
    const destination = account.mustChangePassword ? '設定新密碼' : account.role === 'admin' ? '管理' : null;
    if (destination) {
      const link = menu.getByRole('link', { name: destination, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', account.mustChangePassword ? '/change-password.html' : '/admin-visitors.html');
      expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
    } else await expect(menu.getByRole('link')).toHaveCount(0);
    if (account.mustChangePassword) await expect(menu.getByRole('link', { name: '管理', exact: true })).toHaveCount(0);
  });
}

test('settings logout failure stays signed in and successful retry updates both account menus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 956 });
  let user = { id: 'settings-admin', username: 'settings-admin', role: 'admin', mustChangePassword: false };
  let attempts = 0;
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user } }));
  await page.route('**/api/v1/auth/logout', route => {
    expect(route.request().method()).toBe('POST');
    if (++attempts === 1) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    user = null;
    return route.fulfill({ json: { loggedOut: true } });
  });
  await page.goto('/');
  await openSettings(page);
  const menu = page.locator('#settings-account-menu');
  await menu.getByRole('button', { name: '登出', exact: true }).click();
  const retry = menu.getByRole('button', { name: '登出失敗，重試', exact: true });
  await expect(retry).toBeEnabled();
  await expect(menu.getByRole('link', { name: '管理', exact: true })).toBeVisible();
  await expect(menu.getByRole('link', { name: '登入', exact: true })).toHaveCount(0);
  await retry.click();
  await expect(menu.getByRole('link', { name: '登入', exact: true })).toBeVisible();
  await expect(menu.getByRole('button')).toHaveCount(0);
  await expect(page.locator('#account-menu a[href="/login.html"]')).toHaveText('登入');
  await expect(page.locator('#account-menu a[href="/admin-visitors.html"]')).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('cross-tab account changes update settings without accumulating channel subscriptions', async ({ page, context }) => {
  await context.addInitScript(() => {
    const NativeChannel = window.BroadcastChannel;
    window.authChannelCount = 0;
    window.BroadcastChannel = class extends NativeChannel {
      constructor(name) { super(name); this.tracked = name === 'stock-insight-auth'; if (this.tracked) window.authChannelCount++; }
      close() { if (this.tracked) { window.authChannelCount--; this.tracked = false; } super.close(); }
    };
  });
  let user = null;
  await context.route('**/api/v1/auth/me', route => route.fulfill({ json: { user } }));
  await page.setViewportSize({ width: 390, height: 956 });
  await page.goto('/');
  const other = await context.newPage();
  await other.goto('/');
  await openSettings(page);
  await expect(page.locator('#settings-account-menu').getByRole('link', { name: '登入', exact: true })).toBeVisible();
  user = { id: 'cross-tab-admin', username: 'cross-tab-admin', role: 'admin', mustChangePassword: false };
  await other.evaluate(() => {
    const channel = new BroadcastChannel('stock-insight-auth'); channel.postMessage('changed'); channel.close();
  });
  await expect(page.locator('#settings-account-menu').getByRole('link', { name: '管理', exact: true })).toBeVisible();
  await expect(page.locator('#account-menu .account-identity')).toHaveText('cross-tab-admin');
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '關閉視窗', exact: true }).click();
    await openSettings(page);
    await expect(page.locator('#settings-account-menu').getByRole('button', { name: '登出', exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => window.authChannelCount)).toBe(1);
  user = null;
  await other.evaluate(() => {
    const channel = new BroadcastChannel('stock-insight-auth'); channel.postMessage('changed'); channel.close();
  });
  await expect(page.locator('#settings-account-menu').getByRole('link', { name: '登入', exact: true })).toBeVisible();
  await expect(page.locator('#account-menu .account-identity')).toHaveCount(0);
  await other.close();
});

for (const role of ['user', 'admin']) {
  test(`${role} uses the shared login form and reaches the correct destination`, async ({ page }) => {
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: null } }));
    let payload;
    await page.route('**/api/v1/auth/login', route => {
      expect(route.request().method()).toBe('POST');
      payload = route.request().postDataJSON();
      return route.fulfill({ json: { user: { id: 'account-test', username: 'account-test', role } } });
    });
    const destination = role === 'admin' ? '/admin-visitors.html' : '/';
    await page.route(`http://127.0.0.1:5173${destination}`, route => route.fulfill({ contentType: 'text/html', body: `<main>Signed in as ${role}</main>` }));
    await page.goto('/login.html');
    await page.getByLabel('帳號', { exact: true }).fill('account-test');
    await page.getByLabel('密碼', { exact: true }).fill('correct-test-password');
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await expect(page).toHaveURL(`http://127.0.0.1:5173${destination}`);
    expect(payload).toEqual({ username: 'account-test', password: 'correct-test-password' });
    expect(payload).not.toHaveProperty('role');
    await expect(page.getByRole('main')).toHaveText(`Signed in as ${role}`);
  });
}

test('invalid credentials leave the form available and clear the password', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.route('**/api/v1/auth/login', route => route.fulfill({ status: 401, json: { error: '帳號或密碼錯誤' } }));
  await page.goto('/login.html');
  await page.locator('#username').fill('account-test');
  await page.locator('#password').fill('wrong-test-password');
  await page.locator('#submit').click();
  await expect(page.locator('#status')).toHaveText('帳號或密碼錯誤');
  await expect(page).toHaveURL(/\/login(?:\.html)?$/);
  await expect(page.locator('#password')).toHaveValue('');
  await expect(page.locator('#submit')).toBeEnabled();
  await expect(page.locator('#visitors')).toHaveCount(0);
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('wrong-test-password')))).toBe(false);
});
