export const RESEARCH_STORAGE_KEY = "stock-insight-research-v2";
const active = (period) => period.removedAt === null;
const periodId = (symbol, now) => `${symbol}:${now}:${Math.random().toString(36).slice(2, 9)}`;

export function loadResearchStore(storage, favorites, now = new Date().toISOString()) {
  let saved;
  try { saved = JSON.parse(storage?.getItem(RESEARCH_STORAGE_KEY) ?? "null"); } catch {}
  const periods = [2, 3].includes(saved?.version) && Array.isArray(saved.periods) ? saved.periods.filter((item) =>
    item && typeof item.symbol === "string" && typeof item.id === "string") : [];
  const store = { version: 3, periods };
  for (const period of periods) {
    delete period.reason;
    delete period.note;
    period.baseline ??= null;
    period.firstValidPriceBaseline ??= null;
    period.addedSnapshotId ??= period.addedSnapshot?.id ?? null;
    period.firstValidSnapshotId ??= period.firstValidSnapshot?.id ?? null;
  }
  const retained = new Set(favorites);
  for (const period of periods)
    if (active(period) && !retained.has(period.symbol)) period.removedAt = now;
  for (const symbol of [...new Set(favorites)]) {
    if (periods.some((period) => period.symbol === symbol && active(period))) continue;
    periods.push({ id: periodId(symbol, now), symbol, market: null, addedAt: null,
      startedAt: now, removedAt: null, addedSnapshot: null, addedSnapshotId: null,
      firstValidSnapshot: null, firstValidSnapshotId: null, baseline: null,
      firstValidPriceBaseline: null, legacy: true });
  }
  return store;
}

export function activeResearchPeriod(store, symbol) {
  return store.periods.findLast((period) => period.symbol === symbol && active(period)) ?? null;
}

export function addResearchPeriod(store, { symbol, market, snapshot, baseline },
  now = new Date().toISOString()) {
  if (activeResearchPeriod(store, symbol)) return activeResearchPeriod(store, symbol);
  const period = { id: periodId(symbol, now), symbol, market: market ?? null,
    addedAt: now, startedAt: now, removedAt: null, addedSnapshot: snapshot ?? null,
    addedSnapshotId: snapshot?.id ?? null, firstValidSnapshot: snapshot?.valid ? snapshot : null,
    firstValidSnapshotId: snapshot?.valid ? snapshot.id : null,
    baseline: baseline ?? null, firstValidPriceBaseline: null, legacy: false };
  store.periods.push(period);
  return period;
}

export function removeResearchPeriod(store, symbol, now = new Date().toISOString()) {
  const period = activeResearchPeriod(store, symbol);
  if (period) period.removedAt = now;
  return period;
}

export function persistResearchStore(storage, store) {
  for (const period of store.periods) {
    delete period.reason;
    delete period.note;
  }
  try { storage?.setItem(RESEARCH_STORAGE_KEY, JSON.stringify(store)); return true; }
  catch { return false; }
}
