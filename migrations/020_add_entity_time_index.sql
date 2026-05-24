-- Migration: add_entity_time_index
-- Version: 55
-- Created: 2026-05-24
-- Purpose: Entity/time indexing for long-term memories

ALTER TABLE long_term_memories ADD COLUMN entity_names TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_ltm_entity_names
  ON long_term_memories(entity_names);

CREATE INDEX IF NOT EXISTS idx_ltm_created_at
  ON long_term_memories(json_extract(lifecycle, '$.createdAt'));

-- Down migration
-- SQLite doesn't support DROP COLUMN; columns remain on rollback
-- DROP INDEX IF EXISTS idx_ltm_entity_names;
-- DROP INDEX IF EXISTS idx_ltm_created_at;
