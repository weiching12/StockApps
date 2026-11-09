import { DEFAULT_SETTINGS, getSnapshot, getStockInstitutionEstimate } from "../../shared/indicators.js";
import { DomainError } from "../../shared/domain-error.js";
import { getEntryScore } from "../../shared/entry-score.js";
import { entryResearchApplies, evaluateEntryResearch } from "../../shared/entry-research.js";
import { dailyCloseSeries } from "../../shared/price-history.js";

export const RULES_VERSION = "technical-v1";

export class AnalysisService {
  constructor(marketService, actions = null) { this.marketService = marketService; this.actions = actions; }

  async stock(symbol, options = {}) {
    const source = await this.marketService.stock(symbol);
    const asOf = options.asOf || source.asOf;
    if (asOf > source.asOf || !source.stock.tradingDates.includes(asOf))
      throw new DomainError("INVALID_QUERY", "指定日期不是現有市場資料中的交易日");
    const settings = options.settings ?? DEFAULT_SETTINGS;
    const snapshot = getSnapshot(source.stock, asOf, settings);
    const dates = source.stock.tradingDates.filter((date) => date <= asOf);
    const actions = this.actions ? await this.actions.window(dates.slice(-61)) : null;
    const entryScore = getEntryScore(snapshot, dates, asOf,
      { priceBasis: "unadjusted", corporateActions: actions, settings });
    const money = Object.fromEntries(["day", "5", "20"].map((window) => [window,
      Object.fromEntries(["total", "外資", "投信", "自營商"].map((name) => [name,
        getStockInstitutionEstimate(snapshot, name, window, dates)]))]));
    return { data: { symbol, latest: snapshot.latest, signal: snapshot.signal, trend: snapshot.trend,
      priceHistory: dailyCloseSeries(snapshot.history, source.stock.tradingDates, asOf),
      entryScore,
      entryResearch: entryResearchApplies(snapshot) ? evaluateEntryResearch({ stock: snapshot, tradingDates: dates, asOf,
        corporateActions: actions, settings, score: entryScore }) : null,
      institutionalSummary: snapshot.institutionalSummary, money },
    meta: { asOf, sourceAsOf: source.asOf, rulesVersion: RULES_VERSION,
      priceBasis: "unadjusted", settings } };
  }
}
