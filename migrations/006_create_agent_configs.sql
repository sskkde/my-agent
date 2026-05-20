-- Migration: create_agent_configs
-- Version: 7
-- Created: 2026-05-03

-- Up migration

-- Agent configs table for storing agent configuration with global defaults and user overrides
CREATE TABLE agent_configs (
  agent_config_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('global', 'user')),
  user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  system_prompt TEXT NOT NULL,
  routing_prompt TEXT,
  provider_id TEXT,
  model TEXT,
  allowed_tool_ids TEXT NOT NULL DEFAULT '[]',
  allowed_skill_ids TEXT NOT NULL DEFAULT '[]',
  routing_timeout_ms INTEGER NOT NULL DEFAULT 60000,
  repair_attempts INTEGER NOT NULL DEFAULT 1,
  tenant_id TEXT NOT NULL DEFAULT 'org_default',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Unique index: ensure only one config per (agent_id, scope, user_id) combination
CREATE UNIQUE INDEX idx_agent_configs_unique ON agent_configs(agent_id, scope, user_id);

-- Index: by agent_id for lookups
CREATE INDEX idx_agent_configs_agent ON agent_configs(agent_id);

-- Index: by user_id for user-specific lookups
CREATE INDEX idx_agent_configs_user ON agent_configs(user_id);

-- Index: by scope for global/user filtering
CREATE INDEX idx_agent_configs_scope ON agent_configs(scope);

-- Seed a global default for foreground.default if absent
INSERT INTO agent_configs (
  agent_config_id, agent_id, scope, user_id, display_name, enabled,
  system_prompt, routing_prompt, provider_id, model,
  allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
  tenant_id, created_at, updated_at
) VALUES (
  'agent-global-foreground-default',
  'foreground.default',
  'global',
  '',
  'Foreground Agent',
  1,
  'You are the foreground agent. You handle user-facing interactions and coordinate with the planner and subagents as needed.',
  NULL,
  NULL,
  NULL,
  '[]',
  '[]',
  60000,
  1,
  'org_default',
  datetime('now'),
  datetime('now')
) ON CONFLICT DO NOTHING;

-- Down migration

DROP INDEX IF EXISTS idx_agent_configs_unique;
DROP INDEX IF EXISTS idx_agent_configs_scope;
DROP INDEX IF EXISTS idx_agent_configs_user;
DROP INDEX IF EXISTS idx_agent_configs_agent;
DROP TABLE IF EXISTS agent_configs;
