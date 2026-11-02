import { analyzeHistory, getInstitutionNet, getInstitutionalNet, getPriceVolumeSignal } from "./indicators.js";
import { referenceAdjustedDividendHistory } from "./corporate-actions.js";

export const ENTRY_MODEL_VERSION = "entry-score-v1.2";
export const ENTRY_STRATEGY = "swing-trend";
export const ENTRY_WEIGHTS = Object.freeze({ trend: 25, momentum: 15, priceVolume: 15,
  institutional: 20, entryRisk: 25 });
export const CORE_THRESHOLDS = Object.freeze({ heavySellChange: -0.5, heavySellRvol: 2,
  maxMa20Deviation: 10 });
const CORE_KEYS = Object.keys(ENTRY_WEIGHTS);

const coreResult = (available, passed, reason, data) => ({ status: !available ? "UNKNOWN" : passed ? "PASS" : "FAIL",
  passed: available ? passed : null, reason, data });

/** Five independent gates. Unknown data never counts as a failed gate. */
export function evaluateCoreConditions({ today, previous, dayBefore, completeHistory, rvol20,
  institutionNet5, previous10Low, atr14 }) {
  const trendData = { close: today?.close ?? null, ma20: today?.ma20 ?? null,
    ma60: today?.ma60 ?? null, previousMa20: previous?.ma20 ?? null,
    previousMa60: previous?.ma60 ?? null };
  const trendReady = completeHistory && [trendData.close, trendData.ma20, trendData.ma60,
    trendData.previousMa20, trendData.previousMa60].every(validPrice);
  const trend = trendData.close > trendData.ma20 && trendData.ma20 > trendData.ma60 &&
    trendData.ma20 > trendData.previousMa20 && trendData.ma60 > trendData.previousMa60;
  const trendReason = !trendReady ? "均線或必要交易日資料不足" : trend ? "價格與月線、季線符合順勢排列" :
    trendData.close <= trendData.ma20 ? "收盤價尚未高於 MA20" :
      trendData.ma20 <= trendData.ma60 ? "MA20 尚未高於 MA60" :
        trendData.ma20 <= trendData.previousMa20 ? "MA20 尚未上升" : "MA60 尚未上升";
  const kdData = { k: today?.k ?? null, d: today?.d ?? null,
    previousK: previous?.k ?? null, dayBeforeK: dayBefore?.k ?? null };
  const kdReady = [kdData.k, kdData.d, kdData.previousK, kdData.dayBeforeK].every(Number.isFinite);
  const twoDayFall = kdData.k < kdData.previousK && kdData.previousK < kdData.dayBeforeK;
  const kdPassed = kdData.k > kdData.d && !twoDayFall;
  const kdReason = !kdReady ? "連續三個交易日 KD 資料不足" : kdData.k <= kdData.d
    ? "K 尚未高於 D" : twoDayFall ? "K 連續兩個交易日下降" : "KD 動能符合最低條件";
  const volumeData = { changePercent: today?.changePercent ?? null, rvol20: rvol20 ?? null };
  const volumeReady = Number.isFinite(volumeData.changePercent) && Number.isFinite(volumeData.rvol20);
  const heavySell = volumeData.changePercent < CORE_THRESHOLDS.heavySellChange &&
    volumeData.rvol20 >= CORE_THRESHOLDS.heavySellRvol;
  const volumeReason = !volumeReady ? "當日漲跌幅或 RVOL20 資料不足" : heavySell
    ? "價格下跌超過 0.50% 且成交量達兩倍均量" : "未出現放量下跌的核心否決條件";
  const institutionData = { institutionalNet5: institutionNet5 ?? null };
  const institutionReady = Number.isFinite(institutionNet5);
  const institutionReason = !institutionReady ? "近五日法人資料不完整" : institutionNet5 < 0
    ? "近五日三大法人合計淨賣超" : "近五日三大法人合計未淨賣超";
  const riskData = { deviation20: validPrice(today?.ma20) && validPrice(today?.close)
    ? (today.close - today.ma20) / today.ma20 * 100 : null,
  previous10Low: previous10Low ?? null, close: today?.close ?? null, atr14: atr14 ?? null };
  const riskReady = completeHistory && Number.isFinite(riskData.deviation20) &&
    validPrice(riskData.previous10Low) && validPrice(riskData.close) && Number.isFinite(riskData.atr14);
  const riskPassed = riskData.deviation20 <= CORE_THRESHOLDS.maxMa20Deviation &&
    riskData.previous10Low < riskData.close;
  const riskReason = !riskReady ? "近十日低點、均線或 ATR14 資料不足" :
    riskData.deviation20 > CORE_THRESHOLDS.maxMa20Deviation ? "股價高於 MA20 超過 10%" :
      riskData.previous10Low >= riskData.close ? "風險參考位置不低於現價" : "進場位置與風險符合最低條件";
  return {
    trend: coreResult(trendReady, trend, trendReason, trendData),
    momentum: coreResult(kdReady, kdPassed, kdReason, kdData),
    priceVolume: coreResult(volumeReady, !heavySell, volumeReason, volumeData),
    institutional: coreResult(institutionReady, institutionNet5 >= 0, institutionReason, institutionData),
    entryRisk: coreResult(riskReady, riskPassed, riskReason, riskData),
  };
}

