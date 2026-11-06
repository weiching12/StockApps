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
  return json(request, { data: { asOf: published.asOf, web: await services.push.status(published.asOf), native } });
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
  const web = await services.push.notifyPublished(published);
  const native = services.nativePush.config().enabled ? await services.nativePush.notifyPublished(published) : null;
  console.log(JSON.stringify({ event: "push-resend", user: user.username, asOf: published.asOf, web, native }));
  return json(request, { data: { asOf: published.asOf, web, native } });
}

export async function pushController(request, route, service) {
  if (route.name === "pushConfig" || route.name === "nativePushConfig") return json(request, service.config());
  if (!sameOrigin(request, route.name === "nativePushSubscriptions")) return error(request, true, "CROSS_ORIGIN", "Cross-origin request rejected", 403);
  const input = await body(request);
  const result = request.method === "POST" ? await service.subscribe(input) : await service.unsubscribe(input);
  return json(request, result);
}
