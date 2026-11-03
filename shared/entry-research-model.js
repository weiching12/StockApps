// Entry research model settings. Every value here is a PROVISIONAL research parameter:
// none has been validated by a historical backtest yet. Change them only here, and bump
// ENTRY_RESEARCH_MODEL_VERSION whenever a change alters any result so saved samples of
// different versions stay comparable. There is deliberately no user-facing override.
// v1: stage 1 reuses the V1.2 core conditions. Kept for comparisons and for reading v1 samples.
export const ENTRY_RESEARCH_MODEL_V1 = Object.freeze({
  version: "entry-research-v1",
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
    targetRiskMultiple: 2,     // outcome target = entry reference + 2 × (entry reference − invalidation)
  }),
  // Backtest assumptions (used by the outcome module in a later batch).
  costs: Object.freeze({ commissionPercent: 0.1425, sellTaxPercent: 0.3, slippagePercent: 0.1 }),
  outcomeHorizons: Object.freeze([1, 5, 10, 20]),
});

// v2 (docs/entry-research-gates-v2.md): the first stage only vetoes situations that break the
// swing-trend premise; strength is left to readiness. Signal, plan and cost settings are unchanged.
const reference = (title, kind, url) => Object.freeze({ title, kind, url });
export const ENTRY_RESEARCH_MODEL_V2 = Object.freeze({
  ...ENTRY_RESEARCH_MODEL_V1,
  version: "entry-research-v2",
  gates: Object.freeze({
    kind: "veto",
    trendSlopeSessions: 20,          // G1: MA60 below its value this many sessions earlier = falling
    distributionSessions: 10,        // G2: look-back for an unrecovered heavy-selling day
    heavySellChange: -0.5,           // G2: close change below this percent ...
    heavySellRvol: 2,                // G2: ... on at least this RVOL20
    maxExtensionAtr: 3,              // G3: (close − MA20) ÷ ATR14 above this = overextended
    institutionSessions: 3,          // G4: foreign + investment-trust net over these sessions ...
    institutionNetSellPercent: 5,    // G4: ... selling at least this percent of their volume
    liquiditySessions: 20,           // G5: average traded value (close × shares) over these sessions ...
    minTradingValue: 10_000_000,     // G5: ... below NT$10 million
  }),
  // Readiness structure: V1.2 trend and institutional scores only. KD and volume are scored once,
  // in signal quality; MA20 distance once, in timing; extension is a G3 veto.
  readiness: Object.freeze({ structureCategories: Object.freeze(["trend", "institutional"]) }),
  references: Object.freeze({
    trend: Object.freeze([
      reference("Mark Minervini《Trade Like a Stock Market Wizard》趨勢樣板", "實務規則", "https://therighttrader.com/learn/trading-strategies/minervini-trend-template"),
      reference("Zakamulin 均線策略研究摘要", "學術研究", "https://www.cxoadvisory.com/technical-trading/challenging-sma-effectiveness-for-stocks"),
    ]),
    distribution: Object.freeze([
      reference("William O'Neil《How to Make Money in Stocks》出貨日", "實務規則", "https://discussion.fool.com/t/peak-signals-spotting-a-stocks-direction-with-this-key-market-signal/104495/3"),
    ]),
    extension: Object.freeze([
      reference("Does ATR Extension Predict a Reversal?（納斯達克 100 回測）", "個人回測", "https://backtest.substack.com/p/does-atr-extension-predict-a-reversal"),
    ]),
    institutional: Object.freeze([
      reference("臺灣大學碩士論文：外資買賣超與超額報酬（2021）", "學位論文", "https://tdr.lib.ntu.edu.tw/handle/123456789/74582"),
      reference("中央大學碩士論文：投信與外資買賣超組合報酬（2021）", "學位論文", "https://ir.lib.ncu.edu.tw/bitstream/987654321/85011/1/index.html"),
    ]),
    liquidity: Object.freeze([
      reference("流動性篩選：日均成交金額", "實務文章", "https://ctyeh.com/stock/knowledge/12972"),
      reference("台灣股市流動性溢酬研究", "學術研究", "https://ideas.repec.org/a/asi/aeafrj/v9y2019i7p778-788id1837.html"),
    ]),
  }),
});

// v3: v2 with a one-session signal window. A signal yields a next-day candidate only on its trigger
// day; from the next session it is expired. Measured on 2026-10-01～11-03 history, candidates on the
// trigger day returned +0.68% over 5 sessions while those on days 2–3 lost 0.7–1.2%
// (docs/entry-research-signal-study.md). With one session, a veto during the window cannot occur.
export const ENTRY_RESEARCH_MODEL_V3 = Object.freeze({
  ...ENTRY_RESEARCH_MODEL_V2,
  version: "entry-research-v3",
  signal: Object.freeze({ ...ENTRY_RESEARCH_MODEL_V2.signal, validSessions: 1 }),
});

// The live model: the API, the daily sample capture and demo mode all use it.
export const ENTRY_RESEARCH_MODEL = ENTRY_RESEARCH_MODEL_V3;
export const ENTRY_RESEARCH_MODEL_VERSION = ENTRY_RESEARCH_MODEL.version;

export const ENTRY_RESEARCH_STATUS_LABELS = Object.freeze({
  WAIT_TRIGGER: "等待進場訊號", TRIGGERED: "進場訊號已觸發", SIGNAL_EXPIRED: "訊號已過期",
  SIGNAL_INVALIDATED: "訊號失效", DATA_INSUFFICIENT: "資料不足", NOT_ELIGIBLE: "未通過初步門檻",
});
export const NEXT_DAY_STATUS_LABELS = Object.freeze({
  NEXT_DAY_CANDIDATE: "明日進場候選", WAIT_TRIGGER: "等待進場訊號", PRICE_TOO_HIGH: "價格超出容許範圍",
  PLAN_INVALIDATED: "原進場計畫失效", DATA_INSUFFICIENT: "資料不足", NOT_ELIGIBLE: "尚未評估",
});
export const SETUP_LABELS = Object.freeze({ PULLBACK_RECOVERY: "順勢回踩恢復", RANGE_BREAKOUT: "整理區間向上突破" });
