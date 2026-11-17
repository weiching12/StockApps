// Push text in D1 (migration 0014): the daily template and the announcements. Every query reads by
// primary key or the last row, so each costs a few rows at most.
const KEEP_ANNOUNCEMENTS = 50;

export class PushMessageRepository {
  constructor(db) { this.db = db; }

  template(key) {
    return this.db.prepare("SELECT Title title,Body body,UpdatedAt updatedAt,UpdatedBy updatedBy FROM push_templates WHERE Key=?")
      .bind(key).first();
  }

  saveTemplate(key, { title, body }, now, user) {
    return this.db.prepare(`INSERT INTO push_templates (Key,Title,Body,UpdatedAt,UpdatedBy) VALUES (?,?,?,?,?)
      ON CONFLICT(Key) DO UPDATE SET Title=excluded.Title,Body=excluded.Body,UpdatedAt=excluded.UpdatedAt,UpdatedBy=excluded.UpdatedBy`)
      .bind(key, title, body, now, user).run();
  }

  removeTemplate(key) {
    return this.db.prepare("DELETE FROM push_templates WHERE Key=?").bind(key).run();
  }

  /** Saves a new announcement and drops all but the latest few; returns the saved row. */
  async createAnnouncement({ title, body }, now, user) {
    const row = await this.db.prepare(`INSERT INTO push_announcements (Title,Body,CreatedAt,CreatedBy) VALUES (?,?,?,?)
      RETURNING Id id,Title title,Body body,CreatedAt createdAt,CreatedBy createdBy`).bind(title, body, now, user).first();
    await this.db.prepare("DELETE FROM push_announcements WHERE Id<=?").bind(row.id - KEEP_ANNOUNCEMENTS).run();
    return row;
  }

  latestAnnouncement() {
    return this.db.prepare(`SELECT Id id,Title title,Body body,CreatedAt createdAt,CreatedBy createdBy
      FROM push_announcements ORDER BY Id DESC LIMIT 1`).first();
  }
}
