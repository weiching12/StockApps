import { buildPushPayload } from "@block65/webcrypto-web-push";

// Browser push services only: anonymous subscriptions must not make scheduled sends reach arbitrary hosts.
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com",
  "web.push.apple.com", "notify.windows.com"];
const MAX_ENDPOINT_LENGTH = 1024;
// Trade dates a push service may refuse a subscription before it is deleted.
const MAX_REJECTION_DAYS = 3;
const validEndpoint = (value) => {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};
export const allowedPushEndpoint = (value) => {
  if (typeof value !== "string" || value.length > MAX_ENDPOINT_LENGTH || !validEndpoint(value)) return false;
  const url = new URL(value);
  return !url.username && !url.password && (url.port === "" || url.port === "443") &&
    PUSH_SERVICE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
};
const validKey = (value, max) => typeof value === "string" && value.length >= 8 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);

export class PushService {
  // Workers reject `fetch` invoked as a method of another object ("Illegal invocation"),
  // so the default keeps the global receiver when called as this.fetcher(...).
  constructor(repository, env, fetcher = (input, init) => fetch(input, init)) {
    this.repository = repository;
    this.env = env;
    this.fetcher = fetcher;
  }

  config() {
    return { enabled: Boolean(this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY), publicKey: this.env.VAPID_PUBLIC_KEY ?? null };
  }

  validate(input) {
    if (!input || !allowedPushEndpoint(input.endpoint) || !validKey(input.keys?.p256dh, 256) || !validKey(input.keys?.auth, 64))
      throw Object.assign(new Error("Invalid push subscription"), { code: "INVALID_PUSH_SUBSCRIPTION", status: 400 });
    return { endpoint: input.endpoint, expirationTime: input.expirationTime ?? null,
      keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } };
  }

  async subscribe(input, now = new Date()) {
    const subscription = this.validate(input);
    await this.repository.save(subscription, now.toISOString());
    return { subscribed: true };
  }

  async unsubscribe(input) {
    if (!validEndpoint(input?.endpoint)) throw Object.assign(new Error("Invalid push endpoint"), { code: "INVALID_PUSH_ENDPOINT", status: 400 });
    await this.repository.remove(input.endpoint);
    return { subscribed: false };
  }

  /** Delivery counts for one trade date, by push service, for the administrator page. */
  async status(asOf) {
    const services = await this.repository.status(asOf);
    const sum = (key) => services.reduce((total, row) => total + row[key], 0);
    return { total: sum("total"), delivered: sum("delivered"), rejected: sum("rejected"), pending: sum("pending"), services };
  }

  async notifyPublished(manifest) {
    if (!this.config().enabled) return { sent: 0, skipped: true };
    const rows = await this.repository.pending(manifest.asOf, 501);
    const stale = [];
    let sent = 0, failed = 0, rejected = 0, pruned = 0;
    const data = JSON.stringify({ title: "株研資料已更新", body: `${manifest.asOf} 台股行情與法人資料已完成更新`,
      url: "/", tag: `market-${manifest.asOf}`, generation: manifest.generation });
    for (const row of rows.slice(0, 500)) {
      // Rows saved before the host allowlist existed are dropped instead of contacted.
      if (!allowedPushEndpoint(row.endpoint)) { stale.push(row.endpoint); continue; }
      const subscription = { endpoint: row.endpoint, expirationTime: null, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        // No Topic header: Apple refuses "market-YYYY-MM-DD" as BadWebPushTopic, and the
        // notification tag already replaces an earlier update on the device.
        const payload = await buildPushPayload({ data, options: { ttl: 86400, urgency: "normal" } }, subscription,
          { subject: this.env.VAPID_SUBJECT, publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY });
        const response = await this.fetcher(subscription.endpoint, payload);
        const endpointHost = new URL(row.endpoint).host;
        if (response.ok) { sent++; await this.repository.mark(row.endpoint, manifest.asOf); }
        else if (response.status === 404 || response.status === 410) stale.push(row.endpoint);
        else if (response.status === 429 || response.status >= 500) {
          // Temporary: retried on the next scheduled attempt today.
          failed++;
          console.error(JSON.stringify({ event: "push-failed", status: response.status, endpointHost, reason: await rejectionReason(response) }));
        } else {
          // Refused: skipped for the rest of this trade date and removed after repeated days.
          rejected++;
          const reason = await rejectionReason(response);
          const failureDays = await this.repository.recordRejection(row.endpoint, manifest.asOf, `${response.status} ${reason}`.trim(), MAX_REJECTION_DAYS);
          if (!failureDays) pruned++;
          console.error(JSON.stringify({ event: failureDays ? "push-rejected" : "push-pruned", status: response.status, endpointHost, reason, failureDays }));
        }
      } catch (error) { failed++; console.error(JSON.stringify({ event: "push-failed", error: error.message })); }
    }
    await this.repository.removeMany(stale);
    return { sent, removed: stale.length + pruned, failed, rejected, hasMore: rows.length > 500 };
  }
}

/** Push services explain refusals in the body, e.g. Apple's {"reason":"BadJwtToken"}. Never includes the endpoint. */
async function rejectionReason(response) {
  let text = "";
  try { text = (await response.text()).slice(0, 500); } catch { return ""; }
  try {
    const body = JSON.parse(text);
    const reason = body?.reason ?? body?.error?.message ?? body?.error ?? body?.message;
    if (typeof reason === "string") return reason.slice(0, 120);
  } catch { /* plain-text body */ }
  return text.replace(/\s+/g, " ").trim().slice(0, 120);
}
