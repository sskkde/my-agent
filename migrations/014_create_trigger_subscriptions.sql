-- Migration: create_trigger_subscriptions
-- Version: 14
-- Created: 2026-05-09

-- Up migration

-- Trigger Subscriptions table for event-driven trigger subscriptions
CREATE TABLE IF NOT EXISTS trigger_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL DEFAULT '',
  trigger_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  conditions TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'disabled')),
  tenant_id TEXT NOT NULL DEFAULT 'org_default',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Index: by trigger_type for filtering
CREATE INDEX IF NOT EXISTS idx_trigger_subscriptions_trigger_type ON trigger_subscriptions(trigger_type);

-- Index: by source_type for filtering
CREATE INDEX IF NOT EXISTS idx_trigger_subscriptions_source_type ON trigger_subscriptions(source_type);

-- Index: by status for filtering
CREATE INDEX IF NOT EXISTS idx_trigger_subscriptions_status ON trigger_subscriptions(status);

-- Down migration

DROP INDEX IF EXISTS idx_trigger_subscriptions_status;
DROP INDEX IF EXISTS idx_trigger_subscriptions_source_type;
DROP INDEX IF EXISTS idx_trigger_subscriptions_trigger_type;
DROP TABLE IF EXISTS trigger_subscriptions;
