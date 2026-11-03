// Shared loaders for the offline entry research studies (scripts/entry-research-*.mjs).
// They read the public market snapshot API and a read-only corporate-action export; nothing is written
// anywhere except the optional local cache file.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { combineChunks } from "../../src/provider.js";

export const DEFAULT_ORIGIN = "https://stock-insight-tw.stock-insight-tw.workers.dev";

/** `--name value` pairs from the command line. */
export function cliArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.reduce((pairs, value, index, all) =>
    value.startsWith("--") ? [...pairs, [value.slice(2), all[index + 1]]] : pairs, []));
}

/** The published market with every stock's history, from `cache` when it exists. */
export async function loadDataset(origin = DEFAULT_ORIGIN, cache) {
  if (cache && existsSync(cache)) return JSON.parse(await readFile(cache, "utf8"));
  const get = async (path) => {
    const response = await fetch(new URL(path, origin));
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  };
  const manifest = await get("/api/v1/market");
  const chunks = new Array(manifest.chunks.length);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < manifest.chunks.length) { const index = next++; chunks[index] = await get(manifest.chunks[index]); }
  }));
  const dataset = combineChunks(manifest, chunks);
  const plain = { dates: dataset.dates, info: dataset.info, stocks: dataset.stocks.map(({ tradingDates, ...stock }) => stock) };
  if (cache) await writeFile(cache, JSON.stringify(plain));
  return plain;
}

/**
 * Corporate actions from `<dir>/coverage.json` ([{ Date, Status }]) and `<dir>/events.json`
 * ([{ Date, Symbol, Kind, BeforeClose, ReferencePrice }]), exported read-only from D1.
 */
export async function loadActions(dir) {
  const read = async (name) => JSON.parse(await readFile(`${dir}/${name}`, "utf8"));
  const coverage = await read("coverage.json"), events = await read("events.json");
  const eventsBySymbol = new Map();
  for (const row of events) {
    if (!eventsBySymbol.has(row.Symbol)) eventsBySymbol.set(row.Symbol, new Map());
    eventsBySymbol.get(row.Symbol).set(row.Date, { kind: row.Kind, beforeClose: row.BeforeClose, reference: row.ReferencePrice });
  }
  return { coveredDates: new Set(coverage.filter((row) => row.Status === "complete").map((row) => row.Date)), eventsBySymbol };
}
