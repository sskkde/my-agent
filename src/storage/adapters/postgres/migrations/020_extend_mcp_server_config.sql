-- Migration: extend_mcp_server_config
-- Version: 20
-- Created: 2026-06-26
-- PostgreSQL Conversion

-- Up migration

-- Add streamable_http to config_type CHECK constraint
ALTER TABLE mcp_servers DROP CONSTRAINT IF EXISTS mcp_servers_config_type_check;
ALTER TABLE mcp_servers ADD CONSTRAINT mcp_servers_config_type_check
  CHECK(config_type IN ('stdio', 'http', 'streamable_http'));

-- Add authentication_json column for secret-safe auth config persistence
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS authentication_json JSONB;

-- Down migration

ALTER TABLE mcp_servers DROP COLUMN IF EXISTS authentication_json;
ALTER TABLE mcp_servers DROP CONSTRAINT IF EXISTS mcp_servers_config_type_check;
ALTER TABLE mcp_servers ADD CONSTRAINT mcp_servers_config_type_check
  CHECK(config_type IN ('stdio', 'http'));
