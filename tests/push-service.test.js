import test from "node:test";
import assert from "node:assert/strict";
import { PushService, allowedPushEndpoint } from "../cloudflare/services/push-service.js";
import { pushController } from "../cloudflare/api/push-controller.js";
import { ApnsClient } from "../cloudflare/services/apns-client.js";

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

// Workers throw "Illegal invocation" when fetch runs with another object as `this`;
// every production send failed this way while tests injected their own fetcher.
async function withWorkersFetch(run) {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = function (input, init) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
    calls.push([String(input), init]);
    return Promise.resolve(new Response(null, { status: 201 }));
  };
  try { await run(calls); } finally { globalThis.fetch = original; }
}

test("default push and APNs fetchers keep the global receiver required by Workers", async () => {
  const encode = (value) => Buffer.from(value).toString("base64url");
  const server = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const row = { endpoint: "https://web.push.apple.com/subscription", p256dh: encode(await crypto.subtle.exportKey("raw", client.publicKey)),
    auth: encode(crypto.getRandomValues(new Uint8Array(16))) };
  const marks = [];
  const repository = { pending: async () => marks.length ? [] : [row], mark: async (...args) => marks.push(args), removeMany: async () => {} };
  await withWorkersFetch(async (calls) => {
    const service = new PushService(repository, { VAPID_SUBJECT: "https://app.test",
      VAPID_PUBLIC_KEY: encode(await crypto.subtle.exportKey("raw", server.publicKey)),
      VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey("jwk", server.privateKey)).d });
    assert.deepEqual(await service.notifyPublished({ generation: "g1", asOf: "2026-11-03" }),
      { sent: 1, removed: 0, failed: 0, rejected: 0, hasMore: false });
    assert.deepEqual(marks, [[row.endpoint, "2026-11-03"]]);
    assert.equal(calls[0][0], row.endpoint);
    const apns = new ApnsClient({});
    assert.equal((await apns.fetcher("https://api.push.apple.com/3/device/token", { method: "POST" })).status, 201);
  });
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
    { sent: 0, removed: 1, failed: 1, rejected: 0, hasMore: false });
  assert.deepEqual(await service.notifyPublished({ generation: "g1", asOf: "2026-10-21" }),
    { sent: 1, removed: 1, failed: 0, rejected: 0, hasMore: false });
  assert.deepEqual(marks, [["https://fcm.googleapis.com/fcm/send/subscription", "2026-10-21"]]);
  assert.ok(requests.every(([endpoint]) => endpoint === row.endpoint), "legacy non-push hosts are never contacted");
  assert.deepEqual(removed, [legacy.endpoint, legacy.endpoint]);
  assert.equal(new Headers(requests[0][1].headers).get("Content-Encoding"), "aes128gcm");
  assert.equal(new Headers(requests[0][1].headers).get("Topic"), null, "Apple rejects date topics as BadWebPushTopic");
  assert.deepEqual(await service.notifyPublished({ generation: "g1", asOf: "2026-10-21" }),
    { sent: 0, removed: 0, failed: 0, rejected: 0, hasMore: false });
  assert.equal(requests.length, 2);
});

test("refused pushes log the service reason, skip the rest of the day and are pruned after three trade dates", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const { PushRepository } = await import("../cloudflare/repositories/push-repository.js");
  const sqlite = new DatabaseSync(":memory:");
  for (const file of ["0004_push_subscriptions.sql", "0009_push_failures.sql"])
    sqlite.exec(readFileSync(new URL(`../cloudflare/migrations/${file}`, import.meta.url), "utf8"));
  const db = { prepare(sql) { let values = []; const statement = sqlite.prepare(sql);
    return { bind(...args) { values = args; return this; }, async first() { return statement.get(...values) ?? null; },
      async all() { return { results: statement.all(...values) }; }, async run() { return statement.run(...values); } }; },
  async batch(statements) { for (const statement of statements) await statement.run(); } };
  const repository = new PushRepository(db);
  const encode = (value) => Buffer.from(value).toString("base64url");
  const server = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const keys = async () => { const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    return { p256dh: encode(await crypto.subtle.exportKey("raw", client.publicKey)), auth: encode(crypto.getRandomValues(new Uint8Array(16))) }; };
  const refused = "https://web.push.apple.com/refused", healthy = "https://fcm.googleapis.com/fcm/send/healthy";
  await repository.save({ endpoint: refused, keys: await keys() }, "2026-11-01T00:00:00Z");
  await repository.save({ endpoint: healthy, keys: await keys() }, "2026-11-01T00:00:01Z");
  const requests = [], logs = [];
  const service = new PushService(repository, { VAPID_SUBJECT: "https://app.test",
    VAPID_PUBLIC_KEY: encode(await crypto.subtle.exportKey("raw", server.publicKey)),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey("jwk", server.privateKey)).d },
  async (endpoint) => { requests.push(endpoint); return endpoint === refused
    ? Response.json({ reason: "BadJwtToken" }, { status: 400 }) : new Response(null, { status: 201 }); });
  const originalError = console.error;
  console.error = (line) => logs.push(JSON.parse(line));
  try {
    assert.deepEqual(await service.notifyPublished({ generation: "g1", asOf: "2026-11-02" }),
      { sent: 1, removed: 0, failed: 0, rejected: 1, hasMore: false });
    assert.deepEqual(logs.at(-1), { event: "push-rejected", status: 400, endpointHost: "web.push.apple.com", reason: "BadJwtToken", failureDays: 1 });
    assert.ok(!JSON.stringify(logs).includes("/refused"), "logs never contain the private endpoint path");
    // Not retried again the same evening, so the sync's retry loop can finish.
    assert.deepEqual(await service.notifyPublished({ generation: "g1", asOf: "2026-11-02" }),
      { sent: 0, removed: 0, failed: 0, rejected: 0, hasMore: false });
    assert.equal(requests.filter((endpoint) => endpoint === refused).length, 1);
    const row = () => sqlite.prepare("SELECT FailureDays days, LastFailure failure FROM push_subscriptions WHERE Endpoint=?").get(refused);
    assert.deepEqual({ ...row() }, { days: 1, failure: "400 BadJwtToken" });
    await service.notifyPublished({ generation: "g2", asOf: "2026-11-03" });
    assert.equal(row().days, 2);
    assert.deepEqual(await service.notifyPublished({ generation: "g3", asOf: "2026-11-04" }),
      { sent: 1, removed: 1, failed: 0, rejected: 1, hasMore: false });
    assert.equal(logs.at(-1).event, "push-pruned");
    assert.equal(row(), undefined, "deleted after refusals on three trade dates");
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM push_subscriptions").get().n, 1, "healthy subscription kept");
    // A successful delivery resets an earlier refusal streak.
    await repository.save({ endpoint: refused, keys: await keys() }, "2026-11-05T00:00:00Z");
    await repository.recordRejection(refused, "2026-11-04", "400 BadJwtToken", 3);
    await repository.mark(refused, "2026-11-05");
    assert.deepEqual({ ...row() }, { days: 0, failure: null });
  } finally { console.error = originalError; }
});

