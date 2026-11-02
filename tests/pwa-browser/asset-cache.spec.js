import { test, expect } from "@playwright/test";

const html = { status: 200, contentType: "text/html", body: "<!doctype html><title>fallback</title>" };

async function controlledPage(page) {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test("an HTML fallback for a script is never stored in the app shell cache", async ({ page, context }) => {
  await controlledPage(page);
  await context.route("**/assets/probe-fallback.js", (route) => route.fulfill(html));
  const result = await page.evaluate(async () => {
    const response = await fetch("/assets/probe-fallback.js");
    const cached = await caches.match("/assets/probe-fallback.js");
    return { type: response.headers.get("Content-Type"), cached: Boolean(cached) };
  });
  expect(result.type).toContain("text/html");
  expect(result.cached).toBe(false);
});

test("an HTML body already cached for a script is discarded and refetched", async ({ page, context }) => {
  await controlledPage(page);
  await context.route("**/assets/probe-poisoned.js", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "export const probe = 1;" }));
  const result = await page.evaluate(async () => {
    const shell = (await caches.keys()).find((key) => key.startsWith("stock-insight-shell-"));
    const cache = await caches.open(shell);
    await cache.put("/assets/probe-poisoned.js", new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }));
    const response = await fetch("/assets/probe-poisoned.js");
    const cached = await cache.match("/assets/probe-poisoned.js");
    return { type: response.headers.get("Content-Type"), body: await response.text(), cachedType: cached?.headers.get("Content-Type") };
  });
  expect(result.type).toContain("text/javascript");
  expect(result.body).toContain("probe");
  expect(result.cachedType).toContain("text/javascript");
});

test("a new version whose script is served as HTML does not install over the working version", async ({ page, context }) => {
  await controlledPage(page);
  const before = await page.evaluate(async () => (await caches.keys()).find((key) => key.startsWith("stock-insight-shell-")));
  await context.route(/\/assets\/index-[^/]+\.js$/, (route) => route.fulfill(html));
  const outcome = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    // Re-run install with the current script: the asset now answers with HTML.
    const installing = await navigator.serviceWorker.register(`/sw.js?probe=${Date.now()}`);
    const worker = installing.installing ?? installing.waiting ?? installing.active;
    const state = await new Promise((resolve) => {
      if (!worker || worker.state === "redundant" || worker.state === "activated") return resolve(worker?.state ?? "none");
      worker.addEventListener("statechange", () => {
        if (["redundant", "installed", "activated"].includes(worker.state)) resolve(worker.state);
      });
    });
    return { state, activeScript: registration.active?.scriptURL };
  });
  expect(outcome.state).toBe("redundant");
  expect(outcome.activeScript).not.toContain("probe=");
  const after = await page.evaluate(async () => (await caches.keys()).filter((key) => key.startsWith("stock-insight-shell-")));
  expect(after).toEqual([before]);
});
