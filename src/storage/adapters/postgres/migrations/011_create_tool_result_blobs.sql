-- Migration: create_tool_result_blobs
-- Version: 11
-- Created: 2026-05-09
-- PostgreSQL Conversion

-- Up migration

-- Tool Result Blobs table for storing large tool execution results
CREATE TABLE IF NOT EXISTS tool_result_blobs (
  blob_id TEXT PRIMARY KEY,
  tool_call_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT,
  content_type TEXT NOT NULL,
  preview JSONB,
  storage_ref TEXT NOT NULL,
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK(sensitivity IN ('normal', 'sensitive', 'confidential')),
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- Index: by tool_call_id for blob lookups
CREATE INDEX IF NOT EXISTS idx_tool_result_blobs_tool_call ON tool_result_blobs(tool_call_id);

-- Index: by user_id for user-level queries
CREATE INDEX IF NOT EXISTS idx_tool_result_blobs_user ON tool_result_blobs(user_id);

-- Index: by session_id for session-level queries
CREATE INDEX IF NOT EXISTS idx_tool_result_blobs_session ON tool_result_blobs(session_id);

-- Down migration

DROP INDEX IF EXISTS idx_tool_result_blobs_session;
DROP INDEX IF EXISTS idx_tool_result_blobs_user;
DROP INDEX IF EXISTS idx_tool_result_blobs_tool_call;
DROP TABLE IF EXISTS tool_result_blobs;
