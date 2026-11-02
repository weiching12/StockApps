const tokens = new Map();
const encode = (value) => btoa(String.fromCharCode(...new Uint8Array(value)))
  .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const json64 = (value) => encode(new TextEncoder().encode(JSON.stringify(value)));

export class ApnsClient {
  // A bare `fetch` stored on the instance would run with the wrong receiver in Workers.
  constructor(env, fetcher = (input, init) => fetch(input, init), now = Date.now) { this.env = env; this.fetcher = fetcher; this.now = now; }
  async authorization() {
    const { APNS_PRIVATE_KEY: pem, APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId } = this.env;
    const key = `${keyId}:${teamId}:${pem}`;
    const now = Math.floor(this.now() / 1000);
    const cached = tokens.get(key);
    if (cached && now >= cached.issuedAt && now - cached.issuedAt < 50 * 60) return cached.promise;
    const promise = (async () => {
      const raw = pem.replaceAll("\\n", "\n").replace(/-----[^-]+-----|\s/g, "");
      const privateKey = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
        { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      const data = `${json64({ alg: "ES256", kid: keyId })}.${json64({ iss: teamId, iat: now })}`;
      const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(data));
      return `${data}.${encode(signature)}`;
    })();
    const entry = { issuedAt: now, promise };
    tokens.set(key, entry);
    if (tokens.size > 4) tokens.delete(tokens.keys().next().value);
    promise.catch(() => { if (tokens.get(key) === entry) tokens.delete(key); });
    return promise;
  }
  async send(row, manifest) {
    const host = row.environment === "production" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
    const response = await this.fetcher(`https://${host}/3/device/${row.token}`, {
      method: "POST", signal: AbortSignal.timeout(10_000), headers: { authorization: `bearer ${await this.authorization()}`,
        "apns-topic": this.env.APNS_BUNDLE_ID, "apns-push-type": "alert", "apns-priority": "10",
        "apns-collapse-id": `market-${manifest.asOf}`,
        "apns-expiration": String(Math.floor(this.now() / 1000) + 86400), "Content-Type": "application/json" },
      body: JSON.stringify({ aps: { alert: { title: "株研資料已更新",
        body: `${manifest.asOf} 台股行情與法人資料已完成更新` }, sound: "default" },
        generation: manifest.generation, asOf: manifest.asOf, page: "market" }),
    });
    let body;
    try { body = await response.json(); } catch { body = null; }
    return { ok: response.ok, status: response.status,
      invalidToken: response.status === 410 || response.status === 400 && body?.reason === "BadDeviceToken" };
  }
}
