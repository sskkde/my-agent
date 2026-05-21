-- Migration: create_recovery_checkpoints
-- Version: 13
-- Created: 2026-05-09
-- PostgreSQL Conversion

-- Up migration

-- Recovery Checkpoints table for storing recovery state for runs
CREATE TABLE IF NOT EXISTS recovery_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL CHECK(run_type IN ('planner', 'kernel', 'background', 'workflow')),
  run_id TEXT NOT NULL,
  checkpoint_data JSONB NOT NULL,
  event_range_start TEXT,
  event_range_end TEXT,
  created_at TEXT NOT NULL
);

-- Index: by run_type for filtering
CREATE INDEX IF NOT EXISTS idx_recovery_checkpoints_run_type ON recovery_checkpoints(run_type);

-- Index: by run_id for checkpoint lookups
CREATE INDEX IF NOT EXISTS idx_recovery_checkpoints_run_id ON recovery_checkpoints(run_id);

-- Down migration

DROP INDEX IF EXISTS idx_recovery_checkpoints_run_id;
DROP INDEX IF EXISTS idx_recovery_checkpoints_run_type;
DROP TABLE IF EXISTS recovery_checkpoints;
