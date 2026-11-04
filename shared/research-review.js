import { compareResearchSnapshots } from "./research-tracking.js";

export const REVIEW_HISTORY_LIMIT = 120;
const positive = (value) => Number.isFinite(value) && value > 0;

export function priceBaseline(bar, { asOf, capturedAt, source, priceBasis = "unadjusted", revisionId = null } = {}) {
  if (!asOf || !positive(bar?.close)) return null;
  return { asOf, close: bar.close, capturedAt: capturedAt ?? null,
    source: source ?? "unknown", priceBasis, revisionId };
}

export function reviewEventTimeline(history = [], dates = []) {
  const result = [];
  let previous = null;
  let gap = false;
  for (const snapshot of history) {
    if (!snapshot?.id || !snapshot.valid) { gap = true; continue; }
    if (previous) {
      const adjacent = dates.indexOf(snapshot.asOf) === dates.indexOf(previous.asOf) + 1;
      const comparison = compareResearchSnapshots(snapshot, previous, previous.asOf);
      if (adjacent && !gap) result.push(...comparison.events);
      else if (comparison.status === "comparable" && (previous.passedCount !== snapshot.passedCount ||
        Boolean(previous.cap?.enabled) !== Boolean(snapshot.cap?.enabled)))
        result.push({ key: `${snapshot.id}|observed-after-gap`, type: "observed-after-gap",
          fromDate: previous.asOf, toDate: snapshot.asOf,
          reason: `於此日觀測到必要條件${snapshot.passedCount === snapshot.totalConditions ? "成立" : "未全部成立"}${snapshot.cap?.enabled ? `、${snapshot.cap.value} 分上限啟用` : ""}，前期資料不足` });
    }
    previous = snapshot;
    gap = false;
  }
  return result;
}
