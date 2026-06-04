-- Migration: extend_provider_configs_runtime_metadata
-- File Number: 019 (local sequence for standalone PostgreSQL migrations)
-- Consolidated Version: 60 (corresponds to all-stores migration version)
-- Created: 2026-06-04
-- PostgreSQL Conversion
--
-- NOTE: This standalone migration file is numbered 019 in the local PostgreSQL
-- migration sequence. The "Version: 60" refers to the consolidated schema version
-- used in the all-stores migrations, which accumulate all changes up to v60.
-- New deployments using all-stores migrations already have these columns.

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
