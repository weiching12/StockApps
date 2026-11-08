import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

const releaseVersion = `v${JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version}`;

// Phones reach settings through the menu; wider screens show the button directly.
async function openSettings(page) {
  const menu = page.getByRole("button", { name: "更多選單" });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole("menuitem", { name: "設定" }).click();
  } else await page.getByRole("button", { name: "設定", exact: true }).click();
}

test("manifest and install icons are served with the expected metadata", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: "株研｜台股研究室", short_name: "株研", display: "standalone", background_color: "#14243b" });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: "192x192", type: "image/png" }),
    expect.objectContaining({ sizes: "512x512", type: "image/png" }),
    expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
  ]));
  for (const icon of manifest.icons) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toBe("image/png");
  }
});

test("iPhone 13 has a native startup image matching the web splash background", async ({ page, request }) => {
  await emulateInstalledApp(page, { ios: true });
  await page.goto("/");
  const image = page.locator('link[rel="apple-touch-startup-image"][media*="device-width: 390px"]');
  await expect(image).toHaveAttribute("href", "/launch/ios-1170x2532.png");
  await expect(image).toHaveAttribute("media", /device-height: 844px/);
  const response = await request.get(await image.getAttribute("href"));
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/png");
  const png = Buffer.from(await response.body());
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1170, 2532]);
  await expect(page.locator("#app-splash")).toBeVisible();
  expect(await page.locator("#app-splash").evaluate((node) => getComputedStyle(node).backgroundColor))
    .toBe("rgb(20, 36, 59)");
  await expect(page.locator(".app-splash-brand")).toHaveCSS("animation-name", "splash-brand-in");
});

test("every iPhone startup image matches the screen its media query selects", async ({ page, request }) => {
  await page.goto("/");
  const images = await page.locator('link[rel="apple-touch-startup-image"]').evaluateAll((links) =>
    links.map((link) => ({ href: link.getAttribute("href"), media: link.getAttribute("media") })));
  for (const required of ["device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2",
    "device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3"])
    expect(images.some((image) => image.media.includes(required))).toBe(true);
  for (const { href, media } of images) {
    const [, width, height, ratio] = media.match(/device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)/);
    const response = await request.get(href);
    expect(response.headers()["content-type"]).toContain("image/png");
    const png = Buffer.from(await response.body());
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([width * ratio, height * ratio]);
  }
});

test("the canvas stays dark only while the launch animation plays", async ({ page }) => {
  const colorScheme = () => page.locator('meta[name="color-scheme"]').getAttribute("content");
  await page.goto("/");
  expect(await colorScheme()).toBe("light");
  await emulateInstalledApp(page);
  await page.goto("/");
  await expect(page.locator("#app-splash")).toBeVisible();
  expect(await colorScheme()).toBe("dark");
  await expect(page.locator("#app-splash")).toHaveCount(0, { timeout: 5_000 });
  expect(await colorScheme()).toBe("light");
  await page.reload();
  expect(await colorScheme()).toBe("light");
});

test("the launch animation paints before the stylesheet and the shell waits for it", async ({ page }) => {
  await emulateInstalledApp(page);
  let releaseStyles;
  const stylesHeld = new Promise((resolve) => { releaseStyles = resolve; });
  await page.route("**/assets/*.css", async (route) => { await stylesHeld; await route.continue(); });
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator("#app-splash")).toBeVisible();
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType("paint").length)).toBeGreaterThan(0);
  await expect(page.locator("#app-styles")).toHaveAttribute("media", "print");
  // Past the splash's own minimum, the shell must still hold for the missing stylesheet.
  await expect(page.locator("#app-splash")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator(".sidebar")).toHaveCount(0);
  releaseStyles();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator("#app-styles")).toHaveAttribute("media", "all");
  expect(await page.locator(".sidebar").evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(20, 36, 59)");
});

