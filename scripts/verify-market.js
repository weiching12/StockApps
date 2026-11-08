import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { combineChunks } from "../src/provider.js";
import { MANIFEST_KEY, shardKey } from "../cloudflare/storage/market-keys.js";
import { isEtf } from "../src/market-codec.js";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
const entries = JSON.parse(await readFile(args.file ?? ".wrangler/market-seed.json", "utf8"));
const values = new Map(entries.map(({ key, value }) => [key, value]));
if (values.size !== entries.length) throw new Error("Duplicate exported KV keys");
const manifest = JSON.parse(values.get(MANIFEST_KEY));
const chunks = manifest.chunks.map((_, index) => JSON.parse(values.get(shardKey(manifest.generation, index))));
const dataset = combineChunks(manifest, chunks);
const { stocks, dates } = dataset;
const knownDates = new Set(dates);
const noHistory = [], shortHistory = [], partialInstitutions = [];
let totalBars = 0, traded = 0, with260Sessions = 0;
for (const stock of stocks) {
  totalBars += stock.history.length;
  if (stock.history.length === 260) with260Sessions++;
  if (!stock.history.length) noHistory.push(stock.symbol);
  if (stock.history.length < 60) shortHistory.push({ symbol: stock.symbol, sessions: stock.history.length, listedOn: stock.listedOn });
  for (const bar of stock.history) {
    if (bar.date < stock.listedOn || (bar.date >= dates[0] && !knownDates.has(bar.date)))
      throw new Error(`Pre-listing or unknown trading date: ${stock.symbol} ${bar.date}`);
  }
  const latest = stock.history.at(-1);
  if (latest?.date === manifest.asOf) {
    traded++;
    if (latest.institutions.length !== 3) partialInstitutions.push(stock.symbol);
  }
}
if (traded !== manifest.coverage.traded || stocks.length !== manifest.coverage.companies ||
    [...partialInstitutions].sort().join() !== [...manifest.coverage.missingInstitutions].sort().join())
  throw new Error("Published coverage counters disagree with history data");

let calendarCheck = "not requested";
if (args.calendars) {
  const closed = new Set();
  for (let year = Number(dates[0].slice(0, 4)); year <= Number(dates.at(-1).slice(0, 4)); year++) {
    const calendar = JSON.parse(await readFile(`${args.calendars}/calendar-${year}.json`, "utf8"));
    if (calendar.queryYear !== year || !Array.isArray(calendar.data)) throw new Error(`Wrong calendar year: ${year}`);
    for (const [date, name] of calendar.data) {
      if (!name.includes("開始交易日") && !name.includes("最後交易日")) closed.add(date);
    }
  }
  const cursor = new Date(`${dates[0]}T00:00:00Z`), missing = [];
  while (cursor.toISOString().slice(0, 10) <= manifest.asOf) {
    const date = cursor.toISOString().slice(0, 10);
    const open = ![0, 6].includes(cursor.getUTCDay()) && !closed.has(date);
    if (open && !knownDates.has(date)) missing.push(date);
    if (!open && knownDates.has(date)) throw new Error(`Report unexpectedly falls on a scheduled holiday: ${date}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // Annual schedules omit extraordinary closures. Require the official monthly
  // turnover report to confirm any otherwise unexplained absent session.
  for (const month of new Set(missing.map((date) => date.slice(0, 7).replace("-", "")))) {
    const path = `${args.calendars}/market-calendar-${month}.json`;
    const monthly = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
    if (monthly.stat !== "OK" || !monthly.date?.startsWith(month) || monthly.fields?.[0] !== "日期" || !monthly.data?.length)
      throw new Error(`Invalid official monthly market calendar: ${month}`);
    const actualDates = monthly.data.map((row) => {
      const match = /^(\d{3})\/(\d{2})\/(\d{2})$/.exec(row[0]);
      if (!match) throw new Error(`Invalid monthly trading date: ${row[0]}`);
      const date = `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
      if (date.slice(0, 7).replace("-", "") !== month) throw new Error(`Wrong monthly trading date: ${date}`);
      return date;
    });
    if (new Set(actualDates).size !== actualDates.length) throw new Error(`Duplicate monthly trading date: ${month}`);
    const absent = actualDates.filter((date) => date >= dates[0] && date <= manifest.asOf && !knownDates.has(date));
    if (absent.length) throw new Error(`Missing published market sessions: ${absent.join(", ")}`);
    for (const date of dates.filter((date) => date.replaceAll("-", "").startsWith(month)))
      if (!actualDates.includes(date)) throw new Error(`History disagrees with monthly market calendar: ${date}`);
  }
  calendarCheck = missing.length
    ? `passed: scheduled dates covered; official monthly turnover confirms no sessions on ${missing.join(", ")}`
    : "passed: all scheduled market dates covered";
}

const report = { verifiedAt: new Date().toISOString(), source: manifest.source, asOf: manifest.asOf,
  securities: stocks.length, companies: stocks.filter((stock) => !isEtf(stock)).length,
  etfs: stocks.filter(isEtf).length, ordinaryCompanies: stocks.filter((stock) => !isEtf(stock) && stock.sector !== "存託憑證").length,
  depositoryReceipts: stocks.filter((stock) => stock.sector === "存託憑證").length,
  marketSessions: dates.length, historyFrom: dates[0], totalBars, with260Sessions,
  tradedAtLatestDate: traded, missingLatestInstitutions: partialInstitutions,
  noHistory, shortHistory, calendarCheck, kvKeys: entries.length,
  compactMiB: +(entries.reduce((bytes, entry) => bytes + Buffer.byteLength(entry.value), 0) / 1048576).toFixed(2),
  estimatedGzipMiB: +(entries.reduce((bytes, entry) => bytes + gzipSync(entry.value).length, 0) / 1048576).toFixed(2) };
await writeFile(args.output ?? ".wrangler/market-verification.json", JSON.stringify(report, null, 2));
const { shortHistory: details, ...summary } = report;
console.log(JSON.stringify({ ...summary, shortHistoryCount: details.length,
  reportFile: args.output ?? ".wrangler/market-verification.json" }, null, 2));
