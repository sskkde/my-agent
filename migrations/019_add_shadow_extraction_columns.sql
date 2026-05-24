-- Migration: add_shadow_extraction_columns
-- Version: 54
-- Created: 2026-05-24
-- Purpose: Shadow extraction — 同时记录新旧 prompt 的 extraction 结果

ALTER TABLE memory_extraction_runs ADD COLUMN policy_version TEXT DEFAULT NULL;
ALTER TABLE memory_extraction_runs ADD COLUMN variant TEXT DEFAULT NULL;
ALTER TABLE memory_extraction_runs ADD COLUMN shadow_comparison_payload TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_extraction_runs_variant
  ON memory_extraction_runs(user_id, variant) WHERE variant IS NOT NULL;

-- Down migration
-- SQLite doesn't support DROP COLUMN; columns remain on rollback
