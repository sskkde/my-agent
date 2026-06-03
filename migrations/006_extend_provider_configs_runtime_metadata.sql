-- Migration: extend_provider_configs_runtime_metadata
-- Version: 60
-- Created: 2026-06-04

-- Up migration

-- Add runtime metadata columns to provider_configs table
ALTER TABLE provider_configs ADD COLUMN family TEXT DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN protocol TEXT DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN priority INTEGER DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN headers_json TEXT DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN capabilities_json TEXT DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN models_json TEXT DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN default_model TEXT DEFAULT NULL;
ALTER TABLE provider_configs ADD COLUMN options_json TEXT DEFAULT NULL;

-- Down migration
-- SQLite does not support DROP COLUMN in older versions
-- Schema is preserved for re-creation if needed
