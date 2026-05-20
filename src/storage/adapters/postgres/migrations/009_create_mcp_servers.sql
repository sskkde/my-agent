-- Migration: create_mcp_servers
-- Version: 9
-- Created: 2026-05-09
-- PostgreSQL Conversion

-- Up migration

-- MCP Servers table for Model Context Protocol server metadata
CREATE TABLE IF NOT EXISTS mcp_servers (
  server_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  base_url TEXT NOT NULL,
  config_type TEXT NOT NULL CHECK(config_type IN ('stdio', 'http')),
  command TEXT,
  args JSONB,
  trust_level TEXT NOT NULL DEFAULT 'untrusted' CHECK(trust_level IN ('trusted', 'verified', 'untrusted')),
  sandbox_policy JSONB,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active', 'inactive', 'error')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- MCP Sessions table for active sessions with MCP servers
CREATE TABLE IF NOT EXISTS mcp_sessions (
  session_id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  connector_instance_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('connecting', 'connected', 'disconnected', 'error')),
  auth_token_ref TEXT,
  metadata JSONB,
  last_error TEXT,
  last_health_check TEXT,
  connected_at TEXT,
  last_activity_at TEXT,
  disconnected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Index: by server_id for session lookups
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_server ON mcp_sessions(server_id);

-- Index: by status for filtering
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_status ON mcp_sessions(status);

-- Index: by server status for filtering
CREATE INDEX IF NOT EXISTS idx_mcp_servers_status ON mcp_servers(status);

-- Down migration

DROP INDEX IF EXISTS idx_mcp_servers_status;
DROP INDEX IF EXISTS idx_mcp_sessions_status;
DROP INDEX IF EXISTS idx_mcp_sessions_server;
DROP TABLE IF EXISTS mcp_sessions;
DROP TABLE IF EXISTS mcp_servers;
