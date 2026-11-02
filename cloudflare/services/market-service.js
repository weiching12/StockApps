import { expandStock, isEtf, shardOf } from "../../shared/market-codec.js";

import { DomainError } from "../../shared/domain-error.js";
const unavailable = () => new DomainError("DATA_UNAVAILABLE", "股票資料尚未準備完成，請稍後再試。");

export class MarketService {
  constructor(repository) { this.repository = repository; }
  async market() {
    const manifest = await this.repository.manifest();
    if (!manifest) throw unavailable();
    return manifest;
  }
  async snapshot(generation, index) {
    const shard = await this.repository.shard(generation, index);
    if (!shard) throw unavailable();
    return shard;
  }
  async shards(generation, indices) { return this.repository.shards(generation, indices); }
  async stock(symbol) {
    const manifest = await this.market();
    const metadata = manifest.stocks.find((stock) => stock.symbol === symbol);
    if (!metadata) throw new DomainError("STOCK_NOT_FOUND", "找不到這個證券代號");
    const shard = await this.snapshot(manifest.generation, shardOf(symbol));
    const compact = shard.stocks.find((stock) => stock.symbol === symbol);
    if (!compact) throw unavailable();
    return { schemaVersion: 2, source: "twse", asOf: manifest.asOf, updatedAt: manifest.updatedAt,
      stock: { ...expandStock(metadata, compact.history), tradingDates: manifest.dates } };
  }
  async stocks({ offset, limit, type, sector, query }) {
    const manifest = await this.market();
    const stocks = manifest.stocks.filter((stock) =>
      (!type || (isEtf(stock) ? "etf" : "stock") === type) && (!sector || stock.sector === sector) &&
      (!query || `${stock.symbol} ${stock.name}`.toLowerCase().includes(query.toLowerCase())));
    return { data: stocks.slice(offset, offset + limit), meta: { asOf: manifest.asOf,
      updatedAt: manifest.updatedAt, total: stocks.length, offset, limit } };
  }
}
