import { getInstitutionalNet } from "./indicators.js";

/** One institution's gross shares for the day (buys plus sells); unknown stays null, never zero. */
function grossShares(bar, name) {
  const rows = (bar?.institutions ?? []).filter((row) => row?.name === name);
  if (rows.length !== 1) return null;
  const { buy, sell } = rows[0];
  return Number.isFinite(buy) && buy >= 0 && Number.isFinite(sell) && sell >= 0 ? buy + sell : null;
}

export function dailyCloseSeries(history, tradingDates, asOf, days = 30) {
  const index = tradingDates?.indexOf(asOf) ?? -1;
  if (index < 0) return [];
  const bars = new Map((history ?? []).filter((bar) => bar.date <= asOf)
    .map((bar) => [bar.date, bar]));
  return tradingDates.slice(Math.max(0, index - days + 1), index + 1)
    .map((date) => {
      const bar = bars.get(date);
      const close = Number.isFinite(bar?.close) && bar.close > 0 ? bar.close : null;
      const session = tradingDates.indexOf(date);
      const completeAverage = (days) => session >= days - 1 &&
        tradingDates.slice(session - days + 1, session + 1)
          .every((day) => Number.isFinite(bars.get(day)?.close) && bars.get(day).close > 0);
      const previous = bars.get(tradingDates[session - 1]);
      return { date, close,
        volume: Number.isFinite(bar?.volume) && bar.volume >= 0 ? bar.volume : null,
        foreignVolume: grossShares(bar, "外資"), trustVolume: grossShares(bar, "投信"), dealerVolume: grossShares(bar, "自營商"),
        institutionalNet: getInstitutionalNet(bar?.institutions),
        ma20: completeAverage(20) && Number.isFinite(bar?.ma20) ? bar.ma20 : null,
        ma60: completeAverage(60) && Number.isFinite(bar?.ma60) ? bar.ma60 : null,
        k: close !== null && Number.isFinite(bar?.k) && bar.k >= 0 && bar.k <= 100 ? bar.k : null,
        d: close !== null && Number.isFinite(bar?.d) && bar.d >= 0 && bar.d <= 100 ? bar.d : null,
        changePercent: close !== null && Number.isFinite(previous?.close) && previous.close > 0 &&
          Number.isFinite(bar?.changePercent) ? bar.changePercent : null };
    });
}

/**
 * Daily sessions folded into one point per calendar month: the month's last close, its summed volume and
 * the change from the previous month's close. The first month has nothing to compare with, and a month
 * whose sessions all lack a close keeps a null close; nothing is filled in. `date` is the month's last
 * session, so a point still says which day its close is from.
 */
export function monthlyCloseSeries(daily) {
  const months = new Map();
  for (const point of daily ?? []) {
    const key = point.date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(point);
  }
  let previous = null;
  return [...months].map(([month, points]) => {
    const priced = points.filter((point) => Number.isFinite(point.close) && point.close > 0);
    const close = priced.at(-1)?.close ?? null;
    const volumes = points.map((point) => point.volume).filter(Number.isFinite);
    const changePercent = close !== null && previous !== null ? (close / previous - 1) * 100 : null;
    if (close !== null) previous = close;
    return { date: (priced.at(-1) ?? points.at(-1)).date, month, close, sessions: points.length,
      volume: volumes.length ? volumes.reduce((sum, value) => sum + value, 0) : null, changePercent };
  });
}
