-- Migration: agent_type_profile_split
-- Version: 63
-- Created: 2026-06-19
-- Purpose: Split agent_type into closed AgentType + agent_profile label

-- Up migration

ALTER TABLE subagent_runs ADD COLUMN agent_profile TEXT;
UPDATE subagent_runs SET agent_profile = agent_type;
UPDATE subagent_runs SET agent_type = 'subagent';
CREATE INDEX IF NOT EXISTS idx_subagent_runs_agent_profile ON subagent_runs(agent_profile);

ALTER TABLE background_runs ADD COLUMN agent_profile TEXT;
UPDATE background_runs SET agent_profile = agent_type;
UPDATE background_runs SET agent_type = 'background';
CREATE INDEX IF NOT EXISTS idx_background_runs_agent_profile ON background_runs(agent_profile);

ALTER TABLE subagent_provider_preferences ADD COLUMN agent_profile TEXT;
UPDATE subagent_provider_preferences SET agent_profile = agent_type;
UPDATE subagent_provider_preferences SET agent_type = 'subagent';
CREATE INDEX IF NOT EXISTS idx_subagent_provider_prefs_agent_profile ON subagent_provider_preferences(agent_profile);

-- Down migration
-- SQLite doesn't support DROP COLUMN; columns remain on rollback
-- The agent_type values cannot be restored without knowing the original profile
