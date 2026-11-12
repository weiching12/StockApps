import { routeApi } from "./api/router.js";
import { coordinateEntryResearchCapture, coordinateMarketSync } from "./sync/coordinator.js";
import { syncDailyCorporateActions } from "./corporate-actions/sync.js";
import { syncDailyEtfInfo } from "./etf-info/sync.js";
export { MarketSyncCoordinator } from "./sync/coordinator.js";
export { MarketSummaryCoordinator } from "./summary-coordinator.js";
export { OnlinePresence } from "./presence.js";

export async function runScheduled(controller, env, {
  sync = coordinateMarketSync, syncActions = syncDailyCorporateActions, captureEntry = coordinateEntryResearchCapture,
  syncEtfInfo = syncDailyEtfInfo,
} = {}) {
  const state = await sync(env, controller.scheduledTime);
  let actions;
  try { actions = await syncActions(env, state, new Date(controller.scheduledTime)); }
  catch (error) {
    console.error(JSON.stringify({ event: "corporate-actions-delayed", message: error.message }));
    actions = { status: "delayed" };
  }
  // Fund facts are display-only: a failure here never holds back research capture.
  let etfInfo;
  try { etfInfo = await syncEtfInfo(env, state, new Date(controller.scheduledTime)); }
  catch (error) {
    console.error(JSON.stringify({ event: "etf-info-delayed", message: error.message }));
    etfInfo = { status: "delayed" };
  }
  let entryResearch = { status: "not-required" };
  if (state.phase === "done") {
    try { entryResearch = await captureEntry(env); }
    catch (error) {
      console.error(JSON.stringify({ event: "entry-research-capture-delayed", message: error.message }));
      entryResearch = { status: "failed" };
    }
  }
  console.log(JSON.stringify({ event: "twse-sync", date: state.date, slot: state.slot, phase: state.phase,
    t86Status: state.t86Status, nextShard: state.nextShard, failures: state.failures, error: state.error,
    corporateActions: actions.status, corporateActionEvents: actions.events ?? null,
    etfInfo: etfInfo.status, entryResearchCapture: entryResearch.status }));
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    return path === "/api" || path.startsWith("/api/")
      ? routeApi(request, env) : env.ASSETS.fetch(request);
  },
  scheduled: runScheduled,
};
