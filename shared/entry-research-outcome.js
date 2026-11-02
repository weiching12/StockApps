import { checkNextDayPlan } from "./entry-research.js";
import { ENTRY_RESEARCH_MODEL } from "./entry-research-model.js";

// After-the-fact results for saved research samples. These read bars AFTER the sample's
// session and must never feed back into a sample's own gates, signal or score.
// Prices are unadjusted, so any corporate action inside a measured span makes that span
// UNAVAILABLE, and unverified action coverage keeps it PENDING until verification.

const round4 = (value) => Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 10000) / 10000 : null;
const validPrice = (value) => Number.isFinite(value) && value > 0;
const validBar = (bar) => bar && [bar.open, bar.high, bar.low, bar.close].every(validPrice);
const percent = (to, from) => (to / from - 1) * 100;

/** Classify the sessions after `index` up to `index + count` for one symbol. */
function span(context, index, count) {
  const { tradingDates, bars, corporateActions, symbol } = context;
  const dates = tradingDates.slice(index + 1, index + 1 + count);
  if (dates.length < count) return { status: "PENDING", reason: "後續交易日尚未完整", dates };
  const events = corporateActions?.eventsBySymbol?.get(symbol);
  if (dates.some((date) => events?.has(date))) return { status: "UNAVAILABLE", reason: "期間有除權息，未還原價格不可比較", dates };
  if (dates.some((date) => !corporateActions?.coveredDates?.has(date)))
    return { status: "PENDING", reason: "期間公司行動尚未查核", dates };
  const values = dates.map((date) => bars.get(date));
  if (values.some((bar) => !validBar(bar))) return { status: "UNAVAILABLE", reason: "期間停牌或缺少行情", dates };
  return { status: "COMPLETE", dates, values };
}

/** Exit a filled trade at a fixed horizon, or at the next open after a close below invalidation. */
function tradeExit(context, fillIndex, fill, horizon, costs) {
  const window = span(context, fillIndex, horizon);
  if (window.status === "PENDING" && window.dates.length) {
    // A stop can resolve before the horizon is reached.
    const partial = window.dates.map((date) => context.bars.get(date));
    const stopAt = partial.findIndex((bar) => validBar(bar) && bar.close < fill.invalidationPrice);
    if (stopAt < 0 || stopAt + 1 >= partial.length) return { status: "PENDING", reason: window.reason };
  } else if (window.status !== "COMPLETE") return { status: window.status, reason: window.reason };
  const bars = window.dates.map((date) => context.bars.get(date));
  let exitPrice = bars.at(-1)?.close ?? null, exitDate = window.dates.at(-1), exitReason = "HORIZON";
  const stopAt = bars.findIndex((bar) => validBar(bar) && bar.close < fill.invalidationPrice);
  if (stopAt >= 0 && stopAt < bars.length - 1) {
    const next = bars[stopAt + 1];
    if (!validBar(next)) return { status: "UNAVAILABLE", reason: "停損隔日缺少行情" };
    exitPrice = next.open; exitDate = window.dates[stopAt + 1]; exitReason = "STOP";
  } else if (stopAt === bars.length - 1) exitReason = "HORIZON_BELOW_INVALIDATION";
  const buy = fill.price * (1 + (costs.commissionPercent + costs.slippagePercent) / 100);
  const sell = exitPrice * (1 - (costs.commissionPercent + costs.sellTaxPercent + costs.slippagePercent) / 100);
  return { status: "COMPLETE", exitDate, exitPrice, exitReason,
    grossReturnPercent: round4(percent(exitPrice, fill.price)), netReturnPercent: round4(percent(sell, buy)) };
}

/**
 * sample: { symbol, tradeDate, referenceClose, nextDayPlan } as saved.
 * history: the symbol's bars (any range); only sessions after tradeDate are read.
 */
export function evaluateResearchOutcome(sample, { tradingDates, history, corporateActions, model = ENTRY_RESEARCH_MODEL }) {
  const index = tradingDates.indexOf(sample.tradeDate);
  const context = { tradingDates, corporateActions, symbol: sample.symbol,
    bars: new Map((history ?? []).filter((bar) => bar.date > sample.tradeDate).map((bar) => [bar.date, bar])) };
  const base = sample.referenceClose;
  if (index < 0 || !validPrice(base)) return { status: "UNAVAILABLE", reason: "樣本缺少參考收盤價或交易日", horizons: {} };
  const horizons = {};
  for (const days of model.outcomeHorizons) {
    const window = span(context, index, days);
    horizons[days] = window.status === "COMPLETE"
      ? { status: "COMPLETE", date: window.dates.at(-1), close: window.values.at(-1).close,
        returnPercent: round4(percent(window.values.at(-1).close, base)) }
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
    const invalidationDay = invalidation ? window.values.findIndex((bar) => bar.low <= invalidation) : -1;
    const targetDay = target ? window.values.findIndex((bar) => bar.high >= target) : -1;
    excursion = { status: "COMPLETE", sessions: longest,
      mfePercent: round4(percent(Math.max(...window.values.map((bar) => bar.high)), base)),
      maePercent: round4(percent(Math.min(...window.values.map((bar) => bar.low)), base)),
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
      const check = checkNextDayPlan(sample.nextDayPlan, next.values[0]);
      if (check.status !== "WITHIN_PLAN") trade = { status: check.status, reason: check.reason };
      else {
        const fill = { price: check.fillPrice, date: next.dates[0], invalidationPrice: sample.nextDayPlan.invalidationPrice };
        trade = { status: "FILLED", fillDate: fill.date, fillPrice: fill.price, exits: Object.fromEntries(
          model.outcomeHorizons.filter((days) => days >= 5).map((days) => [days, tradeExit(context, index + 1, fill, days, model.costs)])) };
      }
    }
  }
  const parts = [...Object.values(horizons), excursion, trade, ...Object.values(trade.exits ?? {})];
  return { status: parts.some((part) => part.status === "PENDING") ? "PENDING" : "COMPLETE", horizons, excursion, trade };
}
