import test from "node:test";
import assert from "node:assert/strict";
import { PushService, allowedPushEndpoint } from "../cloudflare/services/push-service.js";
import { pushController } from "../cloudflare/api/push-controller.js";

const valid = { endpoint: "https://fcm.googleapis.com/fcm/send/subscription", expirationTime: null,
  keys: { p256dh: "abcdefgh", auth: "ijklmnop" } };

test("push subscriptions validate and persist without storing browser identity", async () => {
  const saved = [], removed = [];
  const repository = { save: async (...args) => saved.push(args), remove: async (endpoint) => removed.push(endpoint) };
  const service = new PushService(repository, {});
  assert.deepEqual(await service.subscribe(valid, new Date("2026-10-21T10:00:00Z")), { subscribed: true });
  assert.equal(saved[0][0].endpoint, valid.endpoint);
  await service.unsubscribe({ endpoint: valid.endpoint });
  assert.deepEqual(removed, [valid.endpoint]);
  await assert.rejects(service.subscribe({ endpoint: "http://unsafe.test", keys: valid.keys }), /Invalid push subscription/);
});

test("push subscriptions only accept browser push service endpoints", async () => {
  for (const endpoint of ["https://fcm.googleapis.com/fcm/send/a", "https://updates.push.services.mozilla.com/wpush/v2/a",
    "https://web.push.apple.com/a", "https://wns2-par02p.notify.windows.com/w/?token=a"])
    assert.equal(allowedPushEndpoint(endpoint), true, endpoint);
  for (const endpoint of ["https://attacker.example/collect", "https://fcm.googleapis.com.attacker.example/a",
    "https://evilfcm.googleapis.com.example/a", "http://fcm.googleapis.com/a", "https://fcm.googleapis.com:8443/a",
    "https://user:pass@fcm.googleapis.com/a", `https://fcm.googleapis.com/${"a".repeat(1100)}`, 42])
    assert.equal(allowedPushEndpoint(endpoint), false, String(endpoint).slice(0, 60));
  const service = new PushService({ save: async () => assert.fail("must not store") }, {});
  await assert.rejects(service.subscribe({ endpoint: "https://attacker.example/collect", keys: valid.keys }), /Invalid push subscription/);
});

test("push subscription bodies are bounded even without Content-Length", async () => {
  const service = { subscribe: async () => assert.fail("must not subscribe") };
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`{"endpoint":"${"a".repeat(5000)}"}`));
    controller.close();
  } });
  const request = new Request("https://app.test/api/v1/push/subscriptions", { method: "POST", body: stream, duplex: "half" });
  await assert.rejects(pushController(request, { name: "pushSubscriptions" }, service), (error) => error.status === 413);
});

test("push config is public while subscription writes require same origin", async () => {
  const service = { config: () => ({ enabled: true, publicKey: "public" }), subscribe: async () => ({ subscribed: true }) };
  const config = await pushController(new Request("https://app.test/api/v1/push/config"), { name: "pushConfig" }, service);
  assert.deepEqual(await config.json(), { enabled: true, publicKey: "public" });
  const rejected = await pushController(new Request("https://app.test/api/v1/push/subscriptions", {
    method: "POST", headers: { Origin: "https://evil.test", "Content-Type": "application/json" }, body: JSON.stringify(valid),
  }), { name: "pushSubscriptions" }, service);
  assert.equal(rejected.status, 403);
});

test("notification dispatch skips cleanly until VAPID secrets are configured", async () => {
  const service = new PushService({ pending() { throw new Error("must not read subscriptions"); } }, { VAPID_PUBLIC_KEY: "public" });
  assert.deepEqual(await service.notifyPublished({ generation: "g", asOf: "2026-10-21" }), { sent: 0, skipped: true });
});

test("notification dispatch encrypts one payload and marks the trade date", async () => {
  const encode = (value) => Buffer.from(value).toString("base64url");
  const server = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPrivate = await crypto.subtle.exportKey("jwk", server.privateKey);
  const serverPublic = await crypto.subtle.exportKey("raw", server.publicKey);
  const clientPublic = await crypto.subtle.exportKey("raw", client.publicKey);
  const marks = [], requests = [];
  const row = { endpoint: "https://fcm.googleapis.com/fcm/send/subscription", p256dh: encode(clientPublic),
    auth: encode(crypto.getRandomValues(new Uint8Array(16))) };
  const legacy = { ...row, endpoint: "https://attacker.example/collect" };
  const removed = [];
  const repository = {
    pending: async () => marks.length ? [] : [legacy, row],
    mark: async (...args) => marks.push(args), removeMany: async (endpoints) => removed.push(...endpoints),
  };
  const service = new PushService(repository, { VAPID_SUBJECT: "https://app.test", VAPID_PUBLIC_KEY: encode(serverPublic), VAPID_PRIVATE_KEY: serverPrivate.d },
    async (endpoint, payload) => { requests.push([endpoint, payload]); return new Response(null, { status: requests.length === 1 ? 503 : 201 }); });
  assert.deepEqual(await service.notifyPublished({ generation: "g1", asOf: "2026-10-21" }),
    { sent: 0, removed: 1, failed: 1, hasMore: false });
  assert.deepEqual(await service.notifyPublished({ generation: "g1", asOf: "2026-10-21" }),
    { sent: 1, removed: 1, failed: 0, hasMore: false });
  assert.deepEqual(marks, [["https://fcm.googleapis.com/fcm/send/subscription", "2026-10-21"]]);
  assert.ok(requests.every(([endpoint]) => endpoint === row.endpoint), "legacy non-push hosts are never contacted");
  assert.deepEqual(removed, [legacy.endpoint, legacy.endpoint]);
  assert.equal(new Headers(requests[0][1].headers).get("Content-Encoding"), "aes128gcm");
  assert.deepEqual(await service.notifyPublished({ generation: "g1", asOf: "2026-10-21" }),
    { sent: 0, removed: 0, failed: 0, hasMore: false });
  assert.equal(requests.length, 2);
});
