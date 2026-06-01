-- Migration: prompt_binding_and_allowlist_semantics
-- Version: 8
-- Created: 2026-05-05
-- PostgreSQL Conversion

-- Up migration

-- Recreate agent_configs table with nullable system_prompt and new prompt binding columns
-- This enables: null = inherit for system_prompt, routing_prompt, allowed_tool_ids, allowed_skill_ids
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
  system_prompt TEXT,
  routing_prompt TEXT,
  provider_id TEXT,
  model TEXT,
  allowed_tool_ids TEXT,
  allowed_skill_ids TEXT,
  routing_timeout_ms INTEGER NOT NULL DEFAULT 60000,
  repair_attempts INTEGER NOT NULL DEFAULT 1,
  prompt_type TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO agent_configs (
  agent_config_id, agent_id, scope, user_id, display_name, enabled,
  system_prompt, routing_prompt, provider_id, model,
  allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
  prompt_type, prompt_version,
  created_at, updated_at
)
SELECT
  agent_config_id, agent_id, scope, user_id, display_name, enabled,
  system_prompt, routing_prompt, provider_id, model,
  CASE WHEN allowed_tool_ids = '[]' THEN '["artifact_create","artifact_update","ask_user","status_query","memory_retrieve","transcript_search","plan_patch","docs_search"]' ELSE allowed_tool_ids END,
  CASE WHEN allowed_skill_ids = '[]' THEN '["artifact_create","artifact_update","ask_user","status_query","memory_retrieve","transcript_search","plan_patch","docs_search"]' ELSE allowed_skill_ids END,
  routing_timeout_ms, repair_attempts,
  NULL, NULL,
  created_at, updated_at
FROM agent_configs_old;

DROP TABLE agent_configs_old;

CREATE UNIQUE INDEX idx_agent_configs_unique ON agent_configs(agent_id, scope, user_id);
CREATE INDEX idx_agent_configs_agent ON agent_configs(agent_id);
CREATE INDEX idx_agent_configs_user ON agent_configs(user_id);
CREATE INDEX idx_agent_configs_scope ON agent_configs(scope);

-- Down migration

-- PostgreSQL supports DROP COLUMN, so we can properly roll back
ALTER TABLE agent_configs DROP COLUMN prompt_version;
ALTER TABLE agent_configs DROP COLUMN prompt_type;
