import { routeApi } from "./api/router.js";
import { createApplicationServices } from "./composition.js";
import { analysisOptions } from "./api/validators.js";
import { apiFailure } from "./api/errors.js";
import { SummaryCache } from "./summary-cache.js";

const SUMMARY_ROUTES = ["/api/v1/market/summary", "/api/v1/favorites/summary"];
// Bump when the response shape or derived rules change; old Durable Object entries persist across deploys.
const CACHE_SCHEMA = "entry-score-v1.2-research-v2-capture-v9";

export class MarketSummaryCoordinator {
  constructor(ctx, env, cacheOptions) {
    this.env = env;
    this.pending = new Map();
    this.cache = new SummaryCache(ctx.storage, cacheOptions);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    if (!SUMMARY_ROUTES.includes(url.pathname) && !url.pathname.startsWith("/api/v1/sectors/"))
      return new Response(null, { status: 404 });

    let options;
    try { options = analysisOptions(url.searchParams); }
    catch (cause) { return apiFailure(request, true, cause); }
    const { asOf, settings } = options;
    const services = createApplicationServices(this.env);
    const manifest = await services.market.market();
    // Key only on effective validated inputs; ignore ordering and unknown query parameters.
    const canonical = new URLSearchParams({ asOf: asOf || manifest.asOf, ...settings });
    if (url.pathname === "/api/v1/favorites/summary") canonical.set("symbols", url.searchParams.get("symbols") || "");
    url.search = canonical.toString();
    const actionRevision = url.pathname === "/api/v1/market/summary" && services.actions
      ? await services.actions.revision() : "not-applicable";
    const key = `view:${CACHE_SCHEMA}:${manifest.generation}:${actionRevision}:${url.pathname}?${url.searchParams.toString()}`;
    const respond = (body) => new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" },
    });
    const cached = await this.readCached(key);
    if (cached) return respond(cached);

    let task = this.pending.get(key);
    if (!task) {
      task = routeApi(new Request(url, { method: "GET" }), this.env, services).then(async (response) => {
        if (!response.ok) return response;
        const body = await response.json();
        if (body.meta?.generation !== manifest.generation)
          return Response.json({ error: { code: "DATA_UNAVAILABLE", message: "Market generation changed during calculation" } }, { status: 503 });
        const captureFailed = body.meta?.researchCapture === "failed";
        if (!captureFailed) await this.writeCached(key, body);
        // In-flight work is shared by HEAD and GET. Always retain a GET body;
        // strip it only for the individual HEAD caller below.
        return Response.json(body, { headers: { "Cache-Control": captureFailed ? "no-store" : "public, max-age=60" } });
      });
      this.pending.set(key, task);
      task.finally(() => this.pending.delete(key)).catch(() => {});
    }
    const response = await task;
    return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response.clone();
  }

  readCached(key) { return this.cache.read(key); }
  writeCached(key, body) { return this.cache.write(key, body); }
  alarm() { return this.cache.prune(); }
}
