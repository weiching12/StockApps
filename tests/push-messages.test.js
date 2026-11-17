import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDatabase } from "./helpers/t86-db.js";
import { PushRepository } from "../cloudflare/repositories/push-repository.js";
import { PushMessageRepository } from "../cloudflare/repositories/push-message-repository.js";
import { PushMessageService, validatePushText, renderDailyMessage, DEFAULT_DAILY_TEMPLATE } from "../cloudflare/services/push-message.js";
import { PushService } from "../cloudflare/services/push-service.js";
import { NativePushService } from "../cloudflare/services/native-push-service.js";
import { ApnsClient } from "../cloudflare/services/apns-client.js";

function database() {
  const db = testDatabase();
  for (const file of ["0004_push_subscriptions.sql", "0006_native_push.sql", "0009_push_failures.sql", "0014_push_messages.sql"])
    db.sqlite.exec(readFileSync(new URL(`../cloudflare/migrations/${file}`, import.meta.url), "utf8"));
  return db;
}

test("the daily template defaults, saves, fills in the date and resets", async () => {
  const db = database(), messages = new PushMessageService(new PushMessageRepository(db));
  assert.deepEqual(await messages.dailyMessage("2026-11-17"), { title: "株研資料已更新", body: "2026-11-17 台股行情與法人資料已完成更新" });
  const saved = await messages.saveDailyTemplate({ title: " 今日盤後 {日期} ", body: "法人轉買 3 檔\n點開查看" }, "admin", new Date("2026-11-17T12:00:00Z"));
  assert.deepEqual([saved.title, saved.custom, saved.updatedBy], ["今日盤後 {日期}", true, "admin"]);
  assert.deepEqual(await messages.dailyMessage("2026-11-18"), { title: "今日盤後 2026-11-18", body: "法人轉買 3 檔\n點開查看" });
  assert.equal((await messages.resetDailyTemplate()).custom, false);
  assert.deepEqual(await messages.dailyMessage("2026-11-18"), renderDailyMessage(DEFAULT_DAILY_TEMPLATE, "2026-11-18"));
  db.sqlite.close();
});

test("push text is required, trimmed, free of control characters and within the limits", () => {
  assert.throws(() => validatePushText({ title: " ", body: "x" }), /請輸入標題/);
  assert.throws(() => validatePushText({ title: "x", body: "" }), /請輸入內文/);
  assert.throws(() => validatePushText({ title: "字".repeat(41), body: "x" }), /標題最多 40 字/);
  assert.throws(() => validatePushText({ title: "x", body: "字".repeat(161) }), /內文最多 160 字/);
  assert.deepEqual(validatePushText({ title: "a\u0007b", body: "c\u0000\nd" }), { title: "ab", body: "c\nd" });
});

test("an unreadable template never holds the daily update back", async () => {
  const messages = new PushMessageService({ template: async () => { throw new Error("no such table"); } });
  assert.deepEqual(await messages.dailyMessage("2026-11-17"), renderDailyMessage(DEFAULT_DAILY_TEMPLATE, "2026-11-17"));
});

/** A VAPID server key and a browser subscription key, so payloads encrypt for real. */
async function keys() {
  const encode = (value) => Buffer.from(value).toString("base64url");
  const server = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { env: { VAPID_SUBJECT: "https://app.test", VAPID_PUBLIC_KEY: encode(await crypto.subtle.exportKey("raw", server.publicKey)),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey("jwk", server.privateKey)).d },
  p256dh: encode(await crypto.subtle.exportKey("raw", client.publicKey)), auth: encode(crypto.getRandomValues(new Uint8Array(16))) };
}

