import { expandStock, shardOf, SHARD_COUNT, validSymbol } from "../../shared/market-codec.js";
import { DEFAULT_SETTINGS, getSnapshot, getStockInstitutionEstimate, getStockInstitutionSeries,
  getDominantInstitution, getInstitutionNet } from "../../shared/indicators.js";
import { calculateMarketSentiment } from "../../shared/sentiment.js";
import { entryScoreSummary, getEntryScore } from "../../shared/entry-score.js";
import { entryResearchSummary, evaluateEntryResearch } from "../../shared/entry-research.js";
import { compareResearchSnapshots, researchConfigId } from "../../shared/research-tracking.js";
import { REVIEW_HISTORY_LIMIT, reviewEventTimeline } from "../../shared/research-review.js";
import { getSectorDetail, getSectorGroupOverview, getSectorOverview, sectorMatches } from "../../shared/sectors.js";
import { DomainError } from "../../shared/domain-error.js";

const WINDOWS = ["day", "5", "20"];
const INSTITUTIONS = ["total", "外資", "投信", "自營商"];

function validateFavoriteSymbols(symbols) {
  if (!Array.isArray(symbols) || !symbols.length || symbols.length > 50 ||
      new Set(symbols).size !== symbols.length || symbols.some((symbol) => !validSymbol(symbol)))
    throw new DomainError("INVALID_QUERY", "自選股票代號無效");
}

export class MarketSummaryService {
  constructor(market, actions = null, research = null) {
    this.market = market; this.actions = actions; this.researchStore = research;
  }

  async snapshots(date, settings, sector, symbols) {
    const manifest = await this.market.market();
    const asOf = date || manifest.asOf;
    if (!manifest.dates.includes(asOf)) throw new DomainError("INVALID_QUERY", "交易日不存在");
    const dates = manifest.dates.filter((day) => day <= asOf);
    const metadata = sector ? manifest.stocks.filter((stock) => sectorMatches(stock, sector)) :
      symbols ? manifest.stocks.filter((stock) => symbols.includes(stock.symbol)) : manifest.stocks;
    if (sector && !metadata.length) throw new DomainError("SECTOR_NOT_FOUND", "產業不存在");
    const indices = sector || symbols ? [...new Set(metadata.map((stock) => shardOf(stock.symbol)))] :
      Array.from({ length: SHARD_COUNT }, (_, index) => index);
    const compact = new Map();
    const shards = await this.market.shards(manifest.generation, indices);
    if (shards.length !== indices.length) throw new DomainError("DATA_UNAVAILABLE", "市場資料分片不完整");
    const seen = new Set();
    for (const shard of shards) {
      if (shard.generation !== manifest.generation || !indices.includes(shard.index) || seen.has(shard.index))
        throw new DomainError("DATA_UNAVAILABLE", "市場資料版本不一致");
      seen.add(shard.index);
      for (const stock of shard.stocks) compact.set(stock.symbol, stock.history);
    }
    const stocks = metadata.map((stock) => {
      const rows = compact.get(stock.symbol);
      if (!rows) throw new DomainError("DATA_UNAVAILABLE", "市場資料不完整");
      const snapshot = getSnapshot({ ...expandStock(stock, rows), tradingDates: dates }, asOf, settings);
      // The 20-session sentiment series needs 60 closes at its oldest point.
      snapshot.history = snapshot.history.slice(-80);
      return snapshot;
    });
    return { manifest, asOf, dates, stocks };
  }

  async summary(date, settings) {
    const { manifest, asOf, dates, stocks } = await this.snapshots(date, settings);
    const actionRevision = this.actions ? await this.actions.revision() : "no-actions";
    const actions = this.actions ? await this.actions.window(dates.slice(-61)) : null;
    const stableActions = !this.actions || actionRevision === await this.actions.revision();
    const data = stocks.map((stock) => {
      // V1.2 is computed only as entry research's input (structure scores and price-data notes).
      const score = getEntryScore(stock, dates, asOf,
        { priceBasis: "unadjusted", corporateActions: actions, settings });
      return {
        symbol: stock.symbol, name: stock.name, sector: stock.sector, sectorGroup: stock.sectorGroup, market: stock.market,
        assetType: stock.assetType, currency: stock.currency, listedOn: stock.listedOn,
        latest: stock.latest, signal: stock.signal, priceVolume: stock.priceVolume,
        trend: stock.trend, entryScore: entryScoreSummary(score),
        entryResearch: entryResearchSummary(evaluateEntryResearch({ stock, tradingDates: dates, asOf,
          corporateActions: actions, settings, score })),
        dominantInstitution: getDominantInstitution(stock.latest?.institutions),
        money: { day: { total: getStockInstitutionEstimate(stock, "total", "day", dates) } },
      };
    });
    const overviews = (overview) => Object.fromEntries(WINDOWS.map((window) => [window,
      overview(stocks, { window, sort: "net-desc", tradingDates: dates, asOf })
        .map(({ stocks: _stocks, leader, ...sector }) => ({ ...sector,
          leader: leader ? { symbol: leader.symbol, name: leader.name } : null }))]));
    return { data: { stocks: data, sentiment: calculateMarketSentiment(stocks, asOf, 20, dates, actions),
      sectors: overviews(getSectorOverview), sectorGroups: overviews(getSectorGroupOverview) },
      meta: { asOf, sourceAsOf: manifest.asOf, generation: manifest.generation,
        rulesVersion: "technical-v1", settings,
        // Daily V1.2 snapshots are no longer saved; "failed" still marks an unstable action window.
        researchCapture: stableActions ? "not-required" : "failed" } };
  }

