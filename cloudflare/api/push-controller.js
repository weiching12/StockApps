import { json, error } from "./http.js";
import { signedInUser } from "./session-guard.js";

const sameOrigin = (request, native = false) => {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin || native && origin === "capacitor://localhost";
};
const tooLarge = () => Object.assign(new Error("Request body too large"), { status: 413, code: "BODY_TOO_LARGE" });
const body = async (request) => {
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) throw tooLarge();
  // Content-Length is optional and untrusted, so stop reading a streamed body at the limit.
  const reader = request.body?.getReader(), chunks = [];
  let length = 0;
  while (reader) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 4096) { await reader.cancel(); throw tooLarge(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw Object.assign(new Error("Invalid JSON"), { status: 400, code: "INVALID_JSON" }); }
};

/** Same-origin administrator session, or the error response to return. */
async function administrator(request, env) {
  const { user, failure } = await signedInUser(request, env);
  if (failure) return { failure };
  if (user.role !== "admin") return { failure: error(request, true, "FORBIDDEN", "僅管理員可使用推播管理", 403) };
  return { user };
}

async function latestPublished(services) {
  const manifest = await services.market.market();
  return manifest?.asOf && manifest.generation ? { generation: manifest.generation, asOf: manifest.asOf } : null;
}

/** Administrator-only: delivery counts for the latest published date, by push service. */
export async function pushStatusController(request, env, services) {
  const { failure } = await administrator(request, env);
  if (failure) return failure;
  const published = await latestPublished(services);
  if (!published) return error(request, true, "DATA_UNAVAILABLE", "尚無已發布的資料", 503);
  const native = services.nativePush.config().enabled ? await services.nativePush.status(published.asOf) : null;
  return json(request, { data: { asOf: published.asOf, web: await services.push.status(published.asOf), native,
    template: services.pushMessages ? await services.pushMessages.dailyTemplate() : null,
    announcement: services.pushMessages ? await announcementProgress(services) : null } });
}

/**
 * Administrator-only: send the latest published date's update to subscriptions that have
 * neither received nor been refused it today, the same selection as the scheduled send.
 */
export async function pushResendController(request, env, services) {
  const { user, failure } = await administrator(request, env);
  if (failure) return failure;
  const published = await latestPublished(services);
  if (!published) return error(request, true, "DATA_UNAVAILABLE", "尚無已發布的資料", 503);
  const message = await services.pushMessages?.dailyMessage(published.asOf);
  const web = await services.push.notifyPublished(published, message);
  const native = services.nativePush.config().enabled ? await services.nativePush.notifyPublished(published, message) : null;
  console.log(JSON.stringify({ event: "push-resend", user: user.username, asOf: published.asOf, web, native }));
  return json(request, { data: { asOf: published.asOf, web, native } });
}

/** The latest announcement and how many devices have it, or null when none was sent. */
async function announcementProgress(services, announcement = undefined) {
  const latest = announcement === undefined ? await services.pushMessages.latestAnnouncement() : announcement;
  if (!latest) return null;
  const web = await services.push.repository.announcementStatus(latest.id);
  const native = services.nativePush.config().enabled ? await services.nativePush.repository.announcementStatus(latest.id) : { total: 0, delivered: 0 };
  return { ...latest, total: web.total + native.total, delivered: web.delivered + native.delivered };
}

/** One batch to browsers, then iOS once browsers are done, so a request stays well under 50 outbound fetches. */
async function sendAnnouncementBatch(services, announcement) {
  const web = await services.push.sendAnnouncement(announcement);
  const native = !web.hasMore && services.nativePush.config().enabled ? await services.nativePush.sendAnnouncement(announcement) : null;
  return { web, native, hasMore: web.hasMore || Boolean(native?.hasMore) };
}

/**
 * Administrator-only push text: GET/PUT/DELETE /push/template edits the daily update's template;
 * POST /push/announcements saves an announcement and sends its first batch, and
 * POST /push/announcements/latest/send continues the latest one where it stopped.
 */
export async function pushMessageController(request, route, env, services) {
  if (request.method !== "GET" && !sameOrigin(request)) return error(request, true, "CROSS_ORIGIN", "Cross-origin request rejected", 403);
  const { user, failure } = await administrator(request, env);
  if (failure) return failure;
  if (route.name === "pushTemplate") {
    const template = request.method === "GET" ? await services.pushMessages.dailyTemplate()
      : request.method === "DELETE" ? await services.pushMessages.resetDailyTemplate()
        : await services.pushMessages.saveDailyTemplate(await body(request), user.username);
    if (request.method !== "GET") console.log(JSON.stringify({ event: "push-template", user: user.username, action: request.method }));
    return json(request, { data: template });
  }
  let announcement;
  if (route.name === "pushAnnouncements") {
    announcement = await services.pushMessages.createAnnouncement(await body(request), user.username);
    console.log(JSON.stringify({ event: "push-announcement", user: user.username, id: announcement.id }));
  } else {
    announcement = await services.pushMessages.latestAnnouncement();
    if (!announcement) return error(request, true, "NOT_FOUND", "目前沒有公告", 404);
  }
  const batch = await sendAnnouncementBatch(services, announcement);
  return json(request, { data: { ...batch, announcement: await announcementProgress(services, announcement) } });
}

export async function pushController(request, route, service) {
  if (route.name === "pushConfig" || route.name === "nativePushConfig") return json(request, service.config());
  if (!sameOrigin(request, route.name === "nativePushSubscriptions")) return error(request, true, "CROSS_ORIGIN", "Cross-origin request rejected", 403);
  const input = await body(request);
  const result = request.method === "POST" ? await service.subscribe(input) : await service.unsubscribe(input);
  return json(request, result);
}
