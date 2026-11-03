import { test, expect } from '@playwright/test';

const browserId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
function report(params = new URLSearchParams(), overrides = {}) {
  const month = params.get('month') || '2026-10';
  const selectedDay = params.get('selectedDay') || null;
  const offset = Number(params.get('offset') || 0);
  const days = new Date(`${month}-01T00:00:00Z`);
  const lastDay = new Date(Date.UTC(days.getUTCFullYear(), days.getUTCMonth() + 1, 0)).getUTCDate();
  const daily = Array.from({ length: lastDay }, (_, index) => ({
    day: `${month}-${String(index + 1).padStart(2, '0')}`,
    visitors: index === 23 ? 102 : index === 24 ? 3 : index === 29 ? 2 : 0,
  }));
  const visitDay = selectedDay || `${month}-24`;
  const visit = (hour, id = browserId) => {
    const at = Date.parse(`${visitDay}T${hour}:00:00Z`);
    return { day: visitDay, id, ip: '2001:0db8:85a3:0000:0000:8a2e:0370:7334', country: 'TW',
      first_seen: at, last_seen: at, visited_at: at };
  };
  const visitors = offset ? [visit('02', 'second-page-browser')] : [visit('00'), visit('01')];
  return {
    month, months: ['2026-10', '2026-09'], today: { today: 2, asOf: '2026-10-30' },
    overall: { total: 405, firstDay: '2026-09-01', lastDay: '2026-10-30' },
    start: `${month}-01`, end: `${month}-${lastDay}`, daily, total: 107,
    detailTotal: selectedDay ? daily.find(item => item.day === selectedDay)?.visitors || 0 : 107,
    selectedDay, visitors, limit: Number(params.get('limit') || 100), offset, ...overrides,
  };
}

const pushStatus = (overrides = {}) => ({ data: { asOf: '2026-10-30', native: null, web: { total: 3, delivered: 1, rejected: 1, pending: 1,
  services: [{ service: 'apple', total: 2, delivered: 0, rejected: 1, pending: 1, lastFailure: '400 BadWebPushTopic' },
    { service: 'google', total: 1, delivered: 1, rejected: 0, pending: 0, lastFailure: null }], ...overrides } } });

async function reportRoute(page, handle = params => report(params)) {
  await page.route('**/api/v1/push/status', route => route.fulfill({ json: pushStatus() }));
  await page.route('**/api/v1/presence?**', async route => {
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ json: await handle(new URL(route.request().url()).searchParams) });
  });
}
// The page defaults to the current Taipei month; pin it to the fixture's October 2026 data.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-30T12:00:00+08:00'));
});

const dayButton = (page, date = 24, count = 102) => page.locator('#trend').getByRole('button', {
  name: new RegExp(`10月${date}日.*${count}.*次造訪`),
});

async function expectTotals(page) {
  await expect(page.locator('#today')).toHaveText('2');
  await expect(page.locator('#cumulative')).toHaveText('405');
  await expect(page.locator('#month-summary, #month-total, #month-range')).toHaveCount(0);
}

test('administrator sees visit totals and repeated visits from the same browser and can log out', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.route('**/api/v1/auth/logout', route => {
    expect(route.request().method()).toBe('POST');
    return route.fulfill({ json: { loggedOut: true } });
  });
  await reportRoute(page);
  await page.goto('/admin-visitors.html');
  await expectTotals(page);
  await expect(page.locator('#month')).toHaveValue('2026-10');
  await expect(page.locator('#selected-day-text')).toContainText('107');
  await expect(page.locator('#trend').getByRole('button')).toHaveCount(31);
  await expect(dayButton(page)).toBeVisible();
  await expect(page.locator('#visitors tr')).toHaveCount(2);
  await expect(page.locator('#visitors tr').first().locator('td').first()).toHaveText('10-24');
  await expect(page.locator('#visitors tr').first().locator('td').first()).toHaveAttribute('title', '2026-10-24');
  await expect(page.locator('.data-notes')).toHaveCount(0);
  await expect(page.getByText('資料說明', { exact: true })).toHaveCount(0);
  for (const row of await page.locator('#visitors tr').all()) await expect(row).toContainText(browserId);
  await expect(page.locator('#visitors tr').nth(0)).toContainText('08:00:00');
  await expect(page.locator('#visitors tr').nth(1)).toContainText('09:00:00');
  await expect(page.locator('#visitors')).toContainText('台灣');
  await expect(page.locator('#filters, #view, #start, #end, #daily')).toHaveCount(0);
  await page.locator('#logout').click();
  await expect(page).toHaveURL(/\/login(?:\.html)?$/);
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#visitors')).toHaveCount(0);
});

