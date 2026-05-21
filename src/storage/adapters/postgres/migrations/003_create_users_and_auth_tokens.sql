-- Migration: create_users_and_auth_tokens
-- Version: 3
-- Created: 2026-04-29
-- PostgreSQL Conversion

-- Up migration

-- Users table for local-operator authentication
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Auth tokens table for session management
CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

-- Index: by user_id for token lookups
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);

-- Index: by expires_at for purging expired tokens
CREATE INDEX idx_auth_tokens_expires ON auth_tokens(expires_at);

-- Down migration

DROP INDEX IF EXISTS idx_auth_tokens_expires;
DROP INDEX IF EXISTS idx_auth_tokens_user;
DROP TABLE IF EXISTS auth_tokens;
DROP TABLE IF EXISTS users;
