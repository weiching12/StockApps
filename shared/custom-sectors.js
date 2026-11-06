import { SUB_INDUSTRIES } from "./custom-sector-data.js";
import { isEtf } from "./market-codec.js";

const groupOfSub = new Map(SUB_INDUSTRIES.map(([group, sub]) => [sub, group]));
const subOfSymbol = new Map(SUB_INDUSTRIES.flatMap(([, sub, codes]) => codes.split(" ").map((code) => [code, sub])));

// A company listed after the taxonomy was generated starts in its official industry's usual
// sub-industry, the same default the generator uses, until the taxonomy is refreshed.
const DEFAULT_SUB = Object.freeze({
  水泥工業: "水泥", 食品工業: "食品飲料", 塑膠工業: "石化塑膠", 紡織纖維: "紡織上游", 電機機械: "機械零組件",
  電器電纜: "電線電纜", 玻璃陶瓷: "玻璃陶瓷與建材", 造紙工業: "造紙與包材", 鋼鐵工業: "鋼鐵與金屬", 橡膠工業: "橡膠與輪胎",
  汽車工業: "汽車零組件", 建材營造: "建商", 航運業: "物流與陸運", 觀光餐旅: "觀光餐旅", 金融保險: "銀行", 貿易百貨: "零售百貨",
  綜合: "控股與多角化", 其他: "其他", 化學工業: "化工與特化", 生技醫療業: "醫療器材", 油電燃氣業: "油氣燃氣與發電", 半導體業: "IC設計",
  電腦及週邊設備業: "電腦週邊與儲存", 光電業: "其他光電", 通信網路業: "網通設備", 電子零組件業: "機構件與其他零組件", 電子通路業: "電子通路",
  資訊服務業: "軟體與系統整合", 其他電子業: "機構件與其他零組件", 綠能環保: "環保與資源回收", 數位雲端: "數位平台與雲端",
  運動休閒: "製鞋與運動用品", 居家生活: "居家用品", 存託憑證: "存託憑證",
});

export const defaultSubIndustry = (officialSector) => DEFAULT_SUB[officialSector] ?? "其他";

/**
 * A listed company with the custom taxonomy applied: `sector` becomes its sub-industry, `sectorGroup`
 * the broader sector, and `twseSector` keeps the official industry. ETFs stay outside the taxonomy.
 */
export function classifyStock(stock) {
  if (isEtf(stock)) return stock;
  const sector = subOfSymbol.get(stock.symbol) ?? defaultSubIndustry(stock.sector);
  return { ...stock, sector, sectorGroup: groupOfSub.get(sector), twseSector: stock.sector };
}
