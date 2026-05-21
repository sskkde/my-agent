-- Migration: add_custom_provider_type
-- Version: 5
-- Created: 2026-04-29

-- Up migration

CREATE TABLE provider_configs_new (
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
  tenant_id TEXT NOT NULL DEFAULT 'org_default',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO provider_configs_new (
  provider_id, user_id, provider_type, display_name, enabled,
  base_url, selected_model, encrypted_api_key, api_key_last4,
  source, last_test_status, last_tested_at, tenant_id, created_at, updated_at
) SELECT
  provider_id, user_id, provider_type, display_name, enabled,
  base_url, selected_model, encrypted_api_key, api_key_last4,
  source, last_test_status, last_tested_at, tenant_id, created_at, updated_at
FROM provider_configs;

DROP INDEX IF EXISTS idx_provider_configs_user;
DROP TABLE provider_configs;
ALTER TABLE provider_configs_new RENAME TO provider_configs;
CREATE INDEX idx_provider_configs_user ON provider_configs(user_id);

-- Down migration

CREATE TABLE provider_configs_old (
  provider_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK(provider_type IN ('openai','openrouter','ollama')),
  display_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  base_url TEXT,
  selected_model TEXT,
  encrypted_api_key TEXT,
  api_key_last4 TEXT,
  source TEXT NOT NULL DEFAULT 'database',
  last_test_status TEXT,
  last_tested_at TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'org_default',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO provider_configs_old (
  provider_id, user_id, provider_type, display_name, enabled,
  base_url, selected_model, encrypted_api_key, api_key_last4,
  source, last_test_status, last_tested_at, tenant_id, created_at, updated_at
) SELECT
  provider_id, user_id, provider_type, display_name, enabled,
  base_url, selected_model, encrypted_api_key, api_key_last4,
  source, last_test_status, last_tested_at, tenant_id, created_at, updated_at
FROM provider_configs
WHERE provider_type IN ('openai','openrouter','ollama');

DROP INDEX IF EXISTS idx_provider_configs_user;
DROP TABLE provider_configs;
ALTER TABLE provider_configs_old RENAME TO provider_configs;
CREATE INDEX idx_provider_configs_user ON provider_configs(user_id);
