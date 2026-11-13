import { SHARD_COUNT } from "../../shared/market-codec.js";

// Lossless storage avoids rewriting ~100,000 individual history rows per release.
// Generation/index is immutable once committed; incomplete builds have no manifest.
export class HistoryRepository {
  constructor(db) {
    if (!db) throw new Error("History D1 binding required");
    this.db = db.withSession ? db.withSession("first-primary") : db;
  }
  async shard(generation, index) {
    const row = await this.db.prepare("SELECT Payload FROM market_history_shards WHERE Generation=? AND ShardIndex=?")
      .bind(generation, index).first();
    return row ? JSON.parse(row.Payload) : null;
  }
  /** Several shards of one generation in one query (D1 allows 100 bound parameters), keyed by index. */
  async shards(generation, indices) {
    const found = new Map();
    for (let offset = 0; offset < indices.length; offset += 99) {
      const group = indices.slice(offset, offset + 99);
      const rows = await this.db.prepare(`SELECT ShardIndex, Payload FROM market_history_shards
        WHERE Generation=? AND ShardIndex IN (${group.map(() => "?").join(",")})`).bind(generation, ...group).all();
      for (const row of rows.results ?? []) found.set(row.ShardIndex, JSON.parse(row.Payload));
    }
    return found;
  }
  /** `existing` is the stored copy when the caller already read it (null: known absent). */
  async saveShard(chunk, existing) {
    if (!Number.isInteger(chunk.index) || chunk.index < 0 || chunk.index >= SHARD_COUNT || !chunk.generation)
      throw new Error("Invalid history shard");
    if (existing === undefined) existing = await this.shard(chunk.generation, chunk.index);
    if (existing && JSON.stringify(existing) !== JSON.stringify(chunk)) throw new Error("Immutable D1 history conflict");
    if (existing) return;
    await this.db.prepare("INSERT INTO market_history_shards VALUES(?,?,?)")
      .bind(chunk.generation, chunk.index, JSON.stringify(chunk)).run();
  }
  async manifest(generation) {
    const row = await this.db.prepare("SELECT Payload FROM market_history_manifests WHERE Generation=?")
      .bind(generation).first();
    return row ? JSON.parse(row.Payload) : null;
  }
  async commit(manifest) {
    const count = await this.db.prepare("SELECT count(*) AS n FROM market_history_shards WHERE Generation=?")
      .bind(manifest.generation).first();
    if (count.n !== SHARD_COUNT) throw new Error("D1 history incomplete; refuse publication");
    const existing = await this.manifest(manifest.generation);
    if (existing && JSON.stringify(existing) !== JSON.stringify(manifest)) throw new Error("Immutable D1 manifest conflict");
    if (!existing) await this.db.prepare("INSERT INTO market_history_manifests(Generation,Payload,PublishedAt) VALUES(?,?,?)")
      .bind(manifest.generation, JSON.stringify(manifest), manifest.updatedAt).run();
  }
  async retainPublished(generation, previous) {
    if (!generation || !previous || generation === previous) return;
    await this.db.batch([
      this.db.prepare("DELETE FROM market_history_manifests WHERE Generation NOT IN (?,?)").bind(generation, previous),
      this.db.prepare("DELETE FROM market_history_shards WHERE Generation NOT IN (?,?)").bind(generation, previous),
    ]);
  }
}

export const historyRepository = (env) => env.MARKET_HISTORY_ENABLED === "1" ? new HistoryRepository(env.T86_DB) : null;
