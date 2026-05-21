-- Migration: create_retention_config
-- Version: 12
-- Created: 2026-05-09
-- PostgreSQL Conversion

-- Up migration

-- Retention Config table for entity retention policies
CREATE TABLE IF NOT EXISTS retention_config (
  config_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  ttl_days INTEGER NOT NULL,
  policy TEXT NOT NULL DEFAULT 'soft_delete' CHECK(policy IN ('soft_delete', 'archive', 'hard_delete')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Index: by entity_type for config lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_retention_config_entity ON retention_config(entity_type);

-- Memory Lifecycle table for tracking memory lifecycle states
CREATE TABLE IF NOT EXISTS memory_lifecycle (
  memory_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL CHECK(lifecycle_status IN ('active', 'compressed', 'archived', 'deleted')),
  compressed_at TEXT,
  archived_at TEXT,
  deleted_at TEXT,
  tombstone_data JSONB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Index: by user_id for user-level queries
CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_user ON memory_lifecycle(user_id);

-- Index: by lifecycle_status for filtering
CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_status ON memory_lifecycle(lifecycle_status);

-- Audit Retention table for audit-specific TTL configuration
CREATE TABLE IF NOT EXISTS audit_retention (
  config_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  ttl_days INTEGER NOT NULL,
  policy TEXT NOT NULL DEFAULT 'archive' CHECK(policy IN ('soft_delete', 'archive', 'hard_delete')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Index: by entity_type for config lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_retention_entity ON audit_retention(entity_type);

-- Down migration

DROP INDEX IF EXISTS idx_audit_retention_entity;
DROP TABLE IF EXISTS audit_retention;
DROP INDEX IF EXISTS idx_memory_lifecycle_status;
DROP INDEX IF EXISTS idx_memory_lifecycle_user;
DROP TABLE IF EXISTS memory_lifecycle;
DROP INDEX IF EXISTS idx_retention_config_entity;
DROP TABLE IF EXISTS retention_config;
