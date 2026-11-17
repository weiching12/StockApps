import { checkNextDayPlan } from "./entry-research.js";
import { ENTRY_RESEARCH_MODEL } from "./entry-research-model.js";

// After-the-fact results for saved research samples. These read bars AFTER the sample's
// session and must never feed back into a sample's own gates, signal or score.
// Prices are unadjusted. By default any corporate action inside a measured span makes that span
// UNAVAILABLE. A model with `outcomePriceBasis: "reference-adjusted"` (v4) instead carries the
// sample's prices into each later session's basis with the published reference price
// (factor = reference ÷ prior close), so an ex-date drop is neither a loss nor a stop; this equals
// reinvesting the distribution. Unverified action coverage keeps a span PENDING in both modes.

const round4 = (value) => Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 10000) / 10000 : null;
const validPrice = (value) => Number.isFinite(value) && value > 0;
const validBar = (bar) => bar && [bar.open, bar.high, bar.low, bar.close].every(validPrice);
const percent = (to, from) => (to / from - 1) * 100;
const adjustedModel = (model) => model?.outcomePriceBasis === "reference-adjusted";

/** Price factor of one corporate action, or null when its reference price cannot be trusted. */
function actionFactor(event) {
  return validPrice(event?.beforeClose) && validPrice(event?.reference) ? event.reference / event.beforeClose : null;
}

/**
 * Classify the sessions after `index` up to `index + count` for one symbol. `factors[j]` is the
 * cumulative factor from the sample's basis to session j's basis (1 when nothing happened).
 */
function span(context, index, count) {
  const { tradingDates, bars, corporateActions, symbol, adjusted } = context;
  const dates = tradingDates.slice(index + 1, index + 1 + count);
  if (dates.length < count) return { status: "PENDING", reason: "後續交易日尚未完整", dates };
  const events = corporateActions?.eventsBySymbol?.get(symbol);
  const factors = [];
  let cumulative = 1;
  for (const date of dates) {
    const event = events?.get(date);
    if (event) {
      const factor = adjusted ? actionFactor(event) : null;
      if (factor === null) return { status: "UNAVAILABLE", reason: adjusted ? "除權息參考價不完整，無法還原比較" : "期間有除權息，未還原價格不可比較", dates };
      cumulative *= factor;
    }
    factors.push(cumulative);
  }
  if (dates.some((date) => !corporateActions?.coveredDates?.has(date)))
    return { status: "PENDING", reason: "期間公司行動尚未查核", dates };
  const values = dates.map((date) => bars.get(date));
  if (values.some((bar) => !validBar(bar))) return { status: "UNAVAILABLE", reason: "期間停牌或缺少行情", dates };
  return { status: "COMPLETE", dates, values, factors };
}

/** Exit a filled trade at a fixed horizon, or at the next open after a close below invalidation.
 * `fill.factor` is the cumulative factor at the fill session; later sessions are compared in their own basis. */
