import test from "node:test";
import assert from "node:assert/strict";
import { startPushNotifications } from "../src/push.js";
import { PushApiClient } from "../src/api/push-client.js";

const fakeButton = () => {
  const classes = new Set();
  const attributes = new Map();
  return {
    hidden: false,
    disabled: false,
    classList: {
      toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
    querySelector: () => ({ textContent: "" }),
    addEventListener(name, handler) { if (name === "click") this.click = handler; },
  };
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an existing push subscription reports the enabled state", async () => {
  const button = fakeButton();
  const statuses = [];
  const runtime = {
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => ({ endpoint: "https://push.example/sub" }) } }) } },
    window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    Notification: { permission: "granted", requestPermission: async () => "granted" },
  };

  startPushNotifications(button, { runtime, onStatus: (status) => statuses.push(status) });
  await flushPromises();

  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: true, permission: "granted" });
  assert.equal(button.classList.contains("push-enabled"), true);
  assert.equal(button.getAttribute("aria-pressed"), "true");
});

test("the subscription state is checked again when the app returns to the foreground", async () => {
  const button = fakeButton();
  let subscription = null;
  let visibilityHandler;
  const statuses = [];
  const runtime = {
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }) } },
    window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
    document: {
      visibilityState: "visible",
      addEventListener: (name, handler) => { if (name === "visibilitychange") visibilityHandler = handler; },
      removeEventListener() {},
    },
    Notification: { permission: "granted", requestPermission: async () => "granted" },
  };

  startPushNotifications(button, { runtime, onStatus: (status) => statuses.push(status) });
  await flushPromises();
  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: false, permission: "granted" });

  subscription = { endpoint: "https://push.example/sub" };
  visibilityHandler();
  await flushPromises();
  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: true, permission: "granted" });
});

test("an older subscription check cannot restore the bell after enabling notifications", async () => {
  const button = fakeButton();
  let finishInitialCheck;
  let subscription = null;
  let checks = 0;
  const pushManager = {
    getSubscription: () => ++checks === 1
      ? new Promise((resolve) => { finishInitialCheck = resolve; }) : Promise.resolve(subscription),
    subscribe: async () => { subscription = {
      endpoint: "https://push.example/sub", toJSON: () => ({ endpoint: "https://push.example/sub" }),
    }; return subscription; },
  };
  const statuses = [];
  const requests = [];
  startPushNotifications(button, {
    runtime: {
      navigator: { serviceWorker: { ready: Promise.resolve({ pushManager }) } },
      window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
      document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
      Notification: { permission: "granted", requestPermission: async () => "granted" },
    },
    client: new PushApiClient(async (path, options = {}) => {
      requests.push([path, options.method ?? "GET"]);
      return Response.json(path.endsWith("/config") ? { enabled: true, publicKey: "AQ" } : { subscribed: true });
    }),
    onStatus: (status) => statuses.push(status),
  });
  await flushPromises();
  await button.click();
  finishInitialCheck(null);
  await flushPromises();
  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: true, permission: "granted" });
  assert.equal(button.classList.contains("push-enabled"), true);
  assert.deepEqual(requests, [["/api/v1/push/config", "GET"], ["/api/v1/push/subscriptions", "POST"]]);
});

test("a rejected browser subscription remains visibly incomplete", async () => {
  const button = fakeButton();
  const statuses = [];
  const runtime = {
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: {
      getSubscription: async () => null,
      subscribe: async () => { throw new DOMException("Registration failed - permission denied", "AbortError"); },
    } }) } },
    window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    Notification: { permission: "granted", requestPermission: async () => "granted" },
  };
  startPushNotifications(button, { runtime,
    client: new PushApiClient(async () => Response.json({ enabled: true, publicKey: "AQ" })),
    onStatus: (status) => statuses.push(status),
  });
  await button.click();
  await flushPromises();
  assert.deepEqual(statuses.at(-1), { supported: true, subscribed: false, permission: "granted",
    error: "瀏覽器無法建立推播訂閱；請使用一般瀏覽視窗或已安裝的 App 重試" });
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("the newest subscription check wins when checks finish out of order", async () => {
  const button = fakeButton();
  let finishFirstCheck;
  let checks = 0;
  const statuses = [];
  const runtime = {
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: {
      getSubscription: () => ++checks === 1
        ? new Promise((resolve) => { finishFirstCheck = resolve; })
        : Promise.resolve({ endpoint: "https://push.example/sub" }),
    } }) } },
    window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    Notification: { permission: "granted" },
  };
  const controller = startPushNotifications(button, { runtime, onStatus: (status) => statuses.push(status) });
  await flushPromises();
  await controller.refresh();
  finishFirstCheck(null);
  await flushPromises();
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].subscribed, true);
});

