-- Migration: create_transcripts_table
-- Version: 1
-- Created: 2026-04-26
-- PostgreSQL Conversion

-- Up migration

-- Main transcripts table
CREATE TABLE transcripts (
  turnId TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  userId TEXT NOT NULL,

  -- Input data (stored as JSON)
  inboundEventId TEXT,
  userMessageSummary TEXT,
  contentRefs TEXT,

  -- Output data (stored as JSON)
  visibleMessages TEXT NOT NULL,
  artifactRefs TEXT,

  -- Runtime summary (stored as JSON)
  foregroundDecisionId TEXT,
  plannerRunIds TEXT,
  runtimeActionIds TEXT,
  toolCallSummaries TEXT,
  approvalSummaries TEXT,

  -- Event range
  startEventId TEXT,
  endEventId TEXT,

  -- Visibility level
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'internal', 'confidential')),

  -- Timestamps
  createdAt TEXT NOT NULL
);

-- Index: by sessionId + createdAt for chronological retrieval
CREATE INDEX idx_transcripts_session_created ON transcripts(sessionId, createdAt);

-- Index: by userId + createdAt for user-level queries
CREATE INDEX idx_transcripts_user_created ON transcripts(userId, createdAt);

-- Index: by visibility for filtering
CREATE INDEX idx_transcripts_visibility ON transcripts(visibility);

-- Down migration

DROP INDEX IF EXISTS idx_transcripts_visibility;
DROP INDEX IF EXISTS idx_transcripts_user_created;
DROP INDEX IF EXISTS idx_transcripts_session_created;
DROP TABLE IF EXISTS transcripts;
