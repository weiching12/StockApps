// D1 persistence for ETF fund facts. D1's free plan allows 100,000 rows written a day, and most of
// these facts do not change from one evening to the next, so every save writes only the rows that differ:
// an upsert whose DO UPDATE is guarded by a comparison, and a delete of the rows the source no longer
// lists. Saving the same report twice writes nothing. Each method returns the rows it actually wrote.
const changes = (result) => result?.meta?.changes ?? result?.changes ?? 0;
const written = (results) => results.reduce((sum, result) => sum + changes(result), 0);
const differs = (table, columns) => columns.map((column) => `${table}.${column} IS NOT excluded.${column}`).join(" OR ");
const assign = (columns) => columns.map((column) => `${column}=excluded.${column}`).join(",");

export class EtfInfoRepository {
  constructor(db) { this.db = db; }

  /**
   * Whether the day still has an attempt to make: one read of one row. The cron fires every minute, so
   * a day that is already complete, out of attempts or cooling down must cost nothing more than this.
   */
  async due(date, now) {
    const row = await this.db.prepare("SELECT Status, Attempts, LastAttemptAt FROM etf_info_runs WHERE Date=?").bind(date).first();
    if (!row) return true;
    return row.Status === "pending" && row.Attempts < 2 &&
      (row.Attempts === 0 || row.LastAttemptAt <= new Date(now.getTime() - 30 * 60_000).toISOString());
  }

  /** At most two attempts per market day, half an hour apart. One statement; returns the attempt number, or 0. */
  async claim(date, now) {
    const retryBefore = new Date(now.getTime() - 30 * 60_000).toISOString();
    const row = await this.db.prepare(`INSERT INTO etf_info_runs(Date,Status,Attempts,LastAttemptAt) VALUES(?,'pending',1,?)
      ON CONFLICT(Date) DO UPDATE SET Attempts=etf_info_runs.Attempts+1,LastAttemptAt=excluded.LastAttemptAt
      WHERE etf_info_runs.Status='pending' AND etf_info_runs.Attempts<2 AND (etf_info_runs.Attempts=0 OR etf_info_runs.LastAttemptAt<=?)
      RETURNING Attempts`).bind(date, now.toISOString(), retryBefore).first();
    return row?.Attempts ?? 0;
  }

  async finish(date, complete, detail, now) {
    await this.db.prepare("UPDATE etf_info_runs SET Status=?,CompletedAt=?,Detail=? WHERE Date=?")
      .bind(complete ? "complete" : "pending", complete ? now.toISOString() : null, JSON.stringify(detail), date).run();
  }

  /** The profile list is the whole truth each day: funds that left it are removed. */
  async saveProfiles(profiles, updatedAt) {
    const columns = ["FundType", "IndexName", "InceptionDate", "ListedDate", "Units"], rows = JSON.stringify(profiles);
    return written(await this.db.batch([
      this.db.prepare("DELETE FROM etf_profiles WHERE Symbol NOT IN (SELECT json_extract(value,'$.symbol') FROM json_each(?))").bind(rows),
      this.db.prepare(`INSERT INTO etf_profiles(Symbol,FundType,IndexName,InceptionDate,ListedDate,Units,UpdatedAt)
        SELECT json_extract(value,'$.symbol'),json_extract(value,'$.fundType'),json_extract(value,'$.indexName'),
        json_extract(value,'$.inceptionDate'),json_extract(value,'$.listedDate'),json_extract(value,'$.units'),?
        FROM json_each(?) WHERE true
        ON CONFLICT(Symbol) DO UPDATE SET ${assign([...columns, "UpdatedAt"])} WHERE ${differs("etf_profiles", columns)}`).bind(updatedAt, rows),
    ]));
  }

  async saveProducts(products, updatedAt) {
    const columns = ["Issuer", "AssetSize", "Holders"], rows = JSON.stringify(products);
    return written(await this.db.batch([
      this.db.prepare("DELETE FROM etf_products WHERE Symbol NOT IN (SELECT json_extract(value,'$.symbol') FROM json_each(?))").bind(rows),
      this.db.prepare(`INSERT INTO etf_products(Symbol,Issuer,AssetSize,Holders,UpdatedAt)
        SELECT json_extract(value,'$.symbol'),json_extract(value,'$.issuer'),json_extract(value,'$.assetSize'),
        json_extract(value,'$.holders'),? FROM json_each(?) WHERE true
        ON CONFLICT(Symbol) DO UPDATE SET ${assign([...columns, "UpdatedAt"])} WHERE ${differs("etf_products", columns)}`).bind(updatedAt, rows),
    ]));
  }

