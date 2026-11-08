import { expandStock, SHARD_COUNT, HISTORY_LIMIT, shardOf, validSymbol, isEtf } from "./market-codec.js";
import { MarketApiClient } from "./api/market-client.js";

const validDate = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const orderedDates = (dates) => Array.isArray(dates) && dates.length > 0 &&
  dates.every((date, index) => validDate(date) && (index === 0 || dates[index - 1] < date));

function validRows(rows, asOf) {
  return Array.isArray(rows) && rows.length <= HISTORY_LIMIT && rows.every((row, index) =>
    Array.isArray(row) && row.length === 12 && validDate(row[0]) && row[0] <= asOf &&
    (index === 0 || rows[index - 1][0] < row[0]) &&
    row.slice(1, 5).every((value) => Number.isFinite(value) && value > 0) &&
    row[2] >= Math.max(row[1], row[4]) && row[3] <= Math.min(row[1], row[4]) &&
    Number.isSafeInteger(row[5]) && row[5] >= 0 &&
    row.slice(6).every((value) => value === null || (Number.isSafeInteger(value) && value >= 0)));
}

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 2 || manifest.source !== "twse" ||
    !/^[a-z0-9-]{1,64}$/.test(manifest.generation) || !orderedDates(manifest.dates) ||
    manifest.asOf !== manifest.dates.at(-1) || !Number.isFinite(Date.parse(manifest.updatedAt)) ||
    !Array.isArray(manifest.stocks) || !manifest.stocks.length || !Array.isArray(manifest.chunks) ||
    manifest.chunks.length !== SHARD_COUNT || manifest.chunks.some((url, i) =>
      url !== `/api/v1/market/snapshots/${manifest.generation}/shards/${i}` &&
      url !== `/api/market/${manifest.generation}/${i}`))
    throw new Error("Invalid TWSE market manifest");
  const seen = new Set();
  for (const stock of manifest.stocks) {
    if (!validSymbol(stock?.symbol) || !stock.name || !stock.sector || stock.market !== "上市" ||
      !validDate(stock.listedOn) || seen.has(stock.symbol)) throw new Error("Invalid listed-company identity");
    if (stock.assetType && !["stock", "etf"].includes(stock.assetType)) throw new Error("Invalid asset type");
    if (isEtf(stock) && (stock.assetType !== "etf" || stock.sector !== "ETF" || stock.currency !== "TWD"))
      throw new Error("Invalid ETF identity");
    seen.add(stock.symbol);
  }
  return manifest;
}

function decodeChunk(manifest, chunk, index, expected) {
  if (chunk?.schemaVersion !== 2 || chunk.generation !== manifest.generation || chunk.index !== index || !Array.isArray(chunk.stocks))
    throw new Error("Mixed or invalid market generation");
  const compact = new Map();
  for (const stock of chunk.stocks) {
    if (shardOf(stock.symbol) !== index || compact.has(stock.symbol) || !validRows(stock.history, manifest.asOf))
      throw new Error("Invalid stock history chunk");
    compact.set(stock.symbol, stock.history);
  }
  if (compact.size !== expected.length || expected.some((stock) => !compact.has(stock.symbol)))
    throw new Error("Incomplete listed-company coverage");
  return expected.map((stock) => ({ ...expandStock(stock, compact.get(stock.symbol)), tradingDates: manifest.dates }));
}

function marketDataset(manifest, stocks) {
  return { stocks, dates: manifest.dates, info: {
    mode: "twse", label: "每日收盤資料", asOf: manifest.asOf, updatedAt: manifest.updatedAt,
    generation: manifest.generation,
    coverage: manifest.coverage,
    note: "資料來源：臺灣證券交易所。上市公司與新臺幣交易 ETF 名錄、每日收盤行情與三大法人買賣超日報；價格未還原、非即時報價。外資不含外資自營商，自營商合計自行買賣與避險。ETF 自加入日起逐日累積歷史，資料不足時不計算指標。法人買株僅統計產業個股，不含 ETF。未提供行情或法人明細時保留缺漏，不補零。",
  } };
}

export function combineChunks(manifest, chunks) {
  validateManifest(manifest);
  if (chunks.length !== manifest.chunks.length) throw new Error("Incomplete market chunks");
  const decoded = new Map();
  for (const [index, chunk] of chunks.entries())
    for (const stock of decodeChunk(manifest, chunk, index, manifest.stocks.filter((stock) => shardOf(stock.symbol) === index)))
      decoded.set(stock.symbol, stock);
  return marketDataset(manifest, manifest.stocks.map((stock) => decoded.get(stock.symbol)));
}

export async function loadDataset() {
  const { demoProvider } = await import("./data.js");
  return demoProvider.load();
}

export async function loadMarketSummary(fetcher = fetch, { onCacheFallback, settings } = {}) {
  const client = new MarketApiClient(fetcher);
  const manifestResponse = await client.market();
  if (manifestResponse.response.headers.get("X-PWA-Cache") === "fallback") onCacheFallback?.();
  const manifest = validateManifest(manifestResponse.data);
  const summaryResponse = await client.summary(manifest.asOf, settings, { cache: "no-cache" });
  if (summaryResponse.response.headers.get("X-PWA-Cache") === "fallback") onCacheFallback?.();
  if (summaryResponse.data.meta?.generation !== manifest.generation ||
      summaryResponse.data.meta?.asOf !== manifest.asOf ||
      summaryResponse.data.data?.stocks?.length !== manifest.stocks.length)
    throw new Error("Invalid market summary generation or coverage");
  return { dataset: marketDataset(manifest, manifest.stocks), summary: summaryResponse.data };
}
