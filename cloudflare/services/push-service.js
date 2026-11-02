import { buildPushPayload } from "@block65/webcrypto-web-push";

// Browser push services only: anonymous subscriptions must not make scheduled sends reach arbitrary hosts.
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com",
  "web.push.apple.com", "notify.windows.com"];
const MAX_ENDPOINT_LENGTH = 1024;
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
  constructor(repository, env, fetcher = fetch) {
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

  async notifyPublished(manifest) {
    if (!this.config().enabled) return { sent: 0, skipped: true };
    const rows = await this.repository.pending(manifest.asOf, 501);
    const stale = [];
    let sent = 0, failed = 0;
    const data = JSON.stringify({ title: "株研資料已更新", body: `${manifest.asOf} 台股行情與法人資料已完成更新`,
      url: "/", tag: `market-${manifest.asOf}`, generation: manifest.generation });
    for (const row of rows.slice(0, 500)) {
      // Rows saved before the host allowlist existed are dropped instead of contacted.
      if (!allowedPushEndpoint(row.endpoint)) { stale.push(row.endpoint); continue; }
      const subscription = { endpoint: row.endpoint, expirationTime: null, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        const payload = await buildPushPayload({ data, options: { ttl: 86400, urgency: "normal", topic: `market-${manifest.asOf}` } }, subscription,
          { subject: this.env.VAPID_SUBJECT, publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY });
        const response = await this.fetcher(subscription.endpoint, payload);
        if (response.ok) { sent++; await this.repository.mark(row.endpoint, manifest.asOf); }
        else if (response.status === 404 || response.status === 410) stale.push(row.endpoint);
        else { failed++; console.error(JSON.stringify({ event: "push-failed", status: response.status, endpointHost: new URL(row.endpoint).host })); }
      } catch (error) { failed++; console.error(JSON.stringify({ event: "push-failed", error: error.message })); }
    }
    await this.repository.removeMany(stale);
    return { sent, removed: stale.length, failed, hasMore: rows.length > 500 };
  }
}
