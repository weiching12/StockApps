import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { combineChunks } from "../src/provider.js";
import { isEtf } from "../src/market-codec.js";
import { normalizeEtfCatalog, normalizePrices } from "../cloudflare/adapters/twse.js";
import { marketDay, mergeShard, combineCatalogs } from "../shared/market.js";
import { createManifest } from "../cloudflare/snapshots/market-format.js";
import { MANIFEST_KEY, shardKey } from "../cloudflare/storage/market-keys.js";
import { SHARD_COUNT } from "../shared/market-codec.js";
import { T86DataValidator, t86FlowReport } from "../cloudflare/t86-validator.js";

/** Add one verified ETF session while retaining every existing company history. */
export function prepareEtfRelease({ manifest, chunks, rawCatalog, rawPrices, rawFlows, recentCounts, now = new Date() }) {
  const original = combineChunks(manifest, chunks);
  const companies = manifest.stocks.filter((stock) => !isEtf(stock));
  const etfs = normalizeEtfCatalog(rawCatalog).filter((stock) => stock.listedOn <= manifest.asOf);
  const flows = new T86DataValidator().validate({ httpStatus: 200, rawJson: JSON.stringify(rawFlows),
    tradeDate: manifest.asOf, recentCounts });
  if (!flows.valid) throw new Error(`ETF report not accepted: ${flows.status}: ${flows.error}`);
  const day = marketDay(etfs, normalizePrices(rawPrices, manifest.asOf), t86FlowReport(flows.rows, manifest.asOf));
  const catalog = combineCatalogs(companies, etfs);
  const generation = `etf-${manifest.asOf.replaceAll("-", "")}-${now.getTime()}`;
  const nextChunks = chunks.map((previous, index) => ({ ...mergeShard(catalog, index, previous, [day]), generation, index }));
  const oldCoverage = manifest.coverage;
  if (!oldCoverage || manifest.stocks.some(isEtf)) throw new Error("Initial ETF release requires a company-only market snapshot");
  const coverage = { companies: catalog.length, listedCompanies: companies.length, etfs: etfs.length,
    traded: oldCoverage.traded + day.coverage.traded,
    ...Object.fromEntries(["missingPrices", "inactive", "missingInstitutions"].map((key) =>
      [key, [...oldCoverage[key], ...day.coverage[key]]])) };
  const next = { ...manifest, ...createManifest(catalog, manifest.dates, generation, now.toISOString(), coverage, manifest.generation) };
  const decoded = combineChunks(next, nextChunks);
  const bySymbol = new Map(decoded.stocks.map((stock) => [stock.symbol, stock]));
  for (const stock of original.stocks) {
    if (JSON.stringify(bySymbol.get(stock.symbol)?.history) !== JSON.stringify(stock.history))
      throw new Error(`Company history changed: ${stock.symbol}`);
  }
  if (new Set(nextChunks.flatMap((chunk) => chunk.stocks.map((stock) => stock.symbol))).size !== catalog.length)
    throw new Error("Incomplete supplemental release");
  return { manifest: next, chunks: nextChunks, report: { asOf: next.asOf, listedCompanies: companies.length,
    etfs: etfs.length, etfsWithPrices: day.coverage.traded, total: catalog.length, companyHistoriesUnchanged: true } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const base = process.env.STOCK_BASE_URL || "https://stock-insight-tw.stock-insight-tw.workers.dev";
  const get = async (url) => { const response = await fetch(new URL(url, base));
    if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`); return response.json(); };
  const manifest = await get("/api/market");
  const chunks = [];
  // Small batches avoid overloading the cache API.
  for (let start = 0; start < SHARD_COUNT; start += 6)
    chunks.push(...await Promise.all(manifest.chunks.slice(start, start + 6).map(get)));
  const read = async (path) => JSON.parse(await readFile(path, "utf8"));
  const baseline = await read(".wrangler/etf-baseline.json");
  const recentCounts = baseline.filter((day) => day.date < manifest.asOf).slice(-5).map((day) => day.count);
  // D1 current-date context can have four older samples at bootstrap. A reviewed
  // fifth earlier report must be supplied; today's count is never its own baseline.
  if (recentCounts.length < 5) throw new Error("Provide five earlier verified report counts in .wrangler/etf-baseline.json");
  const result = prepareEtfRelease({ manifest, chunks,
    rawCatalog: await read(".wrangler/twse-etfs.json"),
    rawPrices: await read(`.wrangler/twse-cache/prices-${manifest.asOf}.json`),
    rawFlows: await read(`.wrangler/twse-cache/flows-${manifest.asOf}.json`), recentCounts });
  await mkdir(".wrangler", { recursive: true });
  await writeFile(".wrangler/before-etfs-manifest.json", JSON.stringify(manifest));
  await writeFile(".wrangler/etf-shards.json", JSON.stringify(result.chunks.map((chunk, index) =>
    ({ key: shardKey(result.manifest.generation, index), value: JSON.stringify(chunk) }))));
  await writeFile(".wrangler/etf-manifest.json", JSON.stringify([{ key: MANIFEST_KEY, value: JSON.stringify(result.manifest) }]));
  await writeFile(".wrangler/etf-release-report.json", JSON.stringify(result.report, null, 2));
  console.log(JSON.stringify(result.report, null, 2));
}
