import { DomainError } from "../../shared/domain-error.js";
import { ENTRY_RESEARCH_MODEL } from "../../shared/entry-research-model.js";

const parse = (json) => { try { return json ? JSON.parse(json) : null; } catch { return null; } };

/** API representation of one saved sample and its after-the-fact outcome. */
function sampleRepresentation(row, includeDetail) {
  return {
    symbol: row.Symbol, name: row.Name, tradeDate: row.TradeDate, modelVersion: row.ModelVersion, source: row.Source,
    close: row.Close,
    gate: { status: row.GateStatus, passed: row.GatePassed, total: 5, conditions: { trend: row.Trend,
      momentum: row.Momentum, priceVolume: row.PriceVolume, institutional: row.Institutional, entryRisk: row.EntryRisk } },
    readiness: { score: row.ReadinessScore, structure: row.StructureScore, signal: row.SignalScore, timing: row.TimingScore },
    entryStatus: row.EntryStatus, setupType: row.SetupType, signalDate: row.SignalDate,
    nextDay: { status: row.NextDayStatus, entryReferencePrice: row.EntryReferencePrice, entryPriceUpper: row.EntryPriceUpper,
      invalidationPrice: row.InvalidationPrice, riskPercent: row.RiskPercent, atr14: row.Atr14 },
    dataQuality: row.DataQuality, priceBasis: row.PriceBasis, capturedAt: row.CapturedAt,
    outcome: row.OutcomeStatus ? {
      status: row.OutcomeStatus,
      returns: { 1: row.Return1, 5: row.Return5, 10: row.Return10, 20: row.Return20 },
      mfe20: row.Mfe20, mae20: row.Mae20,
      hitInvalidation: row.HitInvalidation === null ? null : Boolean(row.HitInvalidation),
      hitTarget: row.HitTarget === null ? null : Boolean(row.HitTarget),
      trade: { status: row.TradeStatus, fillDate: row.FillDate, fillPrice: row.FillPrice,
        netReturns: { 5: row.TradeReturn5, 10: row.TradeReturn10, 20: row.TradeReturn20 } },
    } : { status: "PENDING" },
    ...(includeDetail && { detail: parse(row.DetailJson), outcomeDetail: parse(row.OutcomeJson) }),
  };
}

export class EntryResearchService {
  constructor(repository) { this.repository = repository; }

  async samples(options) {
    if (!this.repository) throw new DomainError("DATA_UNAVAILABLE", "進場研究樣本資料庫尚未啟用");
    const { includeDetail, ...filters } = options;
    const { total, rows } = await this.repository.samples(filters);
    return { data: rows.map((row) => sampleRepresentation(row, includeDetail)),
      meta: { modelVersion: filters.modelVersion, total, limit: filters.limit, offset: filters.offset,
        provisional: filters.modelVersion === ENTRY_RESEARCH_MODEL.version ? ENTRY_RESEARCH_MODEL.provisional : null } };
  }
}
