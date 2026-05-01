-- Migration: create_sessions_table
-- Version: 2
-- Created: 2026-04-29

-- Up migration

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'archived', 'closed')),
  message_count INTEGER NOT NULL DEFAULT 0,
  last_activity_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata TEXT
);

CREATE INDEX idx_sessions_user_activity ON sessions(user_id, last_activity_at);
CREATE INDEX idx_sessions_status ON sessions(status);

-- Down migration

DROP INDEX IF EXISTS idx_sessions_user_activity;
DROP INDEX IF EXISTS idx_sessions_status;
DROP TABLE IF EXISTS sessions;