export function getQualifiedEntryScore(baseScore, coreConditions, contributions) {
  if (!Number.isFinite(baseScore) || CORE_KEYS.some((key) => !["PASS", "FAIL"].includes(coreConditions?.[key]?.status) ||
      !Number.isFinite(contributions?.[key]) || contributions[key] < 0))
    return { finalScore: null, qualifiedScore: null };
  const qualifiedScore = CORE_KEYS.reduce((sum, key) => sum +
    (coreConditions[key].status === "PASS" ? contributions[key] : 0), 0);
  return { finalScore: qualifiedScore, qualifiedScore };
}

/** Keep whole-market responses small; stock analysis returns the full result.
 * Per-condition reasons and data stay out: the list never shows them and the
 * detail dialog always loads them from the analysis resource.
 */
export function entryScoreSummary(result) {
  return { modelVersion: result.modelVersion, strategy: result.strategy, asOf: result.asOf,
    baseScore: result.baseScore, qualifiedScore: result.qualifiedScore, finalScore: result.finalScore,
    totalScore: result.totalScore, displayScore: result.displayScore,
    coreConditionsPassed: result.coreConditionsPassed, passedCount: result.passedCount,
    totalConditions: result.totalConditions,
    status: result.status,
    priceCaution: result.conflictingEvidence.some((item) => item.includes("未還原價格")),
    missingData: result.missingData };
}

const NAMES = Object.freeze({ trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現",
  institutional: "法人籌碼", entryRisk: "進場位置與風險" });
const PRICE_VOLUME_SCORES = Object.freeze({
  "price-up-volume-up": 100, "price-up-volume-flat": 70, "price-up-volume-down": 45,
  "price-down-volume-up": 0, "price-down-volume-flat": 15, "price-down-volume-down": 30,
  "volume-up-price-stagnant": 30, "price-volume-flat": 45, "volume-down-range": 40,
});
const INSTITUTION_NAMES = ["外資", "投信", "自營商"];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function institutionalScoreBreakdown(netRatio, buyDays, positiveCategories) {
  const ratioScore = clamp(50 + 50 * netRatio / 0.05, 0, 100);
  const ratioContribution = ratioScore * 0.6;
  const dayContribution = buyDays * 5;
  const categoryContribution = positiveCategories * 5;
  return { ratioScore, ratioContribution, dayContribution, categoryContribution,
    score: ratioContribution + dayContribution + categoryContribution };
}
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const validPrice = (value) => Number.isFinite(value) && value > 0;
const validBar = (bar) => bar && validPrice(bar.open) && validPrice(bar.high) &&
  validPrice(bar.low) && validPrice(bar.close) && bar.high >= Math.max(bar.open, bar.close) &&
  bar.low <= Math.min(bar.open, bar.close);

/** Wilder ATR14. The first ATR is the mean of 14 true ranges; later values use Wilder smoothing. */
export function getAtr14(history) {
  if (!Array.isArray(history) || history.length < 15 || !history.every(validBar)) return null;
  const ranges = history.slice(1).map((bar, index) => Math.max(bar.high - bar.low,
    Math.abs(bar.high - history[index].close), Math.abs(bar.low - history[index].close)));
  let atr = ranges.slice(0, 14).reduce((sum, value) => sum + value, 0) / 14;
  for (const range of ranges.slice(14)) atr = (atr * 13 + range) / 14;
  return atr;
}

const statusFor = (score) => score >= 85 ? "條件高度一致" : score >= 70 ? "進場條件接近完整" :
  score >= 50 ? "部分條件成立" : score >= 30 ? "條件偏弱" : "與目前策略不符";

/** The price history a research model may use at asOf. Dividends inside the 60-session
 * window are reference-adjusted only when every one is verified; otherwise the
 * unadjusted history comes back with `unverified` set so callers withhold results.
 */