test("a failed browser unsubscribe keeps the server subscription and enabled state", async () => {
  const button = fakeButton();
  const requests = [];
  const statuses = [];
  const runtime = {
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: {
      getSubscription: async () => ({ endpoint: "https://push.example/sub", unsubscribe: async () => false }),
    } }) } },
    window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    Notification: { permission: "granted" },
  };
  startPushNotifications(button, { runtime,
    client: { unsubscribe: async (endpoint) => requests.push(endpoint) },
    onStatus: (status) => statuses.push(status),
  });
  await button.click();
  await flushPromises();
  assert.deepEqual(requests, []);
  assert.equal(statuses.at(-1).subscribed, true);
  assert.equal(button.getAttribute("aria-pressed"), "true");
});

const syncRuntime = (getSubscription) => ({
  navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription } }) } },
  window: { PushManager: class {}, addEventListener() {}, removeEventListener() {} },
  document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
  Notification: { permission: "granted" },
});
const memoryStorage = () => { const items = new Map(); return { getItem: (key) => items.get(key) ?? null,
  setItem: (key, value) => items.set(key, String(value)), removeItem: (key) => items.delete(key) }; };
const browserSubscription = (endpoint) => ({ endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "abcdefgh", auth: "ijklmnop" } }) });

test("an existing browser subscription is re-sent to the server on open, at most every 12 hours", async () => {
  let subscription = browserSubscription("https://fcm.googleapis.com/fcm/send/a");
  const posted = [], storage = memoryStorage();
  let clock = Date.parse("2026-11-03T09:00:00Z");
  const client = { subscribe: async (body) => { posted.push(body.endpoint); return { data: { subscribed: true } }; } };
  const open = async () => {
    const controller = startPushNotifications(fakeButton(), { runtime: syncRuntime(async () => subscription), client, storage, now: () => clock });
    await flushPromises(); await controller.whenSynced();
    return controller;
  };
  const controller = await open();
  assert.deepEqual(posted, ["https://fcm.googleapis.com/fcm/send/a"], "restores a row the server may have lost");
  await controller.refresh(); await controller.whenSynced();
  clock += 11 * 3600_000; await open();
  assert.equal(posted.length, 1, "no repeat within 12 hours, even across app launches");
  clock += 2 * 3600_000; await open();
  assert.equal(posted.length, 2, "re-sent after 12 hours");
  subscription = browserSubscription("https://fcm.googleapis.com/fcm/send/rotated");
  await open();
  assert.deepEqual(posted.at(-1), "https://fcm.googleapis.com/fcm/send/rotated", "a changed endpoint is sent immediately");
});

test("a failed re-sync keeps the bell enabled and retries on the next open", async () => {
  const subscription = browserSubscription("https://web.push.apple.com/a");
  const statuses = [], storage = memoryStorage();
  let attempts = 0;
  const client = { subscribe: async () => { attempts++; throw new Error("offline"); } };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    for (let open = 0; open < 2; open++) {
      const controller = startPushNotifications(fakeButton(), { runtime: syncRuntime(async () => subscription), client, storage,
        onStatus: (status) => statuses.push(status) });
      await flushPromises(); await controller.whenSynced();
    }
  } finally { console.warn = originalWarn; }
  assert.equal(attempts, 2);
  assert.equal(statuses.at(-1).subscribed, true);
});

test("re-sync works without usable storage and turning notifications off forgets the sync", async () => {
  const posted = [];
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const controller = startPushNotifications(fakeButton(), { runtime: syncRuntime(async () => browserSubscription("https://fcm.googleapis.com/fcm/send/a")),
    client: { subscribe: async (body) => posted.push(body.endpoint) }, storage: broken });
  await flushPromises(); await controller.whenSynced();
  assert.equal(posted.length, 1);

  const storage = memoryStorage(), button = fakeButton();
  storage.setItem("stock-insight-push-sync", JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/a", at: Date.now() }));
  startPushNotifications(button, { runtime: syncRuntime(async () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/a", unsubscribe: async () => true })),
    client: { subscribe: async () => {}, unsubscribe: async () => {} }, storage });
  await flushPromises();
  await button.click();
  assert.equal(storage.getItem("stock-insight-push-sync"), null);
});
