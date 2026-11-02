import { getPriceVolumeSignal } from "./indicators.js";
import { CORE_THRESHOLDS, getAtr14, getEntryScore, researchPriceHistory } from "./entry-score.js";
import { ENTRY_RESEARCH_MODEL, ENTRY_RESEARCH_STATUS_LABELS, NEXT_DAY_STATUS_LABELS, SETUP_LABELS } from "./entry-research-model.js";

// Swing-trend entry research: stage 1 gates (the V1.2 core conditions, unchanged),
// stage 2 setup signals and readiness, stage 3 a conditional next-session plan.
// Every evaluation for a session uses only bars dated on or before that session.

const GATE_KEYS = ["trend", "momentum", "priceVolume", "institutional", "entryRisk"];
const GATE_LABELS = Object.freeze({ trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現",
  institutional: "法人籌碼", entryRisk: "基礎價格風險" });
// The thresholds evaluateCoreConditions() applies, worded for display.
const GATE_RULES = Object.freeze({
  trend: "收盤價 > MA20 > MA60，且 MA20、MA60 皆較前一交易日上升",
  momentum: "K > D，且 K 未連續兩個交易日下降",
  priceVolume: `未出現跌幅超過 ${Math.abs(CORE_THRESHOLDS.heavySellChange).toFixed(2)}% 且 RVOL20 ≥ ${CORE_THRESHOLDS.heavySellRvol} 的放量下跌`,
  institutional: "近五個交易日三大法人合計淨額 ≥ 0",
  entryRisk: `MA20 乖離 ≤ ${CORE_THRESHOLDS.maxMa20Deviation}%，且前十個交易日最低價低於收盤價`,
});

const round2 = (value) => Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : null;
const validPrice = (value) => Number.isFinite(value) && value > 0;
const validBar = (bar) => bar && [bar.open, bar.high, bar.low, bar.close].every(validPrice);
const weighted = (values, weights) => Object.keys(weights).reduce((sum, key) => sum + values[key] * weights[key], 0) /
  Object.values(weights).reduce((sum, weight) => sum + weight, 0);

/** Stage 1: all five gates must PASS; a FAIL is never offset, and UNKNOWN or missing
 * prerequisite data (61 complete sessions, verified corporate actions) is never a PASS. */
export function evaluateGates(score) {
  const conditions = Object.fromEntries(GATE_KEYS.map((key) => [key, score?.coreConditions?.[key]?.status ?? "UNKNOWN"]));
  const passedCount = GATE_KEYS.filter((key) => conditions[key] === "PASS").length;
  const failed = GATE_KEYS.filter((key) => conditions[key] === "FAIL");
  const missingData = [...(score?.missingData ?? [])];
  const status = failed.length ? "FAIL" : passedCount === GATE_KEYS.length && !missingData.length ? "PASS" : "UNKNOWN";
  const details = Object.fromEntries(GATE_KEYS.map((key) => [key, { label: GATE_LABELS[key], rule: GATE_RULES[key],
    status: conditions[key], reason: score?.coreConditions?.[key]?.reason ?? "尚無判斷資料",
    data: score?.coreConditions?.[key]?.data ?? {} }]));
  const reasons = [
    ...GATE_KEYS.filter((key) => conditions[key] !== "PASS").map((key) => `${GATE_LABELS[key]}：${details[key].reason}`),
    ...missingData,
  ];
  return { status, passedCount, totalCount: GATE_KEYS.length, conditions, details, reasons };
}

function sessionReader(history, tradingDates, asOf) {
  const byDate = new Map((history ?? []).filter((bar) => bar.date <= asOf).map((bar) => [bar.date, bar]));
  const index = tradingDates?.indexOf(asOf) ?? -1;
  const bar = (at) => at >= 0 && at <= index ? byDate.get(tradingDates[at]) ?? null : null;
  const window = (from, to) => {
    if (from < 0) return null;
    const bars = [];
    for (let at = from; at <= to; at++) { const value = bar(at); if (!validBar(value)) return null; bars.push(value); }
    return bars;
  };
  // ATR14 over the same 61-session window V1.2 uses, ending at the evaluated session.
  const atr = (at) => { const bars = window(at - 60, at); return bars ? getAtr14(bars) : null; };
  const rvol = (at) => {
    const value = bar(at);
    return value ? getPriceVolumeSignal(history, tradingDates, value.date, value.changePercent).rvol20 : null;
  };
  return { index, bar, window, atr, rvol };
}

