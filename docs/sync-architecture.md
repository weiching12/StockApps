# Market synchronization

## Responsibilities

| Module | Responsibility |
| --- | --- |
| `sync.js` | Run one phase; round initialization, cooldown, failure ceiling, checkpoint recovery |
| `sync/plan.js` | Taipei rounds, pending dates and Friday historical rechecks |
| `sync/acquire.js` | Whole-market acquisition, normalization and coverage gates; validated T86 ingestion |
| `sync/snapshot.js` | Content deduplication and immutable history shard construction |
| `sync/publish.js` | Validate current T86 version and switch the public manifest |
| `sync/cleanup.js` | Retire only superseded generations, preserving the current and candidate generation |
| `sync/common.js` | Fingerprints, temporary-key TTL, shard batch size |
| `sync/coordinator.js` | Single named DO, serialized ticks, duplicate/out-of-order suppression |
| `sync/coordinator-store.js` | Durable progress/head storage, legacy import and publication recovery |

## Coordination

Cron calls `MARKET_SYNC.getByName("stock-insight-market-sync")`. The object serializes
the entire asynchronous phase with a promise queue; external I/O must not permit a
second phase to overlap. A failed promise releases the queue. No network request is
held inside `blockConcurrencyWhile`, which has a 30-second timeout.

Progress is persisted in SQLite-backed DO storage rather than KV. Existing
`twse:v2:sync` and the public manifest are imported on first access only; stale KV
reads cannot subsequently roll the authoritative checkpoint back. The old KV sync
key remains untouched and is no longer a current status source. Public APIs still
read KV snapshots and never access the coordinator.

After a completed publication and the corporate-action check, the existing cron
invokes the internal research capture endpoint on that same sync queue. It reads
the authoritative current manifest, checks the exact revision before calculating,
and saves with default settings; no browser visit is required. Capture failures
are logged independently and retried on later cron ticks without changing the
published manifest, sync phase or failure ceiling. Company-action check failures
do not suppress this retry. The queue prevents a later generation's cleanup from
removing shards while capture is reading them. No D1 schema migration is required.

The summary service checks company-action revision before and after its data read;
a changing revision cannot label a saved research snapshot. Prolonged database
outages across multiple publications still require the historical recovery process;
this job retries the current publication rather than reading reclaimed generations.

Successful ticks persist their scheduled timestamp. Equal/older timestamps are
ignored, including after object reconstruction. An unhandled storage error does not
claim completion; a later tick resumes the last durable checkpoint. Per-phase
errors still have the existing 30-minute cooldown and three-failure ceiling.

Publication first stores a durable intent, writes the public KV manifest, records
the authoritative head, then clears the intent. Interrupted publication replays the
same manifest before further work. If progress still says `publish` for an already
published generation, it is completed without republishing or making the previous
generation reference itself. KV propagation still has the existing 120-second wait.

This provides one active scheduled writer, not an exactly-once guarantee for every
external side effect during a process crash. A shard written before its checkpoint
can be rewritten on recovery. T86 retains D1's existing unique-slot and transactional
guards. Operators must not publish KV heads independently while the coordinator is
active: its durable manifest is authoritative. Any future repair/import publication
must enter the coordinator as an explicit operation with validation.

## Deployment and verification

Append-only migration `market-sync-v1` creates `MarketSyncCoordinator`; existing
presence objects, KV keys and D1 data are not removed. `MARKET_SYNC` is required;
Cron fails closed rather than falling back to an uncoordinated writer.

Run `npm test` and `npm run test:sync-runtime`. The runtime test uses isolated
workerd + SQLite DO storage, eight concurrent identical requests and sequential
distinct ticks, without production or TWSE access. Unit/integration coverage includes
restart checkpoints, pending-publication replay, failed-request queue recovery,
cooldown/stop policy, duplicate ticks through a full market pipeline, corrections,
ETF history preservation and current-generation cleanup protection.

KV budget: in the usual one-date changed/unchanged pair, writes fall from about
153 to 137 (133 changed + 4 unchanged) because progress is stored in the DO.
Additional DO storage writes and invocation usage replace these KV progress writes;
historical corrections/backfills/retries increase operation counts.
