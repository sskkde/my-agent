-- Migration: create_provider_configs
-- Version: 6
-- Created: 2026-04-29

-- Up migration

-- Provider configs table for storing LLM provider configurations with encrypted API keys
CREATE TABLE provider_configs (
  provider_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK(provider_type IN ('openai','openrouter','ollama','custom')),
  display_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  base_url TEXT,
  selected_model TEXT,
  encrypted_api_key TEXT,
  api_key_last4 TEXT,
  source TEXT NOT NULL DEFAULT 'database',
  last_test_status TEXT,
  last_tested_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Index: by user_id for listing user's providers
CREATE INDEX idx_provider_configs_user ON provider_configs(user_id);

-- Down migration

DROP INDEX IF EXISTS idx_provider_configs_user;
DROP TABLE IF EXISTS provider_configs;