  async research(symbols, date, settings) {
    if (!this.researchStore) throw new DomainError("DATA_UNAVAILABLE", "研究快照資料庫尚未啟用");
    validateFavoriteSymbols(symbols);
    const manifest = await this.market.market();
    const asOf = date || manifest.asOf;
    const index = manifest.dates.indexOf(asOf);
    if (index < 0 || index < manifest.dates.length - 30)
      throw new DomainError("INVALID_QUERY", "研究快照查詢限最近 30 個市場交易日");
    const known = new Set(manifest.stocks.map(({ symbol }) => symbol));
    if (symbols.some((symbol) => !known.has(symbol))) throw new DomainError("INVALID_QUERY", "股票不在上市清單");
    const previousDate = manifest.dates[index - 1] ?? null;
    const configId = researchConfigId(settings);
    const historyDates = manifest.dates.slice(Math.max(0, index - REVIEW_HISTORY_LIMIT + 1), index + 1);
    const [sessions, revisions] = await Promise.all([
      this.researchStore.sessions(historyDates, configId, symbols),
      this.researchStore.revisions(asOf, configId),
    ]);
    const today = sessions.get(asOf), previous = sessions.get(previousDate);
    return { data: symbols.map((symbol) => {
      const latest = today?.snapshots.get(symbol) ?? null;
      const prior = previous?.snapshots.get(symbol) ?? null;
      const comparison = compareResearchSnapshots(latest, prior, previousDate);
      const series = historyDates.map((day) => sessions.get(day)?.snapshots.get(symbol) ??
        { asOf: day, valid: false });
      const timeline = reviewEventTimeline(series, historyDates);
      return { symbol, latest, previous: prior, comparison, events: comparison.events,
        history: series, timeline };
    }), meta: { asOf, previousDate, configId, latestRevision: today?.revision ?? null,
      previousRevision: previous?.revision ?? null, revisions, source: "saved", coverage: today?.revision.stockCount ?? 0 } };
  }

  async favorites(symbols, date, settings) {
    validateFavoriteSymbols(symbols);
    const { manifest, asOf, dates, stocks } = await this.snapshots(date, settings, null, symbols);
    if (stocks.length !== symbols.length) throw new DomainError("INVALID_QUERY", "自選股票不在上市清單");
    return { data: stocks.map((stock) => ({ symbol: stock.symbol,
      institutionalSummary: stock.institutionalSummary,
      dayInstitutionNet: Object.fromEntries(INSTITUTIONS.map((name) => [name,
        name === "total" ? stock.latest?.institutionalNet ?? null :
          getInstitutionNet(stock.latest?.institutions, name)])),
      money: Object.fromEntries(WINDOWS.map((window) => [window,
        Object.fromEntries(INSTITUTIONS.map((name) => [name,
          getStockInstitutionEstimate(stock, name, window, dates)]))])),
      institutionSeries: getStockInstitutionSeries(stock, dates),
    })), meta: { asOf, generation: manifest.generation, rulesVersion: "technical-v1" } };
  }

  async sector(name, date, settings) {
    const { manifest, asOf, dates, stocks } = await this.snapshots(date, settings, name);
    const detail = getSectorDetail(stocks, name, { tradingDates: dates, asOf });
    if (!detail) throw new DomainError("SECTOR_NOT_FOUND", "產業不存在");
    return { data: { ...detail, stocks: undefined,
      members: detail.members.map(({ stock, ...member }) => ({ ...member,
        stock: { symbol: stock.symbol, name: stock.name, latest: stock.latest,
          institutionSeries: getStockInstitutionSeries(stock, dates) } })) },
      meta: { asOf, generation: manifest.generation, rulesVersion: "technical-v1" } };
  }
}
