// Offline history backfill for the entry research studies (stage 1 of the backfill plan).
// Everything stays on this machine: TWSE public reports are cached under .backfill/raw and combined
// with the published market (read-only GET) into a local dataset in the research scripts' --cache
// format. Nothing is written to D1, KV or production.
//
//   node scripts/backfill-history-offline.mjs fetch   [--start 2024-11-01 --end 2026-06-05]  daily MI_INDEX + T86, 4 s apart, resumable
//   node scripts/backfill-history-offline.mjs actions [--start 2024-11-01 --end 2026-06-05 --d1 <dir>]  TWT49U/TWTAUU/TWTB8U by month
//   node scripts/backfill-history-offline.mjs build   [--live .backfill/live.json]  → .backfill/dataset-2y.json
//   node scripts/backfill-history-offline.mjs verify  → checks the backfill against the published data
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { reportUrl, fetchJson, normalizePrices, normalizeFlows } from "../cloudflare/adapters/twse.js";
import { marketDay, mergeShard, validDate } from "../shared/market.js";
import { SHARD_COUNT, expandStock, isEtf } from "../shared/market-codec.js";
import { combineCorporateActions, exRightsUrl, parValueUrl, parseExRightsReport,
  parseParValueReport, parseReductionReport, reductionUrl } from "../cloudflare/corporate-actions/source.js";
import { cliArgs, loadDataset, DEFAULT_ORIGIN } from "./lib/research-history.mjs";

const ROOT = ".backfill", RAW = `${ROOT}/raw`, ACTIONS = `${ROOT}/actions`;
const DELAY_MS = 4000;
const command = process.argv[2]?.startsWith("--") ? "fetch" : process.argv[2] ?? "fetch";
const args = cliArgs();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = (date) => date.toISOString().slice(0, 10);

function weekdays(start, end) {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error("Invalid --start/--end");
  const days = [];
  for (let day = new Date(`${start}T00:00:00Z`); iso(day) <= end; day.setUTCDate(day.getUTCDate() + 1))
    if (day.getUTCDay() % 6) days.push(iso(day));
  return days;
}
const rawPath = (date, type) => `${RAW}/${date.replaceAll("-", "")}-${type}.json`;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const isNoData = (body) => typeof body?.stat === "string" && /沒有符合條件的資料/.test(body.stat);

let lastRequest = 0;
async function politeFetch(url) {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try { return await fetchJson(url); }
    catch (error) {
      if (attempt >= 4) throw error;
      console.error(`  retry ${attempt} after ${error.message}`);
      await sleep(30000 * attempt);
    }
  }
}

async function fetchDays() {
  await mkdir(RAW, { recursive: true });
  const days = weekdays(args.start ?? "2024-11-01", args.end ?? "2026-06-05");
  let fetched = 0;
  for (const [position, date] of days.entries()) {
    const pricesPath = rawPath(date, "prices"), flowsPath = rawPath(date, "flows");
    if (!existsSync(pricesPath)) {
      const body = await politeFetch(reportUrl("prices", date));
      if (body?.stat !== "OK" && !isNoData(body)) throw new Error(`${date} prices: ${body?.stat}`);
      await writeFile(pricesPath, JSON.stringify(body)); fetched++;
    }
    const prices = await readJson(pricesPath);
    if (isNoData(prices)) { console.error(`${date} holiday`); continue; }
    if (!existsSync(flowsPath)) {
      const body = await politeFetch(reportUrl("flows", date));
      if (body?.stat !== "OK" && !isNoData(body)) throw new Error(`${date} flows: ${body?.stat}`);
      await writeFile(flowsPath, JSON.stringify(body)); fetched++;
    }
    if ((position + 1) % 20 === 0) console.error(`${position + 1}/${days.length} weekdays (${date}), ${fetched} requests`);
  }
  console.error(`Done: ${days.length} weekdays, ${fetched} new requests`);
}