/** Pullback recovery on session `at`: a recent touch of MA20 that held above MA60, then a
 * close back above MA20 and the prior high with K rising. */
function pullbackAt(reader, at, model) {
  const rules = model.pullback, today = reader.bar(at), previous = reader.bar(at - 1), atr = reader.atr(at);
  const window = reader.window(at - rules.lookbackSessions, at - 1);
  if (!validBar(today) || !validBar(previous) || !window || !Number.isFinite(atr) ||
      ![today.ma20, today.ma60, today.k, today.d, previous.k].every(Number.isFinite) ||
      window.some((bar) => !validPrice(bar.ma20) || !validPrice(bar.ma60))) return null;
  const touches = window.filter((bar) => bar.low <= bar.ma20 + rules.touchAtrBand * atr);
  const held = window.every((bar) => bar.close >= bar.ma60);
  const rvol20 = reader.rvol(at);
  const checks = [
    { met: touches.length > 0, text: `近 ${rules.lookbackSessions} 個交易日最低價曾回到 MA20 + ${rules.touchAtrBand} × ATR14 以內` },
    { met: held, text: "回踩期間收盤未跌破 MA60" },
    { met: today.close > today.ma20, text: "收盤重新站上 MA20" },
    { met: today.close > previous.high, text: "收盤高於前一交易日最高價" },
    { met: today.k > previous.k, text: "K 值較前一交易日上升" },
  ];
  const low = Math.min(...window.map((bar) => bar.low), today.low);
  return {
    setupType: "PULLBACK_RECOVERY", date: today.date, formed: checks[0].met && checks[1].met,
    triggered: checks.every((check) => check.met), checks, atr14: atr, rvol20,
    kdConfirmed: today.k > today.d && today.k > previous.k,
    volumeConfirmed: Number.isFinite(rvol20) ? rvol20 >= rules.volumeConfirmRvol : null,
    triggerPrice: today.close, entryReferencePrice: today.close, referenceMa20: today.ma20,
    invalidationPrice: low - rules.invalidationAtr * atr,
    evidence: { pullbackDates: touches.map((bar) => bar.date), pullbackLow: low, ma20: today.ma20, ma60: today.ma60,
      previousHigh: previous.high },
  };
}

/** Range breakout on session `at`: a compact 20-session range (excluding `at`) whose high the
 * close crosses for the first time, on RVOL20 confirmation with K above D. */
function breakoutAt(reader, at, model) {
  const rules = model.breakout, today = reader.bar(at), previous = reader.bar(at - 1), atr = reader.atr(at);
  const range = reader.window(at - rules.rangeSessions, at - 1);
  if (!validBar(today) || !validBar(previous) || !range || !Number.isFinite(atr) ||
      ![today.k, today.d].every(Number.isFinite)) return null;
  const rangeHigh = Math.max(...range.map((bar) => bar.high)), rangeLow = Math.min(...range.map((bar) => bar.low));
  const rvol20 = reader.rvol(at);
  const checks = [
    { met: rangeHigh - rangeLow <= rules.maxRangeAtr * atr, text: `前 ${rules.rangeSessions} 個交易日區間振幅不超過 ${rules.maxRangeAtr} × ATR14` },
    { met: today.close > rangeHigh && previous.close <= rangeHigh, text: "收盤首次突破整理區間上緣" },
    { met: Number.isFinite(rvol20) && rvol20 >= rules.minRvol, text: `RVOL20 ≥ ${rules.minRvol}` },
    { met: today.k > today.d, text: "K 值高於 D 值" },
  ];
  return {
    setupType: "RANGE_BREAKOUT", date: today.date, formed: checks[0].met,
    triggered: checks.every((check) => check.met), checks, atr14: atr, rvol20,
    kdConfirmed: today.k > today.d, volumeConfirmed: Number.isFinite(rvol20) ? rvol20 >= rules.strongRvol : null,
    triggerPrice: today.close, entryReferencePrice: rangeHigh, referenceMa20: today.ma20,
    invalidationPrice: Math.max(rangeHigh - rules.invalidationAtr * atr, rangeLow),
    evidence: { rangeStart: range[0].date, rangeEnd: range.at(-1).date, rangeHigh, rangeLow,
      breakoutPercent: (today.close - rangeHigh) / rangeHigh * 100 },
  };
}

