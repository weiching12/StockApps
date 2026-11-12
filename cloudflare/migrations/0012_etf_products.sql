-- Reported ETF facts from the TWSE ETF product list: issuer, fund size and holder count (TDCC).
-- A source of its own, so a failure here leaves the profile, NAV and distributions untouched.
CREATE TABLE IF NOT EXISTS etf_products (
  Symbol TEXT PRIMARY KEY,
  Issuer TEXT,
  AssetSize REAL CHECK(AssetSize IS NULL OR AssetSize > 0),
  Holders INTEGER CHECK(Holders IS NULL OR Holders >= 0),
  UpdatedAt TEXT NOT NULL
);
