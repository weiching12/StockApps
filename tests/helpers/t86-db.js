import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { T86Store } from "../../cloudflare/t86-store.js";
import { T86_QUERY } from "../../cloudflare/t86-validator.js";

// Real SQLite constraint, JSON and transaction behavior, with the D1 interface.
export function testDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(readFileSync(new URL("../../cloudflare/migrations/0001_t86.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../../cloudflare/migrations/0002_t86_raw_chunks.sql", import.meta.url), "utf8"));
  const db = { sqlite, beforeStatement: null,
    prepare(sql) {
      let values = [];
      const execute = (method) => { db.beforeStatement?.(sql); return sqlite.prepare(sql)[method](...values); };
      return { bind(...args) { values = args; return this; },
        async first() { return execute("get") ?? null; }, async all() { return { results: execute("all") }; },
        async run() { return execute("run"); }, sql,
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      // Like D1, a batched SELECT returns its rows.
      try { const results = []; for (const s of statements) results.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run());
        sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return db;
}

export function testStore(count = 1000) {
  const db = testDatabase(), store = new T86Store(db);
  // Test-only successful earlier sessions; production bootstrap requires explicit
  // hash approvals and is exercised separately without this fixture.
  for (const date of ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]) {
    const id = `baseline-${date}`, time = `${date}T12:00:00Z`;
    db.sqlite.prepare(`INSERT INTO t86_sync_runs(RunId,TradeDate,SyncTime,Source,QueryKey,Slot,RecordCount,Status,ValidationResult)
      VALUES(?,?,?,?,?,?,?,'Success','[]')`).run(id, date, time, "fixture", T86_QUERY, "backfill", count);
    db.sqlite.prepare("INSERT INTO t86_versions VALUES(?,?,?,?,?,?,?,?)").run(id, T86_QUERY, date, time, id, count, "[]", id);
    db.sqlite.prepare("INSERT INTO t86_heads VALUES(?,?,?,?)").run(T86_QUERY, date, id, time);
  }
  return { db, store };
}