function signalQuality(signal, age, model) {
  let score = 60 + (signal.kdConfirmed ? 15 : 0) + (signal.volumeConfirmed ? 15 : signal.setupType === "RANGE_BREAKOUT" ? 5 : 0);
  score += age === 0 ? 10 : age === 1 ? 5 : 0;
  return Math.min(100, score) * (age < model.signal.validSessions ? 1 : 0);
}

/** Stage 2 signal state at asOf from the most recent trigger within the lookback. */
function findSignal(reader, model) {
  const { index } = reader;
  for (let age = 0; age < model.signal.lookbackSessions && index - age >= 0; age++) {
    const at = index - age;
    const candidates = [pullbackAt(reader, at, model), breakoutAt(reader, at, model)].filter((signal) => signal?.triggered);
    if (!candidates.length) continue;
    const signal = candidates.sort((a, b) => signalQuality(b, age, model) - signalQuality(a, age, model))[0];
    let invalidatedOn = null;
    for (let later = at + 1; later <= index; later++) {
      const bar = reader.bar(later);
      if (validBar(bar) && bar.close < signal.invalidationPrice) { invalidatedOn = bar.date; break; }
    }
    const status = invalidatedOn ? "SIGNAL_INVALIDATED" : age < model.signal.validSessions ? "TRIGGERED" : "SIGNAL_EXPIRED";
    return { ...signal, status, age, validUntilSession: model.signal.validSessions - 1 - age, invalidatedOn };
  }
  return null;
}

const devScore = (deviation) => deviation <= 3 ? 100 : deviation <= 6 ? 70 : deviation <= 10 ? 30 : 0;
const chaseScore = (atrUnits) => atrUnits <= 0.25 ? 100 : atrUnits <= 0.5 ? 70 : atrUnits <= 1 ? 30 : 0;

/** Stage 3: a conditional plan for the next session. No live quotes exist, so a candidate
 * always needs the next session's actual prices before anything can be confirmed. */
function nextDayPlan(status, signal, today, reader, tradingDates, model, base) {
  const plan = { status: null, label: null, setupType: signal?.setupType ?? null, referenceClose: today?.close ?? null,
    entryReferencePrice: null, entryPriceLower: null, entryPriceUpper: null, invalidationPrice: null,
    riskPercent: null, maxRiskPercent: null, atr14: null, planAsOf: base.asOf,
    planExpiresAt: tradingDates?.[reader.index + 1] ?? null, planExpiresAfterSessions: 1,
    requiresPriceConfirmation: true, conditionsToConfirm: [], reasons: [] };
  const done = (code, ...reasons) => Object.assign(plan, { status: code, label: NEXT_DAY_STATUS_LABELS[code],
    reasons: [...plan.reasons, ...reasons] });
  if (status === "NOT_ELIGIBLE") return done("NOT_ELIGIBLE", "五大門檻未全部通過，不建立進場計畫");
  if (status === "DATA_INSUFFICIENT") return done("DATA_INSUFFICIENT", "必要資料不足，無法建立可靠計畫");
  if (status === "SIGNAL_INVALIDATED") return done("PLAN_INVALIDATED", `收盤已跌破策略失效價（${signal.invalidatedOn}）`);
  if (status !== "TRIGGERED") return done("WAIT_TRIGGER", status === "SIGNAL_EXPIRED" ? "原訊號已超過有效期間，等待新的進場訊號" : "尚未出現有效進場訊號");
  const atr = reader.atr(reader.index);
  const entry = signal.entryReferencePrice, invalidation = signal.invalidationPrice;
  if (!Number.isFinite(atr) || !validPrice(entry) || !validPrice(invalidation) || invalidation >= entry)
    return done("DATA_INSUFFICIENT", "無法建立有效的策略失效價或 ATR14，不輸出進場價格");
  const upper = entry + model.plan.upperAtr * atr;
  const riskPercent = (entry - invalidation) / entry * 100, maxRiskPercent = (upper - invalidation) / upper * 100;
  Object.assign(plan, { entryReferencePrice: round2(entry), entryPriceUpper: round2(upper), invalidationPrice: round2(invalidation),
    riskPercent: round2(riskPercent), maxRiskPercent: round2(maxRiskPercent), atr14: round2(atr),
    conditionsToConfirm: [`下一交易日開盤價不高於 ${round2(upper)}`, `開盤價高於策略失效價 ${round2(invalidation)}`,
      "需取得下一交易日實際行情後才能確認，今日收盤不代表明日開盤"] });
  plan.reasons.push("策略未定義可接受價格下限");
  if (today.close > upper) return done("PRICE_TOO_HIGH", `今日收盤 ${round2(today.close)} 已高於可接受上限 ${round2(upper)}，避免追價`);
  if (maxRiskPercent > model.plan.maxRiskPercent)
    return done("PRICE_TOO_HIGH", `以上限價進場至失效價的風險 ${round2(maxRiskPercent)}% 超過 ${model.plan.maxRiskPercent}%`);
  return done("NEXT_DAY_CANDIDATE", "今日盤後符合策略條件，明日仍須確認實際價格");
}

