import { validSymbol } from "../../shared/market-codec.js";

export const ETF_PROFILE_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap47_L";
export const ETF_DIVIDEND_URL = "https://www.twse.com.tw/rwd/zh/ETF/etfDiv";
// Published by the TWSE market information system rather than the OpenAPI catalogue, so its shape is
// validated on every read and a failure only leaves the premium blank.
export const ETF_NAV_URL = "https://mis.twse.com.tw/stock/data/all_etf.txt";
// The TWSE ETF product list: issuer, reported fund size (TWD 100 million) and holders, from TDCC.
export const ETF_PRODUCT_URL = "https://www.twse.com.tw/zh/ETFortune/ajaxProductsResult";

const compact = (date) => date.replaceAll("-", "");
const realDate = (date) => new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date ? date : null;
const amount = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
};

export function etfDividendUrl(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end)
    throw new Error("Invalid ETF dividend date range");
  return `${ETF_DIVIDEND_URL}?response=json&startDate=${compact(start)}&endDate=${compact(end)}`;
}

/** "1090710" (ROC year, compact) → "2020-07-10"; anything else is unknown. */
function rocCompactDate(value) {
  const match = /^(\d{2,3})(\d{2})(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  try { return realDate(`${Number(match[1]) + 1911}-${match[2]}-${match[3]}`); } catch { return null; }
}
/** "115年07月21日" → "2026-07-21"; blank or malformed is unknown. */
function rocLongDate(value) {
  const match = /^(\d{2,3})年(\d{2})月(\d{2})日$/.exec(String(value ?? "").trim());
  if (!match) return null;
  try { return realDate(`${Number(match[1]) + 1911}-${match[2]}-${match[3]}`); } catch { return null; }
}
const text = (value) => { const trimmed = String(value ?? "").trim(); return trimmed ? trimmed.slice(0, 120) : null; };

export function parseEtfProfiles(report) {
  if (!Array.isArray(report) || !report.length || !("基金代號" in report[0]) || !("基金類型" in report[0]) ||
      !("標的指數/追蹤指數名稱" in report[0]))
    throw new Error("TWSE fund profile report unavailable or format changed");
  const profiles = new Map();
  for (const row of report) {
    const symbol = String(row["基金代號"] ?? "").trim();
    if (!validSymbol(symbol)) continue;
    const units = amount(row["發行單位數/轉換數"]);
    profiles.set(symbol, { symbol, name: text(row["基金中文名稱"]), fundType: text(row["基金類型"]), indexName: text(row["標的指數/追蹤指數名稱"]),
      inceptionDate: rocCompactDate(row["成立日期"]), listedDate: rocCompactDate(row["上市日期"]),
      units: units > 0 ? units : null });
  }
  if (!profiles.size) throw new Error("TWSE fund profile report has no usable rows");
  return [...profiles.values()];
}

export function parseEtfDividends(report, start) {
  if (String(report?.stat ?? report?.status).toUpperCase() !== "OK" || !Array.isArray(report.fields) || !Array.isArray(report.data) ||
      report.fields[0] !== "證券代號" || report.fields[2] !== "除息交易日" || !String(report.fields[5]).startsWith("收益分配金額"))
    throw new Error("TWSE ETF dividend report unavailable or format changed");
  const dividends = new Map();
  for (const row of report.data) {
    if (!Array.isArray(row) || row.length < 6) throw new Error("Invalid TWSE ETF dividend row");
    const symbol = String(row[0]).trim(), exDate = rocLongDate(row[2]);
    if (!validSymbol(symbol) || !exDate || exDate < start) continue;
    const value = amount(row[5]);
    if (value !== null && value < 0) throw new Error("Invalid TWSE ETF dividend amount");
    dividends.set(`${symbol}:${exDate}`, { symbol, exDate, recordDate: rocLongDate(row[3]), payDate: rocLongDate(row[4]), amount: value });
  }
  return [...dividends.values()];
}

/** Estimated NAV rows for `date` only: yesterday's file must not pass as today's premium. */
export function parseEtfNav(report, date) {
  if (!Array.isArray(report?.a1)) throw new Error("TWSE ETF NAV file unavailable or format changed");
  const rows = report.a1.flatMap((group) => Array.isArray(group?.msgArray) ? group.msgArray : []);
  if (!rows.length || !rows.every((row) => row && "a" in row && "f" in row && "i" in row))
    throw new Error("TWSE ETF NAV file unavailable or format changed");
  const navs = new Map();
  for (const row of rows) {
    const symbol = String(row.a).trim(), estimatedNav = amount(row.f);
    if (!validSymbol(symbol) || String(row.i) !== compact(date) || !(estimatedNav > 0)) continue;
    const marketPrice = amount(row.e), units = amount(row.c), previousNav = amount(row.h);
    navs.set(symbol, { symbol, date, estimatedNav, marketPrice: marketPrice > 0 ? marketPrice : null,
      // Recomputed from the two published figures instead of trusting the rounded column.
      premiumPercent: marketPrice > 0 ? (marketPrice / estimatedNav - 1) * 100 : null,
      previousNav: previousNav > 0 ? previousNav : null, units: units > 0 ? units : null });
  }
  return [...navs.values()];
}

export function parseEtfProducts(report) {
  if (report?.status !== "success" || !Array.isArray(report.data) || !report.data.length ||
      !("stockNo" in report.data[0]) || !("totalAv" in report.data[0]) || !("issuer" in report.data[0]))
    throw new Error("TWSE ETF product list unavailable or format changed");
  const products = new Map();
  for (const row of report.data) {
    const symbol = String(row.stockNo ?? "").trim();
    if (!validSymbol(symbol)) continue;
    const size = amount(row.totalAv), holders = amount(row.holders);
    products.set(symbol, { symbol, issuer: text(row.issuer), assetSize: size > 0 ? size * 1e8 : null,
      holders: Number.isInteger(holders) && holders >= 0 ? holders : null });
  }
  if (!products.size) throw new Error("TWSE ETF product list has no usable rows");
  return [...products.values()];
}
