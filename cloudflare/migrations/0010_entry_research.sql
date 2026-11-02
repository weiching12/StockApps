-- Daily entry research samples (entry-research models). One immutable row per stock, trading
-- date and model version: the first capture is kept, never silently overwritten. Queryable
-- results are columns; the full explanation for the detail view is DetailJson.
CREATE TABLE IF NOT EXISTS entry_research_samples (
  Symbol TEXT NOT NULL,
  TradeDate TEXT NOT NULL,
  ModelVersion TEXT NOT NULL,
  Name TEXT,
  Source TEXT NOT NULL CHECK(Source IN ('daily', 'historical-recalculation')),
  RevisionId TEXT NOT NULL,
  Close REAL,
  GateStatus TEXT NOT NULL CHECK(GateStatus IN ('PASS', 'FAIL', 'UNKNOWN')),
  GatePassed INTEGER NOT NULL,
  Trend TEXT NOT NULL, Momentum TEXT NOT NULL, PriceVolume TEXT NOT NULL,
  Institutional TEXT NOT NULL, EntryRisk TEXT NOT NULL,
  ReadinessScore REAL,
  StructureScore REAL, SignalScore REAL, TimingScore REAL,
  EntryStatus TEXT NOT NULL,
  SetupType TEXT,
  SignalDate TEXT,
  NextDayStatus TEXT NOT NULL,
  EntryReferencePrice REAL, EntryPriceUpper REAL, InvalidationPrice REAL,
  RiskPercent REAL, Atr14 REAL,
  DataQuality TEXT NOT NULL,
  PriceBasis TEXT,
  CapturedAt TEXT NOT NULL,
  DetailJson TEXT NOT NULL CHECK(json_valid(DetailJson)),
  PRIMARY KEY(Symbol, TradeDate, ModelVersion)
);
CREATE INDEX IF NOT EXISTS idx_entry_samples_date ON entry_research_samples(ModelVersion, TradeDate);
CREATE INDEX IF NOT EXISTS idx_entry_samples_status ON entry_research_samples(ModelVersion, EntryStatus, TradeDate);
CREATE INDEX IF NOT EXISTS idx_entry_samples_setup ON entry_research_samples(ModelVersion, SetupType, TradeDate);
CREATE INDEX IF NOT EXISTS idx_entry_samples_next_day ON entry_research_samples(ModelVersion, NextDayStatus, TradeDate);

-- After-the-fact results. Separate from samples so a sample row never changes; values are
-- NULL while their status is PENDING or UNAVAILABLE, never zero-filled.
CREATE TABLE IF NOT EXISTS entry_research_outcomes (
  Symbol TEXT NOT NULL,
  TradeDate TEXT NOT NULL,
  ModelVersion TEXT NOT NULL,
  Status TEXT NOT NULL CHECK(Status IN ('PENDING', 'COMPLETE', 'UNAVAILABLE')),
  Return1 REAL, Return5 REAL, Return10 REAL, Return20 REAL,
  Mfe20 REAL, Mae20 REAL,
  HitInvalidation INTEGER, HitTarget INTEGER,
  TradeStatus TEXT NOT NULL,
  FillDate TEXT, FillPrice REAL,
  TradeReturn5 REAL, TradeReturn10 REAL, TradeReturn20 REAL,
  DetailJson TEXT NOT NULL CHECK(json_valid(DetailJson)),
  UpdatedAt TEXT NOT NULL,
  PRIMARY KEY(Symbol, TradeDate, ModelVersion),
  FOREIGN KEY(Symbol, TradeDate, ModelVersion) REFERENCES entry_research_samples(Symbol, TradeDate, ModelVersion)
);
CREATE INDEX IF NOT EXISTS idx_entry_outcomes_pending ON entry_research_outcomes(ModelVersion, Status, TradeDate);

-- One row per capture attempt for a publication revision; later revisions of the same
-- trading date are recorded but never replace samples that were already saved.
CREATE TABLE IF NOT EXISTS entry_research_runs (
  TradeDate TEXT NOT NULL,
  ModelVersion TEXT NOT NULL,
  RevisionId TEXT NOT NULL,
  Source TEXT NOT NULL,
  StartedAt TEXT NOT NULL,
  CompletedAt TEXT,
  SampleCount INTEGER NOT NULL DEFAULT 0,
  Inserted INTEGER NOT NULL DEFAULT 0,
  Skipped INTEGER NOT NULL DEFAULT 0,
  OutcomeUpdates INTEGER NOT NULL DEFAULT 0,
  Status TEXT NOT NULL CHECK(Status IN ('running', 'complete', 'failed')),
  Error TEXT,
  PRIMARY KEY(TradeDate, ModelVersion, RevisionId)
);
