-- Migration: extend_provider_configs_runtime_metadata
-- Version: 60
-- Created: 2026-06-04
-- PostgreSQL Conversion

-- Up migration

ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS family TEXT DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS protocol TEXT DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS headers_json TEXT DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS capabilities_json TEXT DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS models_json TEXT DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS default_model TEXT DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS options_json TEXT DEFAULT NULL;

-- Down migration

ALTER TABLE provider_configs DROP COLUMN IF EXISTS options_json;
ALTER TABLE provider_configs DROP COLUMN IF EXISTS default_model;
ALTER TABLE provider_configs DROP COLUMN IF EXISTS models_json;
ALTER TABLE provider_configs DROP COLUMN IF EXISTS capabilities_json;
ALTER TABLE provider_configs DROP COLUMN IF EXISTS headers_json;
ALTER TABLE provider_configs DROP COLUMN IF EXISTS priority;
ALTER TABLE provider_configs DROP COLUMN IF EXISTS protocol;
ALTER TABLE provider_configs DROP COLUMN IF EXISTS family;
