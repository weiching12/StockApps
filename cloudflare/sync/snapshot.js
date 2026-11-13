import { SHARD_COUNT } from "../../shared/market-codec.js";
import { mergeShard } from "../../shared/market.js";
import { shardKey, stageKey } from "../storage/market-keys.js";
import { put, SHARDS_PER_TICK } from "./common.js";
import { retireShard } from "./cleanup.js";

export async function shards({ kv, state, manifest, now, history }) {
  const [catalog, days] = await Promise.all([
    kv.get(stageKey(state.generation, "catalog"), "json"), kv.get(stageKey(state.generation, "days"), "json"),
  ]);
  if (!catalog || !days?.length) throw new Error("Staged market days not visible yet");
  // Missing fingerprints deliberately force one full baseline publication.
  if (state.nextShard === 0 && typeof state.catalogHash === "string" && manifest?.catalogHash === state.catalogHash &&
      days.every((day) => manifest.dayHashes?.[day.date] === state.dayHashes?.[day.date])) {
    state.phase = "done";
    state.result = "Unchanged";
    state.checkedThrough = state.reportDates.at(-1);
    return;
  }
  // Read this tick's shards from D1 in two queries, not three per shard: a free-plan
  // invocation may issue at most 50 D1 queries.
  const indices = Array.from({ length: Math.min(SHARDS_PER_TICK, SHARD_COUNT - state.nextShard) }, (_, i) => state.nextShard + i);
  const [previousShards, savedShards] = history ? await Promise.all([
    manifest ? history.shards(manifest.generation, indices) : new Map(), history.shards(state.generation, indices),
  ]) : [null, null];
  for (const index of indices) {
    const previous = manifest ? history ? previousShards.get(index) ?? null
      : await kv.get(shardKey(manifest.generation, index), "json") : null;
    if (manifest && !previous) throw new Error("Last good history shard unavailable; do not replace it with one day");
    const chunk = { ...mergeShard(catalog, index, previous, days), generation: state.generation, index };
    if (history) await history.saveShard(chunk, savedShards.get(index) ?? null);
    await put(kv, shardKey(state.generation, index), chunk);
    await retireShard(kv, manifest, state, index);
    state.nextShard++;
  }
  if (state.nextShard === SHARD_COUNT) {
    state.phase = "publish";
    // KV is eventually consistent. Leave propagation time before switching readers.
    state.publishAfter = now.getTime() + 120000;
  }
}

