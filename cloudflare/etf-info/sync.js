import { EtfInfoRepository } from "./repository.js";
import { ETF_NAV_URL, ETF_PROFILE_URL, etfDividendUrl, parseEtfDividends, parseEtfNav, parseEtfProfiles } from "./source.js";
import { MANIFEST_KEY } from "../storage/market-keys.js";

const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Distributions are kept for a little over a year back, which a trailing-twelve-month yield needs. */
export const ETF_DIVIDEND_LOOKBACK_DAYS = 400;

/**
 * Refreshes ETF fund facts once the day's market data is published. The three sources are independent:
 * one failing leaves its own table at the last good rows and never blocks the others.
 */
export async function syncDailyEtfInfo(env, state, now, fetcher = fetch) {
  if (env.ETF_INFO_ENABLED !== "1" || !env.T86_DB || state?.phase !== "done") return { status: "skipped" };
  if (now.toISOString().slice(11, 16) < "12:30") return { status: "before-evening-refresh" };
  const manifest = await env.MARKET_DATA.get(MANIFEST_KEY, "json");
  if (!manifest || manifest.asOf !== state.date) return { status: "no-current-market-day" };
  const repository = new EtfInfoRepository(env.T86_DB);
  const attempt = await repository.claim(state.date, now);
  if (!attempt) return { status: "already-checked" };
  const read = async (url) => {
    const response = await fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`TWSE ETF info HTTP ${response.status}`);
    return response.json();
  };
  const start = shift(state.date, -ETF_DIVIDEND_LOOKBACK_DAYS), stamp = now.toISOString();
  const steps = {
    profiles: async () => { const rows = parseEtfProfiles(await read(ETF_PROFILE_URL)); await repository.saveProfiles(rows, stamp); return rows.length; },
    dividends: async () => { const rows = parseEtfDividends(await read(etfDividendUrl(start, shift(state.date, 120))), start);
      // An empty year of distributions means the report changed, not that every ETF stopped paying.
      if (!rows.length) throw new Error("TWSE ETF dividend report is empty");
      await repository.saveDividends(rows, start); return rows.length; },
    nav: async () => { const rows = parseEtfNav(await read(ETF_NAV_URL), state.date);
      if (!rows.length) throw new Error("TWSE ETF NAV file has no rows for the market day");
      await repository.saveNav(rows, stamp); return rows.length; },
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
  await repository.finish(state.date, complete, detail, now);
  return { status: complete ? "complete" : "partial", ...detail };
}
