PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '게스트',
  species TEXT NOT NULL DEFAULT 'rabbit',
  hood TEXT NOT NULL DEFAULT '#f39bc4',
  ranking_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS study_daily (
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  milliseconds INTEGER NOT NULL DEFAULT 0 CHECK(milliseconds >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(guest_id,day)
);
CREATE INDEX IF NOT EXISTS idx_study_daily_day_rank ON study_daily(day,milliseconds DESC,guest_id);
