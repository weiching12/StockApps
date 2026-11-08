import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { syncT86, acceptedT86 } from "../cloudflare/t86-sync.js";
import { T86Store } from "../cloudflare/t86-store.js";
import { t86FlowReport } from "../cloudflare/t86-validator.js";
import { CATALOG_URL, ETF_CATALOG_URL, fetchJson, normalizeCatalog, normalizeEtfCatalog, normalizePrices, reportUrl } from "../cloudflare/adapters/twse.js";
import { MANIFEST_KEY, shardKey } from "../cloudflare/storage/market-keys.js";
import { SHARD_COUNT } from "../shared/market-codec.js";
import { createManifest } from "../cloudflare/snapshots/market-format.js";
import { marketDay, mergeShard, combineCatalogs, taipeiDate, validDate } from "../shared/market.js";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const readJson = async (path) => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
async function saveJson(path, value) {
  await writeFile(`${path}.tmp`, JSON.stringify(value));
  await rename(`${path}.tmp`, path);
}

/** Sequential, resumable bulk download. Cache only successful JSON replies. */
export async function seedMarket({ end = taipeiDate(), sessions = 90, interval = 10000,
  directory = ".wrangler/twse-cache", output = ".wrangler/market-seed.json", offline = false,
  fetcher = fetch, wait = sleep, now = () => Date.now(), log = console.log, t86Store, t86Env = {}, includeEtfs = true } = {}) {
  if (!validDate(end) || end > taipeiDate() || !Number.isInteger(sessions) || sessions < 1 || sessions > 260 || interval < 10000)
    throw new Error("Use a valid --end date, 1–260 --sessions, and --interval >= 10000 ms");
  if (!t86Store) throw new Error("Historical ingestion requires T86Store; no validation bypass is allowed");
  await mkdir(directory, { recursive: true });
  let lastRequest = 0;
  async function spacedFetch(url, options) {
    if (offline) throw new Error(`Offline cache missing: ${url}`);
    const delay = Math.max(0, lastRequest + interval - now());
    if (delay) await wait(delay);
    lastRequest = now();
    // Fail fast on 403/429/network errors. No parallelism or automatic retry loop.
    return fetcher(url, options);
  }
  const request = (url) => fetchJson(url, spacedFetch);
  const catalogPath = `${directory}/companies.json`;
  let cachedCatalog = await readJson(catalogPath);
  if (!cachedCatalog || (!offline && cachedCatalog.checkedOn !== taipeiDate())) {
    const rows = await request(CATALOG_URL);
    const stocks = normalizeCatalog(rows);
    if (stocks.length < 900) throw new Error("Unexpectedly small listed-company catalog");
    cachedCatalog = { checkedOn: taipeiDate(), rows };
    await saveJson(catalogPath, cachedCatalog);
  }
  const companies = normalizeCatalog(cachedCatalog.rows);
  let catalog = companies;
  if (includeEtfs) {
    const etfPath = `${directory}/etfs.json`;
    let cachedEtfs = await readJson(etfPath);
    if (!cachedEtfs || (!offline && cachedEtfs.checkedOn !== taipeiDate())) {
      const rows = await request(ETF_CATALOG_URL);
      normalizeEtfCatalog(rows);
      cachedEtfs = { checkedOn: taipeiDate(), rows };
      await saveJson(etfPath, cachedEtfs);
    }
    catalog = combineCatalogs(companies, normalizeEtfCatalog(cachedEtfs.rows));
  }
  const days = [];
  const cursor = new Date(`${end}T00:00:00Z`);
  for (let scanned = 0; days.length < sessions && scanned < 600; scanned++, cursor.setUTCDate(cursor.getUTCDate() - 1)) {
    if ([0, 6].includes(cursor.getUTCDay())) continue;
    const date = cursor.toISOString().slice(0, 10);
    const pricePath = `${directory}/prices-${date}.json`;
    let rawPrices = await readJson(pricePath);
    if (!rawPrices) {
      rawPrices = await request(reportUrl("prices", date));
      normalizePrices(rawPrices, date);
      // Today's no-data reply might simply precede publication; don't pin it.
      if (date < taipeiDate() || rawPrices.stat === "OK") await saveJson(pricePath, rawPrices);
    }
    const prices = normalizePrices(rawPrices, date);
    if (!prices) { log(`${date}: no exchange report`); continue; }
    const flowPath = `${directory}/flows-${date}.json`;
    let rawJson;
    try { rawJson = await readFile(flowPath, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const run = await syncT86(t86Env, { tradeDate: date, slot: "backfill", now: new Date(now()), store: t86Store,
      ...(rawJson === undefined ? { fetcher: spacedFetch } : { rawJson, httpStatus: 200 }) });
    if (!acceptedT86(run.Status)) throw new Error(`Historical T86 ${date}: ${run.Status}: ${run.ErrorMessage ?? "no data"}; RunId=${run.RunId}`);
    if (rawJson === undefined) await writeFile(flowPath, run.RawJson);
    const version = await t86Store.current(date);
    const day = marketDay(catalog, prices, t86FlowReport(JSON.parse(version.RowsJson), date));
    if (prices.reportRows < 900) throw new Error(`Suspiciously short market report: ${date}`);
    days.push(day);
    if (!offline) await saveJson(`${directory}/progress.json`, { companies: catalog.length, requestedSessions: sessions,
      completedSessions: days.length, newest: days[0].date, oldest: date, checkedAt: new Date(now()).toISOString() });
    log(`${date}: ${days.length}/${sessions} sessions; ${day.coverage.traded} traded, ${day.coverage.missingInstitutions.length} institution rows absent`);
  }
  if (days.length !== sessions) throw new Error("Could not collect requested history; cached progress retained");
  days.reverse();
  // A republished seed must get a new immutable URL, even for the same end date.
  const generation = `seed-${days.at(-1).date.replaceAll("-", "")}-${sessions}-${now()}`;
  const manifest = createManifest(catalog, days.map((day) => day.date), generation,
    new Date(now()).toISOString(), days.at(-1).coverage);
  const entries = Array.from({ length: SHARD_COUNT }, (_, index) => ({
    key: shardKey(generation, index), value: JSON.stringify({ ...mergeShard(catalog, index, null, days), generation, index }),
  }));
  entries.push({ key: MANIFEST_KEY, value: JSON.stringify(manifest) });
  await mkdir(resolve(output, ".."), { recursive: true });
  await saveJson(output, entries);
  log(`Saved ${catalog.length} companies / ${sessions} market sessions / ${entries.length} KV keys to ${output}. No cloud resources changed.`);
  return { manifest, entries };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy({ remoteBindings: false });
  try {
    await seedMarket({ ...(args.end && { end: args.end }), ...(args.sessions && { sessions: Number(args.sessions) }),
      ...(args.interval && { interval: Number(args.interval) }), ...(args.directory && { directory: args.directory }),
      ...(args.output && { output: args.output }), offline: Object.hasOwn(args, "offline"),
      t86Store: new T86Store(proxy.env.T86_DB), t86Env: proxy.env });
  } catch (error) {
    console.error(`TWSE ingestion stopped: ${error.message}. Re-run to resume cached downloads.`); process.exitCode = 1;
  } finally { await proxy.dispose(); }
}
