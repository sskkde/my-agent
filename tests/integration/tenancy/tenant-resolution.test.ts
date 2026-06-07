import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import type { Migration } from '../../../src/storage/migrations.js'
import { createOrganizationStore, type OrganizationStore } from '../../../src/storage/organization-store.js'
import { resolveTenant } from '../../../src/tenancy/tenant-resolution.js'
import { DEFAULT_TENANT_ID, createTenantContext } from '../../../src/tenancy/tenant-context.js'
import type { TenantContext } from '../../../src/tenancy/tenant-context.js'

const orgMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_users_table',
    up: `
      CREATE TABLE users (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    down: `DROP TABLE IF EXISTS users`,
  },
  {
    version: 2,
    name: 'create_organizations_table',
    up: `
      CREATE TABLE organizations (
        org_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_organizations_slug ON organizations(slug);
      INSERT INTO organizations (org_id, name, slug, created_at, updated_at)
      VALUES ('org_default', 'Default Organization', 'default', datetime('now'), datetime('now'))
    `,
    down: `
      DROP INDEX IF EXISTS idx_organizations_slug;
      DROP TABLE IF EXISTS organizations
    `,
  },
  {
    version: 3,
    name: 'create_user_organizations_table',
    up: `
      CREATE TABLE user_organizations (
        user_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')),
        joined_at TEXT NOT NULL,
        PRIMARY KEY (user_id, org_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id),
        FOREIGN KEY (org_id) REFERENCES organizations(org_id)
      );
      CREATE INDEX idx_user_org_user ON user_organizations(user_id);
      CREATE INDEX idx_user_org_org ON user_organizations(org_id)
    `,
    down: `
      DROP INDEX IF EXISTS idx_user_org_org;
      DROP INDEX IF EXISTS idx_user_org_user;
      DROP TABLE IF EXISTS user_organizations
    `,
  },
]

describe('Tenant Resolution', () => {
  let connection: ConnectionManager
  let migrationRunner: MigrationRunner
  let orgStore: OrganizationStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(orgMigrations)
    orgStore = createOrganizationStore(connection)
  })

  afterEach(() => {
    connection.close()
  })

  describe('resolveTenant', () => {
    it('returns default tenant for undefined userId', () => {
      const context = resolveTenant(undefined, orgStore)

      expect(context.tenantId).toBe(DEFAULT_TENANT_ID)
      expect(context.resolvedFrom).toBe('default')
    })

    it('returns default tenant for known userId', () => {
      connection.exec(
        'INSERT INTO users (user_id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['user_1', 'testuser', 'hash', new Date().toISOString(), new Date().toISOString()],
      )

      const context = resolveTenant('user_1', orgStore)

      expect(context.tenantId).toBe(DEFAULT_TENANT_ID)
      expect(context.resolvedFrom).toBe('default')
    })

    it('returns default tenant for user with org associations', () => {
      connection.exec(
        'INSERT INTO users (user_id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['user_1', 'testuser', 'hash', new Date().toISOString(), new Date().toISOString()],
      )
      orgStore.addUser('user_1', 'org_default', 'member')

      const context = resolveTenant('user_1', orgStore)

      expect(context.tenantId).toBe(DEFAULT_TENANT_ID)
      expect(context.resolvedFrom).toBe('default')
    })

    it('ignores X-Tenant-Id header for GA', () => {
      const context = resolveTenant('user_1', orgStore, 'X-Tenant-Id')

      expect(context.tenantId).toBe(DEFAULT_TENANT_ID)
      expect(context.resolvedFrom).toBe('default')
    })
  })

  describe('createTenantContext', () => {
    it('creates context with default resolvedFrom', () => {
      const context = createTenantContext('org_test')

      expect(context.tenantId).toBe('org_test')
      expect(context.resolvedFrom).toBe('default')
    })

    it('creates context with explicit resolvedFrom', () => {
      const context = createTenantContext('org_test', 'header')

      expect(context.tenantId).toBe('org_test')
      expect(context.resolvedFrom).toBe('header')
    })

    it('creates context with optional org fields', () => {
      const context: TenantContext = {
        tenantId: 'org_test',
        resolvedFrom: 'user',
        orgName: 'Test Org',
        orgSlug: 'test-org',
      }

      expect(context.orgName).toBe('Test Org')
      expect(context.orgSlug).toBe('test-org')
    })
  })

  describe('DEFAULT_TENANT_ID', () => {
    it('equals org_default', () => {
      expect(DEFAULT_TENANT_ID).toBe('org_default')
    })
  })
})