function tradeExit(context, fillIndex, fill, horizon, costs) {
  const window = span(context, fillIndex, horizon);
  if (window.status === "PENDING" && window.dates.length) {
    // A stop can resolve before the horizon is reached (unadjusted comparison is only used to decide waiting).
    const partial = window.dates.map((date) => context.bars.get(date));
    const stopAt = partial.findIndex((bar) => validBar(bar) && bar.close < fill.invalidationPrice);
    if (stopAt < 0 || stopAt + 1 >= partial.length) return { status: "PENDING", reason: window.reason };
    if (context.adjusted) return { status: "PENDING", reason: window.reason };
  } else if (window.status !== "COMPLETE") return { status: window.status, reason: window.reason };
  if (window.status !== "COMPLETE") {
    // Unadjusted mode only: the span is pending but a stop already resolved inside the known sessions.
    window.values = window.dates.map((date) => context.bars.get(date));
    window.factors = window.dates.map(() => 1);
  }
  const bars = window.values ?? window.dates.map((date) => context.bars.get(date));
  const factors = window.factors ?? bars.map(() => 1);
  // Invalidation in each session's basis: the fill session's basis times the actions after it.
  const stopIn = (j) => fill.invalidationPrice * factors[j];
  let exitAt = bars.length - 1, exitPrice = bars.at(-1)?.close ?? null, exitDate = window.dates.at(-1), exitReason = "HORIZON";
  const stopAt = bars.findIndex((bar, j) => validBar(bar) && bar.close < stopIn(j));
  if (stopAt >= 0 && stopAt < bars.length - 1) {
    const next = bars[stopAt + 1];
    if (!validBar(next)) return { status: "UNAVAILABLE", reason: "停損隔日缺少行情" };
    exitAt = stopAt + 1; exitPrice = next.open; exitDate = window.dates[stopAt + 1]; exitReason = "STOP";
  } else if (stopAt === bars.length - 1) exitReason = "HORIZON_BELOW_INVALIDATION";
  // Fill price in the exit session's basis (an action on the exit session happened before its open).
  const fillPrice = fill.price * factors[exitAt];
  const buy = fillPrice * (1 + (costs.commissionPercent + costs.slippagePercent) / 100);
  const sell = exitPrice * (1 - (costs.commissionPercent + costs.sellTaxPercent + costs.slippagePercent) / 100);
  return { status: "COMPLETE", exitDate, exitPrice, exitReason,
    ...(factors[exitAt] !== 1 ? { priceFactor: round4(factors[exitAt]) } : {}),
    grossReturnPercent: round4(percent(exitPrice, fillPrice)), netReturnPercent: round4(percent(sell, buy)) };
}

/** A limit order at the plan's reference close for the next session: it fills when that session trades
 * at or below the limit (at the open when it opens lower), and is cancelled like the open-price rule
 * when the limit sits outside the plan or the session opens at or below invalidation. */
export function checkLimitAtClose(plan, referenceClose, nextBar) {
  if (plan?.status !== "NEXT_DAY_CANDIDATE") return { status: "NOT_APPLICABLE", fillPrice: null };
  if (!validBar(nextBar)) return { status: "AWAITING_PRICE", fillPrice: null, reason: "等待下一交易日實際價格確認" };
  if (!(referenceClose > plan.invalidationPrice && referenceClose <= plan.entryPriceUpper))
    return { status: "LIMIT_OUTSIDE_PLAN", fillPrice: null, reason: "限價不在計畫範圍內" };
  if (nextBar.open <= plan.invalidationPrice)
    return { status: "OPEN_BELOW_INVALIDATION", fillPrice: null, reason: `開盤價 ${nextBar.open} 已不高於失效價 ${plan.invalidationPrice}，計畫取消` };
  if (nextBar.low > referenceClose) return { status: "LIMIT_NOT_REACHED", fillPrice: null, reason: `當日最低 ${nextBar.low} 未回到限價 ${referenceClose}` };
  return { status: "WITHIN_PLAN", fillPrice: Math.min(nextBar.open, referenceClose), reason: "限價成交" };
}

const scalePlan = (plan, factor) => factor === 1 ? plan : { ...plan,
  entryPriceUpper: round4(plan.entryPriceUpper * factor), invalidationPrice: round4(plan.invalidationPrice * factor) };

/**
 * sample: { symbol, tradeDate, referenceClose, nextDayPlan } as saved.
 * model.plan.entryMode: "nextOpen" (default, the live rule) or "limitAtClose" (research only).
 * model.outcomePriceBasis: "unadjusted" (default) or "reference-adjusted" (see the header).
 * history: the symbol's bars (any range); only sessions after tradeDate are read.
 */
