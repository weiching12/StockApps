import { isEtf } from "./market-codec.js";
import {
  getDirectionalLeader,
  getInstitutionalNet,
  getInstitutionVolumeRatio,
  getSectorInstitutionEstimate,
  getSectorInstitutionSummary,
  getStockInstitutionActivity,
  getStockInstitutionEstimate,
  getStockInstitutionValue,
} from "./indicators.js";

const PERIODS = Object.freeze(["day", "5", "20"]);
const INSTITUTIONS = Object.freeze(["外資", "投信", "自營商"]);

/** A sub-industry, or the official industry name older links still use. */
export const sectorMatches = (stock, name) => stock.sector === name || stock.twseSector === name;

/** Industry research excludes ETFs, including catalogs that predate assetType. */
export function groupSectorStocks(snapshots) {
  const groups = new Map();
  for (const stock of snapshots) {
    if (isEtf(stock)) continue;
    if (!groups.has(stock.sector)) groups.set(stock.sector, []);
    groups.get(stock.sector).push(stock);
  }
  return groups;
}

/** Raw-price return, using the exact market baseline session, never a nearby bar. */
export function getSectorStockReturn(stock, window, tradingDates) {
  if (!stock.latest) return null;
  if (window === "day") return stock.latest.changePercent;
  const previousDate = tradingDates.at(-(Number(window) + 1));
  const previous = stock.history.find((bar) => bar.date === previousDate);
  return previous && Number.isFinite(previous.close) && previous.close !== 0
    ? ((stock.latest.close - previous.close) / previous.close) * 100 : null;
}

/** Consecutive sessions of three-institution net buying (positive) or selling (negative), ending at the
 * selected session. A missing session, a flat day or a direction change ends the run; no data gives 0.
 */
export function getStockInstitutionStreak(stock, tradingDates) {
  const history = new Map((stock?.history ?? []).map((bar) => [bar.date, bar]));
  let streak = 0;
  for (let at = tradingDates.length - 1; at >= 0; at--) {
    const net = getInstitutionalNet(history.get(tradingDates[at])?.institutions);
    if (!Number.isFinite(net) || net === 0 || (streak && Math.sign(net) !== Math.sign(streak))) break;
    streak += Math.sign(net);
  }
  return streak;
}

/** Pure industry overview shared by UI, future HTTP resources and research jobs.
 * Snapshots and tradingDates must describe the same selected market session.
 * Price averages require every currently priced member's return. Flow aggregates
 * retain their existing complete-window cohort and include genuine zero values.
 */
export function getSectorOverview(snapshots, {
  window = "day", sort = "net-desc", tradingDates, asOf = tradingDates.at(-1),
}) {
  const selectedDates = tradingDates.filter((date) => date <= asOf);
  const sectors = [...groupSectorStocks(snapshots)].map(([name, stocks]) => {
    const priced = stocks.filter((stock) => stock.latest);
    const returns = priced.map((stock) => getSectorStockReturn(stock, window, tradingDates)).filter(Number.isFinite);
    const summary = getSectorInstitutionSummary(stocks, window, tradingDates);
    const estimate = getSectorInstitutionEstimate(stocks, window, tradingDates);
    const { stock: leader, value: leaderValue } = getDirectionalLeader(stocks.map((stock) => ({
      stock, value: getStockInstitutionEstimate(stock, "total", window, selectedDates),
    })), estimate.amount);
    const activities = stocks.map((stock) => getStockInstitutionActivity(stock, window, selectedDates)).filter(Number.isFinite);
    return {
      name, stocks, summary, estimate, total: summary.total,
      activity: { amount: activities.length ? activities.reduce((sum, value) => sum + value, 0) : null,
        available: activities.length, expected: stocks.length, share: null },
      change: priced.length && returns.length === priced.length
        ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
      leader, leaderValue,
      leaderChange: leader ? getSectorStockReturn(leader, window, tradingDates) : null,
      leaderStreak: leader ? getStockInstitutionStreak(leader, selectedDates) : 0,
    };
  });
  // Each sector's share of all listed-company institutional trading (ETFs are already excluded).
  const marketActivity = sectors.reduce((sum, sector) => sum + (sector.activity.amount ?? 0), 0);
  for (const sector of sectors) sector.activity.share = Number.isFinite(sector.activity.amount) && marketActivity > 0
    ? sector.activity.amount / marketActivity * 100 : null;
  sortSectors(sectors, sort);
  return rankSectors(sectors, sort);
}

