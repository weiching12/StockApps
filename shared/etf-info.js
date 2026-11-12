const shiftYear = (date) => {
  const [year, month, day] = date.split("-").map(Number);
  // 02-29 has no counterpart a year earlier; 02-28 keeps the window at twelve months.
  const back = new Date(Date.UTC(year - 1, month - 1, day));
  return (back.getUTCMonth() === month - 1 ? back : new Date(Date.UTC(year - 1, month, 0))).toISOString().slice(0, 10);
};

/**
 * Trailing-twelve-month distributions and the next announced one, as of a market date.
 * `trailing` counts ex-dates in (asOf − 1 year, asOf] whose amount is known; the yield divides their sum
 * by the unadjusted close and is null without a close. With no paid distribution in the window it is null:
 * an ETF that does not distribute is not shown as yielding 0%.
 */
export function summarizeEtfDividends(dividends, asOf, close) {
  const from = shiftYear(asOf);
  const paid = dividends.filter((row) => row.exDate > from && row.exDate <= asOf && Number.isFinite(row.amount) && row.amount > 0);
  const amount = paid.reduce((sum, row) => sum + row.amount, 0);
  const next = dividends.filter((row) => row.exDate > asOf).sort((a, b) => a.exDate.localeCompare(b.exDate))[0];
  return {
    trailing: paid.length ? { from, to: asOf, count: paid.length, amount,
      yieldPercent: Number.isFinite(close) && close > 0 ? amount / close * 100 : null } : null,
    upcoming: next ? { exDate: next.exDate, payDate: next.payDate ?? null, amount: Number.isFinite(next.amount) ? next.amount : null } : null,
  };
}
