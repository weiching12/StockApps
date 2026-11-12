-- Top-ten holdings per ETF and month, from the fund association's monthly report.
-- About thirteen months are kept so the one-year chart can show each month's holdings; a month's
-- report replaces that month's rows and older months are pruned.
CREATE TABLE IF NOT EXISTS etf_holdings (
  Symbol TEXT NOT NULL,
  Month TEXT NOT NULL CHECK(Month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  Rank INTEGER NOT NULL CHECK(Rank >= 1),
  Kind TEXT,
  Code TEXT,
  Name TEXT,
  Weight REAL NOT NULL,
  PRIMARY KEY(Symbol, Month, Rank)
);
CREATE INDEX IF NOT EXISTS etf_holdings_by_month ON etf_holdings(Month);
