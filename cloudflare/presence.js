import { currentUser } from "./auth/session.js";
import { PresenceRepository } from "./repositories/presence-repository.js";
import { PresenceService, InvalidPresenceIdentifier, normalizeCountry } from "./services/presence-service.js";
const requestCountry = request => normalizeCountry(request.cf?.country) ?? normalizeCountry(request.headers.get("CF-IPCountry"));
const reply = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

// One SQLite-backed object stores page-entry events across Worker regions.
export class OnlinePresence {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.now = Date.now;
    this.repository = new PresenceRepository(this.sql);
    this.service = new PresenceService(this.repository, { now: () => this.now() });
  }

  async fetch(request) {
    if (!["GET", "POST"].includes(request.method)) return reply({ error: "Method not allowed" }, 405);
    if (new URL(request.url).pathname === "/internal/analytics") {
      const url = new URL(request.url), today = new Date(this.now() + 8 * 3600000).toISOString().slice(0, 10);
      let period = url.searchParams.get("period") || "day";
      const scope = url.searchParams.get("scope") || "range";
      if (!["day", "month"].includes(period) || !["range", "history"].includes(scope)) return reply({ error: "Invalid period" }, 400);
      if (scope === "history") period = "month";
      const month = url.searchParams.has("month") ? url.searchParams.get("month")
        : !["start", "end", "period", "scope"].some(key => url.searchParams.has(key)) ? today.slice(0, 7) : null;
      let start, end;
      if (month !== null) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1 || month > today.slice(0, 7)) return reply({ error: "Invalid month" }, 400);
        start = `${month}-01`;
        const nextMonth = new Date(`${start}T00:00:00Z`);
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        end = new Date(nextMonth.getTime() - 86400000).toISOString().slice(0, 10);
        if (end > today) end = today;
        period = "day";
      } else {
        end = scope === "history" ? today : url.searchParams.get("end") || today;
        start = scope === "history" ? (this.repository.firstDay() || today) : url.searchParams.get("start") || new Date(this.now() + 8 * 3600000 - 29 * 86400000).toISOString().slice(0, 10);
      }
      const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
      const offset = Number(url.searchParams.get("offset") || 0);
      // Detail page size: 1–100 rows, 100 by default.
      const limit = Number(url.searchParams.get("limit") || 100);
      if (!validDay(start) || !validDay(end) || start > end || (scope !== "history" && Date.parse(end) - Date.parse(start) > (period === "day" ? 365 : 3650) * 86400000) || !Number.isSafeInteger(offset) || offset < 0
          || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        return reply({ error: "Invalid date range or offset" }, 400);
      const selectedDay = url.searchParams.get("selectedDay");
      if (url.searchParams.has("selectedDay") && (!validDay(selectedDay) || selectedDay < start || selectedDay > end || selectedDay > today))
        return reply({ error: "Invalid selected day" }, 400);
      const analytics = this.repository.analytics(start, end, limit, offset, period, selectedDay);
      analytics.visitors = analytics.visitors.map(row => ({ ...row, country: normalizeCountry(row.country) }));
      return reply({ ...analytics,
        overall: this.repository.overall(), months: this.repository.months(today),
        today: this.service.count(), month, start, end, period, scope, timezone: "Asia/Taipei" });
    }
    let id, visitId, metadataOnly = false;
    if (request.method === "POST") {
      if (Number(request.headers.get("Content-Length")) > 512) return reply({ error: "Invalid heartbeat" }, 413);
      // Bound streamed bodies too: Content-Length is optional and untrusted.
      const reader = request.body?.getReader();
      let raw = "", length = 0;
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 512) { await reader.cancel(); return reply({ error: "Invalid heartbeat" }, 413); }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      }
      try { const body = JSON.parse(raw); id = body.id; visitId = body.visitId;
        if (body.metadataOnly !== undefined && typeof body.metadataOnly !== "boolean") return reply({ error: "Invalid visit metadata option" }, 400);
        metadataOnly = body.metadataOnly ?? false;
        // Ignore retired nationality fields from older PWAs; geography is edge-derived only.
      } catch { return reply({ error: "Invalid heartbeat" }, 400); }
    }
    try {
      if (request.method === "POST") { this.service.heartbeat(id, { visitId, metadataOnly, ip: request.headers.get("CF-Connecting-IP"), country: requestCountry(request) }); return reply({ recorded: true }); }
      return reply(this.service.count());
    } catch (error) {
      if (error instanceof InvalidPresenceIdentifier) return reply({ error: error.message }, 400);
      throw error;
    }
  }
}

export async function presenceResponse(request, env) {
  const url = new URL(request.url);
  if (!["GET", "POST"].includes(request.method)) return reply({ error: "Method not allowed" }, 405);
  const origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site")
    return reply({ error: "Same-origin requests required" }, 403);
  if (request.method === "GET") {
    let user;
    try { user = await currentUser(request, env); }
    catch { return reply({ error: "帳號服務暫時無法使用" }, 503); }
    if (!user) return reply({ error: "請先登入" }, 401);
    if (user.mustChangePassword) return reply({ code: "PASSWORD_CHANGE_REQUIRED", error: "請先更改初始密碼" }, 403);
    if (user.role !== "admin") return reply({ error: "僅管理員可查看造訪紀錄" }, 403);
  }
  if (!env.ONLINE_PRESENCE) return reply({ error: "Daily visitor count unavailable" }, 503);
  try {
    const forwarded = new URL(request.url);
    if (request.method === "GET") forwarded.pathname = "/internal/analytics";
    const forwardedRequest = new Request(forwarded, request);
    // Resolve the original edge metadata before cloning/forwarding can lose Request.cf.
    forwardedRequest.headers.set("CF-IPCountry", requestCountry(request) ?? "XX");
    return await env.ONLINE_PRESENCE.getByName("stock-insight-online").fetch(forwardedRequest);
  }
  catch { return reply({ error: "Daily visitor count unavailable" }, 503); }
}
