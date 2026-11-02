// Entry research model settings. Every value here is a PROVISIONAL research parameter:
// none has been validated by a historical backtest yet. Change them only here, and bump
// ENTRY_RESEARCH_MODEL_VERSION whenever a change alters any result so saved samples of
// different versions stay comparable. There is deliberately no user-facing override.
export const ENTRY_RESEARCH_MODEL_VERSION = "entry-research-v1";

export const ENTRY_RESEARCH_MODEL = Object.freeze({
  version: ENTRY_RESEARCH_MODEL_VERSION,
  provisional: true,
  // Readiness score = weighted mean of three 0-100 components.
  weights: Object.freeze({ structure: 50, signal: 30, timing: 20 }),
  pullback: Object.freeze({
    lookbackSessions: 5,       // sessions before the trigger day that may contain the pullback
    touchAtrBand: 0.5,         // a low within MA20 + 0.5 × ATR14 counts as touching MA20
    invalidationAtr: 0.25,     // invalidation = pullback low − 0.25 × ATR14
    volumeConfirmRvol: 1,      // RVOL20 at or above this confirms the recovery's volume
  }),
  breakout: Object.freeze({
    rangeSessions: 20,         // consolidation range: the 20 sessions before the trigger day
    maxRangeAtr: 4,            // range high − range low must be at most 4 × ATR14
    minRvol: 1.5,              // the breakout day's RVOL20 must reach 1.5
    strongRvol: 2,             // RVOL20 at or above this counts as strong volume confirmation
    invalidationAtr: 1,        // invalidation = max(range high − 1 × ATR14, range low)
  }),
  signal: Object.freeze({
    validSessions: 3,          // trigger day plus the next two sessions
    lookbackSessions: 10,      // how far back a past trigger is reported as expired/invalidated
  }),
  plan: Object.freeze({
    upperAtr: 0.5,             // acceptable upper price = entry reference + 0.5 × ATR14
    maxRiskPercent: 8,         // from the upper price down to invalidation
  }),
  // Backtest assumptions (used by the outcome module in a later batch).
  costs: Object.freeze({ commissionPercent: 0.1425, sellTaxPercent: 0.3, slippagePercent: 0.1 }),
  outcomeHorizons: Object.freeze([1, 5, 10, 20]),
});

export const ENTRY_RESEARCH_STATUS_LABELS = Object.freeze({
  WAIT_TRIGGER: "等待進場訊號", TRIGGERED: "進場訊號已觸發", SIGNAL_EXPIRED: "訊號已過期",
  SIGNAL_INVALIDATED: "訊號失效", DATA_INSUFFICIENT: "資料不足", NOT_ELIGIBLE: "未通過五大門檻",
});
export const NEXT_DAY_STATUS_LABELS = Object.freeze({
  NEXT_DAY_CANDIDATE: "明日進場候選", WAIT_TRIGGER: "等待進場訊號", PRICE_TOO_HIGH: "價格超出容許範圍",
  PLAN_INVALIDATED: "原進場計畫失效", DATA_INSUFFICIENT: "資料不足", NOT_ELIGIBLE: "尚未評估",
});
export const SETUP_LABELS = Object.freeze({ PULLBACK_RECOVERY: "順勢回踩恢復", RANGE_BREAKOUT: "整理區間向上突破" });
