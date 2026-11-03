// Real workerd/D1 run of the entry research capture at full-market size (about 1,400 stocks),
// isolated from production and persistent local data.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import wrangler from "wrangler";
import { demoProvider } from "../src/data.js";
import { DEFAULT_SETTINGS, getSnapshot } from "../shared/indicators.js";
import { captureEntryResearch } from "../cloudflare/entry-research-capture.js";
import { EntryResearchRepository } from "../cloudflare/repositories/entry-research-repository.js";
import { ENTRY_RESEARCH_MODEL_VERSION } from "../shared/entry-research-model.js";

const proxy = await wrangler.getPlatformProxy({ persist: false, remoteBindings: false });
try {
  const db = proxy.env.T86_DB;
  const sql = await readFile(new URL("../cloudflare/migrations/0010_entry_research.sql", import.meta.url), "utf8");
  await db.batch(wrangler.unstable_splitSqlQuery(sql).map((statement) => db.prepare(statement)));
  const dataset = await demoProvider.load();
  // 100 copies of the demo stocks under distinct symbols approximate the listed market.
  const market = Array.from({ length: 100 }, (_, copy) => dataset.stocks.map((stock) =>
    ({ ...stock, symbol: String(1000 + copy * 20 + dataset.stocks.indexOf(stock)), name: `${stock.name}${copy}` }))).flat();
  const at = (asOf, generation) => () => {
    const known = dataset.dates.filter((date) => date <= asOf);
    const stocks = market.map((stock) => {
      const snapshot = getSnapshot({ ...stock, tradingDates: known }, asOf, DEFAULT_SETTINGS);
      snapshot.history = snapshot.history.slice(-80);
      return snapshot;
    });
    return { market: { market: async () => ({ asOf, generation }) },
      actions: { revision: async () => "r1", window: async (window) => ({ coveredDates: new Set(window), eventsBySymbol: new Map() }) },
      summary: { snapshots: async () => ({ asOf, dates: known, stocks }) } };
  };
  const env = { T86_DB: db };
  const first = await captureEntryResearch(env, { createServices: at(dataset.dates[120], "g1") });
  assert.equal(first.status, "saved", JSON.stringify(first));
  assert.equal(first.inserted, market.length);
  assert.equal((await captureEntryResearch(env, { createServices: at(dataset.dates[120], "g1") })).status, "already-saved");
  const later = await captureEntryResearch(env, { createServices: at(dataset.dates[150], "g2") });
  assert.equal(later.inserted, market.length);
  const complete = await db.prepare("SELECT COUNT(*) AS n FROM entry_research_outcomes WHERE TradeDate=? AND Status='COMPLETE'")
    .bind(dataset.dates[120]).first();
  assert.equal(complete.n, market.length);
  const page = await new EntryResearchRepository(db).samples({ modelVersion: ENTRY_RESEARCH_MODEL_VERSION, gateStatus: "PASS", limit: 20, offset: 0 });
  assert.ok(page.total > 0 && page.rows.every((row) => row.GateStatus === "PASS"));
  const size = await db.prepare("SELECT SUM(length(DetailJson)) AS bytes, COUNT(*) AS n FROM entry_research_samples").first();
  console.log(`PASS workerd/D1 entry research: ${market.length} stocks per session, insert-only re-capture, outcomes completed, filtered paging; ` +
    `${(size.bytes / size.n).toFixed(0)} bytes of detail per sample`);
} finally {
  await proxy.dispose();
}
