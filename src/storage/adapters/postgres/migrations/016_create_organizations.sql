-- Migration: create_organizations
-- Version: 16
-- Created: 2026-05-21
-- PostgreSQL Conversion

-- Up migration

-- Organizations table for multi-tenancy support
CREATE TABLE IF NOT EXISTS organizations (
  org_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL DEFAULT 'org_default',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Index: by slug for fast lookup
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

-- Insert default organization for existing data
INSERT INTO organizations (org_id, name, slug, created_at, updated_at)
VALUES ('org_default', 'Default Organization', 'default', NOW(), NOW());

-- Down migration

DROP INDEX IF EXISTS idx_organizations_slug;
DROP TABLE IF EXISTS organizations;
