-- Migration: create_user_organizations
-- Version: 17
-- Created: 2026-05-21
-- PostgreSQL Conversion

-- Up migration

-- User-Organization association table for multi-tenancy membership
CREATE TABLE IF NOT EXISTS user_organizations (
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')),
  tenant_id TEXT NOT NULL DEFAULT 'org_default',
  joined_at TEXT NOT NULL,
  PRIMARY KEY (user_id, org_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id) REFERENCES organizations(org_id) ON DELETE CASCADE
);

-- Index: by user_id for listing user's organizations
CREATE INDEX IF NOT EXISTS idx_user_org_user ON user_organizations(user_id);

-- Index: by org_id for listing organization's users
CREATE INDEX IF NOT EXISTS idx_user_org_org ON user_organizations(org_id);

-- Down migration

DROP INDEX IF EXISTS idx_user_org_org;
DROP INDEX IF EXISTS idx_user_org_user;
DROP TABLE IF EXISTS user_organizations;
