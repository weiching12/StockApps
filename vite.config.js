import { defineConfig } from "vite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function publicAssetFingerprint(directory) {
  const hash = createHash("sha256");
  const visit = (path, prefix = "") => {
    for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${item.name}`, file = join(path, item.name);
      if (item.isDirectory()) visit(file, `${name}/`);
      else if (item.isFile()) hash.update(name).update("\0").update(readFileSync(file)).update("\0");
    }
  };
  if (directory) visit(directory);
  return hash.digest("hex");
}

function pwaServiceWorker() {
  let publicDirectory;
  return {
    name: "stock-insight-pwa",
    apply: "build",
    configResolved(config) { publicDirectory = config.publicDir; },
    generateBundle(_, bundle) {
      const files = Object.values(bundle)
        .map((item) => `/${item.fileName}`)
        .filter((file) => !file.endsWith(".map") && file !== "/sw.js")
        .sort();
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: serviceWorkerSource(files, bundle, publicAssetFingerprint(publicDirectory)),
      });
    },
  };
}

function serviceWorkerSource(files, bundle, publicFingerprint) {
  const version = createHash("sha256").update(Object.values(bundle).map((item) =>
    `${item.fileName}:${item.type === "asset" ? String(item.source) : item.code}`).join("|")).update(publicFingerprint).digest("hex").slice(0, 16);
  // Separate this policy from older shells that cached research API responses.
  return `const SHELL_CACHE = ${JSON.stringify(`stock-insight-shell-v2-${version}`)};
const DATA_CACHE = "stock-insight-market-v2";
const APP_SHELL = ${JSON.stringify(["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", ...files])};

// The asset host answers unknown paths with the SPA page, so an HTML body for a script,
// stylesheet or image must never be cached or replayed as that file.
const ASSET_PATH = /\\.(?:m?js|css|png|svg|ico|webmanifest|json|woff2?)$/i;
const expectsAsset = (request) => ["script", "style", "worker", "font", "image", "manifest"].includes(request.destination) ||
  ASSET_PATH.test(new URL(request.url).pathname);
const isHtml = (response) => (response.headers.get("Content-Type") || "").toLowerCase().includes("text/html");
const cacheable = (request, response) => response.ok && !(expectsAsset(request) && isHtml(response));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const entries = await Promise.all(APP_SHELL.map(async (path) => {
      const request = new Request(path);
      const response = await fetch(request);
      if (!cacheable(request, response)) throw new Error("App shell asset unavailable: " + path);
      // Read each body now: unread bodies hold connections and stall the remaining requests.
      return [request, new Response(await response.blob(), response)];
    }));
    // Store only after every file is verified, so a failed install keeps the previous version.
    await Promise.all(entries.map(([request, response]) => cache.put(request, response)));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) =>
      (key.startsWith("stock-insight-shell-") && key !== SHELL_CACHE) ||
      (key.startsWith("stock-insight-market-") && key !== DATA_CACHE))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "株研資料已更新", {
    body: data.body || "今日台股資料已完成更新",
    icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
    tag: data.tag || "market-update", data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(target); return existing.focus(); }
    return self.clients.openWindow(target);
  })());
});

const cachedFallback = async (request, cacheName) => {
  const cached = await caches.match(request, { cacheName });
  if (!cached) throw new Error("No cached response");
  const headers = new Headers(cached.headers);
  headers.set("X-PWA-Cache", "fallback");
  return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
};

const trimCache = async (cache, limit = 40) => {
  const keys = (await cache.keys()).filter((key) => new URL(key.url).pathname === "/api/v1/market/summary");
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)));
};

const networkFirst = async (request, cacheName) => {
  try {
    const response = await fetch(request);
    const noStore = (response.headers.get("Cache-Control") || "").split(",")
      .some((directive) => directive.trim().toLowerCase() === "no-store");
    if (cacheable(request, response) && !noStore) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
      if (cacheName === DATA_CACHE) await trimCache(cache);
    }
    return response;
  } catch {
    return cachedFallback(request, cacheName);
  }
};

const cacheFirst = async (request, cacheName) => {
  const cached = await caches.match(request, { cacheName });
  if (cached && cacheable(request, cached)) return cached;
  // Discard an HTML fallback stored by an older worker, then retry the network.
  if (cached) await (await caches.open(cacheName)).delete(request);
  const response = await fetch(request);
  if (cacheable(request, response)) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    if (cacheName === DATA_CACHE) await trimCache(cache);
  }
  return response;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/v1/auth/")) return;
  if (url.pathname === "/api/v1/push/config") return;
  if (url.pathname === "/api/presence" || url.pathname === "/api/v1/presence") return;
  if (url.pathname === "/api/market" || url.pathname === "/api/v1/market" ||
      url.pathname === "/api/v1/market/summary" || url.pathname === "/api/v1/favorites/summary" ||
      url.pathname === "/api/v1/favorites/research" ||
      url.pathname.startsWith("/api/v1/sectors/") ||
      url.pathname.startsWith("/api/stocks/") || url.pathname.startsWith("/api/v1/stocks/")) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(cacheFirst(request, SHELL_CACHE));
});
`;
}

export default defineConfig(({ mode }) => {
  const native = mode === "native";
  const apiOrigin = native ? process.env.STOCKAPPS_NATIVE_API_ORIGIN || "https://stock-insight-tw.stock-insight-tw.workers.dev" : "";
  if (native) {
    const url = new URL(apiOrigin);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
      throw new Error("STOCKAPPS_NATIVE_API_ORIGIN must be an HTTPS origin");
  }
  return {
    plugins: native ? [] : [pwaServiceWorker()],
    server: { proxy: {
      ...Object.fromEntries(["/api/v1/auth", "/api/v1/presence", "/api/presence"].map(path => [path, {
        target: "http://127.0.0.1:8787", changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (outgoing, incoming) => {
            // Match the browser's original origin before translating the local dev hop.
            // Foreign origins stay intact so the Worker still rejects them.
            if (incoming.headers.origin === `http://${incoming.headers.host}`)
              outgoing.setHeader("Origin", `http://${outgoing.getHeader("host")}`);
          });
        },
      }])),
    } },
    build: { outDir: native ? "dist-native" : "dist" },
    define: {
      "import.meta.env.VITE_DATA_MODE": JSON.stringify(native || mode === "cloudflare" ? "api" : "demo"),
      "import.meta.env.VITE_APP_TARGET": JSON.stringify(native ? "native" : "web"),
      __STOCKAPPS_API_ORIGIN__: JSON.stringify(apiOrigin),
    },
  };
});