test('visitor nationality is derived from IP country and never from a legacy self-reported value', async ({ page }) => {
  const countries = ['TW', 'US', null, 'XX', 'T1'];
  const labels = ['台灣', '美國', '未知', '未知', '未知'];
  await reportRoute(page, params => report(params, { visitors: countries.map((country, index) => ({
    ...report(params).visitors[0], id: `country-fixture-${index}`, country, nationality: '舊版自行填寫值不應出現',
  })) }));
  await page.goto('/admin-visitors.html');
  const header = page.getByRole('columnheader', { name: '國籍', exact: true });
  await expect(header).toHaveCount(1);
  await expect(header).toHaveAttribute('title', /IP/);
  await expect(page.locator('#visitors tr')).toHaveCount(countries.length);
  for (let index = 0; index < labels.length; index++) {
    const cells = page.locator('#visitors tr').nth(index).locator('td');
    await expect(cells).toHaveCount(6);
    await expect(cells.nth(2)).toHaveText(labels[index]);
  }
  await expect(page.locator('body')).not.toContainText('舊版自行填寫值不應出現');
  await expect(page.getByRole('columnheader', { name: /自填|自行填寫|自述/ })).toHaveCount(0);
});

for (const width of [320, 390, 550, 1440]) {
  test(`monthly visitor analytics keeps scrolling inside its detail table at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 956 });
    await reportRoute(page);
    await page.goto('/admin-visitors.html');
    await expect(page.locator('#visitors')).toContainText('台灣');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator('#trend')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    if (width <= 550) {
      await expect.poll(() => page.locator('#trend').evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
      const chart = await page.locator('#trend').boundingBox();
      const recordedDay = await dayButton(page).boundingBox();
      expect(recordedDay.x).toBeGreaterThanOrEqual(chart.x);
      expect(recordedDay.x + recordedDay.width).toBeLessThanOrEqual(chart.x + chart.width);
      const today = await page.locator('#today').boundingBox();
      const cumulative = await page.locator('#cumulative').boundingBox();
      expect(Math.abs(today.y - cumulative.y)).toBeLessThan(2);
      expect(await page.locator('#visitors').evaluate(tbody => {
        for (let node = tbody.parentElement; node; node = node.parentElement) {
          if (['auto', 'scroll'].includes(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth)
            return node.clientWidth <= innerWidth;
        }
        return false;
      })).toBe(true);
    }
    if (width === 390 || width === 1440)
      await page.screenshot({ path: `.wrangler/visitors-redesign-${width}.png`, fullPage: true });
  });
}

test('clicking a day filters and paginates detail visits while all aggregate totals remain unchanged', async ({ page }) => {
  const queries = [];
  await reportRoute(page, params => { queries.push(Object.fromEntries(params)); return report(params); });
  await page.goto('/admin-visitors.html');
  await expectTotals(page);
  await dayButton(page).click();
  await expect(page.locator('#selected-day-text')).toContainText(/2026[-/]10[-/]24/);
  await expect(page.locator('#selected-day-text')).toContainText('102');
  expect(queries.at(-1)).toMatchObject({ month: '2026-10', selectedDay: '2026-10-24', offset: '0', limit: '10' });
  await expect(page.locator('#pagination')).toHaveText('第 1／11 頁 · 共 102 筆');
  await expect(dayButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expectTotals(page);
  await page.locator('#next').click();
  await expect(page.locator('#visitors')).toContainText('second-page-browser');
  expect(queries.at(-1)).toMatchObject({ month: '2026-10', selectedDay: '2026-10-24', offset: '10', limit: '10' });
  await expect(page.locator('#pagination')).toHaveText('第 2／11 頁 · 共 102 筆');
  await expect(page.locator('#next')).toBeEnabled();
  await expectTotals(page);
  await page.locator('#previous').click();
  await expect(page.locator('#visitors tr')).toHaveCount(2);
  await expect(page.locator('#previous')).toBeDisabled();
  await page.locator('#show-month').click();
  await expect(page.locator('#selected-day-text')).toContainText(/全月|整月/);
  expect(queries.at(-1).selectedDay || '').toBe('');
  expect(queries.at(-1).offset).toBe('0');
  await expect(dayButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expectTotals(page);
});

test('month selection loads automatically and clears the selected day and detail page', async ({ page }) => {
  const queries = [];
  await reportRoute(page, params => { queries.push(Object.fromEntries(params)); return report(params); });
  await page.goto('/admin-visitors.html');
  await dayButton(page).click();
  await expect(page.locator('#selected-day-text')).toContainText(/2026[-/]10[-/]24/);
  await page.locator('#next').click();
  await expect(page.locator('#visitors')).toContainText('second-page-browser');
  await page.locator('#month').selectOption('2026-09');
  await expect(page.locator('#month')).toHaveValue('2026-09');
  expect(queries.at(-1)).toMatchObject({ month: '2026-09', offset: '0' });
  expect(queries.at(-1).selectedDay || '').toBe('');
  await expect(page.locator('#trend').getByRole('button')).toHaveCount(30);
  await expect(page.locator('#selected-day-text')).toContainText(/全月|整月/);
  await expect(page.locator('#previous')).toBeDisabled();
  await expect(page.locator('#cumulative')).toHaveText('405');
});

for (const key of ['Enter', 'Space']) {
  test(`day selection works with ${key} and preserves keyboard focus`, async ({ page }) => {
    await reportRoute(page);
    await page.goto('/admin-visitors.html');
    const target = dayButton(page, 25, 3);
    await target.focus();
    await target.press(key);
    await expect(page.locator('#selected-day-text')).toContainText(/2026[-/]10[-/]25/);
    await expect(dayButton(page, 25, 3)).toBeFocused();
    await expect(dayButton(page, 25, 3)).toHaveAttribute('aria-pressed', 'true');
  });
}

test('empty monthly history shows zero totals and an explicit empty detail state', async ({ page }) => {
  await reportRoute(page, params => report(params, { today: { today: 0, asOf: '2026-10-30' },
    overall: { total: 0, firstDay: null, lastDay: null }, total: 0, detailTotal: 0, daily: [], visitors: [] }));
  await page.goto('/admin-visitors.html');
  await expect(page.locator('#report')).toBeVisible();
  for (const id of ['today', 'cumulative']) await expect(page.locator(`#${id}`)).toHaveText('0');
  await expect(page.locator('#month-summary, #month-total, #month-range')).toHaveCount(0);
  await expect(page.locator('#visitors')).toContainText(/無.*紀錄|尚無|沒有.*紀錄/);
  await expect(page.locator('#trend').getByRole('button', { name: /[，,]\s*[1-9]\d*\s*次造訪/ })).toHaveCount(0);
  await expect(page.locator('#previous')).toBeDisabled();
  await expect(page.locator('#next')).toBeDisabled();
});

