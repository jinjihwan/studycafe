-- v5 additions: non-destructive; existing guests/study_daily remain unchanged.
-- SQLite: all identifiers retained as guest/internal user IDs.
CREATE TABLE IF NOT EXISTS accounts (
 user_id TEXT PRIMARY KEY REFERENCES guests(id),
 firebase_uid TEXT UNIQUE NOT NULL,
 friend_code TEXT UNIQUE NOT NULL,
 activity_public INTEGER NOT NULL DEFAULT 1,
 join_allowed INTEGER NOT NULL DEFAULT 1,
 friend_ranking_public INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS guest_consumed (
 guest_id TEXT PRIMARY KEY REFERENCES guests(id),
 account_id TEXT NOT NULL REFERENCES guests(id),
 merged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS app_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES guests(id),
 csrf_hash TEXT NOT NULL, csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS app_session_user_idx ON app_sessions(user_id);
CREATE TABLE IF NOT EXISTS friend_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender TEXT NOT NULL REFERENCES guests(id), target TEXT NOT NULL REFERENCES guests(id),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','rejected','cancelled')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS friend_requests_target_idx ON friend_requests(target,state);
CREATE INDEX IF NOT EXISTS friend_requests_sender_idx ON friend_requests(sender,state);
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair_idx ON friend_requests(min(sender,target),max(sender,target)) WHERE state='pending';
CREATE TABLE IF NOT EXISTS friends (
 a TEXT NOT NULL REFERENCES guests(id),b TEXT NOT NULL REFERENCES guests(id),
 created_at INTEGER NOT NULL,PRIMARY KEY(a,b), CHECK(a<b)
);
CREATE TABLE IF NOT EXISTS blocks (
 blocker TEXT NOT NULL REFERENCES guests(id),blocked TEXT NOT NULL REFERENCES guests(id),
 created_at INTEGER NOT NULL,PRIMARY KEY(blocker,blocked),CHECK(blocker<>blocked)
);
CREATE TABLE IF NOT EXISTS room_policies (
 room_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES guests(id),is_private INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS room_access (
 room_id TEXT NOT NULL REFERENCES room_policies(room_id),user_id TEXT NOT NULL REFERENCES guests(id),
 granted_at INTEGER NOT NULL,PRIMARY KEY(room_id,user_id)
);
