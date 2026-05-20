-- Migration: add_tenant_id
-- Version: 18
-- Created: 2026-05-21

-- Up migration
-- Add tenant_id column to all tables created by SQL migration files (001-017)

ALTER TABLE transcripts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_transcripts_tenant ON transcripts(tenant_id);

ALTER TABLE sessions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions(tenant_id);

ALTER TABLE users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

ALTER TABLE auth_tokens ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_auth_tokens_tenant ON auth_tokens(tenant_id);

ALTER TABLE provider_configs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_provider_configs_tenant ON provider_configs(tenant_id);

ALTER TABLE agent_configs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_agent_configs_tenant ON agent_configs(tenant_id);

ALTER TABLE mcp_servers ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_mcp_servers_tenant ON mcp_servers(tenant_id);

ALTER TABLE mcp_sessions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_tenant ON mcp_sessions(tenant_id);

ALTER TABLE connector_policies ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_connector_policies_tenant ON connector_policies(tenant_id);

ALTER TABLE tool_result_blobs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_tool_result_blobs_tenant ON tool_result_blobs(tenant_id);

ALTER TABLE retention_config ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_retention_config_tenant ON retention_config(tenant_id);

ALTER TABLE memory_lifecycle ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_tenant ON memory_lifecycle(tenant_id);

ALTER TABLE audit_retention ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_audit_retention_tenant ON audit_retention(tenant_id);

ALTER TABLE recovery_checkpoints ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_recovery_checkpoints_tenant ON recovery_checkpoints(tenant_id);

ALTER TABLE trigger_subscriptions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_trigger_subscriptions_tenant ON trigger_subscriptions(tenant_id);

ALTER TABLE api_keys ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);

ALTER TABLE organizations ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_organizations_tenant ON organizations(tenant_id);

ALTER TABLE user_organizations ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
CREATE INDEX IF NOT EXISTS idx_user_organizations_tenant ON user_organizations(tenant_id);

-- Down migration
-- SQLite doesn't support DROP COLUMN reliably; columns remain on rollback
