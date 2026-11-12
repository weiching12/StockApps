import { HttpClient } from "./http-client.js";

export const MARKET_API_PATH = "/api/v1/market";

export class MarketApiClient {
  constructor(fetcher = fetch) { this.http = new HttpClient(fetcher); }

  market(options) { return this.http.json(MARKET_API_PATH, options); }
  summary(date, settings, options) {
    const params = new URLSearchParams({ ...settings, ...(date ? { asOf: date } : {}) });
    return this.http.json(`/api/v1/market/summary?${params}`, options);
  }
  sector(name, date, settings, options) {
    const params = new URLSearchParams({ ...settings, asOf: date });
    return this.http.json(`/api/v1/sectors/${encodeURIComponent(name)}?${params}`, options);
  }
  analysis(symbol, date, settings, options) {
    const params = new URLSearchParams({ ...settings, asOf: date });
    return this.http.json(`/api/v1/stocks/${encodeURIComponent(symbol)}/analysis?${params}`, options);
  }
  /** ETF fund facts: profile, estimated NAV and distributions. */
  fund(symbol, options) { return this.http.json(`/api/v1/stocks/${encodeURIComponent(symbol)}/fund`, options); }
  backtest(params, options) { return this.http.json(`/api/v1/research/backtest?${params}`, options); }
  researchSamples(params, options) { return this.http.json(`/api/v1/research/samples?${params}`, options); }
}
