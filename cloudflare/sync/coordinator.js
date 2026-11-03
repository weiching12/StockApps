import { syncMarket, syncSlot } from "../sync.js";
import { SYNC_KEY } from "../storage/market-keys.js";
import { CoordinatorStore } from "./coordinator-store.js";
import { SyncMetrics, saveSyncMetrics } from "./metrics.js";
import { captureEntryResearch } from "../entry-research-capture.js";

export class MarketSyncCoordinator {
  constructor(ctx, env) {
    this.storage = ctx.storage;
    this.env = env;
    this.metrics = new SyncMetrics();
    this.kv = new CoordinatorStore(ctx.storage, this.metrics.wrap(env.MARKET_DATA));
    this.tail = Promise.resolve();
    this.run = syncMarket;
    this.captureEntry = captureEntryResearch;
  }
  // External I/O yields execution in a DO. Serialize the full phase explicitly;
  // do not hold blockConcurrencyWhile across slow upstream fetches.
  fetch(request) {
    const result = this.tail.then(() => this.handle(request));
    this.tail = result.catch(() => {});
    return result;
  }
  async handle(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/capture-entry-research") {
      await this.kv.recoverPublication();
      return Response.json(await this.captureEntry({ ...this.env, MARKET_DATA: this.kv }));
    }
    if (request.method !== "POST" || url.pathname !== "/tick") return new Response(null, { status: 404 });
    const time = Number(url.searchParams.get("time"));
    if (!url.searchParams.has("time") || !Number.isFinite(time) || !Number.isFinite(new Date(time).getTime()))
      return Response.json({ error: "Invalid scheduled time" }, { status: 400 });
    const now = new Date(time);
    if (!syncSlot(now)) return Response.json({ phase: "outside-window", status: "Skipped" });
    this.metrics.reset();
    const startedAt = Date.now();
    const lastTick = await this.storage.get("lastTick");
    if (lastTick !== undefined && time <= lastTick)
      return Response.json({ ...(await this.kv.get(SYNC_KEY, "json")), duplicate: true });
    await this.kv.recoverPublication();
    const prior = await this.storage.get("progress");
    const state = await this.run({ ...this.env, MARKET_DATA: this.kv }, { now });
    await this.storage.put("lastTick", time);
    // Telemetry cannot turn a successful data checkpoint into a failed sync.
    try { await saveSyncMetrics(this.storage, prior, state, this.metrics.counts, startedAt); }
    catch (error) { console.error(JSON.stringify({ event: "sync-metrics-failed", message: error.message })); }
    return Response.json(state);
  }
}

export async function coordinateMarketSync(env, scheduledTime) {
  if (!env.MARKET_SYNC) throw new Error("MARKET_SYNC binding required; refusing uncoordinated ingestion");
  const response = await env.MARKET_SYNC.getByName("stock-insight-market-sync").fetch(
    new Request(`https://market-sync.internal/tick?time=${scheduledTime}`, { method: "POST" }));
  if (!response.ok) throw new Error(`Market sync coordinator failed: ${response.status}`);
  return response.json();
}

export async function coordinateEntryResearchCapture(env) {
  if (!env.MARKET_SYNC) throw new Error("MARKET_SYNC binding required for entry research capture");
  const response = await env.MARKET_SYNC.getByName("stock-insight-market-sync").fetch(
    new Request("https://market-sync.internal/capture-entry-research", { method: "POST" }));
  if (!response.ok) throw new Error(`Entry research capture coordinator failed: ${response.status}`);
  return response.json();
}
