import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { serviceWorkerSource } from "../vite.config.js";

// Run the generated worker with a fake ServiceWorkerGlobalScope and capture its handlers.
function loadWorker({ subscribe } = {}) {
  const handlers = {}, requests = [];
  const scope = {
    addEventListener: (name, handler) => { handlers[name] = handler; },
    registration: { pushManager: { subscribe: subscribe ?? (async () => { throw new Error("unexpected subscribe"); }) } },
    location: { origin: "https://app.test" }, clients: { claim: async () => {} },
  };
  const context = vm.createContext({ self: scope, caches: {}, Headers, Response, Request, URL, JSON, Promise,
    fetch: async (path, init) => { requests.push([path, init.method, JSON.parse(init.body)]); return new Response(null, { status: 200 }); } });
  vm.runInContext(serviceWorkerSource([], {}, "fingerprint"), context);
  const dispatch = async (name, event) => { let work; handlers[name]({ ...event, waitUntil: (promise) => { work = promise; } }); await work; };
  return { handlers, requests, dispatch };
}
const subscription = (endpoint) => ({ endpoint, options: { applicationServerKey: new Uint8Array([4, 1, 2]) },
  toJSON: () => ({ endpoint, keys: { p256dh: "abcdefgh", auth: "ijklmnop" } }) });

test("a rotated push subscription is registered and the old endpoint removed", async () => {
  const worker = loadWorker();
  assert.equal(typeof worker.handlers.pushsubscriptionchange, "function");
  await worker.dispatch("pushsubscriptionchange", { oldSubscription: subscription("https://fcm.googleapis.com/fcm/send/old"),
    newSubscription: subscription("https://fcm.googleapis.com/fcm/send/new") });
  assert.deepEqual(worker.requests.map(([path, method, body]) => [path, method, body.endpoint]), [
    ["/api/v1/push/subscriptions", "POST", "https://fcm.googleapis.com/fcm/send/new"],
    ["/api/v1/push/subscriptions", "DELETE", "https://fcm.googleapis.com/fcm/send/old"]]);
});

test("without a replacement the worker re-subscribes with the original server key", async () => {
  const keys = [];
  const worker = loadWorker({ subscribe: async (options) => { keys.push(options); return subscription("https://web.push.apple.com/renewed"); } });
  await worker.dispatch("pushsubscriptionchange", { oldSubscription: subscription("https://web.push.apple.com/expired"), newSubscription: null });
  assert.deepEqual(keys.map(({ userVisibleOnly, applicationServerKey }) => [userVisibleOnly, [...applicationServerKey]]), [[true, [4, 1, 2]]]);
  assert.deepEqual(worker.requests.map(([, method, body]) => [method, body.endpoint]),
    [["POST", "https://web.push.apple.com/renewed"], ["DELETE", "https://web.push.apple.com/expired"]]);
});

test("a subscription change the worker cannot recover from never throws", async () => {
  const worker = loadWorker({ subscribe: async () => { throw new Error("permission revoked"); } });
  await worker.dispatch("pushsubscriptionchange", { oldSubscription: subscription("https://web.push.apple.com/expired") });
  assert.deepEqual(worker.requests, []);
});
