-- PostgreSQL 14+; all durations are integer milliseconds. Timezone grouping happens in the application (Asia/Seoul).
BEGIN;
CREATE TABLE IF NOT EXISTS guests (
  id CHAR(32) PRIMARY KEY,
  nickname VARCHAR(15) NOT NULL DEFAULT '게스트',
  species VARCHAR(16) NOT NULL DEFAULT 'rabbit',
  hood VARCHAR(7) NOT NULL DEFAULT '#f39bc4',
  ranking_public BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS study_daily (
  guest_id CHAR(32) NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  milliseconds BIGINT NOT NULL DEFAULT 0 CHECK (milliseconds >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guest_id, day)
);
CREATE INDEX IF NOT EXISTS idx_study_daily_day_rank ON study_daily(day, milliseconds DESC, guest_id);
COMMIT;