test("an announcement goes out in batches, resumes where it stopped and keeps only the latest 50", async () => {
  const db = database(), { env, p256dh, auth } = await keys();
  const insert = db.sqlite.prepare("INSERT INTO push_subscriptions(Endpoint,P256dh,Auth,CreatedAt,UpdatedAt) VALUES(?,?,?,'t',?)");
  for (let index = 0; index < 13; index++) insert.run(`https://fcm.googleapis.com/fcm/send/s${index}`, p256dh, auth, String(index).padStart(2, "0"));
  const messages = new PushMessageService(new PushMessageRepository(db));
  const announcement = await messages.createAnnouncement({ title: "系統維護", body: "今晚 22:00 暫停更新" }, "admin");
  const reached = [];
  const push = new PushService(new PushRepository(db), env, async (endpoint) => (reached.push(endpoint), new Response(null, { status: 201 })));
  const first = await push.sendAnnouncement(announcement), second = await push.sendAnnouncement(announcement);
  assert.deepEqual([first.sent, first.hasMore, second.sent, second.hasMore], [10, true, 3, false]);
  assert.equal(new Set(reached).size, 13, "every device once, none twice");
  assert.deepEqual(await push.repository.announcementStatus(announcement.id), { total: 13, delivered: 13 });
  assert.equal((await push.sendAnnouncement(announcement)).sent, 0, "a finished announcement sends nothing more");
  // A newer announcement starts again for everyone.
  const next = await messages.createAnnouncement({ title: "新功能", body: "法人轉買" }, "admin");
  assert.deepEqual(await push.repository.announcementStatus(next.id), { total: 13, delivered: 0 });
  for (let index = 0; index < 60; index++) await messages.createAnnouncement({ title: `t${index}`, body: "b" }, "admin");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM push_announcements").get().n, 50);
  assert.equal((await messages.latestAnnouncement()).title, "t59");
  db.sqlite.close();
});

test("the web sender marks each reached or refusing device and removes gone ones", async () => {
  const { env, p256dh, auth } = await keys();
  const rows = ["ok", "gone", "refused"].map((name) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, p256dh, auth }));
  const marked = [], removed = [];
  const repository = { pendingAnnouncement: async () => rows, markAnnouncement: async (endpoint) => marked.push(endpoint),
    removeMany: async (list) => removed.push(...list) };
  const service = new PushService(repository, env,
    async (endpoint) => new Response(null, { status: endpoint.endsWith("ok") ? 201 : endpoint.endsWith("gone") ? 410 : 400 }));
  assert.deepEqual(await service.sendAnnouncement({ id: 7, title: "公告", body: "內容" }), { sent: 1, removed: 1, failed: 1, hasMore: false });
  assert.deepEqual(marked, [rows[0].endpoint, rows[2].endpoint]);
  assert.deepEqual(removed, [rows[1].endpoint]);
});

test("iOS gets the announcement text with its own collapse id, after browsers", async () => {
  const calls = [];
  const client = new ApnsClient({ APNS_BUNDLE_ID: "tw.example.app", APNS_KEY_ID: "ABCDEFGHIJ", APNS_TEAM_ID: "ABCDEFGHIJ" },
    async (url, init) => { calls.push(init); return new Response("{}", { status: 200 }); });
  client.authorization = async () => "token";
  await client.send({ token: "ab".repeat(32), environment: "sandbox" }, {}, { title: "公告", body: "內容", collapseId: "announcement-7" });
  const payload = JSON.parse(calls[0].body);
  assert.deepEqual(payload.aps.alert, { title: "公告", body: "內容" });
  assert.equal(calls[0].headers["apns-collapse-id"], "announcement-7");
  const marked = [];
  const native = new NativePushService({ pendingAnnouncement: async () => [{ token: "t", environment: "sandbox", updatedAt: "u" }],
    markAnnouncement: async (row, id) => marked.push(id), retire: async () => {} },
  { NATIVE_PUSH_ENABLED: "1", T86_DB: {}, APNS_PRIVATE_KEY: "k", APNS_KEY_ID: "ABCDEFGHIJ", APNS_TEAM_ID: "ABCDEFGHIJ", APNS_BUNDLE_ID: "tw.example.app" },
  { send: async (row, manifest, message) => ({ ok: message.collapseId === "announcement-7" }) });
  assert.deepEqual(await native.sendAnnouncement({ id: 7, title: "公告", body: "內容" }), { sent: 1, removed: 0, failed: 0, hasMore: false });
  assert.deepEqual(marked, [7]);
});
