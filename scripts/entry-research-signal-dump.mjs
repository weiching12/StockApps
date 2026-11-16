// Usage: node --max-old-space-size=8192 scripts/entry-research-signal-dump.mjs [out.json]
// Writes every v3 gate-pass TRIGGERED signal over the two-year offline dataset, whatever its
// next-day plan status, with the bars after it, to compare backtests with and without the price plan.
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const out = process.argv[2] ?? join(root, ".backfill/signals-v3.json");
const load = (path) => import(pathToFileURL(join(root, path)).href);
const { analyzeHistory, DEFAULT_SETTINGS } = await load("shared/indicators.js");
const { getEntryScore } = await load("shared/entry-score.js");
const { entryResearchApplies, evaluateEntryResearch } = await load("shared/entry-research.js");
const { ENTRY_RESEARCH_MODEL_V3 } = await load("shared/entry-research-model.js");
const { loadActions, loadDataset } = await load("scripts/lib/research-history.mjs");

const loaded = await loadDataset(undefined, join(root, ".backfill/dataset-2y.json"));
const stocks = loaded.stocks.filter(entryResearchApplies);
const actions = await loadActions(join(root, ".backfill/actions"));
const dates = loaded.dates, firstIndex = 79, AFTER = 21;

// Equal-weight market index of daily close-to-close returns, used as the benchmark.
const marketReturn = new Map(dates.map((date) => [date, { sum: 0, n: 0 }]));
for (const stock of stocks) {
  const bars = stock.history;
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i - 1], b = bars[i];
    if (!(a.close > 0 && b.close > 0) || dates.indexOf(b.date) !== dates.indexOf(a.date) + 1) continue;
    const r = b.close / a.close - 1;
    if (Math.abs(r) > 0.11) continue;
    const m = marketReturn.get(b.date); m.sum += r; m.n++;
  }
}
let level = 100; const index = new Map();
for (const date of dates) { const m = marketReturn.get(date); level *= 1 + (m.n ? m.sum / m.n : 0); index.set(date, level); }

const rows = [], started = Date.now();
for (const [position, raw] of stocks.entries()) {
  const stock = { ...raw, history: analyzeHistory(raw.history, DEFAULT_SETTINGS) };
  const byDate = new Map(stock.history.map((bar) => [bar.date, bar]));
  for (let i = firstIndex; i < dates.length - 1; i++) {
    const asOf = dates[i], bar = byDate.get(asOf);
    if (!bar) continue;
    const score = getEntryScore(stock, dates, asOf, { priceBasis: "unadjusted", corporateActions: actions, settings: DEFAULT_SETTINGS });
    const result = evaluateEntryResearch({ stock, tradingDates: dates, asOf, corporateActions: actions, settings: DEFAULT_SETTINGS,
      score, model: ENTRY_RESEARCH_MODEL_V3, researchAllStocks: true });
    const plan = result.nextDayPlan;
    if (result.gateResult.status !== "PASS" || result.entryResearch.status !== "TRIGGERED") continue;
    if (!(plan.invalidationPrice > 0)) continue;
    const after = dates.slice(i + 1, i + 1 + AFTER).map((date) => {
      const b = byDate.get(date);
      return b ? { open: b.open, high: b.high, low: b.low, close: b.close, action: actions.eventsBySymbol.get(stock.symbol)?.has(date) ?? false } : null;
    });
    const last20 = stock.history.filter((b) => b.date <= asOf).slice(-20);
    rows.push({ symbol: stock.symbol, asOf, planStatus: plan.status, close: bar.close, upper: plan.entryPriceUpper, stop: plan.invalidationPrice,
      avgValue20: last20.reduce((s, b) => s + b.close * b.volume, 0) / last20.length,
      market: dates.slice(i, i + AFTER + 1).map((d) => index.get(d)), after });
  }
  if ((position + 1) % 100 === 0) console.error(`${position + 1}/${stocks.length} stocks, ${rows.length} signals, ${Math.round((Date.now() - started) / 1000)}s`);
}
await writeFile(out, JSON.stringify(rows));
console.error(`Wrote ${rows.length} signals in ${Math.round((Date.now() - started) / 1000)}s`);