/** Single entry point. `score` may be supplied when the caller already computed V1.2. */
export function evaluateEntryResearch({ stock, tradingDates, asOf, corporateActions = null, settings, score,
  model = ENTRY_RESEARCH_MODEL }) {
  const result = score ?? getEntryScore(stock, tradingDates, asOf, { priceBasis: "unadjusted", corporateActions, settings });
  const gate = evaluateGates(result);
  // The same (possibly dividend-adjusted) prices V1.2 scored, so gates and setups agree.
  const priced = researchPriceHistory(stock, tradingDates, asOf, { corporateActions, settings, priceBasis: "unadjusted" });
  const reader = sessionReader(priced.stock.history, tradingDates, asOf);
  const today = reader.bar(reader.index);
  const base = { stockCode: stock.symbol, asOf, modelVersion: model.version, provisional: model.provisional };
  const dataQuality = { status: gate.status === "UNKNOWN" ? "INSUFFICIENT" : result.conflictingEvidence?.length ? "WARNING" : "VALID",
    priceBasis: result.priceBasis, warnings: [...(result.conflictingEvidence ?? [])], missing: [...(result.missingData ?? [])] };
  const research = { score: null, status: null, label: null, setupType: null, setupLabel: null, componentScores: null,
    weights: { ...model.weights }, signal: null, triggeredConditions: [], pendingConditions: [], strengths: [], weaknesses: [],
    riskWarnings: [...dataQuality.warnings] };
  const finish = (status) => {
    Object.assign(research, { status, label: ENTRY_RESEARCH_STATUS_LABELS[status] });
    return { ...base, gateResult: gate, entryResearch: research,
      nextDayPlan: nextDayPlan(status, research.signal, today, reader, tradingDates, model, base), dataQuality };
  };
  if (gate.status === "FAIL") return finish("NOT_ELIGIBLE");
  if (gate.status !== "PASS" || !validBar(today) || !Number.isFinite(reader.atr(reader.index))) return finish("DATA_INSUFFICIENT");

  const signal = findSignal(reader, model);
  const status = signal?.status ?? "WAIT_TRIGGER";
  // Structure: equal-weighted mean of the five V1.2 component scores (not its weighted final score).
  const categories = GATE_KEYS.map((key) => result.categories?.[key]?.score);
  if (!categories.every(Number.isFinite)) return finish("DATA_INSUFFICIENT");
  const structure = categories.reduce((sum, value) => sum + value, 0) / categories.length;
  let signalScore;
  if (status === "TRIGGERED") signalScore = signalQuality(signal, signal.age, model);
  else if (status === "SIGNAL_EXPIRED") signalScore = 20;
  else if (status === "SIGNAL_INVALIDATED") signalScore = 0;
  else {
    // Waiting: credit a setup that is forming today, capped well below any triggered signal.
    const forming = [pullbackAt(reader, reader.index, model), breakoutAt(reader, reader.index, model)].filter(Boolean);
    const previous = reader.bar(reader.index - 1);
    const kRising = Number.isFinite(previous?.k) && today.k > previous.k;
    signalScore = Math.min(50, (forming.some((setup) => setup.formed) ? 30 : 0) + (kRising ? 10 : 0) +
      (forming.some((setup) => setup.formed && setup.checks.filter((check) => check.met).length >= setup.checks.length - 1) ? 10 : 0));
    for (const setup of forming.filter((item) => item.formed))
      research.pendingConditions.push(...setup.checks.filter((check) => !check.met).map((check) => `${SETUP_LABELS[setup.setupType]}：${check.text}`));
    if (!forming.some((setup) => setup.formed)) research.pendingConditions.push("尚未出現回踩 MA20 或可辨識的整理區間");
  }
  const deviation20 = (today.close - today.ma20) / today.ma20 * 100;
  let timing = devScore(deviation20);
  if (status === "TRIGGERED") timing = Math.min(timing, chaseScore((today.close - signal.entryReferencePrice) / reader.atr(reader.index)));
  const componentScores = { structure: round2(structure), signal: round2(signalScore), timing: round2(timing) };
  research.componentScores = componentScores;
  research.score = round2(weighted(componentScores, model.weights));
  for (const key of GATE_KEYS) {
    const value = result.categories[key].score;
    if (value >= 70) research.strengths.push(`${GATE_LABELS[key]} ${round2(value)} 分`);
    else if (value < 50) research.weaknesses.push(`${GATE_LABELS[key]} ${round2(value)} 分`);
  }
  if (timing < 70) research.weaknesses.push(`收盤較 MA20 乖離 ${round2(deviation20)}%，位置偏離理想觀察區`);
  if (signal) {
    research.signal = { setupType: signal.setupType, setupLabel: SETUP_LABELS[signal.setupType], status: signal.status,
      date: signal.date, age: signal.age, triggerPrice: round2(signal.triggerPrice), referenceMa20: round2(signal.referenceMa20),
      entryReferencePrice: round2(signal.entryReferencePrice), invalidationPrice: round2(signal.invalidationPrice),
      kdConfirmed: signal.kdConfirmed, volumeConfirmed: signal.volumeConfirmed, rvol20: round2(signal.rvol20),
      validSessions: model.signal.validSessions, validUntilSession: signal.validUntilSession,
      invalidatedOn: signal.invalidatedOn, checks: signal.checks, evidence: signal.evidence };
    Object.assign(research, { setupType: signal.setupType, setupLabel: SETUP_LABELS[signal.setupType] });
    research.triggeredConditions.push(...signal.checks.map((check) => check.text));
    if (!signal.kdConfirmed) research.pendingConditions.push("KD 動能尚未完全確認");
    if (signal.volumeConfirmed === false) research.riskWarnings.push("成交量未達確認標準");
    if (signal.setupType === "RANGE_BREAKOUT" && signal.evidence.breakoutPercent > 3)
      research.riskWarnings.push(`收盤高於區間上緣 ${round2(signal.evidence.breakoutPercent)}%，追價風險較高`);
  }
  return finish(status);
}

