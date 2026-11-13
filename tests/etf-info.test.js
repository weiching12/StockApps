import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDatabase } from "./helpers/t86-db.js";
import { EtfInfoRepository } from "../cloudflare/etf-info/repository.js";
import { etfDividendUrl, parseEtfDividends, parseEtfNav, parseEtfProducts, parseEtfProfiles } from "../cloudflare/etf-info/source.js";
import { fetchEtfHoldings, syncDailyEtfInfo } from "../cloudflare/etf-info/sync.js";
import { SITCA_HOLDINGS_URL, etfHoldingClass, fundNameKey, holdingsQuery, matchHoldingsToSymbols, parseEtfHoldings, parseHoldingsForm } from "../cloudflare/etf-info/holdings.js";
import { EtfInfoService } from "../cloudflare/services/etf-info-service.js";
import { resolveApiRoute } from "../cloudflare/api/routes.js";
import { runScheduled } from "../cloudflare/worker.js";
import { dividendFrequency, lastBuyDate, summarizeEtfDividends } from "../shared/etf-info.js";
import { monthlyCloseSeries } from "../shared/price-history.js";
import { etfChartEventsMarkup, etfDividendCardMarkup, etfDividendHistoryMarkup, etfFundMarkup, etfMonthEvents, etfMonthPanelsMarkup, etfPerformance, etfTechnicalMarkup } from "../src/ui/etf-detail.js";

const date = "2026-11-12";
const profiles = [{ "出表日期": "1151111", "基金代號": "0050", "基金簡稱": "元大台灣50", "基金中文名稱": "元大台灣卓越50證券投資信託基金", "基金類型": "國內成分證券指數股票型基金",
  "標的指數/追蹤指數名稱": "臺灣50指數", "成立日期": "0920625", "上市日期": "0920630", "發行單位數/轉換數": "25042000000", "基金經理人": "不應保存" },
{ "基金代號": "T2301", "基金類型": "封閉式基金", "標的指數/追蹤指數名稱": "", "成立日期": "", "上市日期": "", "發行單位數/轉換數": "" }];
const dividends = { stat: "ok", fields: ["證券代號", "證券簡稱", "除息交易日", "收益分配基準日", "收益分配發放日", "收益分配金額 (每1受益權益單位)", "收益分配標準 (102年度起啟用)", "公告年度"],
  data: [["0050", "元大台灣50", "115年07月21日", "115年07月27日", "115年08月10日", 0.6, "…", "115"],
    ["0050", "元大台灣50", "115年01月22日", "115年01月28日", "115年02月11日", "0.5", "…", "115"],
    ["0050", "元大台灣50", "115年12月16日", "", "", null, "…", "115"],
    ["0050", "元大台灣50", "113年07月16日", "113年07月22日", "113年08月09日", 1, "…", "113"]] };
const nav = { a1: [{ msgArray: [
  { a: "0050", b: "元大台灣50", c: 25042000000, d: 0, e: 100.95, f: 101.05, g: -0.1, h: "103.8100", i: "20261112", j: "13:31:00", k: "1" },
  { a: "00878", b: "國泰永續高股息", c: "19773290000", e: "33.00", f: "32.94", g: "0.18", h: "33.58", i: "20261111", j: "16:59:52" }] }, { refURL: "x" }] };

const products = { status: "success", data: [
  { stockNo: "0050", stockName: "元大台灣50", totalAv: "25,996.79", holders: "3,874,000", issuer: "元大證券投資信託股份有限公司" },
  { stockNo: "BAD", totalAv: "1", holders: "1", issuer: "x" }, { stockNo: "00999", totalAv: "", holders: "", issuer: "" }] };

const P = "ctl00$ContentPlaceHolder1$";
const holdingsForm = (months = ["202608", "202609"], selected = [...months].sort().at(-1)) => `<form><input type="hidden" name="__VIEWSTATE" value="VS" /><input type="hidden" name="__VIEWSTATEGENERATOR" value="GEN" />
  <input type="hidden" name="__EVENTVALIDATION" value="EV" /><select name="${P}ddlQ_YM">${months.map((month) => `<option${month === selected ? ' selected="selected"' : ""} value="${month}">${month}</option>`).join("")}</select>
  <select name="${P}ddlQ_Class"><option selected="selected" value="AA1">AA1.國內投資股票型</option><option value="AH11">AH11.國內投資指數股票型_股票型</option>
  <option value="AK11">AK11.國內投資指數股票型基金之連結基金</option><option value="AL11">AL11.國內投資主動式交易所交易基金_股票型</option></select></form>`;
const cells = (values) => `<tr>${values.map((value) => `<td>${value}</td>`).join("")}</tr>`;
const holdingsHeader = cells(["基金名稱", "名次", "標的種類", "標的代號 或BloombergIsin Code", "標的名稱", "金額", "擔保機構**", "次順位債券**", "受益權單位數***", "占基金淨資產價值之比例(%)"]);
const holdingsTable = (...funds) => `<table>${holdingsHeader}${funds.map(([name, rows]) =>
  rows.map(([code, label, weight], index) => cells([...(index ? [] : [name]), index + 1, "國內上市", code, label, "1,000", "", "", "0", weight])).join("")).join("")}</table>`;
const emptyHoldings = "<p>查無資料</p>";
// Like the real site: a result page carries the form on the month asked for, and a query whose month
// differs from the page it was sent from answers with another view (here, an unrelated fund) regardless of class.
const formMonths = (form) => [...form.matchAll(/<option[^>]*value="(\d{6})"/g)].map((match) => match[1]);
const sitca = (init, overrides = {}) => {
  const form = overrides.form ?? holdingsForm();
  if (init?.method !== "POST") return new Response(form, { headers: { "set-cookie": "ASP.NET_SessionId=abc; path=/" } });
  const body = new URLSearchParams(String(init.body)), month = body.get(`${P}ddlQ_YM`), from = body.get("__VIEWSTATE").split(":")[1] ?? [...formMonths(form)].sort().at(-1);
  const page = holdingsForm(formMonths(form), month).replace('value="VS"', `value="VS:${month}"`);
  const table = month !== from ? holdingsTable(["切換月份時的公司別畫面", [["9999", "不相干", "1"]]])
    : body.get(`${P}ddlQ_Class`) === "AH11" ? overrides.table ?? holdingsTable(["元大台灣卓越50基金(本基金之配息來源可能為收益平準金)", [["2330", "台積電", "56.45"], ["2454", "聯發科", "6.74"]]]) : emptyHoldings;
  return new Response(page + table);
};

