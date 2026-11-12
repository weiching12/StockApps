import { isEtf } from "../../shared/market-codec.js";
import { lastBuyDate, summarizeEtfDividends } from "../../shared/etf-info.js";

const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function holdingsByMonth(rows) {
  const months = new Map();
  for (const row of rows) {
    if (!months.has(row.Month)) months.set(row.Month, []);
    months.get(row.Month).push({ rank: row.Rank, kind: row.Kind, code: row.Code, name: row.Name, weight: row.Weight });
  }
  return [...months].map(([month, items]) => ({ month, items }));
}

/** Fund facts for one ETF. Ordinary shares, and ETFs not yet synced, answer with empty facts, never an error. */
export class EtfInfoService {
  constructor(marketService, repository = null) { this.marketService = marketService; this.repository = repository; }

  async fund(symbol) {
    const source = await this.marketService.stock(symbol);
    const meta = { asOf: source.asOf, priceBasis: "unadjusted", navBasis: "estimated" };
    const empty = { symbol, profile: null, nav: null, size: null, sizeBasis: null, holders: null, dividends: [], frequency: null, trailing: null, upcoming: null, latest: null, holdings: null };
    if (!isEtf(source.stock) || !this.repository) return { data: empty, meta: { ...meta, updatedAt: null } };
    const stored = await this.repository.fund(symbol, shift(source.asOf, -400));
    const close = source.stock.history.findLast((bar) => bar.date <= source.asOf && Number.isFinite(bar.close) && bar.close > 0)?.close ?? null;
    const dividends = stored.dividends.map((row) => ({ exDate: row.ExDate, lastBuyDate: lastBuyDate(row.ExDate), recordDate: row.RecordDate, payDate: row.PayDate, amount: row.Amount }));
    const reported = stored.product?.AssetSize ?? null;
    const nav = stored.nav && { date: stored.nav.Date, estimated: stored.nav.EstimatedNav, marketPrice: stored.nav.MarketPrice,
      premiumPercent: stored.nav.PremiumPercent, previous: stored.nav.PreviousNav };
    const units = stored.nav?.Units ?? stored.profile?.Units ?? null;
    return { data: { symbol,
      profile: stored.profile && { fundType: stored.profile.FundType, indexName: stored.profile.IndexName, issuer: stored.product?.Issuer ?? null,
        inceptionDate: stored.profile.InceptionDate, listedDate: stored.profile.ListedDate, units },
      nav,
      // The reported fund size when TWSE lists one; otherwise units outstanding × estimated NAV, an estimate.
      size: reported ?? (units && nav ? units * nav.estimated : null),
      sizeBasis: reported ? "reported" : units && nav ? "estimated" : null, holders: stored.product?.Holders ?? null,
      dividends: dividends.slice(0, 12), ...summarizeEtfDividends(dividends, source.asOf, close),
      // The fund association's monthly top ten, newest month first, for as many months as are stored.
      holdings: stored.holdings?.length ? { basis: "monthly-top-10", months: holdingsByMonth(stored.holdings) } : null },
    meta: { ...meta, updatedAt: stored.nav?.UpdatedAt ?? stored.profile?.UpdatedAt ?? null } };
  }
}
