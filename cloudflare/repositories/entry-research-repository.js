// D1 persistence for entry research samples, outcomes and capture runs. Rows travel as JSON
// arrays so a whole market fits in a few statements (D1 limits bound parameters, not rows).
const CHUNK = 200;
const SAMPLE_COLUMNS = ["Symbol", "TradeDate", "ModelVersion", "Name", "Source", "RevisionId", "Close", "GateStatus",
  "GatePassed", "Trend", "Momentum", "PriceVolume", "Institutional", "EntryRisk", "ReadinessScore", "StructureScore",
  "SignalScore", "TimingScore", "EntryStatus", "SetupType", "SignalDate", "NextDayStatus", "EntryReferencePrice",
  "EntryPriceUpper", "InvalidationPrice", "RiskPercent", "Atr14", "DataQuality", "PriceBasis", "CapturedAt", "DetailJson"];
const OUTCOME_COLUMNS = ["Symbol", "TradeDate", "ModelVersion", "Status", "Return1", "Return5", "Return10", "Return20",
  "Mfe20", "Mae20", "HitInvalidation", "HitTarget", "TradeStatus", "FillDate", "FillPrice", "TradeReturn5",
  "TradeReturn10", "TradeReturn20", "DetailJson", "UpdatedAt"];
const changes = (result) => result?.meta?.changes ?? result?.changes ?? 0;
const chunks = (rows) => Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, index) => rows.slice(index * CHUNK, (index + 1) * CHUNK));
const extract = (columns) => columns.map((column) => `json_extract(value,'$.${column}')`).join(",");

export class EntryResearchRepository {
  constructor(db) { this.db = db.withSession ? db.withSession("first-primary") : db; }

  async run(tradeDate, modelVersion, revisionId) {
    return this.db.prepare("SELECT * FROM entry_research_runs WHERE TradeDate=? AND ModelVersion=? AND RevisionId=?")
      .bind(tradeDate, modelVersion, revisionId).first();
  }

  async startRun({ tradeDate, modelVersion, revisionId, source, startedAt }) {
    await this.db.prepare(`INSERT INTO entry_research_runs(TradeDate,ModelVersion,RevisionId,Source,StartedAt,Status)
      VALUES(?,?,?,?,?,'running') ON CONFLICT(TradeDate,ModelVersion,RevisionId)
      DO UPDATE SET StartedAt=excluded.StartedAt,Status='running',Error=NULL`)
      .bind(tradeDate, modelVersion, revisionId, source, startedAt).run();
  }

  async finishRun({ tradeDate, modelVersion, revisionId, completedAt, sampleCount, inserted, skipped, outcomeUpdates }) {
    await this.db.prepare(`UPDATE entry_research_runs SET CompletedAt=?,SampleCount=?,Inserted=?,Skipped=?,
      OutcomeUpdates=?,Status='complete',Error=NULL WHERE TradeDate=? AND ModelVersion=? AND RevisionId=?`)
      .bind(completedAt, sampleCount, inserted, skipped, outcomeUpdates, tradeDate, modelVersion, revisionId).run();
  }

  async failRun({ tradeDate, modelVersion, revisionId, error }) {
    await this.db.prepare(`UPDATE entry_research_runs SET Status='failed',Error=?
      WHERE TradeDate=? AND ModelVersion=? AND RevisionId=?`)
      .bind(String(error).slice(0, 500), tradeDate, modelVersion, revisionId).run();
  }

  /** Insert-only: an existing (Symbol, TradeDate, ModelVersion) row is kept as first captured. */
  async saveSamples(rows) {
    let inserted = 0;
    for (const group of chunks(rows)) {
      const result = await this.db.prepare(`INSERT OR IGNORE INTO entry_research_samples(${SAMPLE_COLUMNS.join(",")})
        SELECT ${extract(SAMPLE_COLUMNS)} FROM json_each(?) WHERE true`).bind(JSON.stringify(group)).run();
      inserted += changes(result);
    }
    return { inserted, skipped: rows.length - inserted };
  }