for (const failure of ['empty-json', 'incomplete-json', 'html-server-error', 'empty-server-error']) {
  test(`visitor analytics reports ${failure} with a useful Chinese message`, async ({ page }) => {
    await page.route('**/api/v1/presence?**', route => route.fulfill({
      status: failure.endsWith('server-error') ? 500 : 200,
      contentType: failure === 'html-server-error' ? 'text/html' : 'application/json',
      body: failure === 'html-server-error' ? '<html><h1>Internal Server Error</h1></html>' : failure === 'incomplete-json' ? '{}' : '',
    }));
    await page.goto('/admin-visitors.html');
    await expect(page.locator('#status')).toContainText(/[\u4e00-\u9fff]/);
    await expect(page.locator('#status')).not.toContainText(/載入|Unexpected|JSON|SyntaxError|<html|<h1/i);
    await expect(page.locator('#visitors')).toBeEmpty();
    await expect(page.locator('#trend').getByRole('button')).toHaveCount(0);
  });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('initial and day requests use loading icons without loading text and clear them on success or failure', async ({ page }) => {
  const initial = deferred(), selected = deferred(), failed = deferred();
  await reportRoute(page, async params => {
    if (params.get('selectedDay') === '2026-10-24') await selected.promise;
    else if (params.get('selectedDay') === '2026-10-25') { await failed.promise; return {}; }
    else await initial.promise;
    return report(params);
  });
  try {
    await page.goto('/admin-visitors.html');
    await expect(page.locator('#initial-loading .loading-spinner')).toBeVisible();
    await expect(page.locator('.feedback')).toBeHidden();
    await expect(page.locator('body')).not.toContainText(/正在載入|載入中/);
    initial.resolve();
    await expectTotals(page);
    await expect(page.locator('#initial-loading')).toBeHidden();
    await dayButton(page).click();
    await expect(page.locator('#details-loading')).toBeVisible();
    await expect(page.locator('#visitor-details')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.feedback')).toBeHidden();
    await expect(page.locator('#selected-day-text')).toHaveText('2026/10/24');
    await expect(page.locator('body')).not.toContainText(/正在載入|載入中/);
    await page.screenshot({ path: '.wrangler/visitor-day-loading.png', fullPage: true });
    selected.resolve();
    await expect(page.locator('#selected-day-text')).toContainText('102');
    await expect(page.locator('#details-loading')).toBeHidden();
    await expect(page.locator('#visitor-details')).toHaveAttribute('aria-busy', 'false');
    await dayButton(page, 25, 3).click();
    await expect(page.locator('#details-loading')).toBeVisible();
    failed.resolve();
    await expect(page.locator('#status')).toContainText('統計資料回應異常');
    await expect(page.locator('#details-loading')).toBeHidden();
    await expect(page.locator('#initial-loading')).toBeHidden();
    await expect(page.locator('#visitor-details')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#retry')).toBeVisible();
  } finally { initial.resolve(); selected.resolve(); failed.resolve(); }
});

test('repeated selection while the same month request is pending is deduplicated', async ({ page }) => {
  const release = deferred(), started = deferred();
  let pendingRequests = 0;
  await page.route('**/api/v1/presence?**', async route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('month') === '2026-09') { pendingRequests++; started.resolve(); await release.promise; }
    await route.fulfill({ json: report(params) });
  });
  try {
    await page.goto('/admin-visitors.html');
    await expect(page.locator('#visitors')).toContainText('台灣');
    await page.locator('#month').selectOption('2026-09');
    await started.promise;
    await page.locator('#month').dispatchEvent('change');
    await page.locator('#month').dispatchEvent('change');
    release.resolve();
    await expect(page.locator('#month')).toHaveValue('2026-09');
    await expect(page.locator('#selected-day-text')).toContainText('107');
    expect(pendingRequests).toBe(1);
  } finally { release.resolve(); }
});

for (const selection of ['month', 'day']) {
  test(`rapid ${selection} changes keep the newest result when an earlier request finishes late`, async ({ page }) => {
    const release = deferred(), started = deferred(), finished = deferred();
    await page.route('**/api/v1/presence?**', async route => {
      const params = new URL(route.request().url()).searchParams;
      const slow = selection === 'month' ? params.get('month') === '2026-09' : params.get('selectedDay') === '2026-10-24';
      if (slow) { started.resolve(); await release.promise; }
      try { await route.fulfill({ json: report(params, { visitors: [{ ...report(params).visitors[0], id: slow ? 'outdated-result' : 'latest-result' }] }) }); }
      catch (error) { if (!slow) throw error; }
      finally { if (slow) finished.resolve(); }
    });
    try {
      await page.goto('/admin-visitors.html');
      await expect(page.locator('#visitors')).toContainText('latest-result');
      await expect(page.locator('#details-loading')).toBeHidden();
      if (selection === 'month') await page.locator('#month').selectOption('2026-09');
      else await dayButton(page).click();
      await started.promise;
      if (selection === 'month') await page.locator('#month').selectOption('2026-10');
      else await dayButton(page, 25, 3).click();
      if (selection === 'month') await expect(page.locator('#month')).toHaveValue('2026-10');
      else await expect(page.locator('#selected-day-text')).toContainText(/2026[-/]10[-/]25/);
      await expect(page.locator('#visitors')).toContainText('latest-result');
      release.resolve();
      await finished.promise;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.locator('#visitors')).toContainText('latest-result');
      await expect(page.locator('#visitors')).not.toContainText('outdated-result');
      await expect(page.locator('#details-loading')).toBeHidden();
      await expectTotals(page);
    } finally { release.resolve(); }
  });
}

