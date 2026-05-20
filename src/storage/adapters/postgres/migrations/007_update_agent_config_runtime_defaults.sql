-- Migration: update_agent_config_runtime_defaults
-- Version: 7
-- Created: 2026-05-04
-- PostgreSQL Conversion

-- Up migration

ALTER TABLE agent_configs RENAME TO agent_configs_old;
DROP INDEX IF EXISTS idx_agent_configs_unique;
DROP INDEX IF EXISTS idx_agent_configs_agent;
DROP INDEX IF EXISTS idx_agent_configs_user;
DROP INDEX IF EXISTS idx_agent_configs_scope;

CREATE TABLE agent_configs (
  agent_config_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('global', 'user')),
  user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  system_prompt TEXT NOT NULL,
  routing_prompt TEXT,
  provider_id TEXT,
  model TEXT,
  allowed_tool_ids TEXT NOT NULL DEFAULT '[]',
  allowed_skill_ids TEXT NOT NULL DEFAULT '[]',
  routing_timeout_ms INTEGER NOT NULL DEFAULT 60000,
  repair_attempts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO agent_configs (
  agent_config_id, agent_id, scope, user_id, display_name, enabled,
  system_prompt, routing_prompt, provider_id, model,
  allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
  created_at, updated_at
)
SELECT
  agent_config_id, agent_id, scope, user_id, display_name, enabled,
  system_prompt, routing_prompt, provider_id, model,
  allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
  created_at, updated_at
FROM agent_configs_old;

UPDATE agent_configs
SET routing_timeout_ms = 60000,
    repair_attempts = 1,
    updated_at = NOW()
WHERE agent_config_id = 'agent-global-foreground-default'
  AND agent_id = 'foreground.default'
  AND scope = 'global'
  AND user_id = ''
  AND display_name = 'Foreground Agent'
  AND enabled = TRUE
  AND system_prompt = 'You are the foreground agent. You handle user-facing interactions and coordinate with the planner and subagents as needed.'
  AND routing_prompt IS NULL
  AND provider_id IS NULL
  AND model IS NULL
  AND allowed_tool_ids = '[]'
  AND allowed_skill_ids = '[]'
  AND routing_timeout_ms = 10000
  AND repair_attempts = 1;

DROP TABLE agent_configs_old;

CREATE UNIQUE INDEX idx_agent_configs_unique ON agent_configs(agent_id, scope, user_id);
CREATE INDEX idx_agent_configs_agent ON agent_configs(agent_id);
CREATE INDEX idx_agent_configs_user ON agent_configs(user_id);
CREATE INDEX idx_agent_configs_scope ON agent_configs(scope);

-- Down migration

DROP INDEX IF EXISTS idx_agent_configs_unique;
DROP INDEX IF EXISTS idx_agent_configs_agent;
DROP INDEX IF EXISTS idx_agent_configs_user;
DROP INDEX IF EXISTS idx_agent_configs_scope;
ALTER TABLE agent_configs RENAME TO agent_configs_new;

CREATE TABLE agent_configs (
  agent_config_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('global', 'user')),
  user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  system_prompt TEXT NOT NULL,
  routing_prompt TEXT,
  provider_id TEXT,
  model TEXT,
  allowed_tool_ids TEXT NOT NULL DEFAULT '[]',
  allowed_skill_ids TEXT NOT NULL DEFAULT '[]',
  routing_timeout_ms INTEGER NOT NULL DEFAULT 10000,
  repair_attempts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO agent_configs (
  agent_config_id, agent_id, scope, user_id, display_name, enabled,
  system_prompt, routing_prompt, provider_id, model,
  allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
  created_at, updated_at
)
SELECT
  agent_config_id, agent_id, scope, user_id, display_name, enabled,
  system_prompt, routing_prompt, provider_id, model,
  allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
  created_at, updated_at
FROM agent_configs_new;

DROP TABLE agent_configs_new;

CREATE UNIQUE INDEX idx_agent_configs_unique ON agent_configs(agent_id, scope, user_id);
CREATE INDEX idx_agent_configs_agent ON agent_configs(agent_id);
CREATE INDEX idx_agent_configs_user ON agent_configs(user_id);
CREATE INDEX idx_agent_configs_scope ON agent_configs(scope);