function fixture() {
  const db = testDatabase();
  for (const file of ["0011_etf_info.sql", "0012_etf_products.sql", "0013_etf_holdings.sql"]) db.sqlite.exec(readFileSync(new URL(`../cloudflare/migrations/${file}`, import.meta.url), "utf8"));
  return { db, repository: new EtfInfoRepository(db) };
}
const respond = (overrides = {}) => async (url, init) => {
  if (url === SITCA_HOLDINGS_URL) return overrides.holdings instanceof Response ? overrides.holdings : sitca(init, overrides);
  const body = url.includes("t187ap47") ? overrides.profiles ?? profiles : url.includes("etfDiv") ? overrides.dividends ?? dividends
    : url.includes("ajaxProductsResult") ? overrides.products ?? products : overrides.nav ?? nav;
  return body instanceof Response ? body : Response.json(body);
};
const market = (stock = { symbol: "0050", assetType: "etf", history: [{ date, close: 100 }] }) =>
  ({ stock: async (symbol) => ({ asOf: date, stock: { ...stock, symbol } }) });

test("fund profiles keep the facts shown and skip non-security codes and personal names", () => {
  const rows = parseEtfProfiles(profiles);
  assert.deepEqual(rows, [{ symbol: "0050", name: "元大台灣卓越50證券投資信託基金", fundType: "國內成分證券指數股票型基金", indexName: "臺灣50指數",
    inceptionDate: "2003-06-25", listedDate: "2003-06-30", units: 25042000000 }]);
  assert.throws(() => parseEtfProfiles([{ 代號: "0050" }]), /format changed/);
  assert.throws(() => parseEtfProfiles([]), /format changed/);
});

test("distributions parse ROC dates, keep an unannounced amount unknown and drop rows before the window", () => {
  assert.match(etfDividendUrl("2025-10-08", date), /startDate=20251008&endDate=20261112$/);
  assert.throws(() => etfDividendUrl(date, "2025-01-01"), /Invalid/);
  const rows = parseEtfDividends(dividends, "2025-10-08");
  assert.deepEqual(rows.map((row) => [row.exDate, row.payDate, row.amount]),
    [["2026-07-21", "2026-08-10", 0.6], ["2026-01-22", "2026-02-11", 0.5], ["2026-12-16", null, null]]);
  assert.throws(() => parseEtfDividends({ stat: "ok", fields: ["代號"], data: [] }, date), /format changed/);
  assert.throws(() => parseEtfDividends({ ...dividends, data: [["0050", "x", "115年07月21日", "", "", -1]] }, "2025-01-01"), /amount/);
});

test("estimated NAV rows are taken for the market day only and the premium is recomputed", () => {
  const rows = parseEtfNav(nav, date);
  assert.equal(rows.length, 1, "yesterday's row for 00878 is not today's premium");
  assert.equal(rows[0].symbol, "0050");
  assert.equal(rows[0].estimatedNav, 101.05);
  assert.ok(Math.abs(rows[0].premiumPercent - (100.95 / 101.05 - 1) * 100) < 1e-12);
  assert.equal(rows[0].previousNav, 103.81);
  assert.throws(() => parseEtfNav({ a1: [{ msgArray: [{ a: "0050" }] }] }, date), /format changed/);
  assert.throws(() => parseEtfNav({}, date), /format changed/);
});

test("trailing distributions cover exactly one year back and never read a non-payer as 0%", () => {
  const rows = [{ exDate: "2026-07-21", amount: 0.6 }, { exDate: "2025-11-12", amount: 9 }, { exDate: "2025-11-13", amount: 0.4 },
    { exDate: "2026-12-16", payDate: null, amount: null }];
  const summary = summarizeEtfDividends(rows, date, 50);
  assert.deepEqual(summary.trailing, { from: "2025-11-12", to: date, count: 2, amount: 1, yieldPercent: 2 });
  assert.deepEqual(summary.upcoming, { exDate: "2026-12-16", lastBuyDate: "2026-12-15", payDate: null, amount: null });
  assert.equal(summary.latest.exDate, "2026-07-21");
  assert.equal(summarizeEtfDividends(rows, date, null).trailing.yieldPercent, null);
  assert.deepEqual(summarizeEtfDividends([], date, 50), { frequency: null, trailing: null, upcoming: null, latest: null });
  assert.equal(summarizeEtfDividends([{ exDate: "2023-02-28", amount: 1 }], "2024-02-29", 10).trailing, null);
});

test("the daily sync stores all three sources once and a failed source keeps its last good rows", async () => {
  const { db, repository } = fixture();
  const env = { ETF_INFO_ENABLED: "1", T86_DB: db, MARKET_DATA: { get: async () => ({ asOf: date }) } };
  const state = { phase: "done", date };
  assert.equal((await syncDailyEtfInfo({ ...env, ETF_INFO_ENABLED: "0" }, state, new Date(`${date}T13:00:00Z`), respond())).status, "skipped");
  assert.equal((await syncDailyEtfInfo(env, { phase: "publish", date }, new Date(`${date}T13:00:00Z`), respond())).status, "skipped");
  assert.equal((await syncDailyEtfInfo(env, state, new Date(`${date}T12:00:00Z`), respond())).status, "before-evening-refresh");
  // The NAV file is down on the first attempt: the other two are saved and the day stays open for one retry.
  const first = await syncDailyEtfInfo(env, state, new Date(`${date}T12:40:00Z`), respond({ nav: new Response("", { status: 503 }) }));
  assert.deepEqual(first, { status: "partial", profiles: 1, dividends: 3, products: 2, nav: null, holdings: 2 });
  assert.equal((await repository.fund("0050", "2025-01-01")).nav, null);
  assert.equal((await syncDailyEtfInfo(env, state, new Date(`${date}T12:50:00Z`), respond())).status, "already-checked");
  // On the retry the dividend report has changed shape: yesterday's distributions stay, the NAV arrives.
  const second = await syncDailyEtfInfo(env, state, new Date(`${date}T13:15:00Z`), respond({ dividends: { stat: "ok", fields: ["x"], data: [] } }));
  assert.deepEqual(second, { status: "partial", profiles: 1, dividends: null, products: 2, nav: 1, holdings: 0 });
  assert.equal((await syncDailyEtfInfo(env, state, new Date(`${date}T14:00:00Z`), respond())).status, "already-checked");
  const stored = await repository.fund("0050", "2025-01-01");
  assert.equal(stored.profile.IndexName, "臺灣50指數");
  assert.equal(stored.nav.EstimatedNav, 101.05);
  assert.deepEqual(stored.dividends.map((row) => row.ExDate), ["2026-12-16", "2026-07-21", "2026-01-22"]);
  assert.equal(db.sqlite.prepare("SELECT Status, Attempts FROM etf_info_runs WHERE Date=?").get(date).Attempts, 2);
});

