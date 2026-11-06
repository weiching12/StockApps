# Industry research rules

`shared/sectors.js` owns pure industry grouping, overview and detail models. It
depends only on the shared security codec and indicator calculations; it has no
DOM, HTTP or storage dependency. `src/ui/sectors.js` formats these models and
updates the existing HTML. A future API controller or backtest can call the same
functions without constructing a UI context or supplying formatting callbacks.

- Industries come from the custom taxonomy in `data/custom-sectors/`, applied by
  `shared/custom-sectors.js`: `sector` is the sub-industry, which every ranking and
  detail uses. `sectorGroup`, the broader sector, only organises the market list's
  filter. A detail also accepts the official industry name older links use.
  The ranking shows its top 10 rows until the reader expands it.
- Exclude ETFs identified by either `assetType: "etf"` or the legacy `ETF` sector.
- Accept analyzed snapshots and oldest-first market dates for one selected
  session. Do not mix snapshots and calendars from different selected sessions.
- Daily price change uses the snapshot's daily return. Five/twenty-day returns
  require the exact market session before the selected window; do not substitute
  a neighboring traded bar when a member is missing its baseline.
- Average returns are equally weighted across currently priced members. If any
  such member lacks its return, the entire average is unknown (`null`). Unpriced
  members are excluded from the price average but remain in expected flow counts.
- Net-share totals and estimated monetary totals use the indicator module's
  existing complete-stock-window cohort. Unknown is not zero. Monetary estimates
  use each session's closing price multiplied by that session's net shares.
- Institutional activity is gross trading regardless of direction: each stock's
  three institutions' buys plus sells, times that session's close, summed over
  the window. A stock counts only with every session's close and all three
  institution rows present. An industry's share is its activity divided by the
  sum across all listed-company industries (ETFs excluded) for the same window.
- The default 交易量 ordering (`activity-desc`) sorts by that activity, highest
  first; 買超／賣超 sort by net monetary amount. Unknown values stay last and
  equal values keep input order. `name-asc` (zh-Hant, i.e. stroke order) remains
  available to callers but is no longer offered in the UI. Ranks count only
  industries with a finite value for the active ordering, in display order, so
  under 交易量 the number is the activity rank, not the net-buy rank.
- TOP1 selects the largest monetary buyer for a positive/zero industry net flow,
  or the largest monetary seller for a negative net flow. Changing display sort
  does not change the leader. Equal candidates retain their original order.
- Detail members always sort by daily net monetary amount descending, then name;
  missing values follow known values. Period values remain in TWD and shares,
  leaving units and localized formatting to the caller.

These are a preservation of existing display rules, not a new investment signal.
Returns still use raw prices; corporate-action adjustment is a separate feature.

`tests/sectors-domain.test.js` compares all periods and sort orders with the
pre-extraction algorithm on multiple demo dates and covers ETFs, missing sessions,
partial cohorts, genuine zeros, leader direction, ranking and input immutability.
