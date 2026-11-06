import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const researchPath = "/api/v1/favorites/research?symbols=2330&asOf=2026-10-28&period=9&kSmooth=3&dSmooth=3";
const summaryPath = "/api/v1/market/summary?asOf=2026-10-28&period=9&kSmooth=3&dSmooth=3";
let server, origin, currentWorker, legacyWorker, legacyCache, useLegacy, revision, requests, dataCacheControl, authUser, authRequests;

test.beforeAll(async () => {
  currentWorker = await readFile(resolve("dist/sw.js"), "utf8");
  // Reproduce the previous worker's cache-first research behavior in a real worker.
  const shellCache = JSON.parse(currentWorker.match(/const SHELL_CACHE = ("[^"]+")/)[1]);
  legacyCache = shellCache.replace("stock-insight-shell-v2-", "stock-insight-shell-");
  expect(legacyCache).not.toBe(shellCache);
  legacyWorker = `const SHELL_CACHE = ${JSON.stringify(legacyCache)};
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (new URL(event.request.url).pathname !== "/api/v1/favorites/research") return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const saved = await cache.match(event.request);
    if (saved) return saved;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});`;
  server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (path === "/api/v1/auth/me") {
      authRequests++;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ user: authUser }));
      return;
    }
    if (path === "/api/v1/favorites/research" || path === "/api/v1/market/summary") {
      requests++;
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", dataCacheControl);
      response.end(JSON.stringify({ revision }));
      return;
    }
    if (path === "/sw.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(useLegacy ? legacyWorker : currentWorker);
      return;
    }
    if (path === "/harness") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><html><head><title>Research cache regression</title></head><body>Service Worker regression</body></html>");
      return;
    }
    try {
      const root = resolve("dist"), file = resolve(root, path === "/" ? "index.html" : `.${path}`);
      if (!file.startsWith(root + sep)) throw new Error("Invalid path");
      const mime = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
      const body = await readFile(file);
      response.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream");
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(() => new Promise(resolve => server.close(resolve)));
test.beforeEach(() => {
  useLegacy = false; revision = 1; requests = 0;
  authUser = null; authRequests = 0;
  dataCacheControl = "public, max-age=0, must-revalidate";
});

async function openControlledPage(page) {
  await page.goto(`${origin}/harness`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

async function readData(page, cache = "default", path = researchPath) {
  return page.evaluate(async ({ path, cache }) => {
    const response = await fetch(path, { cache });
    return { body: await response.json(), fallback: response.headers.get("X-PWA-Cache") };
  }, { path, cache });
}

test("authentication reflects session changes and is unavailable offline instead of reusing a cached user", async ({ page, context }) => {
  await openControlledPage(page);
  const path = "/api/v1/auth/me";
  authUser = { username: "pwa-test-admin", role: "admin", mustChangePassword: true };
  expect((await readData(page, "no-store", path)).body).toEqual({ user: authUser });
  authUser = { username: "pwa-test-user", role: "user", mustChangePassword: false };
  expect((await readData(page, "no-store", path)).body).toEqual({ user: authUser });
  authUser = null;
  expect((await readData(page, "no-store", path)).body).toEqual({ user: null });
  expect(authRequests).toBe(3);
  expect(await page.evaluate(async path => {
    const names = await caches.keys();
    return Promise.all(names.map(async name => Boolean(await (await caches.open(name)).match(path))));
  }, path)).not.toContain(true);
  await context.setOffline(true);
  expect(await readData(page, "no-store", path).then(() => false, () => true)).toBe(true);
});

test("built login and password-change pages retain session guards under the active service worker", async ({ page }) => {
  await openControlledPage(page);
  await page.goto(`${origin}/login.html`);
  await expect(page.locator('#login-form')).toBeVisible();
  authUser = { username: "pwa-test-admin", role: "admin", mustChangePassword: true };
  await page.reload();
  await expect(page).toHaveURL(`${origin}/change-password.html`);
  await expect(page.locator('#change-password-form')).toBeVisible();
  await expect(page.locator('#password')).toBeEnabled();
  authUser = null;
  await page.reload();
  await expect(page).toHaveURL(`${origin}/login.html`);
  await expect(page.locator('#login-form')).toBeVisible();
});

test("research uses fresh revisions for the same URL and marks its offline data fallback", async ({ page, context }) => {
  await openControlledPage(page);
  expect(await readData(page)).toEqual({ body: { revision: 1 }, fallback: null });
  revision = 2;
  expect(await readData(page, "no-store")).toEqual({ body: { revision: 2 }, fallback: null });
  revision = 3;
  expect(await readData(page, "reload")).toEqual({ body: { revision: 3 }, fallback: null });
  await page.reload();
  revision = 4;
  expect(await readData(page, "no-store")).toEqual({ body: { revision: 4 }, fallback: null });
  expect(requests).toBe(4);
  expect(await page.evaluate(async path => {
    const names = (await caches.keys()).filter(name => name.startsWith("stock-insight-shell-"));
    return Promise.all(names.map(async name => Boolean(await (await caches.open(name)).match(path))));
  }, researchPath)).not.toContain(true);
  await context.setOffline(true);
  expect(await readData(page, "no-store")).toEqual({ body: { revision: 4 }, fallback: "fallback" });
});

for (const [name, path] of [["research", researchPath], ["summary", summaryPath]]) {
  test(`${name} keeps the prior offline revision when a 200 response prohibits storage`, async ({ page, context }) => {
    await openControlledPage(page);
    expect(await readData(page, "no-store", path)).toEqual({ body: { revision: 1 }, fallback: null });
    revision = 2;
    dataCacheControl = "private, No-Store";
    expect(await readData(page, "no-store", path)).toEqual({ body: { revision: 2 }, fallback: null });
    expect(requests).toBe(2);
    await context.setOffline(true);
    expect(await readData(page, "no-store", path)).toEqual({ body: { revision: 1 }, fallback: "fallback" });
  });
}

test("upgrading removes legacy shell research without using it as an offline fallback", async ({ page, context }) => {
  useLegacy = true;
  await openControlledPage(page);
  expect(await readData(page)).toEqual({ body: { revision: 1 }, fallback: null });
  revision = 2;
  expect(await readData(page, "no-store")).toEqual({ body: { revision: 1 }, fallback: null });
  expect(requests).toBe(1);
  expect(await page.evaluate(() => caches.keys())).toContain(legacyCache);

  useLegacy = false;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting))).toBe(true);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const changed = new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    await changed;
  });
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain(legacyCache);
  await context.setOffline(true);
  expect(await readData(page, "no-store").then(() => false, () => true)).toBe(true);
  await context.setOffline(false);
  expect(await readData(page, "no-store")).toEqual({ body: { revision: 2 }, fallback: null });
  await context.setOffline(true);
  expect(await readData(page)).toEqual({ body: { revision: 2 }, fallback: "fallback" });
});
