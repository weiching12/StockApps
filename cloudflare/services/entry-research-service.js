import { DomainError } from "../../shared/domain-error.js";
import { ENTRY_RESEARCH_MODEL } from "../../shared/entry-research-model.js";
import { gateKeysForModel } from "../../shared/entry-research.js";

// The five gate columns keep their v1 names; each model stores its own gates in this order.
const GATE_COLUMNS = ["Trend", "Momentum", "PriceVolume", "Institutional", "EntryRisk"];

const parse = (json) => { try { return json ? JSON.parse(json) : null; } catch { return null; } };

/** API representation of one saved sample and its after-the-fact outcome. */
function sampleRepresentation(row, includeDetail) {
  return {
    symbol: row.Symbol, name: row.Name, tradeDate: row.TradeDate, modelVersion: row.ModelVersion, source: row.Source,
    close: row.Close,
    gate: { status: row.GateStatus, passed: row.GatePassed, total: 5, conditions: Object.fromEntries(
      gateKeysForModel(row.ModelVersion).map((key, index) => [key, row[GATE_COLUMNS[index]]])) },
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

// Below this many observations a group is flagged as statistically insufficient.
export const BACKTEST_MINIMUM_SAMPLES = 30;
export const READINESS_BUCKETS = [[0, 39], [40, 59], [60, 69], [70, 79], [80, 89], [90, 100]];

const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

/** Win rate and averages for one return column (prefix Trade / Forward from the repository). */
function returnStats(row, prefix) {
  const count = row?.[`${prefix}Count`] ?? 0;
  return { count, winRate: count ? round((row[`${prefix}Wins`] ?? 0) / count * 100, 1) : null,
    averageReturn: round(row?.[`${prefix}Average`]), averageWin: round(row?.[`${prefix}AverageWin`]),
    averageLoss: round(row?.[`${prefix}AverageLoss`]), insufficient: count < BACKTEST_MINIMUM_SAMPLES };
}

/**
 * Staggered capital by sample date: the account is split into `horizon` parts and each date
 * commits one part, equal-weighted across that date's filled trades. Compounding whole-account
 * returns of overlapping holding windows would overstate gains and losses about `horizon`-fold.
 */
function equityCurve(daily, horizon) {
  let equity = 1, peak = 1, maxDrawdown = 0;
  const points = daily.filter((row) => row.Trades > 0).map((row) => {
    equity *= 1 + row.TradeAverage / 100 / horizon;
    peak = Math.max(peak, equity);
    const drawdown = (equity / peak - 1) * 100;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
    return { date: row.TradeDate, trades: row.Trades, averageReturn: round(row.TradeAverage),
      cumulativeReturn: round((equity - 1) * 100), drawdown: round(drawdown) };
  });
  return { points, maxDrawdown: points.length ? round(maxDrawdown) : null };
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

  async backtest(filters) {
    if (!this.repository) throw new DomainError("DATA_UNAVAILABLE", "進場研究樣本資料庫尚未啟用");
    const { totals, buckets, setups, horizons, daily, distribution } = await this.repository.backtest(filters);
    const byBucket = new Map(buckets.map((row) => [row.Bucket, row]));
    const curve = equityCurve(daily, filters.horizon);
    const trades = returnStats(totals, "Trade");
    return { data: {
      totals: { samples: totals.Samples ?? 0, sessions: totals.Sessions ?? 0, firstDate: totals.FirstDate ?? null,
        lastDate: totals.LastDate ?? null, gatePass: totals.GatePass ?? 0, triggered: totals.Triggered ?? 0,
        candidates: totals.Candidates ?? 0, filled: totals.Filled ?? 0, tradePending: totals.TradePending ?? 0,
        outcomesComplete: totals.OutcomesComplete ?? 0 },
      trades: { ...trades, maxDrawdown: curve.maxDrawdown },
      forward: { ...returnStats(totals, "Forward"), averageMfe: round(totals.AverageMfe), averageMae: round(totals.AverageMae),
        excursionCount: totals.ExcursionCount ?? 0 },
      readinessBuckets: READINESS_BUCKETS.map(([min, max]) => {
        const row = byBucket.get(min);
        return { min, max, samples: row?.Samples ?? 0, trades: returnStats(row, "Trade"), forward: returnStats(row, "Forward") };
      }),
      setups: ["PULLBACK_RECOVERY", "RANGE_BREAKOUT"].map((setupType) => {
        const row = setups.find((item) => item.SetupType === setupType);
        return { setupType, samples: row?.Samples ?? 0, candidates: row?.Candidates ?? 0,
          trades: returnStats(row, "Trade"), forward: returnStats(row, "Forward") };
      }),
      horizons: [5, 10, 20].map((days) => ({ days, trades: returnStats(horizons, `Trade${days}`),
        forward: returnStats(horizons, `Forward${days}`) })),
      equity: curve.points,
      daily: daily.map((row) => ({ date: row.TradeDate, samples: row.Samples, gatePass: row.GatePass, candidates: row.Candidates })),
      distribution: distribution.map((row) => ({ from: row.Bin === -10 ? null : row.Bin * 2,
        to: row.Bin === 10 ? null : row.Bin * 2 + 2, count: row.Count })),
    }, meta: { modelVersion: filters.modelVersion, horizon: filters.horizon, minimumSamples: BACKTEST_MINIMUM_SAMPLES,
      provisional: filters.modelVersion === ENTRY_RESEARCH_MODEL.version ? ENTRY_RESEARCH_MODEL.provisional : null,
      filters: Object.fromEntries(Object.entries(filters).filter(([key, value]) =>
        value !== undefined && !["modelVersion", "horizon"].includes(key))) } };
  }
}
