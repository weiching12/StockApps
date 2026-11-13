import { authController } from "../auth/controller.js";
import { createApplicationServices } from "../composition.js";
import { AnalysisService } from "../services/analysis-service.js";
import { HistoryService } from "../services/history-service.js";
import { EtfInfoService } from "../services/etf-info-service.js";
import { MarketSummaryService } from "../services/market-summary-service.js";
import { resolveApiRoute } from "./routes.js";
import { marketController } from "./market-controller.js";
import { presenceController } from "./presence-controller.js";
import { pushController, pushResendController, pushStatusController } from "./push-controller.js";
import { apiFailure } from "./errors.js";
import { json, error } from "./http.js";
import { signedInUser } from "./session-guard.js";

const SIGNED_IN_ROUTES = new Set(["researchSamples", "researchBacktest"]);
// A MarketSummaryCoordinator instance of its own, so research entries never evict summaries.
const RESEARCH_CACHE_NAME = "stock-insight-research-cache";

export async function routeApi(request, env, injected) {
  const url = new URL(request.url), route = resolveApiRoute(url.pathname);
  if (!route.name) return error(request, route.versioned, "NOT_FOUND", "找不到這個資料端點", 404);
  if (!route.methods.includes(request.method)) return error(request, route.versioned,
    "METHOD_NOT_ALLOWED", "Method not allowed", 405, { Allow: route.methods.join(", ") });
  try {
    if (route.name === "auth") return await authController(request, env, route.params.action);
    if (route.name === "presence") return await presenceController(request, env, route.versioned);
    if (!injected && env.MARKET_SUMMARY && ["marketSummary", "favoriteSummary", "sectorDetail"].includes(route.name))
      return await env.MARKET_SUMMARY.getByName("stock-insight-market-summary").fetch(request);
    if (SIGNED_IN_ROUTES.has(route.name)) {
      const { failure } = await (injected?.signedInUser ?? signedInUser)(request, env);
      if (failure) return failure;
      // Each backtest or sample page aggregates every saved sample; serve repeats from the cache.
      if (!injected && env.MARKET_SUMMARY) return await env.MARKET_SUMMARY.getByName(RESEARCH_CACHE_NAME).fetch(request);
    }
    const services = injected?.market && typeof injected.market !== "function" ? injected : injected
      ? { market: injected, analysis: new AnalysisService(injected), summary: new MarketSummaryService(injected), history: new HistoryService(injected), etfInfo: new EtfInfoService(injected) }
      : createApplicationServices(env);
    if (route.name === "pushConfig" || route.name === "pushSubscriptions")
      return await pushController(request, route, services.push);
    if (route.name === "pushResend") return await pushResendController(request, env, services);
    if (route.name === "pushStatus") return await pushStatusController(request, env, services);
    if (route.name === "nativePushConfig" || route.name === "nativePushSubscriptions")
      return await pushController(request, route, services.nativePush);
    const body = await marketController(route, url, services);
    return json(request, body, 200, body.meta?.researchCapture === "failed" || SIGNED_IN_ROUTES.has(route.name) ? "no-store" : route.name === "snapshot"
      ? "public, max-age=86400, immutable" : "public, max-age=60");
  } catch (cause) { return apiFailure(request, route.versioned, cause); }
}