test("a complete run closes the day", async () => {
  const { db } = fixture();
  const env = { ETF_INFO_ENABLED: "1", T86_DB: db, MARKET_DATA: { get: async () => ({ asOf: date }) } };
  const result = await syncDailyEtfInfo(env, { phase: "done", date }, new Date(`${date}T12:40:00Z`), respond());
  assert.deepEqual(result, { status: "complete", profiles: 1, dividends: 3, products: 2, nav: 1, holdings: 2 });
  assert.equal(db.sqlite.prepare("SELECT Status FROM etf_info_runs WHERE Date=?").get(date).Status, "complete");
  assert.equal((await syncDailyEtfInfo(env, { phase: "done", date }, new Date(`${date}T13:30:00Z`), respond())).status, "already-checked");
});

test("the fund endpoint is routable and answers ordinary shares and unsynced ETFs with empty facts", async () => {
  assert.deepEqual(resolveApiRoute("/api/v1/stocks/0050/fund"), { name: "fund", params: { symbol: "0050" }, methods: ["GET", "HEAD"], versioned: true });
  assert.equal(resolveApiRoute("/api/stocks/0050/fund").name, null);
  const empty = { symbol: "2330", profile: null, nav: null, size: null, sizeBasis: null, holders: null, dividends: [], frequency: null, trailing: null, upcoming: null, latest: null, holdings: null };
  const share = await new EtfInfoService(market({ sector: "半導體", history: [] }), { fund() { throw new Error("must not be read"); } }).fund("2330");
  assert.deepEqual(share.data, empty);
  assert.deepEqual((await new EtfInfoService(market(), null).fund("0050")).data, { ...empty, symbol: "0050" });
  const { repository } = fixture();
  const unsynced = await new EtfInfoService(market(), repository).fund("0050");
  assert.deepEqual(unsynced.data, { ...empty, symbol: "0050" });
  assert.equal(unsynced.meta.updatedAt, null);
});

test("the fund endpoint reports the profile, premium, estimated size and trailing yield", async () => {
  const { db, repository } = fixture();
  await syncDailyEtfInfo({ ETF_INFO_ENABLED: "1", T86_DB: db, MARKET_DATA: { get: async () => ({ asOf: date }) } },
    { phase: "done", date }, new Date(`${date}T12:40:00Z`), respond());
  const { data, meta } = await new EtfInfoService(market(), repository).fund("0050");
  assert.deepEqual(data.profile, { fundType: "國內成分證券指數股票型基金", indexName: "臺灣50指數", issuer: "元大證券投資信託股份有限公司", inceptionDate: "2003-06-25", listedDate: "2003-06-30", units: 25042000000 });
  assert.equal(data.nav.date, date);
  // The reported fund size wins over units × estimated NAV; without the product list it falls back, marked estimated.
  assert.equal(data.size, 25996.79e8);
  assert.equal(data.sizeBasis, "reported");
  assert.equal(data.holders, 3874000);
  db.sqlite.exec("DELETE FROM etf_products");
  const fallback = (await new EtfInfoService(market(), repository).fund("0050")).data;
  assert.equal(fallback.size, 25042000000 * 101.05);
  assert.equal(fallback.sizeBasis, "estimated");
  assert.equal(fallback.profile.issuer, null);
  assert.equal(fallback.holders, null);
  assert.deepEqual(data.frequency, { code: "semiannual", label: "半年配息" });
  assert.deepEqual(data.upcoming, { exDate: "2026-12-16", lastBuyDate: "2026-12-15", payDate: null, amount: null });
  assert.deepEqual(data.latest, { exDate: "2026-07-21", lastBuyDate: "2026-07-20", payDate: "2026-08-10", amount: 0.6 });
  assert.equal(data.dividends[1].lastBuyDate, "2026-07-20");
  assert.deepEqual(data.holdings, { basis: "monthly-top-10", months: [{ month: "2026-09", items: [
    { rank: 1, kind: "國內上市", code: "2330", name: "台積電", weight: 56.45 }, { rank: 2, kind: "國內上市", code: "2454", name: "聯發科", weight: 6.74 }] }] });
  assert.equal(fallback.holdings.months[0].items.length, 2);
  assert.equal(data.trailing.count, 2);
  assert.ok(Math.abs(data.trailing.yieldPercent - 1.1) < 1e-9);
  assert.equal(data.upcoming.exDate, "2026-12-16");
  assert.equal(data.dividends.length, 3);
  assert.equal(meta.navBasis, "estimated");
  assert.equal(meta.updatedAt, `${date}T12:40:00.000Z`);
});

test("a failing fund sync is logged and never holds back research capture", async () => {
  const logs = [], original = { log: console.log, error: console.error };
  console.log = (line) => logs.push(line); console.error = () => {};
  let captured = 0;
  try {
    await runScheduled({ scheduledTime: Date.parse(`${date}T13:00:00Z`) }, {}, {
      sync: async () => ({ phase: "done", date }), syncActions: async () => ({ status: "complete", events: 0 }),
      syncEtfInfo: async () => { throw new Error("D1 down"); }, captureEntry: async () => { captured++; return { status: "captured" }; } });
  } finally { Object.assign(console, original); }
  assert.equal(captured, 1);
  const entry = JSON.parse(logs.at(-1));
  assert.equal(entry.etfInfo, "delayed");
  assert.equal(entry.entryResearchCapture, "captured");
});