test("loading holds the navy navigation's place before the shell renders", async ({ page }) => {
  await page.route("**/assets/*.js", (route) => route.abort());
  const placeholder = () => page.locator("#app > .initial-load").evaluate((node) => {
    const style = getComputedStyle(node, "::before");
    return { background: style.backgroundColor, width: style.width, height: style.height };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  expect(await placeholder()).toMatchObject({ background: "rgb(20, 36, 59)", width: "214px", height: "800px" });
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await placeholder();
  expect(phone).toMatchObject({ background: "rgb(20, 36, 59)", height: "64px" });
  await page.unroute("**/assets/*.js");
  await page.reload();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator("#app > .initial-load")).toHaveCount(0);
  // The real navigation takes over exactly where the placeholder stood.
  const sidebar = await page.locator(".sidebar").boundingBox();
  expect(`${sidebar.width}px`).toBe(phone.width);
  expect(sidebar.height).toBe(64);
});

test("service worker handles market update pushes and notification clicks", async ({ request }) => {
  const response = await request.get("/sw.js");
  expect(response.ok()).toBe(true);
  const source = await response.text();
  expect(source.match(/addEventListener\("push"/g)).toHaveLength(1);
  expect(source).toContain('showNotification');
  expect(source.match(/addEventListener\("notificationclick"/g)).toHaveLength(1);
  expect(source).toContain('clients.openWindow');
  expect(source).toContain('if (url.pathname === "/api/v1/push/config") return;');
});

test("installed shell starts offline and identifies saved data", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#page-title")).toContainText("市場觀察清單");
  await expect(page.locator("#app-status")).toContainText(/目前離線，顯示 \d{4}-\d{2}-\d{2} 已保存資料/);
  await expect(page.locator("#app-status")).toBeVisible();
});

test("page buttons check on interaction and settings can check immediately", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await openSettings(page);
  await page.getByRole("button", { name: "檢查更新" }).click();
  await expect(page.locator("#update-check-status")).toHaveText("已是最新版本");
  await page.locator("#close-dialog").click();

  const canObserveRegistration = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    try {
      window.__pwaUpdateChecks = 0;
      const observeUpdate = async () => {
        window.__pwaUpdateChecks += 1;
      };
      Object.getPrototypeOf(registration).update = observeUpdate;
      return registration.update === observeUpdate;
    } catch {
      return false;
    }
  });
  test.skip(!canObserveRegistration, "Browser does not allow observing ServiceWorkerRegistration.update");

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect.poll(() => page.evaluate(() => window.__pwaUpdateChecks)).toBe(0);
  await page.clock.install();
  await page.clock.fastForward(61_000);
  await page.locator('[data-page="favorites"]').click();
  await expect.poll(() => page.evaluate(() => window.__pwaUpdateChecks)).toBe(1);
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="sectors"]').click();
  await expect.poll(() => page.evaluate(() => window.__pwaUpdateChecks)).toBe(1);
  await openSettings(page);
  await page.getByRole("button", { name: "檢查更新" }).click();
  await expect.poll(() => page.evaluate(() => window.__pwaUpdateChecks)).toBe(2);
});

test("refresh checks the app version before reloading and keeps the current page", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.locator('[data-page="favorites"]').click();
  await openSettings(page);
  await page.getByRole("button", { name: "檢查更新" }).click();
  await expect(page.locator("#update-check-status")).toHaveText("已是最新版本");
  await page.locator("#close-dialog").click();
  const canObserveRegistration = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    try {
      Object.getPrototypeOf(registration).update = async () => {
        localStorage.setItem("pwa-refresh-update-checked", "yes");
      };
      return true;
    } catch { return false; }
  });
  test.skip(!canObserveRegistration, "Browser does not allow observing ServiceWorkerRegistration.update");
  await page.evaluate(() => localStorage.removeItem("pwa-refresh-update-checked"));
  const heading = await page.locator(".page-heading").boundingBox();
  const touch = await page.context().newCDPSession(page);
  const x = heading.x + 24, y = heading.y + 16;
  await Promise.all([
    page.waitForEvent("load"),
    (async () => {
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 6; step++)
        await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + step * 25 }] });
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    })(),
  ]);
  await touch.detach();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pwa-refresh-update-checked"))).toBe("yes");
  await expect(page.locator("#page-title")).toContainText("自選");
});

