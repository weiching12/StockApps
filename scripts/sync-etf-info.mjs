// One-off refresh of ETF fund facts (profile, estimated NAV, distributions) into D1, using the same
// parsers as the scheduled sync. For the first fill after the migration, or a manual catch-up.
//   node scripts/sync-etf-info.mjs --local|--remote [--holdings-months N]
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { ETF_NAV_URL, ETF_PRODUCT_URL, ETF_PROFILE_URL, etfDividendUrl, parseEtfDividends, parseEtfNav, parseEtfProducts, parseEtfProfiles } from "../cloudflare/etf-info/source.js";
import { ETF_DIVIDEND_LOOKBACK_DAYS, ETF_HOLDING_MONTHS, fetchEtfHoldings } from "../cloudflare/etf-info/sync.js";

const monthsFlag = process.argv.indexOf("--holdings-months");
const holdingMonths = monthsFlag > 0 ? Math.max(1, Math.min(ETF_HOLDING_MONTHS, Number(process.argv[monthsFlag + 1]) || 1)) : ETF_HOLDING_MONTHS;
const targets = process.argv.slice(2).filter((flag) => ["--local", "--remote"].includes(flag));
if (targets.length !== 1) { console.error("用法：node scripts/sync-etf-info.mjs <--local|--remote>"); process.exit(1); }
const wranglerBin = join(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin", "wrangler.js");
const read = async (url) => {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.json();
};
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const sql = (value) => value === null || value === undefined ? "NULL"
  : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const values = (rows, pick) => rows.map((row) => `(${pick(row).map(sql).join(",")})`);
const insert = (head, rows) => { const out = []; for (let at = 0; at < rows.length; at += 100) out.push(`${head} VALUES ${rows.slice(at, at + 100).join(",")};`); return out; };

const now = new Date().toISOString(), today = now.slice(0, 10), start = shift(today, -ETF_DIVIDEND_LOOKBACK_DAYS);
const statements = [], summary = {};
let names = null;
const step = async (name, run) => {
  try { summary[name] = await run(); }
  catch (error) { summary[name] = `略過：${error.message}`; }
};
await step("profiles", async () => {
  const rows = parseEtfProfiles(await read(ETF_PROFILE_URL));
  names = rows.filter((row) => row.name);
  statements.push("DELETE FROM etf_profiles;", ...insert("INSERT INTO etf_profiles(Symbol,FundType,IndexName,InceptionDate,ListedDate,Units,UpdatedAt)",
    values(rows, (row) => [row.symbol, row.fundType, row.indexName, row.inceptionDate, row.listedDate, row.units, now])));
  return rows.length;
});
await step("dividends", async () => {
  const rows = parseEtfDividends(await read(etfDividendUrl(start, shift(today, 120))), start);
  if (!rows.length) throw new Error("配息報表沒有資料");
  statements.push(`DELETE FROM etf_dividends WHERE ExDate>=${sql(start)};`, ...insert("INSERT INTO etf_dividends(Symbol,ExDate,RecordDate,PayDate,Amount)",
    values(rows, (row) => [row.symbol, row.exDate, row.recordDate, row.payDate, row.amount])));
  return rows.length;
});
await step("products", async () => {
  const rows = parseEtfProducts(await read(ETF_PRODUCT_URL));
  statements.push("DELETE FROM etf_products;", ...insert("INSERT INTO etf_products(Symbol,Issuer,AssetSize,Holders,UpdatedAt)",
    values(rows, (row) => [row.symbol, row.issuer, row.assetSize, row.holders, now])));
  return rows.length;
});
await step("nav", async () => {
  const report = await read(ETF_NAV_URL);
  // The file carries one session; take its own date rather than assuming today traded.
  const compact = String(report?.a1?.flatMap((group) => group.msgArray ?? [])[0]?.i ?? "");
  if (!/^\d{8}$/.test(compact)) throw new Error("折溢價檔案沒有日期");
  const rows = parseEtfNav(report, `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`);
  if (!rows.length) throw new Error("折溢價檔案沒有資料");
  statements.push(...insert("INSERT OR REPLACE INTO etf_nav(Symbol,Date,MarketPrice,EstimatedNav,PremiumPercent,PreviousNav,Units,UpdatedAt)",
    values(rows, (row) => [row.symbol, row.date, row.marketPrice, row.estimatedNav, row.premiumPercent, row.previousNav, row.units, now])));
  return rows.length;
});
await step("holdings", async () => {
  if (!names) throw new Error("沒有基金名稱可供比對");
  // The whole kept window, about a minute per month; `--holdings-months N` fetches fewer.
  const { months, keepFrom } = await fetchEtfHoldings(fetch, names, new Set(), holdingMonths);
  for (const { month, rows } of months) statements.push(`DELETE FROM etf_holdings WHERE Month=${sql(month)};`,
    ...insert("INSERT INTO etf_holdings(Symbol,Month,Rank,Kind,Code,Name,Weight)",
      values(rows, (row) => [row.symbol, row.month, row.rank, row.kind, row.code, row.name, row.weight])));
  statements.push(`DELETE FROM etf_holdings WHERE Month<${sql(keepFrom)};`);
  return months.map(({ month, rows }) => `${month}：${new Set(rows.map((row) => row.symbol)).size} 檔`).join("、");
});
console.log(JSON.stringify(summary));
if (!statements.length) { console.error("沒有任何來源可用，未寫入。"); process.exit(1); }
const directory = await mkdtemp(join(tmpdir(), "stock-etf-info-"));
try {
  const file = join(directory, "etf-info.sql");
  await writeFile(file, statements.join("\n"));
  const result = spawnSync(process.execPath, [wranglerBin, "d1", "execute", "stockapps-t86", targets[0], "--file", file, "--yes"], { encoding: "utf8" });
  if (result.error || result.status !== 0) { console.error(result.stderr || result.stdout); throw new Error("寫入失敗，請確認已套用資料庫 migration"); }
  console.log(`已寫入 ${targets[0] === "--remote" ? "遠端" : "本機"} D1。`);
} finally { await rm(directory, { recursive: true, force: true }); }