test("the product list gives the issuer, reported size and holders, skipping unusable rows", () => {
  assert.deepEqual(parseEtfProducts(products), [
    { symbol: "0050", issuer: "元大證券投資信託股份有限公司", assetSize: 25996.79e8, holders: 3874000 },
    { symbol: "00999", issuer: null, assetSize: null, holders: null }]);
  assert.throws(() => parseEtfProducts({ status: "error", data: [] }), /format changed/);
  assert.throws(() => parseEtfProducts({ status: "success", data: [{ code: "0050" }] }), /format changed/);
});

test("the last day to buy is the weekday before the ex-date", () => {
  assert.equal(lastBuyDate("2026-11-17"), "2026-11-16");
  assert.equal(lastBuyDate("2026-11-16"), "2026-11-13", "a Monday ex-date reaches back over the weekend");
  assert.equal(lastBuyDate("2027-01-03"), "2027-01-01", "a weekend ex-date in the data still lands on a weekday");
});

test("distribution frequency is read from the gap between ex-dates and stays unknown from a single date", () => {
  const every = (days, count) => Array.from({ length: count }, (_, index) => ({ exDate: new Date(Date.UTC(2026, 0, 15) + index * days * 86_400_000).toISOString().slice(0, 10) }));
  assert.equal(dividendFrequency(every(30, 12)).label, "月配息");
  assert.equal(dividendFrequency(every(61, 6)).label, "雙月配息");
  assert.equal(dividendFrequency(every(91, 5)).label, "季配息");
  assert.equal(dividendFrequency(every(182, 3)).label, "半年配息");
  assert.equal(dividendFrequency(every(365, 2)).label, "年配息");
  assert.equal(dividendFrequency(every(30, 1)), null);
  assert.equal(dividendFrequency([]), null);
  // One irregular gap does not change a quarterly payer.
  assert.equal(dividendFrequency([...every(91, 4), { exDate: "2027-03-20" }]).code, "quarterly");
});

const format = { esc: (value) => String(value), number: (value, digits = 0) => Number(value).toFixed(digits) };

