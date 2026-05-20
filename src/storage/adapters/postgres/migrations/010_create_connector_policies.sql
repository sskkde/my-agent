-- Migration: create_connector_policies
-- Version: 10
-- Created: 2026-05-09
-- PostgreSQL Conversion

-- Up migration

-- Connector Policies table for access control policies on connectors
CREATE TABLE IF NOT EXISTS connector_policies (
  policy_id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  resource_pattern TEXT NOT NULL,
  action TEXT NOT NULL,
  effect TEXT NOT NULL CHECK(effect IN ('allow', 'deny')),
  allowed_scopes JSONB,
  risk_cap TEXT,
  audit_label TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- Index: by connector_id for policy lookups
CREATE INDEX IF NOT EXISTS idx_connector_policies_connector ON connector_policies(connector_id);

-- Index: by effect for filtering
CREATE INDEX IF NOT EXISTS idx_connector_policies_effect ON connector_policies(effect);

-- Down migration

DROP INDEX IF EXISTS idx_connector_policies_effect;
DROP INDEX IF EXISTS idx_connector_policies_connector;
DROP TABLE IF EXISTS connector_policies;