test("settings shows the release version beside update on phone and desktop", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await openSettings(page);
    const button = page.locator("#check-update");
    const version = page.locator("#app-version");
    await expect(version).toBeVisible();
    await expect(version).toHaveText(releaseVersion);
    const buttonBox = await button.boundingBox();
    const versionBox = await version.boundingBox();
    expect(versionBox.x).toBeGreaterThanOrEqual(buttonBox.x + buttonBox.width);
    expect(Math.abs(versionBox.y + versionBox.height / 2 - buttonBox.y - buttonBox.height / 2)).toBeLessThan(5);
    if (width === 1440) await expect(page.locator(".workspace-status > span:last-child")).toHaveText(releaseVersion);
  }
});

async function emulateInstalledApp(page, { ios = false, chromeIos = false } = {}) {
  await page.addInitScript(({ isIos, isChromeIos }) => {
    if (isIos || isChromeIos) {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: isChromeIos
          ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1"
          : "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      });
      if (!isChromeIos) Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    }
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = nativeMatchMedia(query);
      if (query !== "(display-mode: standalone)") return result;
      return new Proxy(result, { get(target, key) {
        if (key === "matches") return true;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    };
  }, { isIos: ios, isChromeIos: chromeIos });
}

test("iPhone home screen retains the branded launch animation", async ({ page }) => {
  await emulateInstalledApp(page, { ios: true });
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/is-standalone/);
  await expect(page.locator("#app-splash")).toBeVisible();
  await expect(page.locator("#app-splash")).toHaveCount(0, { timeout: 3_000 });
  await expect(page.locator("#app")).toBeVisible();
});

test("standalone app covers the saved view while backgrounded and restores it on return", async ({ page }) => {
  await emulateInstalledApp(page, { ios: true });
  await page.goto("/");
  await expect(page.locator("#app-splash")).toHaveCount(0, { timeout: 3_000 });
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect(page.locator("html")).toHaveClass(/app-snapshot-cover-visible/);
  expect(await page.evaluate(() => ({
    cover: getComputedStyle(document.querySelector(".app-snapshot-cover")).backgroundColor,
    top: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.className,
  }))).toEqual({ cover: "rgb(20, 36, 59)", top: "app-snapshot-cover" });
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page.locator("html")).not.toHaveClass(/app-snapshot-cover-visible/);
  await expect(page.locator("#app")).toBeVisible();
});

test("iPhone Chrome home screen retains the branded launch animation", async ({ page }) => {
  await emulateInstalledApp(page, { chromeIos: true });
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/is-standalone/);
  await expect(page.locator("#app-splash")).toBeVisible();
  await expect(page.locator("#app-splash")).toHaveCount(0, { timeout: 3_000 });
  await expect(page.locator("#app")).toBeVisible();
});

test("standalone app animates on opening but skips a page refresh", async ({ page }) => {
  await emulateInstalledApp(page);
  await page.goto("/");
  const splash = page.locator("#app-splash");
  await expect(splash).toBeVisible();
  await expect(splash).toContainText("株研");
  const launchBackground = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    app: getComputedStyle(document.querySelector("#app")).visibility,
    bottom: document.elementFromPoint(innerWidth / 2, innerHeight - 1)?.closest("#app-splash")?.id,
  }));
  expect(launchBackground).toEqual({ html: "rgb(20, 36, 59)", body: "rgb(20, 36, 59)", app: "hidden", bottom: "app-splash" });
  await page.evaluate(() => {
    window.__splashExitSamples = [];
    const node = document.querySelector("#app-splash");
    new MutationObserver(() => {
      if (!node.classList.contains("is-leaving")) return;
      const sample = () => {
        if (!node.isConnected) return;
        window.__splashExitSamples.push({
          opacity: getComputedStyle(node).opacity,
          app: getComputedStyle(document.querySelector("#app")).visibility,
          bottom: document.elementFromPoint(innerWidth / 2, innerHeight - 1)?.closest("#app-splash")?.id,
        });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }).observe(node, { attributes: true, attributeFilter: ["class"] });
  });
  await page.waitForTimeout(1_000);
  await expect(splash).toBeVisible();
  await expect(splash).toHaveCount(0, { timeout: 3_000 });
  const exitSamples = await page.evaluate(() => window.__splashExitSamples);
  expect(exitSamples.length).toBeGreaterThan(2);
  expect(exitSamples.every((sample) => sample.opacity === "1" && sample.app === "hidden" && sample.bottom === "app-splash")).toBe(true);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector("#app")).visibility)).toBe("visible");
  await page.reload();
  await expect(page.locator("#app-splash")).toBeHidden();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(248, 250, 252)");
  await page.goto("/");
  await expect(page.locator("#app-splash")).toBeVisible();
});