export function researchPriceHistory(stock, tradingDates, asOf, options = {}) {
  const priceBasis = options.priceBasis ?? stock.priceBasis ?? "unadjusted";
  const index = tradingDates?.indexOf(asOf) ?? -1;
  const requiredActionDates = index >= 0 ? tradingDates.slice(Math.max(0, index - 59), index + 1) : [];
  const actionDates = new Set(requiredActionDates);
  const actionsForStock = options.corporateActions?.eventsBySymbol?.get(stock.symbol);
  const relevantActions = new Map([...actionsForStock ?? []].filter(([date]) => actionDates.has(date)));
  if (priceBasis !== "unadjusted" || !relevantActions.size)
    return { stock, priceBasis, requiredActionDates, unverified: false };
  const covered = options.corporateActions?.coveredDates;
  const adjusted = [...relevantActions.keys()].every((date) => covered?.has(date))
    ? referenceAdjustedDividendHistory(stock.history, relevantActions) : null;
  return adjusted
    ? { stock: { ...stock, history: analyzeHistory(adjusted, options.settings) }, priceBasis: "reference-adjusted",
      requiredActionDates, unverified: false }
    : { stock, priceBasis, requiredActionDates, unverified: true };
}

/** Pure, calendar-aware research score; future history is ignored. */
export function getEntryScore(stock, tradingDates, asOf, options = {}) {
  const base = { modelVersion: ENTRY_MODEL_VERSION, strategy: ENTRY_STRATEGY, asOf,
    priceBasis: options.priceBasis ?? stock.priceBasis ?? "unadjusted", weights: ENTRY_WEIGHTS,
    baseScore: null, qualifiedScore: null, finalScore: null, totalScore: null, displayScore: null,
    coreConditionsPassed: false,
    passedCount: 0, totalConditions: CORE_KEYS.length, coreConditions: {}, status: "資料不足，無法評分",
    conclusion: "資料不足，無法評分", mainReason: "必要行情與法人資料尚未齊備", categories: {}, supportingEvidence: [], conflictingEvidence: [],
    pendingConditions: [], missingData: [], rawCategories: {}, rawBaseScore: null, rawFinalScore: null };
  const index = tradingDates?.indexOf(asOf) ?? -1;
  if (index < 60) base.missingData.push("需截至評估日連續 61 個市場交易日行情");
  const priced = researchPriceHistory(stock, tradingDates, asOf, { ...options, priceBasis: base.priceBasis });
  const { requiredActionDates } = priced;
  if (priced.priceBasis === "reference-adjusted") {
    stock = priced.stock;
    base.priceBasis = "reference-adjusted";
    base.conflictingEvidence.push("已依核對的除息參考價調整歷史價格；不含股息再投資");
  } else if (priced.unverified) {
    base.missingData.push("公司行動參考價無法核對；未還原價格不適合直接評分");
  }
  const byDate = new Map((stock.history ?? []).filter((bar) => bar.date <= asOf).map((bar) => [bar.date, bar]));
  const window = index >= 0 ? tradingDates.slice(Math.max(0, index - 60), index + 1).map((date) => byDate.get(date)) : [];
  const completeHistory = window.length === 61 && window.every(validBar);
  if (index >= 60 && !completeHistory)
    base.missingData.push("必要交易日行情缺漏或價格無效");
  const today = byDate.get(asOf), previous = byDate.get(tradingDates?.[index - 1]);
  const dayBefore = byDate.get(tradingDates?.[index - 2]);
  const five = window.slice(-5);
  const numbers = [today?.ma20, today?.ma60, previous?.ma20, previous?.ma60,
    today?.k, today?.d, previous?.k, previous?.d, dayBefore?.k, today?.changePercent];
  if (!numbers.every(Number.isFinite) || !(today?.ma20 > 0) || !(today?.ma60 > 0))
    base.missingData.push("均線、KD 或當日漲跌幅無效");
  if (five.length !== 5 || five.some((bar) => !Number.isFinite(bar?.ma20) || bar.ma20 <= 0))
    base.missingData.push("近五日 MA20 不完整");
  const volumeSignal = getPriceVolumeSignal(stock.history ?? [], tradingDates, asOf, today?.changePercent);
  if (!Number.isFinite(volumeSignal.rvol20) || !(volumeSignal.code in PRICE_VOLUME_SCORES))
    base.missingData.push("RVOL20 資料不足");
  const institutionDays = window.slice(-5);
  const institutionComplete = institutionDays.length === 5 && !institutionDays.some((bar) =>
    !Number.isFinite(bar?.volume) || bar.volume < 0 ||
      INSTITUTION_NAMES.some((name) => !Number.isFinite(getInstitutionNet(bar.institutions, name))));
  if (!institutionComplete)
    base.missingData.push("近五日法人或成交量資料不完整");
  const fiveVolume = institutionComplete ? institutionDays.reduce((sum, bar) => sum + bar.volume, 0) : null;
  if (fiveVolume === 0) base.missingData.push("近五日累積成交量為零");
  const net = institutionComplete ? institutionDays.reduce((sum, bar) => sum + getInstitutionalNet(bar.institutions), 0) : null;
  const atr14 = completeHistory ? getAtr14(window) : null;
  if (!Number.isFinite(atr14)) base.missingData.push("ATR14 無法計算");
  const previous10Low = completeHistory ? Math.min(...window.slice(-11, -1).map((bar) => bar.low)) : null;
  base.coreConditions = evaluateCoreConditions({ today, previous, dayBefore, completeHistory,
    rvol20: volumeSignal.rvol20, institutionNet5: net,
    previous10Low, atr14 });
  base.passedCount = CORE_KEYS.filter((key) => base.coreConditions[key].status === "PASS").length;
  base.coreConditionsPassed = base.passedCount === CORE_KEYS.length;
  if (base.priceBasis === "unadjusted" && options.corporateActions) {
    const { coveredDates } = options.corporateActions;
    if (coveredDates && requiredActionDates.some((date) => !coveredDates.has(date)))
      base.conflictingEvidence.push("部分歷史日期尚未完成公司行動查核；採未還原價格評分");
  } else if (base.priceBasis === "unadjusted") {
    base.conflictingEvidence.push("未還原價格且未提供公司行動查核；除權息可能影響分數");
  }
  if (CORE_KEYS.some((key) => base.coreConditions[key].status === "UNKNOWN"))
    base.missingData.push("核心條件必要資料不足");
  if (base.missingData.length) return base;

  const coreChecks = [today.close > today.ma20, today.ma20 > today.ma60,
    today.ma20 > previous.ma20, today.ma60 > previous.ma60];
  const trend = coreChecks.filter(Boolean).length * 20 + five.filter((bar) => bar.close > bar.ma20).length * 4;
  const crossedUp = previous.k <= previous.d && today.k > today.d;
  const momentum = (today.k > today.d ? 30 : 0) + (crossedUp ? 15 : 0) +
    (today.k > previous.k ? 35 : today.k === previous.k ? 15 : 0) +
    (today.k >= 20 && today.k < 80 ? 20 : today.k < 20 ? 10 : 0);
  const priceVolume = PRICE_VOLUME_SCORES[volumeSignal.code];
  const netRatio = net / fiveVolume;
  const institutionBuyDays = institutionDays.filter((bar) => getInstitutionalNet(bar.institutions) > 0).length;
  const institutionPositiveCategories = INSTITUTION_NAMES.filter((name) => institutionDays.reduce((sum, bar) =>
    sum + getInstitutionNet(bar.institutions, name), 0) > 0).length;
  const institution = institutionalScoreBreakdown(netRatio, institutionBuyDays, institutionPositiveCategories).score;
  const deviation20 = (today.close - today.ma20) / today.ma20 * 100;
  const riskDistance = (today.close - previous10Low) / today.close * 100;
  const atrPercent = atr14 / today.close * 100;
  const maScore = deviation20 < 0 ? 20 : deviation20 <= 3 ? 100 : deviation20 <= 6 ? 70 : deviation20 <= 10 ? 30 : 0;
  const riskScore = riskDistance <= 0 ? 0 : riskDistance <= 3 ? 100 : riskDistance <= 6 ? 70 : riskDistance <= 10 ? 30 : 0;
  const atrScore = atrPercent <= 2 ? 100 : atrPercent <= 4 ? 70 : atrPercent <= 6 ? 30 : 0;
  const entryRisk = maScore * 0.4 + riskScore * 0.4 + atrScore * 0.2;
  const values = { trend, momentum, priceVolume, institutional: institution, entryRisk };
  base.rawCategories = Object.fromEntries(Object.entries(values).map(([key, score]) => [key,
    { score, contribution: score * ENTRY_WEIGHTS[key] / 100,
      creditedContribution: base.coreConditions[key].status === "PASS" ? score * ENTRY_WEIGHTS[key] / 100 : 0 }]));
  base.categories = Object.fromEntries(Object.entries(values).map(([key, score]) => [key,
    { label: NAMES[key], score: round2(score), weight: ENTRY_WEIGHTS[key],
      contribution: round2(score * ENTRY_WEIGHTS[key] / 100),
      creditedContribution: base.coreConditions[key].status === "PASS" ? round2(score * ENTRY_WEIGHTS[key] / 100) : 0 }]));
  const total = Object.entries(values).reduce((sum, [key, value]) => sum + value * ENTRY_WEIGHTS[key] / 100, 0);
  base.baseScore = round2(total);
  const contributions = Object.fromEntries(Object.entries(values).map(([key, value]) =>
    [key, value * ENTRY_WEIGHTS[key] / 100]));
  const qualified = getQualifiedEntryScore(total, base.coreConditions, contributions);
  base.rawBaseScore = total;
  base.rawFinalScore = qualified.finalScore;
  base.qualifiedScore = round2(qualified.qualifiedScore);
  base.finalScore = round2(qualified.finalScore);
  base.totalScore = base.finalScore;
  base.displayScore = Math.round(base.finalScore);
  base.status = base.coreConditionsPassed ? statusFor(base.displayScore) : "核心條件不通過";
  base.conclusion = base.coreConditionsPassed ? base.status : "未通過條件的加權分數不計入最終分數";
  base.mainReason = CORE_KEYS.find((key) => base.coreConditions[key].status === "FAIL")
    ? base.coreConditions[CORE_KEYS.find((key) => base.coreConditions[key].status === "FAIL")].reason
    : "五項核心條件皆已通過";
  if (coreChecks[0]) base.supportingEvidence.push("收盤價高於 MA20");
  else base.pendingConditions.push("等待收盤價站上 MA20");
  if (coreChecks[1]) base.supportingEvidence.push("MA20 高於 MA60");
  else base.pendingConditions.push("等待 MA20 高於 MA60");
  if (coreChecks[2] && coreChecks[3]) base.supportingEvidence.push("月線與季線同步向上");
  else base.pendingConditions.push("觀察月線與季線是否同步向上");
  if (crossedUp) base.supportingEvidence.push("KD 今日上穿");
  else if (today.k <= today.d) base.pendingConditions.push("觀察 K 是否回到 D 上方");
  if (today.k < previous.k) base.conflictingEvidence.push("K 值較前一交易日下降");
  if (priceVolume === 100) base.supportingEvidence.push("價漲量增");
  if (priceVolume === 0) base.conflictingEvidence.push("價跌量增");
  else if (priceVolume < 45) base.pendingConditions.push(`觀察量價由「${volumeSignal.label}」改善`);
  if (netRatio > 0) base.supportingEvidence.push("近五日法人淨買超");
  else if (netRatio < 0) base.conflictingEvidence.push("近五日法人淨賣超");
  if (deviation20 > 10) base.conflictingEvidence.push("價格偏離 MA20 超過 10%");
  if (riskDistance <= 0) base.conflictingEvidence.push("十日前低點不低於現價，參考位置不適用");
  else if (riskDistance > 10) base.conflictingEvidence.push("與近十日前低點距離超過 10%");
  if (atrPercent > 6) base.conflictingEvidence.push("ATR14 占股價超過 6%，波動風險較高");
  base.metrics = { close: today.close, changePercent: today.changePercent, ma20: today.ma20,
    ma60: today.ma60, previousMa20: previous.ma20, previousMa60: previous.ma60,
    k: today.k, d: today.d, previousK: previous.k, previousD: previous.d,
    fiveAboveMa20: five.filter((bar) => bar.close > bar.ma20).length,
    rvol20: volumeSignal.rvol20, priceVolume: volumeSignal.label,
    institutionNet5: net, institutionVolume5: fiveVolume,
    institutionBuyDays, institutionPositiveCategories,
    netRatio, deviation20, previous10Low, riskDistance, atr14, atrPercent };
  return base;
}

export function entryScoreDayChange(current, previous, previousDate) {
  const unavailable = (status, score) => ({ previousDate: previousDate ?? null, delta: null,
    status, missingData: [...(score?.missingData ?? [])] });
  if (!Number.isFinite(current?.finalScore)) return unavailable("missing-current", current);
  if (!previousDate) return unavailable("no-previous-session");
  if (!Number.isFinite(previous?.finalScore)) return unavailable("missing-previous", previous);
  return { previousDate, delta: Math.round((current.finalScore - previous.finalScore) * 100) / 100,
    status: "comparable" };
}
