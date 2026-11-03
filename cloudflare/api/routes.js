import { SHARD_COUNT, validSymbol } from "../../shared/market-codec.js";

export function resolveApiRoute(path) {
  const versioned = path === "/api/v1" || path.startsWith("/api/v1/");
  const route = (name, params = {}, methods = ["GET", "HEAD"]) => ({ name, params, methods, versioned });
  const auth = path.match(/^\/api\/v1\/auth\/(login|logout|me|change-password)$/);
  if (auth) return route("auth", { action: auth[1] }, auth[1] === "me" ? ["GET"] : ["POST"]);
  if (path === "/api/presence" || path === "/api/v1/presence") return route("presence", {}, ["GET", "POST"]);
  if (path === "/api/v1/push/config") return route("pushConfig");
  if (path === "/api/v1/push/native/config") return route("nativePushConfig");
  if (path === "/api/v1/push/native/subscriptions") return route("nativePushSubscriptions", {}, ["POST", "DELETE"]);
  if (path === "/api/v1/push/subscriptions") return route("pushSubscriptions", {}, ["POST", "DELETE"]);
  if (path === "/api/v1/push/resend") return route("pushResend", {}, ["POST"]);
  if (path === "/api/v1/push/status") return route("pushStatus", {}, ["GET"]);
  const resource = versioned ? path.slice(7) : path.slice(4);
  if (resource === "/market") return route("market");
  if (versioned && resource === "/market/summary") return route("marketSummary");
  if (versioned && resource === "/favorites/summary") return route("favoriteSummary");
  if (versioned && resource === "/favorites/research") return route("favoriteResearch");
  if (versioned && resource === "/research/samples") return route("researchSamples");
  if (versioned && resource === "/research/backtest") return route("researchBacktest");
  const sector = versioned && resource.match(/^\/sectors\/([^/]+)$/);
  if (sector) return route("sectorDetail", { name: sector[1] });
  if (versioned && resource === "/stocks") return route("stocks");
  const chunk = resource.match(versioned
    ? /^\/market\/snapshots\/([a-z0-9-]{1,64})\/shards\/(\d{1,3})$/
    : /^\/market\/([a-z0-9-]{1,64})\/(\d{1,3})$/);
  if (chunk && Number(chunk[2]) < SHARD_COUNT)
    return route("snapshot", { generation: chunk[1], index: Number(chunk[2]) });
  const stock = resource.match(/^\/stocks\/([^/]+)(\/(?:history|analysis|review))?$/);
  if (stock && validSymbol(stock[1]) && (!stock[2] || versioned))
    return route(stock[2] === "/analysis" ? "analysis" : stock[2] === "/history" ? "history" : stock[2] === "/review" ? "review" : "stock", { symbol: stock[1] });
  return { name: null, params: {}, methods: [], versioned };
}
