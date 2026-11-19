const DAY = 86_400_000;
const shiftYear = (date) => {
  const [year, month, day] = date.split("-").map(Number);
  // 02-29 has no counterpart a year earlier; 02-28 keeps the window at twelve months.
  const back = new Date(Date.UTC(year - 1, month - 1, day));
  return (back.getUTCMonth() === month - 1 ? back : new Date(Date.UTC(year - 1, month, 0))).toISOString().slice(0, 10);
};

/**
 * The last session to buy and still receive a distribution: the weekday before the ex-date.
 * Market holidays are not known ahead of time, so a holiday right before the ex-date moves the real
 * day earlier; the UI says so.
 */
export function lastBuyDate(exDate) {
  let time = Date.parse(`${exDate}T00:00:00Z`) - DAY;
  while ([0, 6].includes(new Date(time).getUTCDay())) time -= DAY;
  return new Date(time).toISOString().slice(0, 10);
}

const FREQUENCIES = [[45, "monthly", "月配息"], [75, "bimonthly", "雙月配息"], [135, "quarterly", "季配息"], [270, "semiannual", "半年配息"], [550, "annual", "年配息"]];

/**
 * How often an ETF distributes, read from the median gap between its ex-dates (announced ones included).
 * One known ex-date cannot tell a yearly payer from a new fund, so it stays unknown rather than guessed.
 */
export function dividendFrequency(dividends) {
  const dates = [...new Set(dividends.map((row) => row.exDate))].sort();
  if (dates.length < 2) return null;
  const gaps = dates.slice(1).map((date, index) => (Date.parse(date) - Date.parse(dates[index])) / DAY).sort((a, b) => a - b);
  const median = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
  const match = FREQUENCIES.find(([limit]) => median <= limit);
  return match ? { code: match[1], label: match[2] } : null;
}

const event = (row) => row ? { exDate: row.exDate, lastBuyDate: lastBuyDate(row.exDate), payDate: row.payDate ?? null,
  amount: Number.isFinite(row.amount) ? row.amount : null } : null;

/**
 * Distribution facts as of a market date: how often it pays, the next announced distribution, the latest
 * one already ex-dividend, and the trailing twelve months.
 * `trailing` counts ex-dates in (asOf − 1 year, asOf] whose amount is known; the yield divides their sum
 * by the unadjusted close and is null without a close. With no paid distribution in the window it is null:
 * an ETF that does not distribute is not shown as yielding 0%.
 */
export function summarizeEtfDividends(dividends, asOf, close) {
  const from = shiftYear(asOf);
  const paid = dividends.filter((row) => row.exDate > from && row.exDate <= asOf && Number.isFinite(row.amount) && row.amount > 0);
  const amount = paid.reduce((sum, row) => sum + row.amount, 0);
  const ordered = [...dividends].sort((a, b) => a.exDate.localeCompare(b.exDate));
  return {
    frequency: dividendFrequency(dividends),
    trailing: paid.length ? { from, to: asOf, count: paid.length, amount,
      yieldPercent: Number.isFinite(close) && close > 0 ? amount / close * 100 : null } : null,
    upcoming: event(ordered.find((row) => row.exDate > asOf)),
    latest: event(ordered.findLast((row) => row.exDate <= asOf)),
  };
}

/**
 * ETF categories for the ETF list, from TWSE's fund type (基金類型). Order is the chips' order.
 * Leveraged/inverse first (they track any market); then bond, futures, balanced and feeder funds, which are
 * too few on the listed market for categories of their own; then active funds; then by where the
 * constituents are listed.
 */
export const ETF_CATEGORIES = Object.freeze([
  Object.freeze({ key: "domestic", label: "國內股票" }),
  Object.freeze({ key: "foreign", label: "國外股票" }),
  Object.freeze({ key: "active", label: "主動式" }),
  Object.freeze({ key: "leveraged", label: "槓桿反向" }),
  Object.freeze({ key: "other", label: "其他" }),
]);

/** One category key for a TWSE fund type; an unknown or missing type is "other". */
export function etfCategory(fundType) {
  const type = String(fundType ?? "");
  if (!type) return "other";
  if (/槓桿|反向/.test(type)) return "leveraged";
  if (/債券|期貨|平衡|連結/.test(type)) return "other";
  if (/主動/.test(type)) return "active";
  if (/國內/.test(type)) return "domestic";
  if (/國外|境外/.test(type)) return "foreign";
  return "other";
}