test('anonymous visitor access redirects to account login', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.route('**/api/v1/presence?**', route => route.fulfill({ status: 401, json: { error: '請先登入' } }));
  await page.goto('/admin-visitors.html');
  await expect(page).toHaveURL(/\/login(?:\.html)?$/);
  await expect(page.getByLabel('帳號', { exact: true })).toBeVisible();
});

test('ordinary user cannot view visitor details or trends', async ({ page }) => {
  await page.route('**/api/v1/presence?**', route => route.fulfill({ status: 403, json: { error: '僅管理員可查看造訪紀錄' } }));
  await page.goto('/admin-visitors.html');
  await expect(page.locator('#status')).toHaveText('僅管理員可查看造訪紀錄');
  await expect(page.locator('#report')).toBeHidden();
  await expect(page.locator('#visitors')).toBeEmpty();
  await expect(page.locator('#trend')).toBeEmpty();
});

test('administrator with a temporary password must change it before viewing visitor details', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: {
    user: { id: 'temporary-admin', username: 'temporary-admin', role: 'admin', mustChangePassword: true },
  } }));
  await page.route('**/api/v1/presence?**', route => route.fulfill({ status: 403, json: {
    error: { code: 'PASSWORD_CHANGE_REQUIRED', message: '請先更新密碼' },
  } }));
  await page.goto('/admin-visitors.html');
  await expect(page).toHaveURL(/\/change-password\.html$/);
  await expect(page.locator('#change-password-form')).toBeVisible();
  await expect(page.locator('#password')).toBeEnabled();
  await expect(page.locator('#visitors')).toHaveCount(0);
});