/** The same overview one level up, for the market list's broader sector choices. */
export const getSectorGroupOverview = (snapshots, options) => getSectorOverview(
  snapshots.map((stock) => stock.sectorGroup ? { ...stock, sector: stock.sectorGroup } : stock), options);

const sortValue = (sector, sort) => sort === "activity-desc" ? sector.activity?.amount ?? null : sector.estimate.amount;

/** Shared by the model and the API client, which re-sorts the server's net-desc overview. */
export function sortSectors(sectors, sort) {
  return sectors.sort((a, b) => {
    if (sort === "name-asc") return a.name.localeCompare(b.name, "zh-Hant");
    const av = sortValue(a, sort), bv = sortValue(b, sort);
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    return (av - bv) * (sort === "net-asc" ? 1 : -1);
  });
}

/** Ranks count only sectors with a value for the active ordering. */
export function rankSectors(sectors, sort) {
  let rank = 0;
  return sectors.map((sector) => Object.assign(sector, {
    rank: Number.isFinite(sortValue(sector, sort)) ? ++rank : null,
  }));
}

/** Traded shares for the same complete-window cohort as the institution summary.
 * Any missing session volume leaves the ratio unknown rather than understated.
 */
function getSectorCohortVolume(stocks, window, tradingDates) {
  const days = window === "day" ? 1 : Number(window);
  const dates = tradingDates.slice(-days);
  const cohort = stocks.filter((stock) => Number.isFinite(getStockInstitutionEstimate(stock, "total", window, tradingDates))
    && ["total", ...INSTITUTIONS].every((name) => Number.isFinite(getStockInstitutionValue(stock, name, window))));
  if (!cohort.length || dates.length !== days) return null;
  let volume = 0;
  for (const stock of cohort) {
    const history = new Map((stock.history ?? []).map((bar) => [bar.date, bar]));
    for (const date of dates) {
      const traded = history.get(date)?.volume;
      if (!Number.isFinite(traded)) return null;
      volume += traded;
    }
  }
  return volume > 0 ? volume : null;
}

/** Signed net shares as a percentage of the cohort's traded shares, like a stock's 法人占量. */
const volumeRatio = (shares, volume) => Number.isFinite(shares) && volume ? shares / volume * 100 : null;

/** One stock's traded shares over the window's sessions; any missing session leaves it unknown. */
function getStockWindowVolume(stock, window, tradingDates) {
  const days = window === "day" ? 1 : Number(window);
  const dates = tradingDates.slice(-days);
  if (dates.length !== days) return null;
  const history = new Map((stock.history ?? []).map((bar) => [bar.date, bar]));
  let volume = 0;
  for (const date of dates) {
    const traded = history.get(date)?.volume;
    if (!Number.isFinite(traded)) return null;
    volume += traded;
  }
  return volume > 0 ? volume : null;
}

const FLOW_SESSIONS = 20;
const FLOW_LINES = ["外資", "投信", "自營商"];

/**
 * Cumulative institutional net amount (TWD) at each of the last 20 sessions, summed over the stocks
 * whose whole 20-session window is complete, so the last point equals the 20-day total shown with it.
 * `daily` holds each session's own amount. Null when the calendar is short or no stock has a complete
 * window; a missing day is never zero.
 */
export function getSectorFlowSeries(stocks, tradingDates, days = FLOW_SESSIONS) {
  const dates = tradingDates.slice(-days);
  if (dates.length !== days) return null;
  const cohort = stocks.filter((stock) => Number.isFinite(getStockInstitutionEstimate(stock, "total", String(days), tradingDates)));
  if (!cohort.length) return null;
  const names = ["total", ...FLOW_LINES];
  const lines = Object.fromEntries(names.map((name) => [name, []]));
  const daily = Object.fromEntries(names.map((name) => [name, []]));
  for (let index = 0; index < days; index++) {
    const seen = tradingDates.slice(0, tradingDates.length - days + index + 1);
    for (const name of names) {
      let amount = 0;
      for (const stock of cohort) {
        const value = getStockInstitutionEstimate(stock, name, "day", seen);
        if (!Number.isFinite(value)) return null;
        amount += value;
      }
      daily[name].push(amount);
      lines[name].push((lines[name].at(-1) ?? 0) + amount);
    }
  }
  return { dates, available: cohort.length, expected: stocks.length, lines, daily };
}