/** Parsed trading days from the raw cache: [{ date, prices, flows }]. */
async function rawDays(start = "0000", end = "9999") {
  const names = (await readdir(RAW)).filter((name) => name.endsWith("-prices.json")).sort();
  const days = [];
  for (const name of names) {
    const date = `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}`;
    if (date < start || date > end) continue;
    const prices = normalizePrices(await readJson(`${RAW}/${name}`), date);
    if (!prices) continue;
    const flowsPath = rawPath(date, "flows");
    if (!existsSync(flowsPath)) throw new Error(`${date}: prices without flows; rerun fetch`);
    const flows = normalizeFlows(await readJson(flowsPath), date);
    if (!flows) throw new Error(`${date}: trading day without T86`);
    days.push({ date, prices, flows });
  }
  return days;
}

const liveCache = () => args.live ?? `${ROOT}/live.json`;
async function live() {
  await mkdir(ROOT, { recursive: true });
  return loadDataset(args.origin ?? DEFAULT_ORIGIN, liveCache());
}
const catalogOf = (dataset) => dataset.stocks.map(({ history, ...meta }) => meta);
const compactRow = (bar) => {
  const flows = ["外資", "投信", "自營商"].map((name) => bar.institutions.find((item) => item.name === name));
  return [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume,
    ...flows.flatMap((item) => item ? [item.buy, item.sell] : [null, null])];
};

/** Market days in the exact published row format, using the same coverage gate as the sync. */
function backfillMarketDays(catalog, days) {
  return days.map(({ prices, flows }) => marketDay(catalog, prices, flows));
}

async function build() {
  const dataset = await live();
  const catalog = catalogOf(dataset);
  const first = dataset.dates[0];
  const all = backfillMarketDays(catalog, await rawDays());
  const days = all.filter((day) => day.date < first);
  if (!days.length) throw new Error("No backfill days; run fetch first");
  // Same compact row merge as production (mergeShard) without the 260-day trim: backfill rows before the
  // first published session, then the published rows unchanged. ETFs (published from 2026-10-19 only) are
  // not gap-filled; entry research never evaluates them.
  const liveRows = new Map(dataset.stocks.map((stock) => [stock.symbol, stock.history.map(compactRow)]));
  const merged = new Map();
  for (let index = 0; index < SHARD_COUNT; index++) {
    for (const { symbol, history } of mergeShardUnbounded(catalog, index, all).stocks) {
      const published = liveRows.get(symbol);
      merged.set(symbol, [...history.filter((row) => row[0] < first), ...published]);
    }
  }
  const dates = [...days.map((day) => day.date), ...dataset.dates];
  if (new Set(dates).size !== dates.length || dates.some((date, i) => i && date <= dates[i - 1])) throw new Error("Calendar overlap");
  const calendar = new Set(dates);
  const stocks = catalog.map((meta) => {
    const rows = merged.get(meta.symbol).filter((row) => row[0] >= meta.listedOn && calendar.has(row[0]));
    return expandStock(meta, rows);
  });
  const out = { dates, info: { ...dataset.info, generation: `${dataset.info.generation}+backfill-${dates[0]}` }, stocks };
  await writeFile(`${ROOT}/dataset-2y.json`, JSON.stringify(out));
  console.error(`Wrote ${ROOT}/dataset-2y.json: ${dates.length} sessions (${dates[0]} ~ ${dates.at(-1)}), ${stocks.length} stocks, backfill ${days.length} sessions`);
}

function mergeShardUnbounded(catalog, index, days) {
  // mergeShard trims to HISTORY_LIMIT; merge in windows of at most that many days so nothing is dropped.
  const histories = new Map();
  for (let offset = 0; offset < days.length; offset += 200) {
    const shard = mergeShard(catalog, index, null, days.slice(offset, offset + 200));
    for (const { symbol, history } of shard.stocks) histories.set(symbol, [...histories.get(symbol) ?? [], ...history]);
  }
  return { stocks: [...histories].map(([symbol, history]) => ({ symbol, history })) };
}

// --- corporate actions ---
function months(start, end) {
  const list = [];
  for (let day = new Date(`${start.slice(0, 7)}-01T00:00:00Z`); iso(day) <= end; day.setUTCMonth(day.getUTCMonth() + 1)) {
    const monthEnd = new Date(day); monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1); monthEnd.setUTCDate(0);
    list.push([iso(day) < start ? start : iso(day), iso(monthEnd) > end ? end : iso(monthEnd)]);
  }
  return list;
}

