-- Migration: create_organizations
-- Version: 16
-- Created: 2026-05-21

-- Up migration

-- Organizations table for multi-tenancy support
CREATE TABLE organizations (
  org_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Index: by slug for fast lookup
CREATE INDEX idx_organizations_slug ON organizations(slug);

-- Insert default organization for existing data
INSERT INTO organizations (org_id, name, slug, created_at, updated_at)
VALUES ('org_default', 'Default Organization', 'default', datetime('now'), datetime('now'));

-- Down migration

DROP INDEX IF EXISTS idx_organizations_slug;
DROP TABLE IF EXISTS organizations;
