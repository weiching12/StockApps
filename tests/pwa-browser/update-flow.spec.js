import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

let server, origin, version = 1;
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://localhost").pathname;
      const file = resolve("dist", path === "/" ? "index.html" : `.${path}`);
      if (!file.startsWith(resolve("dist") + "/") && !file.startsWith(resolve("dist") + "\\")) throw new Error("Invalid path");
      const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
      let body = await readFile(file);
      if (path === "/sw.js") body = Buffer.concat([body, Buffer.from(`\nself.addEventListener('message',e=>{if(e.data?.type==='TEST_VERSION')e.ports[0].postMessage(${version});});\n// release ${version}\n`)]);
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise(resolve => server.close(resolve)));

async function workerVersion(page) {
  return page.evaluate(() => new Promise(resolve => {
    if (!navigator.serviceWorker.controller) return resolve(null);
    const channel = new MessageChannel();
    channel.port1.onmessage = event => resolve(event.data);
    navigator.serviceWorker.controller.postMessage({ type: 'TEST_VERSION' }, [channel.port2]);
  })).catch(error => {
    if (/Execution context was destroyed|Cannot find context/.test(error.message)) return null;
    throw error;
  });
}
async function open(page) {
  await page.goto(origin);
  await expect(page.locator('.nav-item[data-page="market"]')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => workerVersion(page)).toBe(version);
}

test("new app version waits for its mandatory button and restores research tracking after update", async ({ page }) => {
  await open(page);
  await page.locator('[data-page="favorites"]').click();
  version++;
  await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
  const prompt = page.locator('#required-update-dialog');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('有新版本可更新');
  await expect(prompt.locator('p')).toHaveText('請更新至最新版本，完成後將自動回到原畫面。');
  for (const width of [320, 390, 487, 1440]) {
    await page.setViewportSize({ width, height: 956 });
    const bounds = await prompt.boundingBox();
    expect(Math.abs(bounds.x + bounds.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.y + bounds.height / 2 - 956 / 2)).toBeLessThanOrEqual(1);
    expect(await prompt.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await page.mouse.click(3, 3);
  await expect(prompt).toBeVisible();
  await expect(page.locator('#page-title')).toContainText('自選');
  await Promise.all([page.waitForEvent('load'), prompt.getByRole('button', { name: '更新', exact: true }).click()]);
  await expect(page.locator('#page-title')).toContainText('自選');
  await expect(prompt).toBeHidden();
  await expect.poll(() => workerVersion(page)).toBe(version);
  expect(await page.evaluate(() => sessionStorage.getItem('stock-insight-update-progress'))).toBeNull();
});

test("launch animation applies a waiting version automatically and retains the saved page", async ({ page }) => {
  await page.addInitScript(() => {
    const match = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: standalone)' ? { matches: true } : match(query);
  });
  await open(page);
  await page.locator('[data-page="favorites"]').click();
  version++;
  await page.goto(origin);
  await expect.poll(() => workerVersion(page)).toBe(version);
  await expect(page.locator('#page-title')).toContainText('自選');
  await expect(page.locator('#required-update-dialog')).toBeHidden();
});

test("another tab activating a version does not reload an already open research page", async ({ page, context }) => {
  await open(page);
  const other = await context.newPage();
  await open(other);
  await other.locator('[data-page="favorites"]').click();
  let navigations = 0;
  other.on('framenavigated', frame => { if (frame === other.mainFrame()) navigations++; });
  version++;
  await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
  await expect(page.locator('#required-update-dialog')).toBeVisible();
  await Promise.all([page.waitForEvent('load'), page.locator('#apply-app-update').click()]);
  await expect(other.locator('#required-update-dialog')).toBeVisible();
  await expect(other.locator('#page-title')).toContainText('自選');
  expect(navigations).toBe(0);
  await Promise.all([other.waitForEvent('load'), other.locator('#apply-app-update').click()]);
  await expect(other.locator('#required-update-dialog')).toBeHidden();
  await expect(other.locator('#page-title')).toContainText('自選');
});