/** Compact fields for whole-market lists; the full result stays in the analysis resource. */
export function entryResearchSummary(result) {
  return { modelVersion: result.modelVersion, gateStatus: result.gateResult.status, gatePassed: result.gateResult.passedCount,
    gateTotal: result.gateResult.totalCount, gateConditions: result.gateResult.conditions,
    score: result.entryResearch.score, status: result.entryResearch.status, setupType: result.entryResearch.setupType,
    signalDate: result.entryResearch.signal?.date ?? null, nextDayStatus: result.nextDayPlan.status,
    dataQuality: result.dataQuality.status };
}

/** Next-session check from daily OHLC only: the open decides; intraday order is unknown. */
export function checkNextDayPlan(plan, nextBar) {
  if (plan?.status !== "NEXT_DAY_CANDIDATE") return { status: "NOT_APPLICABLE", fillPrice: null };
  if (!validPrice(nextBar?.open)) return { status: "AWAITING_PRICE", fillPrice: null, reason: "等待下一交易日實際價格確認" };
  if (nextBar.open > plan.entryPriceUpper)
    return { status: "OPEN_ABOVE_UPPER", fillPrice: null, reason: `開盤價 ${nextBar.open} 高於可接受上限 ${plan.entryPriceUpper}，不追價` };
  if (nextBar.open <= plan.invalidationPrice)
    return { status: "OPEN_BELOW_INVALIDATION", fillPrice: null, reason: `開盤價 ${nextBar.open} 已不高於失效價 ${plan.invalidationPrice}，計畫取消` };
  return { status: "WITHIN_PLAN", fillPrice: nextBar.open, reason: "開盤價符合計畫" };
}
