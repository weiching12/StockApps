import test from "node:test";
import assert from "node:assert/strict";
import { demoProvider } from "../src/data.js";
import { isEtf } from "../src/market-codec.js";
import { getSectorOverview, getSectorDetail, getSectorStockReturn, groupSectorStocks, sectorsForSort } from "../shared/sectors.js";
import {
  getSnapshot, getSectorInstitutionSummary, getSectorInstitutionEstimate,
  getDirectionalLeader, getStockInstitutionEstimate, getStockInstitutionValue, getInstitutionVolumeRatio,
} from "../shared/indicators.js";

const dates = Array.from({ length: 21 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`);
const institutions = (net) => ["外資", "投信", "自營商"].map((name, index) => ({ name,
  buy: index === 0 ? Math.max(0, net) : 0,
  sell: index === 0 ? Math.max(0, -net) : 0,
}));
const makeStock = (symbol, name, sector, net = 10) => getSnapshot({ symbol, name, sector, tradingDates: dates,
  history: dates.map((date) => ({ date, open: 20, high: 21, low: 19, close: 20, volume: 1000, institutions: institutions(net) })),
}, dates.at(-1));
const options = (window = "day", sort = "net-desc") => ({ window, sort, tradingDates: dates, asOf: dates.at(-1) });

// Frozen copy of the pre-extraction UI algorithm: guards result/order parity,
// rather than computing expectations by calling the new overview/detail models.
function legacyOverview(snapshots, { window, sort, tradingDates, asOf }) {
  const groups = new Map();
  for (const stock of snapshots) {
    if (isEtf(stock)) continue;
    if (!groups.has(stock.sector)) groups.set(stock.sector, []);
    groups.get(stock.sector).push(stock);
  }
  const days = window === "day" ? 1 : Number(window);
  const stockReturn = (stock) => {
    if (days === 1) return stock.latest.changePercent;
    const previous = stock.history.find((bar) => bar.date === tradingDates.at(-(days + 1)));
    return previous && Number.isFinite(previous.close) && previous.close !== 0
      ? ((stock.latest.close - previous.close) / previous.close) * 100 : null;
  };
  const sectors = [...groups].map(([name, stocks]) => {
    const priced = stocks.filter((stock) => stock.latest);
    const returns = priced.map(stockReturn).filter(Number.isFinite);
    const summary = getSectorInstitutionSummary(stocks, window, tradingDates);
    return { name, stocks, summary, estimate: getSectorInstitutionEstimate(stocks, window, tradingDates), total: summary.total,
      change: priced.length && returns.length === priced.length
        ? returns.reduce((total, value) => total + value, 0) / returns.length : null };
  });
  sectors.sort((a, b) => {
    if (sort === "name-asc") return a.name.localeCompare(b.name, "zh-Hant");
    if (a.estimate.amount === null) return b.estimate.amount === null ? 0 : 1;
    if (b.estimate.amount === null) return -1;
    return (a.estimate.amount - b.estimate.amount) * (sort === "net-asc" ? 1 : -1);
  });
  let rank = 0;
  return sectors.map((sector) => {
    const { stock: leader, value: leaderValue } = getDirectionalLeader(sector.stocks.map((stock) => ({ stock,
      value: getStockInstitutionEstimate(stock, "total", window, tradingDates.filter((date) => date <= asOf)),
    })), sector.estimate.amount);
    return { ...sector, leader, leaderValue, leaderChange: leader ? stockReturn(leader) : null,
      rank: Number.isFinite(sector.estimate.amount) ? ++rank : null };
  });
}

function legacyDetail(snapshots, name, { tradingDates, asOf }) {
  const stocks = snapshots.filter((stock) => !isEtf(stock) && stock.sector === name);
  if (!stocks.length) return null;
  const selectedDates = tradingDates.filter((date) => date <= asOf);
  const periods = Object.fromEntries(["day", "5", "20"].map((window) => {
    const summary = getSectorInstitutionSummary(stocks, window, tradingDates);
    return [window, { summary, estimate: getSectorInstitutionEstimate(stocks, window, tradingDates),
      institutions: Object.fromEntries(["外資", "投信", "自營商"].map((institution) => [institution, {
        shares: summary[institution], amount: getSectorInstitutionEstimate(stocks, window, tradingDates, institution).amount,
      }])),
    }];
  }));
  const members = stocks.map((stock) => ({ stock,
    net: getStockInstitutionEstimate(stock, "total", "day", selectedDates),
    periods: Object.fromEntries(["day", "5", "20"].map((window) => [window, {
      amount: getStockInstitutionEstimate(stock, "total", window, selectedDates),
      shares: getStockInstitutionValue(stock, "total", window),
    }])), volumeRatio: getInstitutionVolumeRatio(stock.latest),
  })).sort((a, b) => {
    if (a.net === null) return b.net === null ? a.stock.name.localeCompare(b.stock.name, "zh-Hant") : 1;
    if (b.net === null) return -1;
    return b.net - a.net || a.stock.name.localeCompare(b.stock.name, "zh-Hant");
  });
  return { name, stocks, periods, members, tradingDates: selectedDates };
}

test("industry overview/detail match the previous UI algorithm across all windows, orders and demo sessions", async () => {
  const dataset = await demoProvider.load();
  for (const asOf of [dataset.dates[0], dataset.dates[10], dataset.info.asOf]) {
    const tradingDates = dataset.dates.filter((date) => date <= asOf);
    const snapshots = dataset.stocks.map((stock) => getSnapshot(stock, asOf));
    for (const window of ["day", "5", "20"]) for (const sort of ["net-desc", "net-asc", "name-asc"]) {
      const config = { window, sort, tradingDates, asOf };
      assert.deepEqual(getSectorOverview(snapshots, config).map(({ activity: _activity, leaderStreak: _streak, ...sector }) => sector),
        legacyOverview(snapshots, config), `${asOf}/${window}/${sort}`);
    }
    for (const sector of new Set(snapshots.map((stock) => stock.sector)))
      assert.deepEqual(withoutVolumeRatios(getSectorDetail(snapshots, sector, { tradingDates, asOf })), legacyDetail(snapshots, sector, { tradingDates, asOf }));
  }
});

// Volume ratios, the flow trend and the price line were added after the legacy algorithm; parity covers every field it had.
function withoutVolumeRatios(detail) {
  if (!detail) return detail;
  const { flow: _flow, price: _price, ...rest } = detail;
  return { ...rest, periods: Object.fromEntries(Object.entries(detail.periods).map(([window, { volume, ratio, institutions, ...period }]) =>
    [window, { ...period, institutions: Object.fromEntries(Object.entries(institutions).map(([name, { ratio: _ratio, ...values }]) => [name, values])) }])),
    members: rest.members.map((member) => ({ ...member, periods: Object.fromEntries(Object.entries(member.periods)
      .map(([window, { ratio: _ratio, ...values }]) => [window, values])) })) };
}

test("both ETF markers are excluded even if an ETF is incorrectly labeled as an industry company", () => {
  const company = makeStock("2330", "公司", "半導體");
  const legacyEtf = makeStock("0050", "舊名單ETF", "ETF", 100000);
  const typedEtf = { ...makeStock("00981A", "主動ETF", "半導體", 100000), assetType: "etf" };
  const stocks = [legacyEtf, company, typedEtf];
  assert.deepEqual([...groupSectorStocks(stocks)], [["半導體", [company]]]);
  assert.deepEqual(getSectorOverview(stocks, options()), getSectorOverview([company], options()));
  assert.deepEqual(getSectorDetail(stocks, "半導體", options()), getSectorDetail([company], "半導體", options()));
  assert.equal(getSectorDetail(stocks, "ETF", options()), null);
});

test("returns require an exact baseline and every priced member, while suspended stocks remain in flow coverage", () => {
  const complete = makeStock("2330", "完整", "半導體");
  complete.latest.changePercent = 4;
  complete.latest.close = 22;
  const missingBaseline = makeStock("2454", "基準缺漏", "半導體");
  missingBaseline.history = missingBaseline.history.filter((bar) => bar.date !== dates.at(-6));
  const suspended = makeStock("2303", "停牌", "半導體");
  suspended.history.pop(); suspended.latest = null;
  assert.equal(getSectorStockReturn(complete, "5", dates), 10);
  assert.equal(getSectorStockReturn(missingBaseline, "5", dates), null);
  assert.equal(getSectorStockReturn(suspended, "day", dates), null);
  assert.equal(getSectorOverview([complete, missingBaseline, suspended], options("5"))[0].change, null);
  const sector = getSectorOverview([complete, suspended], options())[0];
  assert.equal(sector.change, 4);
  assert.equal(sector.estimate.available, 1);
  assert.equal(sector.estimate.expected, 2);
  assert.equal(getSectorOverview([suspended], options())[0].change, null);
  const zeroBaseline = structuredClone(complete);
  zeroBaseline.history.find((bar) => bar.date === dates.at(-6)).close = 0;
  assert.equal(getSectorStockReturn(zeroBaseline, "5", dates), null);
});

test("unknown flows rank last, observed zero stays ranked, ties remain stable and TOP1 follows net direction", () => {
  const strongBuyer = makeStock("2330", "大買", "買超", 100);
  const seller = makeStock("2454", "賣出", "買超", -20);
  const mildBuyer = makeStock("2303", "買入", "賣超", 5);
  const strongSeller = makeStock("2317", "大賣", "賣超", -100);
  const zero = makeStock("2308", "零", "零額", 0);
  const unknown = makeStock("2382", "缺漏", "未知");
  unknown.history.at(-1).institutions.pop(); unknown.latest.institutionalNet = null;
  const equal = makeStock("2881", "相同金額", "同額", 80);
  const stocks = [unknown, strongBuyer, seller, mildBuyer, strongSeller, zero, equal];
  const result = getSectorOverview(stocks, options());
  assert.deepEqual(result.map((row) => [row.name, row.rank]), [["買超", 1], ["同額", 2], ["零額", 3], ["賣超", 4], ["未知", null]]);
  assert.equal(result[0].leader.symbol, strongBuyer.symbol);
  assert.equal(result[3].leader.symbol, strongSeller.symbol);
  assert.equal(result[2].estimate.amount, 0);
  assert.equal(result[2].estimate.buying, 0);
  assert.equal(result[4].leader, null);
  const ascending = getSectorOverview(stocks, options("day", "net-asc"));
  assert.equal(ascending[0].name, "賣超");
  assert.equal(ascending[0].leader.symbol, strongSeller.symbol);
  assert.equal(ascending.at(-1).name, "未知");
});

test("detail uses daily monetary sorting with name ties and one complete cohort for institution components", () => {
  const high = makeStock("2330", "高價", "產業", 10);
  high.history.at(-1).close = 100;
  const low = makeStock("2454", "低價", "產業", 20);
  const equal = makeStock("2303", "同價", "產業", 20);
  const missing = makeStock("2317", "缺漏", "產業", 100);
  missing.history.at(-1).institutions.pop(); missing.latest.institutionalNet = null;
  const detail = getSectorDetail([missing, low, high, equal], "產業", options());
  assert.equal(detail.members[0].stock.symbol, high.symbol);
  assert.deepEqual(detail.members.slice(1, 3).map(({ stock }) => stock.name), [low.name, equal.name].sort((a, b) => a.localeCompare(b, "zh-Hant")));
  assert.equal(detail.members.at(-1).stock.symbol, missing.symbol);
  assert.equal(detail.periods.day.estimate.amount, 1800);
  assert.equal(detail.periods.day.summary.total, 50);
  assert.equal(detail.periods.day.estimate.available, 3);
  assert.equal(detail.periods.day.institutions.外資.amount, 1800);
  assert.equal(detail.periods.day.institutions.投信.amount, 0);
  assert.equal(detail.members[0].volumeRatio, 1);
  assert.equal(detail.members.at(-1).volumeRatio, null);
  // Each window's 占量 divides the stock's net shares by its own traded shares over the same sessions.
  assert.equal(detail.members[0].periods.day.ratio, 1);
  assert.equal(detail.members[0].periods["5"].ratio, 1);
  assert.equal(detail.members[0].periods["20"].ratio, 1);
  assert.equal(detail.members.at(-1).periods.day.ratio, null);
});

test("activity sort ranks sectors by their share of gross institutional trading, ignoring direction", () => {
  // makeStock trades only 外資: buy = max(net, 0), sell = max(-net, 0), close 20.
  const seller = makeStock("2330", "大賣", "賣壓", -300);
  const buyer = makeStock("2454", "小買", "買盤", 100);
  const quiet = makeStock("2303", "冷門", "冷門", 0);
  const gap = makeStock("2317", "缺漏", "缺漏", 50);
  gap.history.at(-1).institutions.pop();
  const day = getSectorOverview([seller, buyer, quiet, gap], options("day", "activity-desc"));
  assert.deepEqual(day.map(({ name, rank }) => [name, rank]), [["賣壓", 1], ["買盤", 2], ["冷門", 3], ["缺漏", null]]);
  assert.equal(day[0].activity.amount, 300 * 20);
  assert.equal(day[0].activity.share, 75, "a net seller ranks first when it trades the most");
  assert.equal(day[1].activity.share, 25);
  assert.equal(day[2].activity.share, 0);
  assert.equal(day[3].activity.amount, null);
  assert.equal(day[3].activity.share, null);
  // The incomplete day only blocks windows containing it.
  const five = getSectorOverview([seller, buyer, gap], options("5", "activity-desc"));
  assert.equal(five.find(({ name }) => name === "缺漏").activity.amount, null);
  gap.history.at(-1).institutions.push({ name: "自營商", buy: 0, sell: 0 });
  const restored = getSectorOverview([seller, buyer, gap], options("20", "activity-desc"));
  assert.equal(restored.find(({ name }) => name === "缺漏").activity.amount, 50 * 20 * 20);
  // Other orderings keep ranking by net amount.
  const net = getSectorOverview([seller, buyer, quiet], options("day", "net-desc"));
  assert.deepEqual(net.map(({ name, rank }) => [name, rank]), [["買盤", 1], ["冷門", 2], ["賣壓", 3]]);
});

test("detail volume ratios divide cohort net shares by the same cohort's traded shares", () => {
  const buyer = makeStock("2330", "買超", "產業", 10);
  const seller = makeStock("2454", "賣超", "產業", -30);
  const incomplete = makeStock("2317", "缺漏", "產業", 100);
  incomplete.history.at(-1).institutions.pop(); incomplete.latest.institutionalNet = null;
  const detail = getSectorDetail([buyer, seller, incomplete], "產業", options());
  // The incomplete stock's volume is excluded with its flows: (10 - 30) / (1000 + 1000).
  assert.equal(detail.periods.day.volume, 2000);
  assert.equal(detail.periods.day.ratio, -1);
  assert.equal(detail.periods.day.institutions.外資.ratio, -1);
  assert.equal(detail.periods.day.institutions.投信.ratio, 0);
  assert.equal(detail.periods["5"].volume, 10000);
  assert.equal(detail.periods["20"].ratio, -20 * 20 / 40000 * 100);

  const missingVolume = makeStock("2303", "缺量", "產業", 10);
  missingVolume.history.at(-3).volume = null;
  const unknown = getSectorDetail([buyer, missingVolume], "產業", options());
  assert.equal(unknown.periods.day.volume, 2000, "a gap outside the window does not matter");
  assert.equal(unknown.periods["5"].volume, null);
  assert.equal(unknown.periods["5"].ratio, null);
  assert.equal(unknown.periods["5"].institutions.外資.ratio, null);
});

test("sector models are read-only and handle empty or unknown industries without fabricated totals", () => {
  const stocks = [makeStock("2330", "完整", "半導體")];
  const before = structuredClone(stocks);
  const freeze = (object) => {
    for (const value of Object.values(object)) if (value && typeof value === "object") freeze(value);
    return Object.freeze(object);
  };
  freeze(stocks); freeze(dates);
  getSectorOverview(stocks, options()); getSectorDetail(stocks, "半導體", options());
  assert.deepEqual(stocks, before);
  assert.deepEqual(getSectorOverview([], options()), []);
  assert.equal(getSectorDetail(stocks, "不存在", options()), null);
  assert.equal(getSectorDetail([], "半導體", options()), null);
});

test("the leader's institution streak counts consecutive net sessions up to the selected date", async () => {
  const { getStockInstitutionStreak } = await import("../shared/sectors.js");
  const dates = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
  const bar = (date, net) => ({ date, institutions: net === null ? [] : [
    { name: "外資", buy: Math.max(net, 0), sell: Math.max(-net, 0) }, { name: "投信", buy: 0, sell: 0 }, { name: "自營商", buy: 0, sell: 0 }] });
  const stock = (nets) => ({ history: dates.map((date, index) => bar(date, nets[index])) });
  assert.equal(getStockInstitutionStreak(stock([-5, 3, 4, 2, 9]), dates), 4);
  assert.equal(getStockInstitutionStreak(stock([1, 1, -2, -3, -1]), dates), -3);
  assert.equal(getStockInstitutionStreak(stock([1, 1, 1, null, 4]), dates), 1);
  assert.equal(getStockInstitutionStreak(stock([1, 1, 1, 1, 0]), dates), 0);
  assert.equal(getStockInstitutionStreak(stock([2, 2, 2, 2, 2]), dates.slice(0, 3)), 3);
});

test("the net buying and selling orderings list only their own side, ranked from 1", () => {
  const sector = (name, amount, rank) => ({ name, rank, estimate: { amount } });
  const buying = [sector("A", 5e8, 1), sector("B", 1e6, 2), sector("C", 0, 3), sector("D", -1e5, 4), sector("E", null, null)];
  assert.deepEqual(sectorsForSort(buying, "net-desc").map(({ name, rank }) => [name, rank]), [["A", 1], ["B", 2]]);
  const selling = [sector("D", -3e8, 1), sector("F", -1e5, 2), sector("C", 0, 3), sector("A", 5e8, 4)];
  // A loss that rounds to -0.00 億 is still selling.
  assert.deepEqual(sectorsForSort(selling, "net-asc").map(({ name, rank }) => [name, rank]), [["D", 1], ["F", 2]]);
  assert.equal(sectorsForSort(buying, "activity-desc").length, buying.length);
});
