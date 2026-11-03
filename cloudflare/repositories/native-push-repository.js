export class NativePushRepository {
  constructor(db) { this.db = db; }
  save({ token, environment }, secretHash, now) {
    return this.db.prepare(`INSERT INTO native_push_subscriptions
      (DeviceToken,Environment,SecretHash,CreatedAt,UpdatedAt) VALUES(?,?,?,?,?)
      ON CONFLICT(DeviceToken,Environment) DO UPDATE SET SecretHash=excluded.SecretHash,UpdatedAt=excluded.UpdatedAt`)
      .bind(token, environment, secretHash, now, now).run();
  }
  remove({ token, environment }, secretHash) {
    return this.db.prepare("DELETE FROM native_push_subscriptions WHERE DeviceToken=? AND Environment=? AND SecretHash=?")
      .bind(token, environment, secretHash).run();
  }
  async pending(asOf, environment, limit = 21) {
    const result = await this.db.prepare(`SELECT DeviceToken token,Environment environment,UpdatedAt updatedAt
      FROM native_push_subscriptions WHERE Environment=? AND (LastTradeDate IS NULL OR LastTradeDate<>?)
      ORDER BY UpdatedAt LIMIT ?`).bind(environment, asOf, limit).all();
    return result.results ?? [];
  }
  async status(asOf) {
    const row = await this.db.prepare(`SELECT COUNT(*) AS total, SUM(LastTradeDate=?) AS delivered
      FROM native_push_subscriptions`).bind(asOf).first();
    return { total: row?.total ?? 0, delivered: row?.delivered ?? 0 };
  }
  mark(row, asOf) {
    return this.db.prepare("UPDATE native_push_subscriptions SET LastTradeDate=? WHERE DeviceToken=? AND Environment=? AND UpdatedAt=?")
      .bind(asOf, row.token, row.environment, row.updatedAt).run();
  }
  retire(row) {
    return this.db.prepare("DELETE FROM native_push_subscriptions WHERE DeviceToken=? AND Environment=? AND UpdatedAt=?")
      .bind(row.token, row.environment, row.updatedAt).run();
  }
}