test("the dividend card leads with the next distribution, or says the latest one is already past", () => {
  assert.match(etfDividendCardMarkup(undefined, format, () => "LOADING"), /LOADING/);
  assert.match(etfDividendCardMarkup(null, format), /暫時無法讀取/);
  assert.match(etfDividendCardMarkup({ dividends: [], frequency: null, trailing: null, upcoming: null, latest: null }, format), /沒有配息紀錄/);
  const event = { exDate: "2026-11-17", lastBuyDate: "2026-11-16", payDate: "2026-12-11", amount: null };
  const next = etfDividendCardMarkup({ dividends: [event], frequency: { code: "quarterly", label: "季配息" }, upcoming: event, latest: null,
    trailing: { count: 4, amount: 1.64, yieldPercent: 7.084 } }, format);
  assert.match(next, /etf-frequency">季配息</);
  assert.match(next, /下次配息/);
  assert.match(next, /最後買進日<\/dt><dd class="">11\/16（一）/);
  assert.match(next, /除息日<\/dt><dd class="">11\/17（二）/);
  assert.match(next, /領息日<\/dt><dd class="">12\/11（五）/);
  assert.match(next, /每單位配息<\/dt><dd class="">未公告/);
  assert.match(next, /近一年殖利率<\/dt><dd class="">7\.08%/);
  assert.match(next, /共 4 次/);
  // Nothing announced: the latest distribution is shown and labelled as past; the count stands in for an unknown frequency.
  const past = etfDividendCardMarkup({ dividends: [{ ...event, amount: 0.6 }], frequency: null, upcoming: null,
    latest: { ...event, amount: 0.6 }, trailing: { count: 1, amount: 0.6, yieldPercent: null } }, format);
  assert.match(past, /最近一次配息 <small>已除息，下次尚未公告/);
  assert.doesNotMatch(past, /下次配息/);
  assert.match(past, /etf-frequency">近一年配息 1 次</);
  assert.match(past, /每單位配息<\/dt><dd class="">0\.600 元/);
  assert.match(past, /近一年殖利率<\/dt><dd class="">—/);
});

test("the history lists each distribution with its last day to buy and an unannounced amount as such", () => {
  assert.equal(etfDividendHistoryMarkup({ dividends: [] }, format), "");
  assert.equal(etfDividendHistoryMarkup(null, format), "");
  const markup = etfDividendHistoryMarkup({ dividends: [
    { exDate: "2026-11-17", lastBuyDate: "2026-11-16", payDate: null, amount: null },
    { exDate: "2026-08-18", lastBuyDate: "2026-08-17", payDate: "2026-09-11", amount: 0.42 }] }, format);
  assert.match(markup, /<td>11\/16<\/td><td>2026-11-17<\/td><td>未公告<\/td><td>未公告<\/td>/);
  assert.match(markup, /<td>08\/17<\/td><td>2026-08-18<\/td><td>2026-09-11<\/td><td>0\.420<\/td>/);
});

test("fund facts leave out what is unknown and name an estimated size as such", () => {
  assert.equal(etfFundMarkup(null, format), "");
  assert.equal(etfFundMarkup({ profile: null, nav: null, size: null }, format), "");
  const bare = etfFundMarkup({ profile: { indexName: "不適用", fundType: "主動式", issuer: null, listedDate: null }, nav: null, size: null, sizeBasis: null, holders: null }, format);
  assert.doesNotMatch(bare, /追蹤指數|折溢價|規模|受益人數|發行公司/);
  assert.match(bare, /基金類型/);
  const full = etfFundMarkup({ profile: { indexName: "臺灣50指數", fundType: "指數股票型", issuer: "元大投信", listedDate: "2003-06-30" },
    nav: { date, estimated: 101.05, marketPrice: 100.95, premiumPercent: -0.099, previous: null }, size: 2.5e12, sizeBasis: "reported", holders: 3874000 }, format);
  assert.match(full, /基金規模<\/dt><dd>25000 億元/);
  assert.match(full, /受益人數<\/dt><dd>3874000 人/);
  assert.match(full, /折價<\/dt><dd class="down">-0\.10%/);
  assert.match(etfFundMarkup({ profile: null, nav: null, size: 5e9, sizeBasis: "estimated", holders: null }, format), /規模（估算）<\/dt><dd>50\.00 億元/);
});

test("the holdings form gives its latest month and only the ETF classes", () => {
  assert.equal(etfHoldingClass("AH11.國內投資指數股票型_股票型"), true);
  assert.equal(etfHoldingClass("AL21.跨國投資主動式交易所交易基金_股票型"), true);
  assert.equal(etfHoldingClass("AK11.國內投資指數股票型基金之連結基金"), false);
  assert.equal(etfHoldingClass("AA1.國內投資股票型"), false);
  const form = parseHoldingsForm(holdingsForm(["202609", "202608"]));
  assert.deepEqual(form, { state: { __VIEWSTATE: "VS", __VIEWSTATEGENERATOR: "GEN", __EVENTVALIDATION: "EV" }, month: "202609", selected: "202609", months: ["202608", "202609"], classes: ["AH11", "AL11"] });
  assert.equal(parseHoldingsForm(holdingsForm(["202608", "202609"], "202608")).selected, "202608");
  assert.equal(holdingsQuery(form, "AH11", "202608").get(`${P}ddlQ_YM`), "202608");
  const query = holdingsQuery(form, "AH11");
  assert.equal(query.get(`${P}ddlQ_YM`), "202609");
  assert.equal(query.get(`${P}rdo1`), "rbClass");
  assert.equal(query.get(`${P}ddlQ_Class`), "AH11");
  assert.equal(query.get("__VIEWSTATE"), "VS");
  assert.throws(() => parseHoldingsForm("<html>maintenance</html>"), /format changed/);
});

test("the holdings table groups rows under each fund and rejects a changed layout", () => {
  const funds = parseEtfHoldings(holdingsForm() + holdingsTable(["甲基金", [["2330", "台積電", "25.02"], ["2454", "聯發科", "17.34"]]], ["乙基金", [["1303", "南亞", "8.37"]]]));
  assert.deepEqual(funds, [
    { fundName: "甲基金", holdings: [{ rank: 1, kind: "國內上市", code: "2330", name: "台積電", weight: 25.02 }, { rank: 2, kind: "國內上市", code: "2454", name: "聯發科", weight: 17.34 }] },
    { fundName: "乙基金", holdings: [{ rank: 1, kind: "國內上市", code: "1303", name: "南亞", weight: 8.37 }] }]);
  assert.deepEqual(parseEtfHoldings(`${holdingsForm()}${emptyHoldings}`), [], "a class with no funds is not an error");
  assert.throws(() => parseEtfHoldings("<html>blocked</html>"), /format changed/);
  assert.throws(() => parseEtfHoldings(`<table>${cells(["基金名稱", "名次", "標的種類", "代號", "標的", "比例"])}</table>`), /format changed/);
});

test("fund names from the two sources meet on one key, and doubtful matches are left out", () => {
  assert.equal(fundNameKey("元大台灣高股息基金(本基金之配息來源可能為收益平準金且並無保證收益及配息)"), "元大台灣高股息");
  assert.equal(fundNameKey("元大台灣高股息證券投資信託基金"), "元大台灣高股息");
  assert.equal(fundNameKey("兆豐臺灣藍籌30ETF基金"), fundNameKey("兆豐臺灣藍籌30 ETF證券投資信託基金"));
  assert.equal(fundNameKey("富邦台灣ETF傘型基金之富邦台灣摩根指數股票型基金"), fundNameKey("富邦台灣ETF傘型證券投資信託基金之富邦台灣摩根指數股票型證券投資信託基金"));
  assert.equal(fundNameKey("永豐台灣科技趨勢主動式ETF證券投資信託基&#63754;"), "永豐台灣科技趨勢主動式");
  const holdings = (code) => [{ rank: 1, kind: "國內上市", code, name: code, weight: 1 }];
  const matched = matchHoldingsToSymbols([
    { fundName: "元大台灣高股息基金(配息來源)", holdings: holdings("A") },
    { fundName: "元大標普500基金", holdings: holdings("B") },
    { fundName: "國泰富時中國A50基金", holdings: holdings("C") },
    { fundName: "甲投信同名基金", holdings: holdings("D") },
    { fundName: "沒有對應的基金", holdings: holdings("E") },
  ], [
    { symbol: "0056", name: "元大台灣高股息證券投資信託基金" },
    // An umbrella profile names its sub-fund without the issuer.
    { symbol: "00646", name: "元大全球ETF傘型證券投資信託基金之標普500證券投資信託基金" },
    // Two share classes of one fund both take its holdings.
    { symbol: "00636", name: "國泰富時中國A50證券投資信託基金" }, { symbol: "00636K", name: "國泰富時中國A50證券投資信託基金(加掛美元受益憑證)-國外成份" },
    // Two different funds reducing to one key: neither is trusted.
    { symbol: "00901", name: "甲投信同名證券投資信託基金" }, { symbol: "00777", name: "甲投信同名ETF基金" },
    { symbol: "00999", name: "另一檔沒有持股的基金" },
  ]);
  assert.deepEqual([...matched.keys()].sort(), ["0056", "00636", "00636K", "00646"]);
  assert.equal(matched.get("00646")[0].code, "B");
  assert.equal(matched.get("00636K")[0].code, "C");
});

test("holdings are fetched only for a month not stored yet, and a report that matches nothing keeps last month", async () => {
  const { db, repository } = fixture();
  const env = { ETF_INFO_ENABLED: "1", T86_DB: db, MARKET_DATA: { get: async () => ({ asOf: date }) } };
  let posts = 0;
  const counting = (overrides) => async (url, init) => { if (url === SITCA_HOLDINGS_URL && init?.method === "POST") posts++; return respond(overrides)(url, init); };
  assert.equal((await syncDailyEtfInfo(env, { phase: "done", date }, new Date(`${date}T12:40:00Z`), counting())).holdings, 2);
  assert.equal(posts, 2, "one request per ETF class");
  assert.deepEqual([...await repository.holdingMonths()], ["2026-09"]);
  // Next market day, same month: the form is read, nothing else is requested or rewritten.
  const next = "2026-11-13", nextEnv = { ...env, MARKET_DATA: { get: async () => ({ asOf: next }) } };
  const sameMonth = await syncDailyEtfInfo(nextEnv, { phase: "done", date: next }, new Date(`${next}T12:40:00Z`),
    counting({ nav: { a1: [{ msgArray: [{ ...nav.a1[0].msgArray[0], i: "20261113" }] }] } }));
  assert.equal(sameMonth.holdings, 0);
  assert.equal(posts, 2);
  // A new month whose funds match no listed ETF is treated as a broken report.
  const later = "2026-11-16", laterEnv = { ...env, MARKET_DATA: { get: async () => ({ asOf: later }) } };
  const broken = await syncDailyEtfInfo(laterEnv, { phase: "done", date: later }, new Date(`${later}T12:40:00Z`),
    counting({ form: holdingsForm(["202609", "202610"]), table: holdingsTable(["不認識的基金", [["2330", "台積電", "9"]]]) }));
  assert.equal(broken.holdings, null);
  assert.deepEqual([...await repository.holdingMonths()], ["2026-09"]);
  assert.equal((await repository.fund("0050", "2025-01-01")).holdings.length, 2);
});

test("a backfill fetches every missing month, skips stored ones and prunes what falls out of the kept window", async () => {
  const { repository } = fixture();
  const names = [{ symbol: "0050", name: "元大台灣卓越50證券投資信託基金" }];
  const asked = [];
  const fetcher = async (url, init) => { if (init?.method === "POST") asked.push(new URLSearchParams(String(init.body)).get(`${P}ddlQ_YM`)); return sitca(init, { form: holdingsForm(["202607", "202608", "202609"]) }); };
  const all = await fetchEtfHoldings(fetcher, names, new Set(["2026-08"]), 13);
  assert.deepEqual(all.months.map(({ month }) => month), ["2026-09", "2026-07"], "newest first, the stored month left alone");
  assert.equal(all.keepFrom, "2026-07");
  assert.deepEqual([...new Set(asked)], ["202609", "202607"]);
  // The latest month is asked from the page already on it; an older one costs one extra request to switch to it.
  assert.equal(asked.filter((month) => month === "202609").length, 2);
  assert.equal(asked.filter((month) => month === "202607").length, 3);
  assert.ok(all.months.every(({ rows }) => rows.every((row) => row.code !== "9999")), "the switching answer is never read as holdings");
  assert.ok(all.months.every(({ month, rows }) => rows.every((row) => row.month === month && row.symbol === "0050")));
  for (const { month, rows } of all.months) await repository.saveHoldings(month, rows, all.keepFrom);
  assert.deepEqual([...await repository.holdingMonths()].sort(), ["2026-07", "2026-09"]);
  // Saving a month replaces only that month and drops months older than the window.
  await repository.saveHoldings("2026-09", all.months[0].rows.slice(0, 1), "2026-08");
  assert.deepEqual([...await repository.holdingMonths()], ["2026-09"]);
  assert.equal((await repository.fund("0050", "2025-01-01")).holdings.length, 1);
  await assert.rejects(repository.saveHoldings("2026-10", all.months[0].rows, "2026-08"), /saved month/);
  // The evening sync asks only for the latest month.
  asked.length = 0;
  const latest = await fetchEtfHoldings(fetcher, names, new Set(), 1);
  assert.deepEqual(latest.months.map(({ month }) => month), ["2026-09"]);
  assert.deepEqual([...new Set(asked)], ["202609"]);
});

test("daily sessions fold into months: last close, summed volume and the change from the month before", () => {
  const day = (date, close, volume = 100) => ({ date, close, volume });
  const months = monthlyCloseSeries([day("2026-07-30", 10), day("2026-07-31", 11), day("2026-08-03", 12, 50), day("2026-08-31", null, 70),
    day("2026-09-01", null, null), day("2026-10-01", 15)]);
  assert.deepEqual(months.map(({ month, date, close, volume, sessions }) => [month, date, close, volume, sessions]),
    [["2026-07", "2026-07-31", 11, 200, 2], ["2026-08", "2026-08-03", 12, 120, 2], ["2026-09", "2026-09-01", null, null, 1], ["2026-10", "2026-10-01", 15, 100, 1]]);
  assert.equal(months[0].changePercent, null, "nothing before the first month");
  assert.ok(Math.abs(months[1].changePercent - (12 / 11 - 1) * 100) < 1e-9);
  assert.equal(months[2].changePercent, null, "a month without a close has no change");
  assert.ok(Math.abs(months[3].changePercent - 25) < 1e-9, "the next month compares with the last close that exists");
  assert.deepEqual(monthlyCloseSeries([]), []);
});

test("distribution days are placed in the chart month they fall in, on lanes aligned to the chart's points", () => {
  const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
  const fund = { dividends: [{ exDate: "2026-11-17", payDate: "2026-12-11", amount: null }, { exDate: "2026-08-18", payDate: "2026-09-11", amount: 0.42 },
    { exDate: "2026-05-19", payDate: "2026-07-02", amount: 0.4 }] };
  const events = etfMonthEvents(fund, months);
  assert.deepEqual(events.get("2026-08"), [{ type: "ex", date: "2026-08-18", amount: 0.42 }]);
  assert.deepEqual(events.get("2026-09"), [{ type: "pay", date: "2026-09-11", amount: 0.42 }]);
  assert.deepEqual(events.get("2026-07"), [{ type: "pay", date: "2026-07-02", amount: 0.4 }], "a payment whose ex-date is before the chart still shows");
  assert.deepEqual(events.get("2026-10"), []);
  const lanes = etfChartEventsMarkup(fund, months, format);
  assert.match(lanes, /etf-event-lane ex"><span>除息<\/span><div><i style="left:33\.78%" title="08\/18 除息 0\.420 元"><\/i><\/div>/);
  assert.match(lanes, /etf-event-lane pay"><span>發息<\/span><div><i style="left:1\.33%" title="07\/02 發息 0\.400 元"><\/i><i style="left:66\.22%"/);
  assert.equal(etfChartEventsMarkup({ dividends: [] }, months, format), "");
  assert.equal(etfChartEventsMarkup(undefined, months, format), "");
});

test("each chart month gets a panel with its distributions and holdings, never another month's passed off as its own", () => {
  const months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const item = (weight, extra = {}) => ({ rank: 1, kind: "國內上市", code: "2330", name: "台積電", weight, ...extra });
  const fund = { dividends: [{ exDate: "2026-08-18", payDate: "2026-09-11", amount: 0.42 }],
    holdings: { basis: "monthly-top-10", months: [{ month: "2026-09", items: [item(56.45), { rank: 2, kind: "國外", code: "US0378331005", name: "APPLE <INC>", weight: 5.5 }] },
      { month: "2026-08", items: [item(55)] }, { month: "2026-07", items: [item(54)] }] } };
  assert.equal(etfMonthPanelsMarkup(null, months, format), "");
  assert.equal(etfMonthPanelsMarkup(fund, [], format), "");
  const markup = etfMonthPanelsMarkup(fund, months, { ...format, esc: (value) => String(value).replaceAll("<", "&lt;") });
  const panel = (month) => new RegExp(`<div class="etf-month-panel" data-etf-month="${month}"( hidden)?>([\\s\\S]*?)(?=<div class="etf-month-panel"|</section>)`).exec(markup);
  assert.equal(markup.match(/data-etf-month=/g).length, 5);
  assert.equal(panel("2026-10")[1], undefined, "the latest month is the one shown first");
  for (const month of months.slice(0, -1)) assert.equal(panel(month)[1], " hidden");
  // October's report is not out: September's is shown and named.
  assert.match(panel("2026-10")[2], /2026 年 10 月/);
  assert.match(panel("2026-10")[2], /這個月沒有除息或發息/);
  assert.match(panel("2026-10")[2], /成分股 <small>前 2 大 · 2026 年 09 月月報/);
  assert.match(panel("2026-10")[2], /這個月的月報尚未公布，顯示 2026 年 09 月的持股/);
  // A month with its own report says nothing about another month.
  assert.match(panel("2026-08")[2], /08\/18 除息 0\.420 元/);
  assert.match(panel("2026-08")[2], /前 1 大 · 2026 年 08 月月報/);
  assert.doesNotMatch(panel("2026-08")[2], /尚未公布|沒有保存/);
  assert.match(panel("2026-09")[2], /09\/11 發息 0\.420 元/);
  // Before the oldest stored report: the oldest is shown and said not to be that month's.
  assert.match(panel("2026-06")[2], /這個月的月報沒有保存，顯示 2026 年 07 月的持股/);
  // Listed Taiwan stocks open in the app; other holdings are text; nothing links elsewhere.
  assert.match(panel("2026-09")[2], /<button type="button" class="etf-holding-name" data-entry-score="2330"/);
  assert.equal(panel("2026-09")[2].match(/data-entry-score=/g).length, 1);
  assert.match(panel("2026-09")[2], /APPLE &lt;INC>/);
  assert.match(panel("2026-09")[2], /--share:100\.0%/);
  assert.match(panel("2026-09")[2], /合計占淨資產 61\.95%/);
  assert.doesNotMatch(markup, /<a |href=/);
  const none = etfMonthPanelsMarkup({ dividends: [], holdings: null }, ["2026-10"], format);
  assert.match(none, /月報沒有這檔 ETF 的持股/);
  assert.doesNotMatch(none, /etf-holding-list/);
});

test("the technical read is folded and keeps its parts only when their data exists", () => {
  const stock = { latest: { k: 28.85, d: 30.36, deviation: -3.76 }, trend: { label: "偏空", reason: "月線、季線向下" },
    priceVolume: { label: "量價持平", rvol20: 1.01 }, signal: { label: "偏弱觀察" } };
  const closed = etfTechnicalMarkup(stock, null, format);
  assert.match(closed, /^<details class="etf-section etf-technical"><summary>技術面與法人/);
  assert.doesNotMatch(closed, /<details[^>]* open/);
  assert.doesNotMatch(closed, /etf-performance|etf-flow/);
  assert.match(closed, /季線<\/dt><dd class="down">之下/);
  const series = [10, 11, 12, 12.5, 12, 11].map((close, index) => ({ date: `d${index}`, close }));
  const open = etfTechnicalMarkup({ ...stock, money: { day: { total: 3.9e9 }, 5: { total: -2e7 }, 20: { total: null } } }, series, format);
  assert.match(open, /區間表現/);
  assert.match(open, /當日<\/dt><dd class="up">\+39\.00 億/);
  assert.match(open, /近 5 日<\/dt><dd class="down">-2000 萬/);
  assert.match(open, /近 20 日<\/dt><dd class="">—/);
});

test("performance needs both ends of a window and measures from the closing high and low", () => {
  const series = [10, 11, null, 12, 12.5, 12, 11].map((close, index) => ({ date: `d${index}`, close }));
  const performance = etfPerformance(series);
  assert.ok(Math.abs(performance.change5 - 0) < 1e-9, "11 five sessions earlier");
  assert.equal(performance.change20, null);
  assert.ok(Math.abs(performance.fromHigh - (11 / 12.5 - 1) * 100) < 1e-9);
  assert.ok(Math.abs(performance.fromLow - 10) < 1e-9);
  assert.equal(etfPerformance([{ close: null }]), null);
});

test("saving the same facts again writes nothing, and a change writes only the rows that differ", async () => {
  const { db, repository } = fixture();
  const profileRows = [{ symbol: "0050", fundType: "A", indexName: "I", inceptionDate: "2003-06-25", listedDate: "2003-06-30", units: 25042000000 },
    { symbol: "0056", fundType: "B", indexName: null, inceptionDate: null, listedDate: null, units: null }];
  assert.equal(await repository.saveProfiles(profileRows, "t1"), 2);
  assert.equal(await repository.saveProfiles(profileRows, "t2"), 0, "an unchanged list is not rewritten, not even its timestamp");
  assert.equal(db.sqlite.prepare("SELECT UpdatedAt FROM etf_profiles WHERE Symbol='0050'").get().UpdatedAt, "t1");
  assert.equal(await repository.saveProfiles([{ ...profileRows[0], units: 25042000001 }, profileRows[1]], "t3"), 1);
  assert.equal(db.sqlite.prepare("SELECT UpdatedAt FROM etf_profiles WHERE Symbol='0050'").get().UpdatedAt, "t3");
  assert.equal(db.sqlite.prepare("SELECT UpdatedAt FROM etf_profiles WHERE Symbol='0056'").get().UpdatedAt, "t1");
  // A fund that left the list is removed; a null turning into a value counts as a change.
  assert.equal(await repository.saveProfiles([{ ...profileRows[1], indexName: "新指數" }], "t4"), 2);
  assert.deepEqual(db.sqlite.prepare("SELECT Symbol, IndexName FROM etf_profiles").all().map((row) => ({ ...row })), [{ Symbol: "0056", IndexName: "新指數" }]);

  const productRows = [{ symbol: "0050", issuer: "元大", assetSize: 2.6e12, holders: 3874009 }];
  assert.equal(await repository.saveProducts(productRows, "t1"), 1);
  assert.equal(await repository.saveProducts(productRows, "t2"), 0);
  assert.equal(await repository.saveProducts([{ ...productRows[0], holders: 3874010 }], "t3"), 1);

  const navRows = [{ symbol: "0050", date, marketPrice: 100.95, estimatedNav: 101.05, premiumPercent: (100.95 / 101.05 - 1) * 100, previousNav: 103.81, units: 25042000000 }];
  assert.equal(await repository.saveNav(navRows, "t1"), 1);
  assert.equal(await repository.saveNav(navRows, "t2"), 0);
  assert.equal(await repository.saveNav([{ ...navRows[0], date: "2026-11-13" }], "t3"), 1, "a new session replaces the row");

  const dividendRows = [{ symbol: "0050", exDate: "2026-07-21", recordDate: "2026-07-27", payDate: "2026-08-10", amount: 0.6 },
    { symbol: "0050", exDate: "2026-12-16", recordDate: null, payDate: null, amount: null }];
  assert.equal(await repository.saveDividends(dividendRows, "2025-10-08"), 2);
  assert.equal(await repository.saveDividends(dividendRows, "2025-10-08"), 0);
  // The amount is announced: one row changes. A withdrawn announcement is removed.
  assert.equal(await repository.saveDividends([dividendRows[0], { ...dividendRows[1], amount: 0.7 }], "2025-10-08"), 1);
  assert.equal(await repository.saveDividends([dividendRows[0]], "2025-10-08"), 1);
  // Rows before the kept window are pruned even though the report no longer mentions them.
  db.sqlite.exec("INSERT INTO etf_dividends VALUES('0050','2024-07-16',NULL,NULL,1)");
  assert.equal(await repository.saveDividends([dividendRows[0]], "2025-10-08"), 1);
  assert.deepEqual(db.sqlite.prepare("SELECT ExDate FROM etf_dividends").all().map((row) => row.ExDate), ["2026-07-21"]);
});

test("stored holding months are found without reading every holdings row", async () => {
  const { db, repository } = fixture();
  assert.deepEqual([...await repository.holdingMonths()], []);
  const insert = db.sqlite.prepare("INSERT INTO etf_holdings VALUES(?,?,?,?,?,?,?)");
  for (const month of ["2026-09", "2026-07", "2026-08"]) for (let rank = 1; rank <= 10; rank++) for (const symbol of ["0050", "0056", "00878"])
    insert.run(symbol, month, rank, "國內上市", "2330", "台積電", 1);
  assert.deepEqual([...await repository.holdingMonths()], ["2026-07", "2026-08", "2026-09"]);
  const plan = db.sqlite.prepare(`EXPLAIN QUERY PLAN WITH RECURSIVE months(Month) AS (SELECT MIN(Month) FROM etf_holdings
    UNION ALL SELECT (SELECT MIN(Month) FROM etf_holdings WHERE Month>months.Month) FROM months WHERE months.Month IS NOT NULL)
    SELECT Month FROM months WHERE Month IS NOT NULL`).all().map((row) => row.detail).join(" | ");
  assert.match(plan, /etf_holdings_by_month/);
  assert.doesNotMatch(plan, /SCAN etf_holdings(?! USING)/, "never a full table scan");
});

test("the evening sync stays inside a free-plan invocation and a finished day costs one row read", async () => {
  const { db } = fixture();
  let kvReads = 0, fetches = 0, queries = [];
  const env = { ETF_INFO_ENABLED: "1", T86_DB: db, MARKET_DATA: { get: async () => { kvReads++; return { asOf: date }; } } };
  const counting = async (url, init) => { fetches++; return respond()(url, init); };
  db.beforeStatement = (sql) => queries.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
  const state = { phase: "done", date };
  // The working run: every source, including a new month of holdings.
  assert.equal((await syncDailyEtfInfo(env, state, new Date(`${date}T12:40:00Z`), counting)).status, "complete");
  assert.ok(queries.length <= 16, `${queries.length} D1 queries: ${queries.join("; ")}`);
  assert.ok(fetches <= 8, `${fetches} outbound requests with two ETF classes in the fixture`);
  const detail = JSON.parse(db.sqlite.prepare("SELECT Detail FROM etf_info_runs WHERE Date=?").get(date).Detail);
  assert.equal(detail.written, 1 + 3 + 2 + 1 + 2, "profile, distributions, products, NAV and holdings rows, each written once");
  // Every later tick of the evening: one single-row read, no KV read, no request, no write.
  for (const minute of ["12:41", "13:30", "15:59"]) {
    kvReads = 0; fetches = 0; queries = [];
    assert.equal((await syncDailyEtfInfo(env, state, new Date(`${date}T${minute}:00Z`), counting)).status, "already-checked");
    assert.deepEqual(queries, ["SELECT Status, Attempts,"]);
    assert.equal(kvReads + fetches, 0);
  }
  // The next market day with nothing new but the NAV session: only the NAV row is written.
  const next = "2026-11-13", nextEnv = { ...env, MARKET_DATA: { get: async () => ({ asOf: next }) } };
  queries = []; fetches = 0;
  await syncDailyEtfInfo(nextEnv, { phase: "done", date: next }, new Date(`${next}T12:40:00Z`),
    async (url, init) => { fetches++; return respond({ nav: { a1: [{ msgArray: [{ ...nav.a1[0].msgArray[0], i: "20261113" }] }] } })(url, init); });
  assert.equal(JSON.parse(db.sqlite.prepare("SELECT Detail FROM etf_info_runs WHERE Date=?").get(next).Detail).written, 1);
  assert.ok(queries.length <= 12, `${queries.length} D1 queries on an ordinary evening`);
  assert.equal(fetches, 5, "four reports and one look at the holdings form");
});
