export class EtfInfoRepository {
  constructor(db) { this.db = db; }

  /** At most two attempts per market day, half an hour apart. */
  async claim(date, now) {
    await this.db.prepare("INSERT OR IGNORE INTO etf_info_runs(Date,Status,Attempts) VALUES(?,'pending',0)").bind(date).run();
    const retryBefore = new Date(now.getTime() - 30 * 60_000).toISOString();
    const result = await this.db.prepare(`UPDATE etf_info_runs SET Attempts=Attempts+1,LastAttemptAt=?
      WHERE Date=? AND Status='pending' AND Attempts<2 AND (Attempts=0 OR LastAttemptAt<=?)`)
      .bind(now.toISOString(), date, retryBefore).run();
    if ((result.meta?.changes ?? result.changes) !== 1) return 0;
    return (await this.db.prepare("SELECT Attempts FROM etf_info_runs WHERE Date=?").bind(date).first()).Attempts;
  }

  async finish(date, complete, detail, now) {
    await this.db.prepare("UPDATE etf_info_runs SET Status=?,CompletedAt=?,Detail=? WHERE Date=?")
      .bind(complete ? "complete" : "pending", complete ? now.toISOString() : null, JSON.stringify(detail), date).run();
  }

  /** The profile list is the whole truth each day: funds that left it are removed. */
  async saveProfiles(profiles, updatedAt) {
    await this.db.batch([
      this.db.prepare("DELETE FROM etf_profiles"),
      this.db.prepare(`INSERT INTO etf_profiles(Symbol,FundType,IndexName,InceptionDate,ListedDate,Units,UpdatedAt)
        SELECT json_extract(value,'$.symbol'),json_extract(value,'$.fundType'),json_extract(value,'$.indexName'),
        json_extract(value,'$.inceptionDate'),json_extract(value,'$.listedDate'),json_extract(value,'$.units'),?
        FROM json_each(?) WHERE true`).bind(updatedAt, JSON.stringify(profiles)),
    ]);
  }

  async saveProducts(products, updatedAt) {
    await this.db.batch([
      this.db.prepare("DELETE FROM etf_products"),
      this.db.prepare(`INSERT INTO etf_products(Symbol,Issuer,AssetSize,Holders,UpdatedAt)
        SELECT json_extract(value,'$.symbol'),json_extract(value,'$.issuer'),json_extract(value,'$.assetSize'),
        json_extract(value,'$.holders'),? FROM json_each(?) WHERE true`).bind(updatedAt, JSON.stringify(products)),
    ]);
  }

  /** Replaces the fetched window, so a corrected or withdrawn announcement does not linger. */
  async saveDividends(dividends, start) {
    await this.db.batch([
      this.db.prepare("DELETE FROM etf_dividends WHERE ExDate>=?").bind(start),
      this.db.prepare(`INSERT INTO etf_dividends(Symbol,ExDate,RecordDate,PayDate,Amount)
        SELECT json_extract(value,'$.symbol'),json_extract(value,'$.exDate'),json_extract(value,'$.recordDate'),
        json_extract(value,'$.payDate'),json_extract(value,'$.amount') FROM json_each(?) WHERE true`)
        .bind(JSON.stringify(dividends)),
    ]);
  }

  async saveNav(navs, updatedAt) {
    await this.db.prepare(`INSERT INTO etf_nav(Symbol,Date,MarketPrice,EstimatedNav,PremiumPercent,PreviousNav,Units,UpdatedAt)
      SELECT json_extract(value,'$.symbol'),json_extract(value,'$.date'),json_extract(value,'$.marketPrice'),
      json_extract(value,'$.estimatedNav'),json_extract(value,'$.premiumPercent'),json_extract(value,'$.previousNav'),
      json_extract(value,'$.units'),? FROM json_each(?) WHERE true
      ON CONFLICT(Symbol) DO UPDATE SET Date=excluded.Date,MarketPrice=excluded.MarketPrice,EstimatedNav=excluded.EstimatedNav,
      PremiumPercent=excluded.PremiumPercent,PreviousNav=excluded.PreviousNav,Units=excluded.Units,UpdatedAt=excluded.UpdatedAt`)
      .bind(updatedAt, JSON.stringify(navs)).run();
  }

  /** The months whose holdings report is stored. */
  async holdingMonths() {
    return new Set((await this.db.prepare("SELECT DISTINCT Month FROM etf_holdings").all()).results.map((row) => row.Month));
  }

  /** A month's report replaces that month for every ETF; months before `keepFrom` are pruned in the same batch. */
  async saveHoldings(month, rows, keepFrom) {
    if (rows.some((row) => row.month !== month)) throw new Error("ETF holdings must belong to the saved month");
    await this.db.batch([
      this.db.prepare("DELETE FROM etf_holdings WHERE Month=? OR Month<?").bind(month, keepFrom),
      this.db.prepare(`INSERT INTO etf_holdings(Symbol,Month,Rank,Kind,Code,Name,Weight)
        SELECT json_extract(value,'$.symbol'),json_extract(value,'$.month'),json_extract(value,'$.rank'),json_extract(value,'$.kind'),
        json_extract(value,'$.code'),json_extract(value,'$.name'),json_extract(value,'$.weight') FROM json_each(?) WHERE true`)
        .bind(JSON.stringify(rows)),
    ]);
  }

  /** One ETF's stored facts; `from` bounds how far back distributions are read. */
  async fund(symbol, from) {
    const [profile, nav, dividends, product, holdings] = await Promise.all([
      this.db.prepare("SELECT FundType,IndexName,InceptionDate,ListedDate,Units,UpdatedAt FROM etf_profiles WHERE Symbol=?").bind(symbol).first(),
      this.db.prepare("SELECT Date,MarketPrice,EstimatedNav,PremiumPercent,PreviousNav,Units,UpdatedAt FROM etf_nav WHERE Symbol=?").bind(symbol).first(),
      this.db.prepare("SELECT ExDate,RecordDate,PayDate,Amount FROM etf_dividends WHERE Symbol=? AND ExDate>=? ORDER BY ExDate DESC").bind(symbol, from).all(),
      this.db.prepare("SELECT Issuer,AssetSize,Holders FROM etf_products WHERE Symbol=?").bind(symbol).first(),
      this.db.prepare("SELECT Month,Rank,Kind,Code,Name,Weight FROM etf_holdings WHERE Symbol=? ORDER BY Month DESC, Rank").bind(symbol).all(),
    ]);
    return { profile, nav, dividends: dividends.results, product, holdings: holdings.results };
  }
}
