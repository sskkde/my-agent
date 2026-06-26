-- Migration: extend_mcp_server_config
-- Version: 23
-- Created: 2026-06-26

-- Up migration

-- SQLite does not support ALTER CHECK constraints, so we recreate the table.
-- 1. Create temp table with updated schema (streamable_http + authentication_json)
CREATE TABLE mcp_servers_new (
  server_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  base_url TEXT NOT NULL,
  config_type TEXT NOT NULL CHECK(config_type IN ('stdio', 'http', 'streamable_http')),
  command TEXT,
  args TEXT,
  authentication_json TEXT,
  trust_level TEXT NOT NULL DEFAULT 'untrusted' CHECK(trust_level IN ('trusted', 'verified', 'untrusted')),
  sandbox_policy TEXT,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active', 'inactive', 'error')),
  tenant_id TEXT NOT NULL DEFAULT 'org_default',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. Copy existing data (authentication_json defaults to NULL)
INSERT INTO mcp_servers_new (
  server_id, name, version, description, base_url, config_type,
  command, args, trust_level, sandbox_policy, status,
  tenant_id, created_at, updated_at
)
SELECT
  server_id, name, version, description, base_url, config_type,
  command, args, trust_level, sandbox_policy, status,
  tenant_id, created_at, updated_at
FROM mcp_servers;

-- 3. Drop old table and indexes
DROP INDEX IF EXISTS idx_mcp_servers_status;
DROP TABLE IF EXISTS mcp_servers;

-- 4. Rename new table
ALTER TABLE mcp_servers_new RENAME TO mcp_servers;

-- 5. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_mcp_servers_status ON mcp_servers(status);

-- Down migration

CREATE TABLE mcp_servers_old (
  server_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  base_url TEXT NOT NULL,
  config_type TEXT NOT NULL CHECK(config_type IN ('stdio', 'http')),
  command TEXT,
  args TEXT,
  trust_level TEXT NOT NULL DEFAULT 'untrusted' CHECK(trust_level IN ('trusted', 'verified', 'untrusted')),
  sandbox_policy TEXT,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active', 'inactive', 'error')),
  tenant_id TEXT NOT NULL DEFAULT 'org_default',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO mcp_servers_old (
  server_id, name, version, description, base_url, config_type,
  command, args, trust_level, sandbox_policy, status,
  tenant_id, created_at, updated_at
)
SELECT
  server_id, name, version, description, base_url, config_type,
  command, args, trust_level, sandbox_policy, status,
  tenant_id, created_at, updated_at
FROM mcp_servers WHERE config_type IN ('stdio', 'http');

DROP INDEX IF EXISTS idx_mcp_servers_status;
DROP TABLE IF EXISTS mcp_servers;
ALTER TABLE mcp_servers_old RENAME TO mcp_servers;
CREATE INDEX IF NOT EXISTS idx_mcp_servers_status ON mcp_servers(status);