  /** Samples on or after `since` whose outcome is missing or still pending. */
  async outcomeCandidates(modelVersion, since) {
    const rows = await this.db.prepare(`SELECT s.Symbol,s.TradeDate,s.Close,s.NextDayStatus,s.EntryReferencePrice,
      s.EntryPriceUpper,s.InvalidationPrice,o.DetailJson AS OutcomeJson
      FROM entry_research_samples s LEFT JOIN entry_research_outcomes o
      ON o.Symbol=s.Symbol AND o.TradeDate=s.TradeDate AND o.ModelVersion=s.ModelVersion
      WHERE s.ModelVersion=? AND s.TradeDate>=? AND (o.Status IS NULL OR o.Status='PENDING')`)
      .bind(modelVersion, since).all();
    return rows.results ?? [];
  }

  async saveOutcomes(rows) {
    const updates = OUTCOME_COLUMNS.filter((column) => !["Symbol", "TradeDate", "ModelVersion"].includes(column))
      .map((column) => `${column}=excluded.${column}`).join(",");
    for (const group of chunks(rows))
      await this.db.prepare(`INSERT INTO entry_research_outcomes(${OUTCOME_COLUMNS.join(",")})
        SELECT ${extract(OUTCOME_COLUMNS)} FROM json_each(?) WHERE true
        ON CONFLICT(Symbol,TradeDate,ModelVersion) DO UPDATE SET ${updates}`).bind(JSON.stringify(group)).run();
    return rows.length;
  }

  /** Remove samples (with their outcomes) and runs dated before `cutoff`. */
  async prune(cutoff) {
    const [outcomes, samples, runs] = await this.db.batch([
      this.db.prepare("DELETE FROM entry_research_outcomes WHERE TradeDate<?").bind(cutoff),
      this.db.prepare("DELETE FROM entry_research_samples WHERE TradeDate<?").bind(cutoff),
      this.db.prepare("DELETE FROM entry_research_runs WHERE TradeDate<?").bind(cutoff),
    ]);
    return { outcomes: changes(outcomes), samples: changes(samples), runs: changes(runs) };
  }

  /** Filtered sample list with outcomes, newest first. */
  async samples({ modelVersion, from, to, symbol, gateStatus, entryStatus, setupType, nextDayStatus, minScore, maxScore, source,
    limit, offset }) {
    const where = ["s.ModelVersion=?"], values = [modelVersion];
    const add = (sql, value) => { if (value !== undefined && value !== null) { where.push(sql); values.push(value); } };
    add("s.TradeDate>=?", from); add("s.TradeDate<=?", to); add("s.Symbol=?", symbol); add("s.GateStatus=?", gateStatus);
    add("s.EntryStatus=?", entryStatus); add("s.SetupType=?", setupType); add("s.NextDayStatus=?", nextDayStatus);
    add("s.ReadinessScore>=?", minScore); add("s.ReadinessScore<=?", maxScore); add("s.Source=?", source);
    const clause = where.join(" AND ");
    const total = await this.db.prepare(`SELECT COUNT(*) AS Count FROM entry_research_samples s WHERE ${clause}`)
      .bind(...values).first();
    const rows = await this.db.prepare(`SELECT s.*,o.Status AS OutcomeStatus,o.Return1,o.Return5,o.Return10,o.Return20,
      o.Mfe20,o.Mae20,o.HitInvalidation,o.HitTarget,o.TradeStatus,o.FillDate,o.FillPrice,
      o.TradeReturn5,o.TradeReturn10,o.TradeReturn20,o.DetailJson AS OutcomeJson
      FROM entry_research_samples s LEFT JOIN entry_research_outcomes o
      ON o.Symbol=s.Symbol AND o.TradeDate=s.TradeDate AND o.ModelVersion=s.ModelVersion
      WHERE ${clause} ORDER BY s.TradeDate DESC,s.ReadinessScore DESC,s.Symbol LIMIT ? OFFSET ?`)
      .bind(...values, limit, offset).all();
    return { total: total?.Count ?? 0, rows: rows.results ?? [] };
  }
}
