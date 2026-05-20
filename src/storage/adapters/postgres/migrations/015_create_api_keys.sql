-- Migration: create_api_keys
-- Version: 15
-- Created: 2026-05-15
-- PostgreSQL Conversion

-- Up migration

-- API Keys table for programmatic access
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'user', 'service')),
  user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Index: by user_id for listing user's keys
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

-- Index: by key_hash for fast lookup during authentication
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Index: by is_active for filtering active keys
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

-- Down migration

DROP INDEX IF EXISTS idx_api_keys_active;
DROP INDEX IF EXISTS idx_api_keys_hash;
DROP INDEX IF EXISTS idx_api_keys_user;
DROP TABLE IF EXISTS api_keys;
