-- ETF fund facts from TWSE: profile, latest estimated NAV and cash distributions.
-- Each table is replaced from its own source; a failed source leaves its last good rows.
CREATE TABLE IF NOT EXISTS etf_profiles (
  Symbol TEXT PRIMARY KEY,
  FundType TEXT,
  IndexName TEXT,
  InceptionDate TEXT,
  ListedDate TEXT,
  Units REAL,
  UpdatedAt TEXT NOT NULL
);
-- One row per ETF: the estimated NAV published for its latest session, never a history.
CREATE TABLE IF NOT EXISTS etf_nav (
  Symbol TEXT PRIMARY KEY,
  Date TEXT NOT NULL,
  MarketPrice REAL,
  EstimatedNav REAL NOT NULL CHECK(EstimatedNav > 0),
  PremiumPercent REAL,
  PreviousNav REAL,
  Units REAL,
  UpdatedAt TEXT NOT NULL
);
-- Amount stays NULL until the issuer announces it.
CREATE TABLE IF NOT EXISTS etf_dividends (
  Symbol TEXT NOT NULL,
  ExDate TEXT NOT NULL,
  RecordDate TEXT,
  PayDate TEXT,
  Amount REAL CHECK(Amount IS NULL OR Amount >= 0),
  PRIMARY KEY(Symbol, ExDate)
);
CREATE INDEX IF NOT EXISTS etf_dividends_by_date ON etf_dividends(ExDate);
CREATE TABLE IF NOT EXISTS etf_info_runs (
  Date TEXT PRIMARY KEY,
  Status TEXT NOT NULL CHECK(Status IN ('pending', 'complete')),
  Attempts INTEGER NOT NULL DEFAULT 0 CHECK(Attempts BETWEEN 0 AND 2),
  LastAttemptAt TEXT,
  CompletedAt TEXT,
  Detail TEXT
);
