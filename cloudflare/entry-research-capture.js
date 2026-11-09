import { createApplicationServices } from "./composition.js";
import { EntryResearchRepository } from "./repositories/entry-research-repository.js";
import { DEFAULT_SETTINGS } from "../shared/indicators.js";
import { entryResearchApplies, evaluateEntryResearch, gateKeysForModel } from "../shared/entry-research.js";
import { ENTRY_RESEARCH_MODEL } from "../shared/entry-research-model.js";
import { evaluateResearchOutcome } from "../shared/entry-research-outcome.js";

// Outcomes are refreshed for samples from the last 35 sessions; one still pending 30 sessions
// after its date (e.g. corporate-action coverage never completed) is closed as UNAVAILABLE.
const OUTCOME_LOOKBACK_SESSIONS = 35;
const OUTCOME_OVERDUE_SESSIONS = 30;
// Provisional retention: samples, outcomes and runs older than six calendar months are deleted.
export const SAMPLE_RETENTION_MONTHS = 6;

export function retentionCutoff(asOf, months = SAMPLE_RETENTION_MONTHS) {
  const date = new Date(`${asOf}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}

/** The saved detail: everything the explanation views need, nothing recomputed later. */
function sampleDetail(result) {
  const { gateResult: gate, entryResearch: research, nextDayPlan, dataQuality } = result;
  return { gate: { status: gate.status, passedCount: gate.passedCount, reasons: gate.reasons,
    conditions: Object.fromEntries(Object.entries(gate.details).map(([key, item]) =>
      [key, { status: item.status, reason: item.reason, data: item.data }])) },
  research: research.status === "NOT_ELIGIBLE" || research.status === "DATA_INSUFFICIENT"
    ? { status: research.status } : research,
  nextDayPlan, dataQuality, provisional: result.provisional };
}

const GATE_COLUMNS = ["Trend", "Momentum", "PriceVolume", "Institutional", "EntryRisk"];

export function sampleRow(result, { stock, revisionId, capturedAt, source }) {
  const { gateResult: gate, entryResearch: research, nextDayPlan: plan } = result;
  return { Symbol: result.stockCode, TradeDate: result.asOf, ModelVersion: result.modelVersion, Name: stock.name ?? null,
    Source: source, RevisionId: revisionId, Close: plan.referenceClose, GateStatus: gate.status, GatePassed: gate.passedCount,
    // The five gate columns keep their v1 names; each model stores its own gates in order.
    ...Object.fromEntries(GATE_COLUMNS.map((column, index) => [column, gate.conditions[gateKeysForModel(result.modelVersion)[index]]])),
    ReadinessScore: research.score, StructureScore: research.componentScores?.structure ?? null,
    SignalScore: research.componentScores?.signal ?? null, TimingScore: research.componentScores?.timing ?? null,
    EntryStatus: research.status, SetupType: research.setupType, SignalDate: research.signal?.date ?? null,
    NextDayStatus: plan.status, EntryReferencePrice: plan.entryReferencePrice, EntryPriceUpper: plan.entryPriceUpper,
    InvalidationPrice: plan.invalidationPrice, RiskPercent: plan.riskPercent, Atr14: plan.atr14,
    DataQuality: result.dataQuality.status, PriceBasis: result.dataQuality.priceBasis, CapturedAt: capturedAt,
    DetailJson: JSON.stringify(sampleDetail(result)) };
}

export function outcomeRow(candidate, outcome, updatedAt) {
  const horizon = (days) => outcome.horizons?.[days]?.status === "COMPLETE" ? outcome.horizons[days].returnPercent : null;
  const exit = (days) => outcome.trade?.exits?.[days]?.status === "COMPLETE" ? outcome.trade.exits[days].netReturnPercent : null;
  const excursion = outcome.excursion?.status === "COMPLETE" ? outcome.excursion : {};
  const flag = (value) => value === true ? 1 : value === false ? 0 : null;
  return { Symbol: candidate.Symbol, TradeDate: candidate.TradeDate, ModelVersion: candidate.ModelVersion,
    Status: outcome.status, Return1: horizon(1), Return5: horizon(5), Return10: horizon(10), Return20: horizon(20),
    Mfe20: excursion.mfePercent ?? null, Mae20: excursion.maePercent ?? null,
    HitInvalidation: flag(excursion.hitInvalidation), HitTarget: flag(excursion.hitTarget),
    TradeStatus: outcome.trade?.status ?? "NOT_APPLICABLE", FillDate: outcome.trade?.fillDate ?? null,
    FillPrice: outcome.trade?.fillPrice ?? null, TradeReturn5: exit(5), TradeReturn10: exit(10), TradeReturn20: exit(20),
    DetailJson: JSON.stringify(outcome), UpdatedAt: updatedAt };
}

/** Recompute pending outcomes from the current history; write only rows whose result changed. */
export async function updateOutcomes({ repository, stocks, dates, actions, model, updatedAt }) {
  const since = dates[Math.max(0, dates.length - 1 - OUTCOME_LOOKBACK_SESSIONS)];
  const candidates = await repository.outcomeCandidates(model.version, since);
  if (!candidates.length) return 0;
  const histories = new Map(stocks.map((stock) => [stock.symbol, stock.history]));
  const corporateActions = actions ? await actions.window(dates.slice(-(OUTCOME_LOOKBACK_SESSIONS + 1)))
    : { coveredDates: new Set(), eventsBySymbol: new Map() };
  const rows = [];
  for (const candidate of candidates) {
    let outcome = evaluateResearchOutcome({ symbol: candidate.Symbol, tradeDate: candidate.TradeDate,
      referenceClose: candidate.Close, nextDayPlan: { status: candidate.NextDayStatus,
        entryReferencePrice: candidate.EntryReferencePrice, entryPriceUpper: candidate.EntryPriceUpper,
        invalidationPrice: candidate.InvalidationPrice } },
    { tradingDates: dates, history: histories.get(candidate.Symbol) ?? [], corporateActions, model });
    const age = dates.length - 1 - dates.indexOf(candidate.TradeDate);
    if (outcome.status === "PENDING" && age > OUTCOME_OVERDUE_SESSIONS)
      outcome = { ...outcome, status: "UNAVAILABLE", reason: `樣本日後 ${OUTCOME_OVERDUE_SESSIONS} 個交易日仍無法取得完整後續資料` };
    const row = outcomeRow({ ...candidate, ModelVersion: model.version }, outcome, updatedAt);
    if (row.DetailJson !== candidate.OutcomeJson) rows.push(row);
  }
  return repository.saveOutcomes(rows);
}

// Runs inside the market sync coordinator's queue with its authoritative store, after the
// current publication. Each revision is captured once; later ticks return immediately.
export async function captureEntryResearch(env, { createServices = createApplicationServices, now = () => new Date(),
  model = ENTRY_RESEARCH_MODEL } = {}) {
  if (!env.T86_DB) return { status: "not-required" };
  const repository = new EntryResearchRepository(env.T86_DB);
  let key;
  try {
    const services = createServices(env);
    const manifest = await services.market.market();
    const revisionId = `${manifest.generation}:${services.actions ? await services.actions.revision() : "no-actions"}`;
    key = { tradeDate: manifest.asOf, modelVersion: model.version, revisionId };
    if ((await repository.run(key.tradeDate, key.modelVersion, revisionId))?.Status === "complete")
      return { status: "already-saved", asOf: manifest.asOf, generation: manifest.generation };
    const startedAt = now().toISOString();
    await repository.startRun({ ...key, source: "daily", startedAt });
    const { asOf, dates, stocks } = await services.summary.snapshots(undefined, DEFAULT_SETTINGS);
    if (asOf !== manifest.asOf) throw new Error("Entry research read a different publication than its manifest");
    const corporateActions = services.actions ? await services.actions.window(dates.slice(-61)) : null;
    // ETFs are not researched, so they never enter the samples the backtest reads.
    const rows = stocks.filter(entryResearchApplies).map((stock) => sampleRow(evaluateEntryResearch({ stock, tradingDates: dates, asOf,
      corporateActions, settings: DEFAULT_SETTINGS, model }), { stock, revisionId, capturedAt: startedAt, source: "daily" }));
    const { inserted, skipped } = await repository.saveSamples(rows);
    const outcomeUpdates = await updateOutcomes({ repository, stocks, dates, actions: services.actions, model,
      updatedAt: startedAt });
    const pruned = await repository.prune(retentionCutoff(asOf));
    await repository.finishRun({ ...key, completedAt: now().toISOString(), sampleCount: rows.length, inserted, skipped, outcomeUpdates });
    return { status: "saved", asOf, generation: manifest.generation, inserted, skipped, outcomeUpdates, pruned };
  } catch (error) {
    console.error(JSON.stringify({ event: "entry-research-capture-delayed", message: error.message }));
    if (key) await repository.failRun({ ...key, error: error.message }).catch(() => {});
    return { status: "failed" };
  }
}