test('push panel shows delivery counts by service and resends today\'s update', async ({ page }) => {
  let resent = 0;
  await reportRoute(page);
  await page.unroute('**/api/v1/push/status');
  await page.route('**/api/v1/push/status', route => route.fulfill({ json: resent
    ? pushStatus({ delivered: 2, pending: 0, services: [{ service: 'apple', total: 2, delivered: 1, rejected: 1, pending: 0, lastFailure: '400 BadWebPushTopic' },
      { service: 'google', total: 1, delivered: 1, rejected: 0, pending: 0, lastFailure: null }] }) : pushStatus() }));
  await page.route('**/api/v1/push/resend', route => {
    expect(route.request().method()).toBe('POST');
    resent++;
    return route.fulfill({ json: { data: { asOf: '2026-10-30', native: null, web: { sent: 1, rejected: 0, failed: 0, removed: 0, hasMore: false } } } });
  });
  await page.goto('/admin-visitors.html');
  await expect(page.locator('h1')).toHaveText('管理');
  const panel = page.locator('#push-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#push-date')).toHaveText('資料日 2026/10/30');
  await expect(panel.locator('#push-total')).toHaveText('3');
  await expect(panel.locator('#push-delivered')).toHaveText('1');
  await expect(panel.locator('#push-rejected')).toHaveText('1');
  await expect(panel.locator('#push-pending')).toHaveText('1');
  await expect(panel.locator('#push-services tr').first()).toContainText('Apple');
  await expect(panel.locator('#push-services tr').first()).toContainText('BadWebPushTopic');
  await panel.locator('#push-resend').click();
  await expect(panel.locator('#push-message')).toHaveText('已送出 1 則。');
  expect(resent).toBe(1);
  await expect(panel.locator('#push-pending')).toHaveText('0');
  await expect(panel.locator('#push-resend')).toBeDisabled();
});
