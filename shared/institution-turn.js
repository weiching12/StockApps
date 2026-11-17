// "法人轉買": the three institutions together turn from a selling run to a sizeable buy while the
// price is falling. An observation for the stock lists, never an entry signal or a score input.
// Reads analysed history bars (close, volume, ma60, institutionalNet); any missing value → no mark.

export const INSTITUTION_TURN_RULE = Object.freeze({
  minSellSessions: 2, // net selling on at least this many sessions in a row before today
  minAmount: 50_000_000, // today's net buying, estimated as net shares × close (NT$)
  minValueShare: 5, // today's net buying as a percentage of today's traded value
  returnSessions: 5, // the fall is measured against the close this many sessions earlier
  maxReturn: -5, // ...and must be at least this much (percent)
});

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const amountOf = (bar) => Number.isFinite(bar?.institutionalNet) && bar.close > 0 ? bar.institutionalNet * bar.close : null;

/** The mark for `asOf`, or null when the stock does not meet every condition or data is missing. */
export function getInstitutionTurn(history, tradingDates, asOf, rule = INSTITUTION_TURN_RULE) {
  const index = tradingDates?.indexOf(asOf) ?? -1;
  if (index < rule.returnSessions) return null;
  const bars = new Map((history ?? []).map((bar) => [bar.date, bar]));
  const today = bars.get(asOf), amount = amountOf(today);
  if (!(amount >= rule.minAmount) || !(today.volume > 0) || !(today.ma60 > 0) || !(today.close < today.ma60)) return null;
  const valueShare = amount / (today.close * today.volume) * 100;
  if (valueShare < rule.minValueShare) return null;
  const earlier = bars.get(tradingDates[index - rule.returnSessions]);
  if (!(earlier?.close > 0)) return null;
  const returnPercent = (today.close / earlier.close - 1) * 100;
  if (returnPercent > rule.maxReturn) return null;
  // The selling run counts only consecutive trading sessions; a missing or non-negative one ends it.
  let sellSessions = 0, soldAmount = 0;
  for (let at = index - 1; at >= 0; at--) {
    const net = amountOf(bars.get(tradingDates[at]));
    if (!(net < 0)) break;
    sellSessions++;
    soldAmount -= net;
  }
  if (sellSessions < rule.minSellSessions) return null;
  return { amount: Math.round(amount), valueShare: round2(valueShare), returnPercent: round2(returnPercent),
    returnSessions: rule.returnSessions, sellSessions, soldAmount: Math.round(soldAmount) };
}
