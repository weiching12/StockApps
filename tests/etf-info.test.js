import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDatabase } from "./helpers/t86-db.js";
import { EtfInfoRepository } from "../cloudflare/etf-info/repository.js";
import { etfDividendUrl, parseEtfDividends, parseEtfNav, parseEtfProfiles } from "../cloudflare/etf-info/source.js";
import { syncDailyEtfInfo } from "../cloudflare/etf-info/sync.js";
import { EtfInfoService } from "../cloudflare/services/etf-info-service.js";
import { resolveApiRoute } from "../cloudflare/api/routes.js";
import { runScheduled } from "../cloudflare/worker.js";
import { summarizeEtfDividends } from "../shared/etf-info.js";
import { etfFundMarkup, etfPerformance } from "../src/ui/etf-detail.js";

const date = "2026-11-12";
const profiles = [{ "出表日期": "1151111", "基金代號": "0050", "基金簡稱": "元大台灣50", "基金類型": "國內成分證券指數股票型基金",
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

function fixture() {
  const db = testDatabase();
  db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0011_etf_info.sql", import.meta.url), "utf8"));
  return { db, repository: new EtfInfoRepository(db) };
}
const respond = (overrides = {}) => async (url) => {
  const body = url.includes("t187ap47") ? overrides.profiles ?? profiles : url.includes("etfDiv") ? overrides.dividends ?? dividends : overrides.nav ?? nav;
  return body instanceof Response ? body : Response.json(body);
};
const market = (stock = { symbol: "0050", assetType: "etf", history: [{ date, close: 100 }] }) =>
  ({ stock: async (symbol) => ({ asOf: date, stock: { ...stock, symbol } }) });

test("fund profiles keep the facts shown and skip non-security codes and personal names", () => {
  const rows = parseEtfProfiles(profiles);
  assert.deepEqual(rows, [{ symbol: "0050", fundType: "國內成分證券指數股票型基金", indexName: "臺灣50指數",
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
  assert.deepEqual(summary.upcoming, { exDate: "2026-12-16", payDate: null, amount: null });
  assert.equal(summarizeEtfDividends(rows, date, null).trailing.yieldPercent, null);
  assert.deepEqual(summarizeEtfDividends([], date, 50), { trailing: null, upcoming: null });
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
  assert.deepEqual(first, { status: "partial", profiles: 1, dividends: 3, nav: null });
  assert.equal((await repository.fund("0050", "2025-01-01")).nav, null);
  assert.equal((await syncDailyEtfInfo(env, state, new Date(`${date}T12:50:00Z`), respond())).status, "already-checked");
  // On the retry the dividend report has changed shape: yesterday's distributions stay, the NAV arrives.
  const second = await syncDailyEtfInfo(env, state, new Date(`${date}T13:15:00Z`), respond({ dividends: { stat: "ok", fields: ["x"], data: [] } }));
  assert.deepEqual(second, { status: "partial", profiles: 1, dividends: null, nav: 1 });
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
  assert.deepEqual(result, { status: "complete", profiles: 1, dividends: 3, nav: 1 });
  assert.equal(db.sqlite.prepare("SELECT Status FROM etf_info_runs WHERE Date=?").get(date).Status, "complete");
  assert.equal((await syncDailyEtfInfo(env, { phase: "done", date }, new Date(`${date}T13:30:00Z`), respond())).status, "already-checked");
});

test("the fund endpoint is routable and answers ordinary shares and unsynced ETFs with empty facts", async () => {
  assert.deepEqual(resolveApiRoute("/api/v1/stocks/0050/fund"), { name: "fund", params: { symbol: "0050" }, methods: ["GET", "HEAD"], versioned: true });
  assert.equal(resolveApiRoute("/api/stocks/0050/fund").name, null);
  const empty = { symbol: "2330", profile: null, nav: null, size: null, dividends: [], trailing: null, upcoming: null };
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
  assert.deepEqual(data.profile, { fundType: "國內成分證券指數股票型基金", indexName: "臺灣50指數", inceptionDate: "2003-06-25", listedDate: "2003-06-30", units: 25042000000 });
  assert.equal(data.nav.date, date);
  assert.equal(data.size, 25042000000 * 101.05);
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

test("the fund section leaves out what is unknown instead of showing zeros", () => {
  const format = { esc: (value) => String(value), number: (value, digits = 0) => Number(value).toFixed(digits) };
  assert.match(etfFundMarkup(undefined, format, () => "LOADING"), /LOADING/);
  assert.match(etfFundMarkup(null, format), /暫時無法讀取/);
  assert.match(etfFundMarkup({ profile: null, nav: null, dividends: [] }, format), /尚未取得/);
  const markup = etfFundMarkup({ profile: { indexName: "臺灣50指數", fundType: "指數股票型", listedDate: "2003-06-30" }, nav: null, size: null,
    dividends: [{ exDate: "2026-12-16", payDate: null, amount: null }], trailing: null, upcoming: { exDate: "2026-12-16", payDate: null, amount: null } }, format);
  assert.match(markup, /追蹤指數/);
  assert.doesNotMatch(markup, /折溢價|規模/);
  assert.match(markup, /金額未公告/);
  assert.doesNotMatch(markup, /<table/, "no table when no distribution has an amount yet");
  assert.match(markup, /近一年殖利率<\/dt><dd class="">—/);
  const discount = etfFundMarkup({ profile: null, nav: { date, estimated: 101.05, marketPrice: 100.95, premiumPercent: -0.099, previous: null }, size: 2.5e12, dividends: [] }, format);
  assert.match(discount, /折價<\/dt><dd class="down">-0\.10%/);
  assert.match(discount, /25000 億元/);
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