test("temporary push-service errors are retried and never count toward pruning", async () => {
  const encode = (value) => Buffer.from(value).toString("base64url");
  const server = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const rows = [{ endpoint: "https://fcm.googleapis.com/fcm/send/busy", p256dh: encode(await crypto.subtle.exportKey("raw", client.publicKey)),
    auth: encode(crypto.getRandomValues(new Uint8Array(16))) }];
  const recorded = [], logs = [];
  const service = new PushService({ pending: async () => rows, mark: async () => {}, removeMany: async () => {},
    recordRejection: async (...args) => recorded.push(args) }, { VAPID_SUBJECT: "https://app.test",
    VAPID_PUBLIC_KEY: encode(await crypto.subtle.exportKey("raw", server.publicKey)),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey("jwk", server.privateKey)).d },
  async () => new Response("Service Unavailable\n try later", { status: 503 }));
  const originalError = console.error;
  console.error = (line) => logs.push(JSON.parse(line));
  try {
    assert.deepEqual(await service.notifyPublished({ generation: "g", asOf: "2026-11-02" }),
      { sent: 0, removed: 0, failed: 1, rejected: 0, hasMore: false });
    assert.deepEqual(logs, [{ event: "push-failed", status: 503, endpointHost: "fcm.googleapis.com", reason: "Service Unavailable try later" }]);
    assert.deepEqual(recorded, []);
  } finally { console.error = originalError; }
});
test("only a signed-in administrator can resend the latest update, same-origin only", async () => {
  const { createHash } = await import("node:crypto");
  const { authDatabase } = await import("./helpers/auth-db.js");
  const { routeApi } = await import("../cloudflare/api/router.js");
  const db = authDatabase();
  // Session tokens are hex, so each account gets its own hex digit.
  const token = (id) => (id === "admin" ? "a" : "b").repeat(64);
  for (const [id, role] of [["admin", "admin"], ["viewer", "user"]]) {
    db.sqlite.prepare("INSERT INTO app_users(id, username, password_hash, role, disabled, created_at) VALUES (?, ?, 'unused', ?, 0, ?)").run(id, id, role, Date.now());
    db.sqlite.prepare("INSERT INTO auth_sessions VALUES (?, ?, ?)").run(createHash("sha256").update(token(id)).digest("hex"), id, Date.now() + 3600000);
  }
  const sent = [];
  const services = { market: { market: async () => ({ asOf: "2026-11-03", generation: "g1" }) },
    push: { notifyPublished: async (published) => { sent.push(published); return { sent: 2, removed: 0, failed: 0, rejected: 0, hasMore: false }; } },
    nativePush: { config: () => ({ enabled: false }) } };
  const resend = (headers = {}) => routeApi(new Request("https://app.test/api/v1/push/resend", { method: "POST", headers }), { T86_DB: db }, services);
  const cookie = (id) => ({ Cookie: `__Host-stock_session=${token(id)}` });
  assert.equal((await resend()).status, 401);
  assert.equal((await resend(cookie("viewer"))).status, 403);
  assert.equal((await resend({ ...cookie("admin"), Origin: "https://evil.test" })).status, 403);
  assert.equal((await routeApi(new Request("https://app.test/api/v1/push/resend"), { T86_DB: db }, services)).status, 405);
  assert.deepEqual(sent, []);
  const response = await resend({ ...cookie("admin"), Origin: "https://app.test" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { data: { asOf: "2026-11-03", web: { sent: 2, removed: 0, failed: 0, rejected: 0, hasMore: false }, native: null } });
  assert.deepEqual(sent, [{ generation: "g1", asOf: "2026-11-03" }]);
});
