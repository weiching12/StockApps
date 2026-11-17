-- Administrator-edited push text. Key 'daily' is the daily update's template; {日期} becomes the trade
-- date when it is sent. No row means the built-in default.
CREATE TABLE IF NOT EXISTS push_templates (
  Key TEXT PRIMARY KEY,
  Title TEXT NOT NULL,
  Body TEXT NOT NULL,
  UpdatedAt TEXT NOT NULL,
  UpdatedBy TEXT NOT NULL
);
-- Announcements an administrator sends to every subscribed device, apart from the daily update.
-- Only the latest 50 are kept (older ones are deleted when a new one is created).
CREATE TABLE IF NOT EXISTS push_announcements (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  Title TEXT NOT NULL,
  Body TEXT NOT NULL,
  CreatedAt TEXT NOT NULL,
  CreatedBy TEXT NOT NULL
);
-- The latest announcement each subscription has received (0 = none), so a send resumes where it stopped.
ALTER TABLE push_subscriptions ADD COLUMN AnnouncementId INTEGER NOT NULL DEFAULT 0;
ALTER TABLE native_push_subscriptions ADD COLUMN AnnouncementId INTEGER NOT NULL DEFAULT 0;
