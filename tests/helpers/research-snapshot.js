import { ENTRY_STRATEGY, ENTRY_WEIGHTS } from "../../shared/entry-score.js";
import { researchConfigId } from "../../shared/research-tracking.js";

// Builds a V1.2 research snapshot in the shape still stored in D1. Production stopped writing
// them; the reader (/api/v1/favorites/research) and its comparison remain, so tests need the shape.
const CORE_KEYS = Object.keys(ENTRY_WEIGHTS);

export function researchSnapshot(score, { symbol, market, asOf, capturedAt, generation,
  settings, source = "saved", revisionId = generation } = {}) {
  if (!symbol || !asOf) throw new Error("Research snapshot requires symbol and trading date");
  const configId = researchConfigId(settings, score?.weights);
  const valid = Number.isFinite(score?.baseScore) && Number.isFinite(score?.finalScore);
  const categories = Object.fromEntries(CORE_KEYS.map((key) => [key, {
    score: score?.rawCategories?.[key]?.score ?? score?.categories?.[key]?.score ?? null,
    contribution: score?.rawCategories?.[key]?.contribution ?? score?.categories?.[key]?.contribution ?? null,
    creditedContribution: score?.rawCategories?.[key]?.creditedContribution ?? score?.categories?.[key]?.creditedContribution ?? null,
    weight: score?.weights?.[key] ?? ENTRY_WEIGHTS[key],
  }]));
  const conditions = Object.fromEntries(CORE_KEYS.map((key) => [key, {
    status: score?.coreConditions?.[key]?.status ?? "UNKNOWN",
    reason: score?.coreConditions?.[key]?.reason ?? "資料不足",
  }]));
  const id = [symbol, asOf, score?.modelVersion ?? "unknown", configId,
    revisionId ?? "local", source].join("|");
  return { id, symbol, market: market ?? null, asOf, capturedAt: capturedAt ?? null,
    revisionId: revisionId ?? null, source, modelVersion: score?.modelVersion ?? null,
    strategy: score?.strategy ?? ENTRY_STRATEGY, configId, settings: { ...settings },
    weights: { ...(score?.weights ?? ENTRY_WEIGHTS) }, priceBasis: score?.priceBasis ?? "unadjusted",
    close: score?.metrics?.close ?? null, valid,
    baseScore: valid ? score?.rawBaseScore ?? score.baseScore : null,
    finalScore: valid ? score?.rawFinalScore ?? score.finalScore : null,
    categories, conditions, passedCount: score?.passedCount ?? 0,
    totalConditions: score?.totalConditions ?? CORE_KEYS.length,
    cap: score?.cap ?? { enabled: false, value: null, reason: null },
    missingData: [...(score?.missingData ?? [])],
  };
}
