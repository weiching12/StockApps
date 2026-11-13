// Manual refresh of ETF fund facts (profile, issuer/size, estimated NAV, distributions, monthly holdings)
// into D1, using the same parsers as the scheduled sync. For the first fill after a migration or a catch-up.
//   node scripts/sync-etf-info.mjs --local|--remote [--holdings-months N] [--allow-large]
//
// D1's free plan allows 100,000 rows written a day, shared with the evening sync and research capture
// (docs/cloudflare-limits.md). So this script writes only what differs: facts are upserts that touch a row
// only when a value changed, and holdings months already stored are not fetched or rewritten. It prints
// how many rows it may write before running, and refuses a large remote write without --allow-large.
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { ETF_NAV_URL, ETF_PRODUCT_URL, ETF_PROFILE_URL, etfDividendUrl, parseEtfDividends, parseEtfNav, parseEtfProducts, parseEtfProfiles } from "../cloudflare/etf-info/source.js";
import { ETF_DIVIDEND_LOOKBACK_DAYS, ETF_HOLDING_MONTHS, fetchEtfHoldings } from "../cloudflare/etf-info/sync.js";
import { parseWranglerD1Results } from "./lib/wrangler-json.js";

// Each holdings row is written three times: the row, its primary-key index entry and the month index.
const WRITES_PER_HOLDING = 3;
const LARGE_REMOTE_WRITE = 20_000;
const monthsFlag = process.argv.indexOf("--holdings-months");
const holdingMonths = monthsFlag > 0 ? Math.max(1, Math.min(ETF_HOLDING_MONTHS, Number(process.argv[monthsFlag + 1]) || 1)) : ETF_HOLDING_MONTHS;
const targets = process.argv.slice(2).filter((flag) => ["--local", "--remote"].includes(flag));
if (targets.length !== 1) { console.error("用法：node scripts/sync-etf-info.mjs <--local|--remote> [--holdings-months N] [--allow-large]"); process.exit(1); }
const target = targets[0], remote = target === "--remote";
const wranglerBin = join(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin", "wrangler.js");
const wrangler = (...args) => spawnSync(process.execPath, [wranglerBin, "d1", "execute", "stockapps-t86", target, ...args, "--yes"], { encoding: "utf8" });
const read = async (url) => {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.json();
};
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const sql = (value) => value === null || value === undefined ? "NULL"
  : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const values = (rows, pick) => rows.map((row) => `(${pick(row).map(sql).join(",")})`);
const insert = (head, rows, tail = "") => { const out = []; for (let at = 0; at < rows.length; at += 100) out.push(`${head} VALUES ${rows.slice(at, at + 100).join(",")}${tail};`); return out; };
/** An upsert that leaves a row untouched unless one of `columns` differs; `stamp` columns follow a real change. */
const upsert = (table, key, columns, stamp = []) => ` ON CONFLICT(${key}) DO UPDATE SET ${[...columns, ...stamp].map((column) => `${column}=excluded.${column}`).join(",")}`
  + ` WHERE ${columns.map((column) => `${table}.${column} IS NOT excluded.${column}`).join(" OR ")}`;
const list = (items) => items.map(sql).join(",");

/** Months already stored, read through the month index in one small query. */
function storedHoldingMonths() {
  const result = wrangler("--json", "--command", `WITH RECURSIVE months(Month) AS (SELECT MIN(Month) FROM etf_holdings
    UNION ALL SELECT (SELECT MIN(Month) FROM etf_holdings WHERE Month>months.Month) FROM months WHERE months.Month IS NOT NULL)
    SELECT Month FROM months WHERE Month IS NOT NULL`);
  if (result.error || result.status !== 0) throw new Error("無法讀取已儲存的持股月份，請確認已套用資料庫 migration");
  return new Set(parseWranglerD1Results(result.stdout)[0].results.map((row) => row.Month));
}

const now = new Date().toISOString(), today = now.slice(0, 10), start = shift(today, -ETF_DIVIDEND_LOOKBACK_DAYS);
const statements = [], summary = {};
let names = null, holdingRows = 0, factRows = 0;
const step = async (name, run) => {
  try { summary[name] = await run(); }
  catch (error) { summary[name] = `略過：${error.message}`; }
};
await step("profiles", async () => {
  const rows = parseEtfProfiles(await read(ETF_PROFILE_URL));
  names = rows.filter((row) => row.name);
  statements.push(`DELETE FROM etf_profiles WHERE Symbol NOT IN (${list(rows.map((row) => row.symbol))});`,
    ...insert("INSERT INTO etf_profiles(Symbol,FundType,IndexName,InceptionDate,ListedDate,Units,UpdatedAt)",
      values(rows, (row) => [row.symbol, row.fundType, row.indexName, row.inceptionDate, row.listedDate, row.units, now]),
      upsert("etf_profiles", "Symbol", ["FundType", "IndexName", "InceptionDate", "ListedDate", "Units"], ["UpdatedAt"])));
  factRows += rows.length;
  return rows.length;
});
await step("dividends", async () => {
  const rows = parseEtfDividends(await read(etfDividendUrl(start, shift(today, 120))), start);
  if (!rows.length) throw new Error("配息報表沒有資料");
  statements.push(`DELETE FROM etf_dividends WHERE ExDate<${sql(start)} OR (Symbol||':'||ExDate) NOT IN (${list(rows.map((row) => `${row.symbol}:${row.exDate}`))});`,
    ...insert("INSERT INTO etf_dividends(Symbol,ExDate,RecordDate,PayDate,Amount)",
      values(rows, (row) => [row.symbol, row.exDate, row.recordDate, row.payDate, row.amount]),
      upsert("etf_dividends", "Symbol,ExDate", ["RecordDate", "PayDate", "Amount"])));
  factRows += rows.length;
  return rows.length;
});
await step("products", async () => {
  const rows = parseEtfProducts(await read(ETF_PRODUCT_URL));
  statements.push(`DELETE FROM etf_products WHERE Symbol NOT IN (${list(rows.map((row) => row.symbol))});`,
    ...insert("INSERT INTO etf_products(Symbol,Issuer,AssetSize,Holders,UpdatedAt)",
      values(rows, (row) => [row.symbol, row.issuer, row.assetSize, row.holders, now]),
      upsert("etf_products", "Symbol", ["Issuer", "AssetSize", "Holders"], ["UpdatedAt"])));
  factRows += rows.length;
  return rows.length;
});
await step("nav", async () => {
  const report = await read(ETF_NAV_URL);
  // The file carries one session; take its own date rather than assuming today traded.
  const compact = String(report?.a1?.flatMap((group) => group.msgArray ?? [])[0]?.i ?? "");
  if (!/^\d{8}$/.test(compact)) throw new Error("折溢價檔案沒有日期");
  const rows = parseEtfNav(report, `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`);
  if (!rows.length) throw new Error("折溢價檔案沒有資料");
  statements.push(...insert("INSERT INTO etf_nav(Symbol,Date,MarketPrice,EstimatedNav,PremiumPercent,PreviousNav,Units,UpdatedAt)",
    values(rows, (row) => [row.symbol, row.date, row.marketPrice, row.estimatedNav, row.premiumPercent, row.previousNav, row.units, now]),
    upsert("etf_nav", "Symbol", ["Date", "MarketPrice", "EstimatedNav", "PremiumPercent", "PreviousNav", "Units"], ["UpdatedAt"])));
  factRows += rows.length;
  return rows.length;
});
await step("holdings", async () => {
  if (!names) throw new Error("沒有基金名稱可供比對");
  // Only the months not stored yet, about a minute each; `--holdings-months N` looks at fewer.
  const stored = storedHoldingMonths();
  const { months, keepFrom } = await fetchEtfHoldings(fetch, names, stored, holdingMonths);
  for (const { month, rows } of months) {
    statements.push(`DELETE FROM etf_holdings WHERE Month=${sql(month)};`,
      ...insert("INSERT INTO etf_holdings(Symbol,Month,Rank,Kind,Code,Name,Weight)",
        values(rows, (row) => [row.symbol, row.month, row.rank, row.kind, row.code, row.name, row.weight])));
    holdingRows += rows.length;
  }
  statements.push(`DELETE FROM etf_holdings WHERE Month<${sql(keepFrom)};`);
  return months.length ? months.map(({ month, rows }) => `${month}：${new Set(rows.map((row) => row.symbol)).size} 檔`).join("、")
    : `已有 ${stored.size} 個月份，沒有需要補的月份`;
});
console.log(JSON.stringify(summary));
if (!statements.length) { console.error("沒有任何來源可用，未寫入。"); process.exit(1); }
// Facts are bounded by their row counts (only changed rows are written); holdings are all new rows.
const holdingWrites = holdingRows * WRITES_PER_HOLDING, worst = holdingWrites + factRows * 3;
console.log(`預估寫入：持股 ${holdingRows} 列（含索引約 ${holdingWrites} 次寫入），其餘資料只寫有變動的列，最多約 ${factRows * 3} 次。免費方案每日上限 100,000 次。`);
if (remote && worst > LARGE_REMOTE_WRITE && !process.argv.includes("--allow-large")) {
  console.error(`這次最多會寫入約 ${worst} 次，超過 ${LARGE_REMOTE_WRITE} 次的保護門檻，未執行。確認當日額度足夠後加上 --allow-large，或用 --holdings-months N 分天補。`);
  process.exit(2);
}
const directory = await mkdtemp(join(tmpdir(), "stock-etf-info-"));
try {
  const file = join(directory, "etf-info.sql");
  await writeFile(file, statements.join("\n"));
  const result = wrangler("--file", file);
  if (result.error || result.status !== 0) { console.error(result.stderr || result.stdout); throw new Error("寫入失敗，請確認已套用資料庫 migration"); }
  const reported = /rows_written["':\s]+(\d+)/i.exec(result.stdout)?.[1] ?? /(\d[\d,]*)\s+rows written/i.exec(result.stdout)?.[1];
  console.log(`已寫入${remote ? "遠端" : "本機"} D1。${reported ? `資料庫回報寫入 ${reported} 列。` : ""}`);
} finally { await rm(directory, { recursive: true, force: true }); }
