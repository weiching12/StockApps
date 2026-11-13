import { EtfInfoRepository } from "./repository.js";
import { ETF_NAV_URL, ETF_PRODUCT_URL, ETF_PROFILE_URL, etfDividendUrl, parseEtfDividends, parseEtfNav, parseEtfProducts, parseEtfProfiles } from "./source.js";
import { SITCA_HOLDINGS_URL, holdingsQuery, matchHoldingsToSymbols, parseEtfHoldings, parseHoldingsForm } from "./holdings.js";
import { MANIFEST_KEY } from "../storage/market-keys.js";

/** How many monthly holdings reports are kept: the one-year chart's months plus the one in progress. */
export const ETF_HOLDING_MONTHS = 13;
const dashed = (month) => `${month.slice(0, 4)}-${month.slice(4)}`;

/**
 * Top-ten holdings from the fund association's monthly report. One request reads the form; of its latest
 * `limit` months, those not in `stored` are fetched class by class, newest first. Most evenings nothing is
 * missing and that one request is all. A month whose funds match no listed ETF is a broken report: for the
 * latest month it is an error (the stored months stay), for older months it is skipped.
 * Returns `{ months: [{ month, rows }], keepFrom }`; `keepFrom` is the oldest month still worth keeping.
 */
export async function fetchEtfHoldings(fetcher, profiles, stored = new Set(), limit = 1) {
  const headers = { "User-Agent": "Mozilla/5.0", Accept: "text/html" };
  const first = await fetcher(SITCA_HOLDINGS_URL, { headers, signal: AbortSignal.timeout(30_000) });
  if (!first.ok) throw new Error(`SITCA holdings HTTP ${first.status}`);
  const form = parseHoldingsForm(await first.text());
  const cookie = (first.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
  const wanted = form.months.slice(-limit).reverse().filter((month) => !stored.has(dashed(month)));
  const post = async (state, fundClass, month) => {
    const response = await fetcher(SITCA_HOLDINGS_URL, { method: "POST", body: holdingsQuery(state, fundClass, month), signal: AbortSignal.timeout(60_000),
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", Referer: SITCA_HOLDINGS_URL, ...(cookie ? { Cookie: cookie } : {}) } });
    if (!response.ok) throw new Error(`SITCA holdings HTTP ${response.status}`);
    return response.text();
  };
  const months = [];
  let page = form;
  for (const month of wanted) {
    // The site ignores the class when the month differs from the page's own: that first answer is not the
    // class asked for. Its page is on the new month, though, and queries from it are honoured.
    if (page.selected !== month) {
      page = parseHoldingsForm(await post(page, form.classes[0], month));
      if (page.selected !== month) throw new Error("SITCA holdings report did not switch to the requested month");
    }
    const funds = [];
    for (const fundClass of form.classes) funds.push(...parseEtfHoldings(await post(page, fundClass, month)));
    const rows = [...matchHoldingsToSymbols(funds, profiles)].flatMap(([symbol, holdings]) => holdings.map((holding) => ({ symbol, month: dashed(month), ...holding })));
    if (rows.length) months.push({ month: dashed(month), rows });
    else if (month === form.month) throw new Error("SITCA holdings report matched no listed ETF");
  }
  return { months, keepFrom: dashed(form.months.slice(-ETF_HOLDING_MONTHS)[0]) };
}

const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Distributions are kept for a little over a year back, which a trailing-twelve-month yield needs. */
export const ETF_DIVIDEND_LOOKBACK_DAYS = 400;

/**
 * Refreshes ETF fund facts once the day's market data is published. The sources are independent:
 * one failing leaves its own table at the last good rows and never blocks the others.
 *
 * Free-plan budget (docs/cloudflare-limits.md): the cron calls this every minute, so a day that needs
 * nothing ends after one single-row D1 read and no KV read. A working run issues about 12 D1 queries
 * (14 when a new month of holdings arrives) and 5 outbound requests (about 23 with a new month), and
 * writes only the rows that changed since the last run; `written` in the run's detail records how many.
 */
export async function syncDailyEtfInfo(env, state, now, fetcher = fetch) {
  if (env.ETF_INFO_ENABLED !== "1" || !env.T86_DB || state?.phase !== "done") return { status: "skipped" };
  if (now.toISOString().slice(11, 16) < "12:30") return { status: "before-evening-refresh" };
  const repository = new EtfInfoRepository(env.T86_DB);
  if (!await repository.due(state.date, now)) return { status: "already-checked" };
  const manifest = await env.MARKET_DATA.get(MANIFEST_KEY, "json");
  if (!manifest || manifest.asOf !== state.date) return { status: "no-current-market-day" };
  const attempt = await repository.claim(state.date, now);
  if (!attempt) return { status: "already-checked" };
  const read = async (url) => {
    const response = await fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`TWSE ETF info HTTP ${response.status}`);
    return response.json();
  };
  const start = shift(state.date, -ETF_DIVIDEND_LOOKBACK_DAYS), stamp = now.toISOString();
  let names = null, written = 0;
  const steps = {
    profiles: async () => { const rows = parseEtfProfiles(await read(ETF_PROFILE_URL)); written += await repository.saveProfiles(rows, stamp);
      names = rows.filter((row) => row.name); return rows.length; },
    dividends: async () => { const rows = parseEtfDividends(await read(etfDividendUrl(start, shift(state.date, 120))), start);
      // An empty year of distributions means the report changed, not that every ETF stopped paying.
      if (!rows.length) throw new Error("TWSE ETF dividend report is empty");
      written += await repository.saveDividends(rows, start); return rows.length; },
    products: async () => { const rows = parseEtfProducts(await read(ETF_PRODUCT_URL)); written += await repository.saveProducts(rows, stamp); return rows.length; },
    nav: async () => { const rows = parseEtfNav(await read(ETF_NAV_URL), state.date);
      if (!rows.length) throw new Error("TWSE ETF NAV file has no rows for the market day");
      written += await repository.saveNav(rows, stamp); return rows.length; },
    // Monthly: most evenings this is one request that finds the latest month already stored (0 rows written).
    holdings: async () => {
      if (!names) throw new Error("fund names unavailable for matching holdings");
      const { months, keepFrom } = await fetchEtfHoldings(fetcher, names, await repository.holdingMonths());
      for (const { month, rows } of months) written += await repository.saveHoldings(month, rows, keepFrom);
      return months.reduce((count, { rows }) => count + rows.length, 0); },
  };
  const detail = {};
  for (const [name, run] of Object.entries(steps)) {
    try { detail[name] = await run(); }
    catch (error) {
      detail[name] = null;
      console.error(JSON.stringify({ event: "etf-info-delayed", date: state.date, source: name, message: error.message }));
    }
  }
  const complete = Object.values(detail).every((count) => count !== null);
  // Rows this run changed (table rows, before index entries), kept beside the counts for the write budget.
  await repository.finish(state.date, complete, { ...detail, written }, now);
  return { status: complete ? "complete" : "partial", ...detail };
}