test("inline launch cover hides the page even when the stylesheet is unavailable", async ({ page }) => {
  await emulateInstalledApp(page);
  const stylesheetPattern = /\/assets\/index-[^/]+\.css$/;
  await page.route(stylesheetPattern, (route) => route.abort());
  await page.goto("/");
  expect(await page.evaluate(() => ({
    app: getComputedStyle(document.querySelector("#app")).visibility,
    splash: getComputedStyle(document.querySelector("#app-splash")).position,
    bottom: document.elementFromPoint(innerWidth / 2, innerHeight - 1)?.closest("#app-splash")?.id,
  }))).toEqual({ app: "hidden", splash: "fixed", bottom: "app-splash" });
  const measure = () => page.evaluate(() => {
    const splash = document.querySelector("#app-splash");
    const brand = document.querySelector(".app-splash-brand");
    const name = document.querySelector(".app-splash-name");
    return { top: brand.getBoundingClientRect().top, height: brand.getBoundingClientRect().height,
      nameHeight: name.getBoundingClientRect().height, splashHeight: splash.getBoundingClientRect().height,
      splashPadding: getComputedStyle(splash).padding, splashBox: getComputedStyle(splash).boxSizing };
  });
  const beforeCss = await measure();
  const stylesheetUrl = await page.locator('link[rel="stylesheet"]').getAttribute("href");
  await page.unroute(stylesheetPattern);
  await page.addStyleTag({ url: stylesheetUrl });
  const afterCss = await measure();
  expect(Math.abs(afterCss.top - beforeCss.top)).toBeLessThan(1);
});

test("invalid saved preferences cannot disable the standalone launch cover", async ({ page }) => {
  await emulateInstalledApp(page);
  await page.addInitScript(() => {
    localStorage.setItem("stock-insight-v1", "invalid-json");
  });
  await page.goto("/");
  await expect(page.locator("#app-splash")).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/is-standalone/);
});

test("slow app startup still shows the complete launch animation", async ({ page }) => {
  await emulateInstalledApp(page);
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    await route.continue();
  });
  await page.goto("/");
  const splash = page.locator("#app-splash");
  await expect(splash).toBeVisible();
  await expect(page.locator("#app .initial-load")).toBeAttached();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.waitForTimeout(1_100);
  await expect(splash).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(splash).toHaveCount(0, { timeout: 2_000 });
  await expect(page.locator(".sidebar")).toBeAttached();
});

test("dark standalone reload never paints a light bottom before the app loads", async ({ page }) => {
  await emulateInstalledApp(page);
  await page.addInitScript(() => {
    localStorage.setItem("stock-insight-v1", JSON.stringify({ theme: "dark" }));
  });
  await page.goto("/");
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  await page.reload({ waitUntil: "commit" });
  await page.locator("body").waitFor();
  expect(await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
  }))).toEqual({ theme: "dark", html: "rgb(11, 18, 32)", body: "rgb(11, 18, 32)" });
  await expect(page.locator("#app-splash")).toBeHidden();
});

test("reduced motion skips the launch animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await emulateInstalledApp(page);
  await page.goto("/");
  await expect(page.locator("#app-splash")).toBeHidden();
});