export function evaluateResearchOutcome(sample, { tradingDates, history, corporateActions, model = ENTRY_RESEARCH_MODEL }) {
  const index = tradingDates.indexOf(sample.tradeDate);
  const context = { tradingDates, corporateActions, symbol: sample.symbol, adjusted: adjustedModel(model),
    bars: new Map((history ?? []).filter((bar) => bar.date > sample.tradeDate).map((bar) => [bar.date, bar])) };
  const base = sample.referenceClose;
  if (index < 0 || !validPrice(base)) return { status: "UNAVAILABLE", reason: "樣本缺少參考收盤價或交易日", horizons: {} };
  const horizons = {};
  for (const days of model.outcomeHorizons) {
    const window = span(context, index, days);
    horizons[days] = window.status === "COMPLETE"
      ? { status: "COMPLETE", date: window.dates.at(-1), close: window.values.at(-1).close,
        returnPercent: round4(percent(window.values.at(-1).close, base * window.factors.at(-1))) }
      : { status: window.status, reason: window.reason };
  }
  const longest = Math.max(...model.outcomeHorizons);
  const window = span(context, index, longest);
  let excursion = { status: window.status, reason: window.reason };
  if (window.status === "COMPLETE") {
    const plan = sample.nextDayPlan ?? {};
    const invalidation = validPrice(plan.invalidationPrice) ? plan.invalidationPrice : null;
    const entry = validPrice(plan.entryReferencePrice) ? plan.entryReferencePrice : null;
    const target = entry && invalidation ? entry + model.plan.targetRiskMultiple * (entry - invalidation) : null;
    const f = window.factors;
    const invalidationDay = invalidation ? window.values.findIndex((bar, j) => bar.low <= invalidation * f[j]) : -1;
    const targetDay = target ? window.values.findIndex((bar, j) => bar.high >= target * f[j]) : -1;
    excursion = { status: "COMPLETE", sessions: longest,
      mfePercent: round4(Math.max(...window.values.map((bar, j) => percent(bar.high, base * f[j])))),
      maePercent: round4(Math.min(...window.values.map((bar, j) => percent(bar.low, base * f[j])))),
      hitInvalidation: invalidation ? invalidationDay >= 0 : null,
      invalidationDate: invalidationDay >= 0 ? window.dates[invalidationDay] : null,
      targetPrice: round4(target), hitTarget: target ? targetDay >= 0 : null,
      targetDate: targetDay >= 0 ? window.dates[targetDay] : null,
      // Daily bars cannot order a target and an invalidation touched on the same session.
      sameSessionAmbiguous: invalidationDay >= 0 && invalidationDay === targetDay };
  }
  // Simulated trade: only plans that were candidates, filled at the next session's open.
  let trade = { status: "NOT_APPLICABLE" };
  if (sample.nextDayPlan?.status === "NEXT_DAY_CANDIDATE") {
    const next = span(context, index, 1);
    if (next.status === "PENDING") trade = { status: "PENDING", reason: next.reason };
    else if (next.status !== "COMPLETE") trade = { status: "UNAVAILABLE", reason: next.reason };
    else {
      // An action on the fill session itself happened before its open: compare in that session's basis.
      const fillFactor = next.factors[0], plan = scalePlan(sample.nextDayPlan, fillFactor);
      const check = model.plan?.entryMode === "limitAtClose"
        ? checkLimitAtClose(plan, base * fillFactor, next.values[0]) : checkNextDayPlan(plan, next.values[0]);
      if (check.status !== "WITHIN_PLAN") trade = { status: check.status, reason: check.reason };
      else {
        const fill = { price: check.fillPrice, date: next.dates[0], invalidationPrice: plan.invalidationPrice };
        trade = { status: "FILLED", fillDate: fill.date, fillPrice: fill.price, exits: Object.fromEntries(
          model.outcomeHorizons.filter((days) => days >= 5).map((days) => [days, tradeExit(context, index + 1, fill, days, model.costs)])) };
      }
    }
  }
  const parts = [...Object.values(horizons), excursion, trade, ...Object.values(trade.exits ?? {})];
  return { status: parts.some((part) => part.status === "PENDING") ? "PENDING" : "COMPLETE", horizons, excursion, trade };
}
