import { json, error } from "./http.js";

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

export async function pushController(request, route, service) {
  if (route.name === "pushConfig" || route.name === "nativePushConfig") return json(request, service.config());
  if (!sameOrigin(request, route.name === "nativePushSubscriptions")) return error(request, true, "CROSS_ORIGIN", "Cross-origin request rejected", 403);
  const input = await body(request);
  const result = request.method === "POST" ? await service.subscribe(input) : await service.unsubscribe(input);
  return json(request, result);
}