async function actions() {
  const dir = args.outDir ?? ACTIONS;
  const start = args.start ?? "2024-11-01", end = args.end ?? "2026-06-05";
  await mkdir(`${ACTIONS}/raw`, { recursive: true }); await mkdir(dir, { recursive: true });
  const events = [];
  for (const [from, to] of months(start, end)) {
    const parsed = [];
    for (const [name, url, parse] of [["TWT49U", exRightsUrl, parseExRightsReport],
      ["TWTAUU", reductionUrl, parseReductionReport], ["TWTB8U", parValueUrl, parseParValueReport]]) {
      const path = `${ACTIONS}/raw/${from}_${to}-${name}.json`;
      if (!existsSync(path)) await writeFile(path, JSON.stringify(await politeFetch(url(from, to))));
      parsed.push(parse(await readJson(path), from, to));
    }
    const month = combineCorporateActions(...parsed);
    events.push(...month);
    console.error(`${from.slice(0, 7)}: ${parsed.map((list) => list.length).join("/")} → ${month.length}`);
  }
  // Coverage: every backfill trading day in the fetched range was fully checked.
  const tradingDays = (await rawDays(start, end)).map((day) => day.date);
  let rows = events.map((event) => ({ Date: event.date, Symbol: event.symbol, Kind: event.kind,
    BeforeClose: event.beforeClose, ReferencePrice: event.reference }));
  let coverage = tradingDays.map((date) => ({ Date: date, Status: "complete" }));
  // Merge the read-only D1 export for the published period (from 2026-06-08 on).
  const d1 = args.d1;
  if (d1) {
    const d1Events = await readJson(`${d1}/events.json`), d1Coverage = await readJson(`${d1}/coverage.json`);
    const seen = new Set(rows.map((row) => `${row.Date}:${row.Symbol}`));
    rows = [...rows, ...d1Events.filter((row) => row.Date > end && !seen.has(`${row.Date}:${row.Symbol}`))];
    coverage = [...coverage, ...d1Coverage.filter((row) => row.Date > end)];
  }
  rows.sort((a, b) => a.Date.localeCompare(b.Date) || a.Symbol.localeCompare(b.Symbol));
  coverage.sort((a, b) => a.Date.localeCompare(b.Date));
  await writeFile(`${dir}/events.json`, JSON.stringify(rows));
  await writeFile(`${dir}/coverage.json`, JSON.stringify(coverage));
  console.error(`Wrote ${dir}: ${rows.length} events, ${coverage.length} covered dates`);
}

