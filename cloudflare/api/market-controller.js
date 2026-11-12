import { analysisOptions, chartDays, researchBacktestOptions, researchSampleOptions, stockCollectionOptions } from "./validators.js";

// Controllers own API representations and HTTP input adaptation.
export async function marketController(route, url, services) {
  const { market, analysis, history, summary } = services;
  switch (route.name) {
    case "market": {
      const body = await market.market();
      return route.versioned ? { ...body,
        chunks: body.chunks.map((_, index) => `/api/v1/market/snapshots/${body.generation}/shards/${index}`) } : body;
    }
    case "snapshot": return market.snapshot(route.params.generation, route.params.index);
    case "marketSummary": {
      const options = analysisOptions(url.searchParams);
      return summary.summary(options.asOf, options.settings);
    }
    case "favoriteSummary": {
      const options = analysisOptions(url.searchParams);
      return summary.favorites((url.searchParams.get("symbols") || "").split(","), options.asOf, options.settings);
    }
    case "favoriteResearch": {
      const options = analysisOptions(url.searchParams);
      return summary.research((url.searchParams.get("symbols") || "").split(","), options.asOf, options.settings);
    }
    case "sectorDetail": {
      const options = analysisOptions(url.searchParams);
      return summary.sector(decodeURIComponent(route.params.name), options.asOf, options.settings);
    }
    case "stocks": return market.stocks(stockCollectionOptions(url.searchParams));
    case "analysis": return analysis.stock(route.params.symbol, { ...analysisOptions(url.searchParams), days: chartDays(url.searchParams) });
    case "stock": return market.stock(route.params.symbol);
    case "history": return history.stock(route.params.symbol);
    case "review": return history.review(route.params.symbol);
    case "fund": return services.etfInfo.fund(route.params.symbol);
    case "researchSamples": return services.entryResearch.samples(researchSampleOptions(url.searchParams));
    case "researchBacktest": return services.entryResearch.backtest(researchBacktestOptions(url.searchParams));
    default: throw new Error("Unregistered market controller");
  }
}
