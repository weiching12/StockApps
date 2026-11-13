import { MarketRepository } from "./repositories/market-repository.js";
import { MarketService } from "./services/market-service.js";
import { AnalysisService } from "./services/analysis-service.js";
import { MarketSummaryService } from "./services/market-summary-service.js";
import { HistoryService } from "./services/history-service.js";
import { PushRepository } from "./repositories/push-repository.js";
import { PushService } from "./services/push-service.js";
import { NativePushRepository } from "./repositories/native-push-repository.js";
import { NativePushService } from "./services/native-push-service.js";
import { CorporateActionRepository } from "./corporate-actions/repository.js";
import { ResearchSnapshotRepository } from "./repositories/research-snapshot-repository.js";
import { EntryResearchRepository } from "./repositories/entry-research-repository.js";
import { EntryResearchService } from "./services/entry-research-service.js";
import { EtfInfoRepository } from "./etf-info/repository.js";
import { EtfInfoService } from "./services/etf-info-service.js";

// Environment bindings are assembled here, outside application services.
export const createMarketService = (env) => new MarketService(new MarketRepository(env.MARKET_DATA,
  env.MARKET_HISTORY_ENABLED === "1" ? env.T86_DB : null));

export function createApplicationServices(env) {
  const market = createMarketService(env);
  const actions = env.CORPORATE_ACTIONS_ENABLED === "1" ? new CorporateActionRepository(env.T86_DB) : null;
  const research = env.T86_DB ? new ResearchSnapshotRepository(env.T86_DB) : null;
  return { market, actions, research, analysis: new AnalysisService(market, actions), summary: new MarketSummaryService(market, actions, research), history: new HistoryService(market, actions),
    etfInfo: new EtfInfoService(market, env.ETF_INFO_ENABLED === "1" && env.T86_DB ? new EtfInfoRepository(env.T86_DB) : null),
    entryResearch: new EntryResearchService(env.T86_DB ? new EntryResearchRepository(env.T86_DB) : null),
    push: new PushService(new PushRepository(env.T86_DB), env),
    nativePush: new NativePushService(new NativePushRepository(env.T86_DB), env) };
}

export const createPushService = (env) => {
  const web = new PushService(new PushRepository(env.T86_DB), env);
  const native = new NativePushService(new NativePushRepository(env.T86_DB), env);
  return { async notifyPublished(manifest) {
    const result = await web.notifyPublished(manifest);
    // Native devices wait while browser sends remain, so one tick never doubles its outbound requests.
    if (!native.config().enabled || result.hasMore) return result;
    const nativeResult = await native.notifyPublished(manifest);
    return { sent: result.sent + nativeResult.sent, removed: (result.removed ?? 0) + nativeResult.removed,
      failed: (result.failed ?? 0) + nativeResult.failed, rejected: result.rejected ?? 0,
      hasMore: result.hasMore || nativeResult.hasMore, skipped: false };
  } };
};