// --- verification ---
async function verify() {
  const dataset = await live();
  const catalog = catalogOf(dataset);
  const report = { overlap: null, coverage: [], gaps: [], jumps: [], spot: {} };
  // 1. Overlap week: backfill parser output must equal the published rows exactly.
  const overlapDays = backfillMarketDays(catalog, await rawDays(args.overlapStart ?? "2026-06-08", args.overlapEnd ?? dataset.dates.at(-1)));
  const liveRows = new Map(dataset.stocks.map((stock) => [stock.symbol, new Map(stock.history.map((bar) => [bar.date, compactRow(bar)]))]));
  let compared = 0; const mismatches = [];
  for (const day of overlapDays) {
    const symbols = new Set([...Object.keys(day.records),
      ...dataset.stocks.filter((stock) => liveRows.get(stock.symbol).has(day.date)).map((stock) => stock.symbol)]);
    for (const symbol of symbols) {
      compared++;
      const a = JSON.stringify(day.records[symbol] ?? null), b = JSON.stringify(liveRows.get(symbol)?.get(day.date) ?? null);
      if (a !== b) mismatches.push({ date: day.date, symbol, backfill: a, live: b });
    }
  }
  const etfs = new Set(catalog.filter((stock) => stock.sector === "ETF").map((stock) => stock.symbol));
  const kind = (row) => row.live === "null" ? (etfs.has(row.symbol) ? "etfNotPublished" : "stockNotPublished")
    : row.backfill === "null" ? "missingInBackfill" : "valueDiffers";
  const byKind = mismatches.reduce((counts, row) => ({ ...counts, [kind(row)]: (counts[kind(row)] ?? 0) + 1 }), {});
  report.overlap = { days: overlapDays.map((day) => day.date), compared, identical: compared - mismatches.length, byKind,
    sample: mismatches.filter((row) => kind(row) !== "etfNotPublished").slice(0, 20) };

  if (!existsSync(`${ROOT}/dataset-2y.json`)) {
    console.log(JSON.stringify(report.overlap, null, 1));
    return;
  }
  // 2–3. Full dataset checks, on the stocks entry research evaluates (ETFs excluded, as in production).
  const full = await readJson(`${ROOT}/dataset-2y.json`);
  const acts = existsSync(`${ACTIONS}/events.json`) ? await readJson(`${ACTIONS}/events.json`) : [];
  const eventKey = new Set(acts.map((row) => `${row.Symbol}@${row.Date}`));
  const position = new Map(full.dates.map((date, index) => [date, index]));
  const byDate = new Map(full.dates.map((date) => [date, 0]));
  const eligibleOn = new Map(full.dates.map((date) => [date, 0]));
  const researched = full.stocks.filter((stock) => !isEtf(stock));
  for (const stock of researched) {
    for (const date of full.dates) if (stock.listedOn <= date) eligibleOn.set(date, eligibleOn.get(date) + 1);
    let previous = null;
    for (const bar of stock.history) {
      byDate.set(bar.date, byDate.get(bar.date) + 1);
      if (previous) {
        const skipped = position.get(bar.date) - position.get(previous.date) - 1;
        if (skipped > 0) report.gaps.push({ symbol: stock.symbol, after: previous.date, before: bar.date, sessions: skipped });
        const change = bar.open / previous.close - 1;
        // TWSE daily limit is ±10% (from the reference price); a larger open gap needs a corporate action.
        if (Math.abs(change) > 0.105 && !eventKey.has(`${stock.symbol}@${bar.date}`) )
          report.jumps.push({ symbol: stock.symbol, date: bar.date, previousClose: previous.close, open: bar.open,
            percent: +(change * 100).toFixed(2), skipped });
      }
      previous = bar;
    }
  }
  report.coverage = full.dates.map((date) => ({ date, traded: byDate.get(date), eligible: eligibleOn.get(date),
    percent: +(byDate.get(date) / eligibleOn.get(date) * 100).toFixed(1) }));
  // Ex-rights events must show up as a jump at the reference price, not elsewhere.
  const stockMap = new Map(full.stocks.map((stock) => [stock.symbol, stock]));
  report.eventChecks = acts.filter((row) => row.Date >= full.dates[0] && row.Date < dataset.dates[0]).map((row) => {
    const stock = stockMap.get(row.Symbol);
    const index = stock?.history.findIndex((bar) => bar.date === row.Date) ?? -1;
    if (!stock || index < 1) return { ...row, status: stock ? "no-bar" : "not-listed" };
    const before = stock.history[index - 1];
    return { ...row, status: before.close === row.BeforeClose ? "match" : "before-close-differs", actualBeforeClose: before.close,
      priorDate: before.date };
  });
  for (const symbol of (args.spot ?? "1802,2330,2317,0050,2603").split(",")) {
    const stock = stockMap.get(symbol);
    if (!stock) { report.spot[symbol] = null; continue; }
    report.spot[symbol] = { name: stock.name, listedOn: stock.listedOn, bars: stock.history.length,
      first: stock.history[0], atBoundary: stock.history.filter((bar) => bar.date >= "2026-06-03" && bar.date <= "2026-06-10")
        .map((bar) => [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume]) };
  }
  await writeFile(`${ROOT}/verify.json`, JSON.stringify(report, null, 1));
  const low = report.coverage.filter((row) => row.percent < 90);
  const events = report.eventChecks.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] ?? 0) + 1 }), {});
  console.log(JSON.stringify({ overlap: { days: report.overlap.days.length, compared, mismatches: mismatches.length },
    sessions: full.dates.length, lowCoverageDays: low.length, minCoverage: Math.min(...report.coverage.map((row) => row.percent)),
    gaps: report.gaps.length, unexplainedJumps: report.jumps.length, events }, null, 1));
}

const commands = { fetch: fetchDays, build, actions, verify };
if (!commands[command]) throw new Error(`Unknown command ${command}; use ${Object.keys(commands).join("|")}`);
await commands[command]();
