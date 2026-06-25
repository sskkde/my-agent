-- Migration: create_workdir_tables
-- Version: 22
-- Created: 2026-06-24

-- Up migration

CREATE TABLE work_directories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'org_default',
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  metadata TEXT
);

CREATE INDEX idx_work_directories_user ON work_directories(tenant_id, user_id);
CREATE INDEX idx_work_directories_deleted ON work_directories(tenant_id, user_id, deleted_at);

CREATE TABLE session_workdir_state (
  tenant_id TEXT NOT NULL DEFAULT 'org_default',
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  active_work_dir_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, session_id),
  FOREIGN KEY (active_work_dir_id) REFERENCES work_directories(id)
);

CREATE INDEX idx_session_workdir_state_session ON session_workdir_state(tenant_id, user_id, session_id);

-- Down migration

DROP INDEX IF EXISTS idx_session_workdir_state_session;
DROP TABLE IF EXISTS session_workdir_state;
DROP INDEX IF EXISTS idx_work_directories_deleted;
DROP INDEX IF EXISTS idx_work_directories_user;
DROP TABLE IF EXISTS work_directories;
