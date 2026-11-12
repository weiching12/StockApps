import { isEtf } from "../../shared/market-codec.js";
import { summarizeEtfDividends } from "../../shared/etf-info.js";

const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Fund facts for one ETF. Ordinary shares, and ETFs not yet synced, answer with empty facts, never an error. */
export class EtfInfoService {
  constructor(marketService, repository = null) { this.marketService = marketService; this.repository = repository; }

  async fund(symbol) {
    const source = await this.marketService.stock(symbol);
    const meta = { asOf: source.asOf, priceBasis: "unadjusted", navBasis: "estimated" };
    const empty = { symbol, profile: null, nav: null, size: null, dividends: [], trailing: null, upcoming: null };
    if (!isEtf(source.stock) || !this.repository) return { data: empty, meta: { ...meta, updatedAt: null } };
    const stored = await this.repository.fund(symbol, shift(source.asOf, -400));
    const close = source.stock.history.findLast((bar) => bar.date <= source.asOf && Number.isFinite(bar.close) && bar.close > 0)?.close ?? null;
    const dividends = stored.dividends.map((row) => ({ exDate: row.ExDate, recordDate: row.RecordDate, payDate: row.PayDate, amount: row.Amount }));
    const nav = stored.nav && { date: stored.nav.Date, estimated: stored.nav.EstimatedNav, marketPrice: stored.nav.MarketPrice,
      premiumPercent: stored.nav.PremiumPercent, previous: stored.nav.PreviousNav };
    const units = stored.nav?.Units ?? stored.profile?.Units ?? null;
    return { data: { symbol,
      profile: stored.profile && { fundType: stored.profile.FundType, indexName: stored.profile.IndexName,
        inceptionDate: stored.profile.InceptionDate, listedDate: stored.profile.ListedDate, units },
      nav,
      // Units outstanding × estimated NAV: an estimate, not the issuer's published fund size.
      size: units && nav ? units * nav.estimated : null,
      dividends: dividends.slice(0, 12), ...summarizeEtfDividends(dividends, source.asOf, close) },
    meta: { ...meta, updatedAt: stored.nav?.UpdatedAt ?? stored.profile?.UpdatedAt ?? null } };
  }
}
