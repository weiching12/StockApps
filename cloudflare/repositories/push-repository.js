export class PushRepository {
  constructor(db) { this.db = db; }

  async save(subscription, now) {
    await this.db.prepare(`INSERT INTO push_subscriptions (Endpoint,P256dh,Auth,CreatedAt,UpdatedAt)
      VALUES (?,?,?,?,?) ON CONFLICT(Endpoint) DO UPDATE SET P256dh=excluded.P256dh,Auth=excluded.Auth,UpdatedAt=excluded.UpdatedAt`)
      .bind(subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now, now).run();
  }

  async remove(endpoint) {
    await this.db.prepare("DELETE FROM push_subscriptions WHERE Endpoint=?").bind(endpoint).run();
  }

  // A subscription the push service refused today is not retried until the next trade date.
  async pending(tradeDate, limit = 500) {
    const result = await this.db.prepare(`SELECT Endpoint endpoint,P256dh p256dh,Auth auth
      FROM push_subscriptions WHERE (LastTradeDate IS NULL OR LastTradeDate<>?)
      AND (FailedTradeDate IS NULL OR FailedTradeDate<>?) ORDER BY UpdatedAt LIMIT ?`)
      .bind(tradeDate, tradeDate, limit).all();
    return result.results ?? [];
  }

  async mark(endpoint, tradeDate) {
    await this.db.prepare(`UPDATE push_subscriptions SET LastTradeDate=?,FailureDays=0,FailedTradeDate=NULL,LastFailure=NULL
      WHERE Endpoint=?`).bind(tradeDate, endpoint).run();
  }

  /** Count one rejection per trade date; delete once it reaches maxDays. Returns the day count, or 0 if removed. */
  async recordRejection(endpoint, tradeDate, failure, maxDays) {
    const row = await this.db.prepare(`UPDATE push_subscriptions
      SET FailureDays=CASE WHEN FailedTradeDate=? THEN FailureDays ELSE FailureDays+1 END,FailedTradeDate=?,LastFailure=?
      WHERE Endpoint=? RETURNING FailureDays failureDays`).bind(tradeDate, tradeDate, failure, endpoint).first();
    if (!row) return 0;
    if (row.failureDays < maxDays) return row.failureDays;
    await this.remove(endpoint);
    return 0;
  }

  /** Per push service counts for one trade date; endpoints never leave the database. */
  async status(tradeDate) {
    const result = await this.db.prepare(`SELECT CASE
        WHEN Endpoint LIKE 'https://web.push.apple.com/%' THEN 'apple'
        WHEN Endpoint LIKE 'https://fcm.googleapis.com/%' OR Endpoint LIKE 'https://android.googleapis.com/%' THEN 'google'
        WHEN Endpoint LIKE '%.notify.windows.com/%' THEN 'microsoft'
        WHEN Endpoint LIKE '%push.services.mozilla.com/%' THEN 'mozilla' ELSE 'other' END AS service,
      COUNT(*) AS total, SUM(LastTradeDate=?) AS delivered, SUM(FailedTradeDate=?) AS rejected,
      MAX(CASE WHEN FailedTradeDate=? THEN LastFailure END) AS lastFailure
      FROM push_subscriptions GROUP BY service ORDER BY service`).bind(tradeDate, tradeDate, tradeDate).all();
    return (result.results ?? []).map((row) => ({ service: row.service, total: row.total, delivered: row.delivered ?? 0,
      rejected: row.rejected ?? 0, pending: row.total - (row.delivered ?? 0) - (row.rejected ?? 0), lastFailure: row.lastFailure ?? null }));
  }

  async removeMany(endpoints) {
    if (!endpoints.length) return;
    await this.db.batch(endpoints.map((endpoint) => this.db.prepare("DELETE FROM push_subscriptions WHERE Endpoint=?").bind(endpoint)));
  }
}
