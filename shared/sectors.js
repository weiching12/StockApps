import { isEtf } from "./market-codec.js";
import {
  getDirectionalLeader,
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
    const values = Object.fromEntries(PERIODS.map((window) => [window, {
      amount: getStockInstitutionEstimate(stock, "total", window, selectedDates),
      shares: getStockInstitutionValue(stock, "total", window),
    }]));
    return { stock, net: values.day.amount, periods: values,
      volumeRatio: getInstitutionVolumeRatio(stock.latest) };
  }).sort((a, b) => {
    if (a.net === null) return b.net === null ? a.stock.name.localeCompare(b.stock.name, "zh-Hant") : 1;
    if (b.net === null) return -1;
    return b.net - a.net || a.stock.name.localeCompare(b.stock.name, "zh-Hant");
  });
  return { name, stocks, periods, members, tradingDates: selectedDates };
}