/**
 * The latest run of one institution's daily amounts: direction (1 buying, -1 selling, 0 flat), how many
 * sessions it has lasted, the session it began, whether it reaches back past the series (`capped`)
 * and whether the session before it went the other way (`turned`).
 */
export function getFlowStreak(daily, dates) {
  const direction = Math.sign(daily.at(-1) ?? 0);
  if (!direction) return { direction: 0, length: 0, since: null, capped: false, turned: false };
  let start = daily.length - 1;
  while (start > 0 && Math.sign(daily[start - 1]) === direction) start--;
  return { direction, length: daily.length - start, since: dates[start], capped: start === 0,
    turned: start > 0 && Math.sign(daily[start - 1]) === -direction };
}

/**
 * Equal-weighted cumulative price change (%) of the sector over the same sessions, from the close before
 * them. Prices are unadjusted, as everywhere else; a stock missing any of those closes stays out.
 */
export function getSectorPriceSeries(stocks, tradingDates, days = FLOW_SESSIONS) {
  if (tradingDates.length < days + 1) return null;
  const sessions = tradingDates.slice(-days - 1);
  const rows = stocks.map((stock) => {
    const history = new Map((stock.history ?? []).map((bar) => [bar.date, bar.close]));
    const closes = sessions.map((date) => history.get(date));
    return closes.every((close) => Number.isFinite(close) && close > 0) ? closes : null;
  }).filter(Boolean);
  if (!rows.length) return null;
  return { dates: sessions.slice(1), base: sessions[0], available: rows.length, expected: stocks.length,
    returns: sessions.slice(1).map((_, index) => rows.reduce((sum, closes) => sum + (closes[index + 1] / closes[0] - 1) * 100, 0) / rows.length) };
}

/** Detail cohort, shared institution totals and daily-money member ordering.
 * Amounts are closing-price estimates in TWD; share totals remain in shares.
 * No DOM, HTTP, storage or formatted strings enter the research model.
 */
export function getSectorDetail(snapshots, name, { tradingDates, asOf = tradingDates.at(-1) }) {
  const stocks = snapshots.filter((stock) => !isEtf(stock) && sectorMatches(stock, name));
  if (!stocks.length) return null;
  const selectedDates = tradingDates.filter((date) => date <= asOf);
  const periods = Object.fromEntries(PERIODS.map((window) => {
    const summary = getSectorInstitutionSummary(stocks, window, tradingDates);
    const estimate = getSectorInstitutionEstimate(stocks, window, tradingDates);
    const volume = getSectorCohortVolume(stocks, window, tradingDates);
    return [window, { summary, estimate, volume, ratio: volumeRatio(summary.total, volume),
      institutions: Object.fromEntries(INSTITUTIONS.map((institution) => [institution, {
        shares: summary[institution],
        amount: getSectorInstitutionEstimate(stocks, window, tradingDates, institution).amount,
        ratio: volumeRatio(summary[institution], volume),
      }])),
    }];
  }));
  const members = stocks.map((stock) => {
    const values = Object.fromEntries(PERIODS.map((window) => {
      const shares = getStockInstitutionValue(stock, "total", window);
      return [window, {
        amount: getStockInstitutionEstimate(stock, "total", window, selectedDates),
        shares,
        // The day keeps the stock's own 法人占量; longer windows divide by the same sessions' volume.
        ratio: window === "day" ? getInstitutionVolumeRatio(stock.latest) : volumeRatio(shares, getStockWindowVolume(stock, window, selectedDates)),
      }];
    }));
    return { stock, net: values.day.amount, periods: values,
      volumeRatio: getInstitutionVolumeRatio(stock.latest) };
  }).sort((a, b) => {
    if (a.net === null) return b.net === null ? a.stock.name.localeCompare(b.stock.name, "zh-Hant") : 1;
    if (b.net === null) return -1;
    return b.net - a.net || a.stock.name.localeCompare(b.stock.name, "zh-Hant");
  });
  return { name, stocks, periods, members, tradingDates: selectedDates, flow: getSectorFlowSeries(stocks, selectedDates),
    price: getSectorPriceSeries(stocks, selectedDates) };
}
