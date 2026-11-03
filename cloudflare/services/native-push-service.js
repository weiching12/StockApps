import { DomainError } from "../../shared/domain-error.js";
import { ApnsClient } from "./apns-client.js";

const invalid = () => Object.assign(new Error("Invalid native push subscription"), { status: 400, code: "INVALID_NATIVE_PUSH" });
const hash = async (secret) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)))]
  .map((n) => n.toString(16).padStart(2, "0")).join("");

export class NativePushService {
  constructor(repository, env, transport = new ApnsClient(env)) { this.repository = repository; this.env = env; this.transport = transport; }
  status(asOf) { return this.repository.status(asOf); }
  config() {
    const environment = this.env.APNS_ENVIRONMENT === "production" ? "production" : "sandbox";
    return { enabled: Boolean(this.env.NATIVE_PUSH_ENABLED === "1" && this.env.T86_DB &&
      this.env.APNS_PRIVATE_KEY && /^[A-Z0-9]{10}$/.test(this.env.APNS_KEY_ID ?? "") &&
      /^[A-Z0-9]{10}$/.test(this.env.APNS_TEAM_ID ?? "") &&
      /^[a-zA-Z0-9.-]+$/.test(this.env.APNS_BUNDLE_ID ?? "")), provider: "apns", environment };
  }
  validate(input) {
    if (!input || !/^[a-f0-9]{32,512}$/i.test(input.token ?? "") || input.token.length % 2 ||
        !["sandbox", "production"].includes(input.environment) || !/^[a-f0-9]{64}$/.test(input.secret ?? "")) throw invalid();
    return { token: input.token.toLowerCase(), environment: input.environment };
  }
  async subscribe(input, now = new Date()) {
    if (!this.config().enabled) throw new DomainError("DATA_UNAVAILABLE", "原生通知尚未開放");
    const subscription = this.validate(input);
    if (subscription.environment !== this.config().environment) throw invalid();
    await this.repository.save(subscription, await hash(input.secret), now.toISOString());
    return { subscribed: true };
  }
  async unsubscribe(input) {
    const subscription = this.validate(input);
    await this.repository.remove(subscription, await hash(input.secret));
    return { subscribed: false };
  }
  async notifyPublished(manifest) {
    if (!this.config().enabled) return { sent: 0, removed: 0, failed: 0, hasMore: false };
    const rows = await this.repository.pending(manifest.asOf, this.config().environment, 21);
    let sent = 0, removed = 0, failed = 0;
    for (const row of rows.slice(0, 20)) {
      try {
        const result = await this.transport.send(row, manifest);
        if (result.ok) { await this.repository.mark(row, manifest.asOf); sent++; }
        else if (result.invalidToken) { await this.repository.retire(row); removed++; }
        else { failed++; console.error(JSON.stringify({ event: "apns-send-failed", status: result.status })); }
      } catch { failed++; console.error(JSON.stringify({ event: "apns-send-failed" })); }
    }
    return { sent, removed, failed, hasMore: rows.length > 20 };
  }
}
