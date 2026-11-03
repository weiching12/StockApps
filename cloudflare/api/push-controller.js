import { json, error } from "./http.js";
import { currentUser, sameOrigin as strictSameOrigin } from "../auth/session.js";

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

/**
 * Administrator-only: send the latest published date's update to subscriptions that have
 * neither received nor been refused it today, the same selection as the scheduled send.
 */
export async function pushResendController(request, env, services) {
  if (!strictSameOrigin(request)) return error(request, true, "CROSS_ORIGIN", "Cross-origin request rejected", 403);
  let user;
  try { user = await currentUser(request, env); }
  catch { return error(request, true, "AUTH_UNAVAILABLE", "帳號服務暫時無法使用", 503); }
  if (!user) return error(request, true, "UNAUTHENTICATED", "請先登入", 401);
  if (user.mustChangePassword) return error(request, true, "PASSWORD_CHANGE_REQUIRED", "請先更改初始密碼", 403);
  if (user.role !== "admin") return error(request, true, "FORBIDDEN", "僅管理員可重送通知", 403);
  const manifest = await services.market.market();
  if (!manifest?.asOf || !manifest.generation) return error(request, true, "DATA_UNAVAILABLE", "尚無已發布的資料", 503);
  const published = { generation: manifest.generation, asOf: manifest.asOf };
  const web = await services.push.notifyPublished(published);
  const native = services.nativePush.config().enabled ? await services.nativePush.notifyPublished(published) : null;
  console.log(JSON.stringify({ event: "push-resend", user: user.username, asOf: manifest.asOf, web, native }));
  return json(request, { data: { asOf: manifest.asOf, web, native } });
}

export async function pushController(request, route, service) {
  if (route.name === "pushConfig" || route.name === "nativePushConfig") return json(request, service.config());
  if (!sameOrigin(request, route.name === "nativePushSubscriptions")) return error(request, true, "CROSS_ORIGIN", "Cross-origin request rejected", 403);
  const input = await body(request);
  const result = request.method === "POST" ? await service.subscribe(input) : await service.unsubscribe(input);
  return json(request, result);
}
