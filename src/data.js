import { lastBuyDate, summarizeEtfDividends } from "../shared/etf-info.js";
import { classifyStock } from "../shared/custom-sectors.js";

/**
 * Synthetic, reproducible demo data. These are NOT exchange quotes or forecasts.
 * Weekdays are illustrative sessions, not an official Taiwan trading calendar.
 * Replace demoProvider with an API adapter implementing the same contract.
 */
export const DATA_INFO = Object.freeze({
  mode: "demo",
  label: "示範資料",
  asOf: "2026-10-16",
  note: "價格、成交量與法人買賣量皆為模擬資料，非交易所行情；日期僅以平日模擬，未套用休市日曆。",
});

const catalog = [
  ["2330", "台積電", "半導體", 1085, 36500, 0.0025],
  ["2317", "鴻海", "電子零組件", 218.5, 96500, 0.0008],
  ["2454", "聯發科", "半導體", 1360, 8200, 0.0015],
  ["2308", "台達電", "電子零組件", 452, 12800, 0.002],
  ["2382", "廣達", "電腦週邊", 286.5, 43500, -0.0015],
  ["2303", "聯電", "半導體", 48.7, 84200, -0.0018],
  ["2881", "富邦金", "金融保險", 92.4, 25200, 0.001],
  ["2882", "國泰金", "金融保險", 65.8, 31500, -0.0008],
  ["2891", "中信金", "金融保險", 40.2, 65400, 0.0006],
  ["2603", "長榮", "航運", 198.5, 22600, -0.002],
  ["0050", "元大台灣50", "ETF", 62.8, 56800, 0.0015],
  ["00878", "國泰永續高股息", "ETF", 23.15, 125000, -0.0004],
  ["3026", "禾伸堂", "電子零組件", 105.5, 8500, 0.0004],
  ["6488", "環球晶", "半導體業", 450, 15000, 0.0005],
];

function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function sessionDates() {
  const dates = [];
  const date = new Date(`${DATA_INFO.asOf}T00:00:00Z`);
  while (dates.length < 180) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6)
      dates.unshift(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return dates;
}

const dates = sessionDates();
const round = (n) => Math.round(n * 100) / 100;

function createStock([symbol, name, sector, target, baseVolume, drift], index) {
  const random = randomGenerator(Number(symbol) + 42);
  let previous = target * 0.85;
  const raw = dates.map((date, i) => {
    const wave = Math.sin(i / 9 + index) * 0.004;
    const close = previous * (1 + drift + wave + (random() - 0.5) * 0.024);
    const open = previous * (1 + (random() - 0.5) * 0.01);
    const high = Math.max(open, close) * (1 + random() * 0.012);
    const low = Math.min(open, close) * (1 - random() * 0.012);
    const volume = Math.round(baseVolume * (0.5 + random()) * 1000);
    const institutions = ["外資", "投信", "自營商"].map((institution, j) => ({
      name: institution,
      buy:
        Math.round((volume * (0.08 + random() * 0.22)) / (j + 1) / 1000) * 1000,
      sell:
        Math.round((volume * (0.08 + random() * 0.22)) / (j + 1) / 1000) * 1000,
    }));
    previous = close;
    return { date, open, high, low, close, volume, institutions };
  });
  const scale = target / raw.at(-1).close;
  return {
    symbol,
    name,
    sector,
    market: symbol === "6488" ? "上櫃" : "上市",
    history: raw.map((bar) => ({
      ...bar,
      open: round(bar.open * scale),
      high: round(bar.high * scale),
      low: round(bar.low * scale),
      close: round(bar.close * scale),
    })),
  };
}

const stocks = catalog.map(createStock).map(classifyStock);

/** Provider boundary: network-backed adapters can replace this object later. */
export const demoProvider = {
  async load() {
    return { info: DATA_INFO, stocks, dates, etfInfo: demoEtfInfo };
  },
};

// Illustrative fund facts for the demo ETFs, shaped like /api/v1/stocks/{symbol}/fund. Not real figures.
const DEMO_FUNDS = {
  "0050": { fundType: "國內成分證券指數股票型基金", indexName: "臺灣50指數", inceptionDate: "2003-06-25", listedDate: "2003-06-30", units: 25_000_000_000, premium: -0.1, issuer: "元大證券投資信託股份有限公司", holders: 3_874_000,
    dividends: [["2026-07-21", "2026-08-10", 0.6], ["2026-01-22", "2026-02-11", 0.5]],
    holdings: [["2330", "台積電", 56.45], ["2454", "聯發科", 6.74], ["2308", "台達電", 3.4], ["2317", "鴻海", 3.1], ["2891", "中信金", 1.62]] },
  "00878": { fundType: "國內成分證券指數股票型基金", indexName: "MSCI臺灣ESG永續高股息精選30指數", inceptionDate: "2020-07-10", listedDate: "2020-07-20", units: 19_700_000_000, premium: 0.18, issuer: "國泰證券投資信託股份有限公司", holders: 1_650_000,
    dividends: [["2026-11-17", "2026-12-11", null], ["2026-08-18", "2026-09-11", 0.42], ["2026-05-19", "2026-06-12", 0.42], ["2026-02-24", "2026-03-20", 0.4], ["2025-11-18", "2025-12-12", 0.4]],
    holdings: [["2891", "中信金", 9.65], ["2382", "廣達", 9.14], ["2882", "國泰金", 6.43], ["2303", "聯電", 5.2], ["US0378331005", "境外標的範例", 1.1, "國外"]] },
};
export function demoEtfInfo(symbol, asOf, close) {
  const fund = DEMO_FUNDS[symbol];
  if (!fund || !Number.isFinite(close)) return null;
  const estimated = close / (1 + fund.premium / 100);
  const dividends = fund.dividends.map(([exDate, payDate, amount]) => ({ exDate, lastBuyDate: lastBuyDate(exDate), recordDate: null, payDate, amount }));
  return { symbol, profile: { fundType: fund.fundType, indexName: fund.indexName, issuer: fund.issuer, inceptionDate: fund.inceptionDate, listedDate: fund.listedDate, units: fund.units },
    nav: { date: asOf, estimated, marketPrice: close, premiumPercent: fund.premium, previous: null }, size: fund.units * estimated, sizeBasis: "reported", holders: fund.holders,
    dividends, ...summarizeEtfDividends(dividends, asOf, close),
    // Five monthly reports ending 2026-09; weights drift a little so a month reads differently from the next.
    holdings: { basis: "monthly-top-10", months: ["2026-09", "2026-08", "2026-07", "2026-06", "2026-05"].map((month, back) => ({ month,
      items: fund.holdings.map(([code, name, weight, kind = "國內上市"], index) => ({ rank: index + 1, kind, code, name,
        weight: Math.round((weight - back * 0.21 * (index % 2 ? -1 : 1)) * 100) / 100 })) })) } };
}