  /**
   * The fetched window is the truth from `start` on: an announcement that was corrected is updated and
   * one that was withdrawn is removed. Rows before `start` are past the kept year and are pruned.
   */
  async saveDividends(dividends, start) {
    const columns = ["RecordDate", "PayDate", "Amount"], rows = JSON.stringify(dividends);
    return written(await this.db.batch([
      this.db.prepare(`DELETE FROM etf_dividends WHERE ExDate<? OR (Symbol||':'||ExDate) NOT IN
        (SELECT json_extract(value,'$.symbol')||':'||json_extract(value,'$.exDate') FROM json_each(?))`).bind(start, rows),
      this.db.prepare(`INSERT INTO etf_dividends(Symbol,ExDate,RecordDate,PayDate,Amount)
        SELECT json_extract(value,'$.symbol'),json_extract(value,'$.exDate'),json_extract(value,'$.recordDate'),
        json_extract(value,'$.payDate'),json_extract(value,'$.amount') FROM json_each(?) WHERE true
        ON CONFLICT(Symbol,ExDate) DO UPDATE SET ${assign(columns)} WHERE ${differs("etf_dividends", columns)}`).bind(rows),
    ]));
  }

  /** One row per ETF, replaced when the session or any figure changes. */
  async saveNav(navs, updatedAt) {
    const columns = ["Date", "MarketPrice", "EstimatedNav", "PremiumPercent", "PreviousNav", "Units"];
    return changes(await this.db.prepare(`INSERT INTO etf_nav(Symbol,Date,MarketPrice,EstimatedNav,PremiumPercent,PreviousNav,Units,UpdatedAt)
      SELECT json_extract(value,'$.symbol'),json_extract(value,'$.date'),json_extract(value,'$.marketPrice'),
      json_extract(value,'$.estimatedNav'),json_extract(value,'$.premiumPercent'),json_extract(value,'$.previousNav'),
      json_extract(value,'$.units'),? FROM json_each(?) WHERE true
      ON CONFLICT(Symbol) DO UPDATE SET ${assign([...columns, "UpdatedAt"])} WHERE ${differs("etf_nav", columns)}`)
      .bind(updatedAt, JSON.stringify(navs)).run());
  }

  /**
   * The months whose holdings report is stored. Steps from one month to the next through the month
   * index (about a dozen seeks) instead of scanning the table's twenty-odd thousand rows for DISTINCT.
   */
  async holdingMonths() {
    const rows = await this.db.prepare(`WITH RECURSIVE months(Month) AS (
        SELECT MIN(Month) FROM etf_holdings
        UNION ALL SELECT (SELECT MIN(Month) FROM etf_holdings WHERE Month>months.Month) FROM months WHERE months.Month IS NOT NULL)
      SELECT Month FROM months WHERE Month IS NOT NULL`).all();
    return new Set(rows.results.map((row) => row.Month));
  }

  /** A month's report replaces that month for every ETF; months before `keepFrom` are pruned in the same batch. */
  async saveHoldings(month, rows, keepFrom) {
    if (rows.some((row) => row.month !== month)) throw new Error("ETF holdings must belong to the saved month");
    return written(await this.db.batch([
      this.db.prepare("DELETE FROM etf_holdings WHERE Month=? OR Month<?").bind(month, keepFrom),
      this.db.prepare(`INSERT INTO etf_holdings(Symbol,Month,Rank,Kind,Code,Name,Weight)
        SELECT json_extract(value,'$.symbol'),json_extract(value,'$.month'),json_extract(value,'$.rank'),json_extract(value,'$.kind'),
        json_extract(value,'$.code'),json_extract(value,'$.name'),json_extract(value,'$.weight') FROM json_each(?) WHERE true`)
        .bind(JSON.stringify(rows)),
    ]));
  }

  /** One ETF's stored facts; `from` bounds how far back distributions are read. Every query is a primary-key lookup or prefix. */
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
