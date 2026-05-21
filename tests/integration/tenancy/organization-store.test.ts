import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import type { Migration } from '../../../src/storage/migrations.js';
import {
  createOrganizationStore,
  type OrganizationStore,
} from '../../../src/storage/organization-store.js';

describe('OrganizationStore', () => {
  let connection: ConnectionManager;
  let migrationRunner: MigrationRunner;
  let orgStore: OrganizationStore;

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
      down: `DROP TABLE IF EXISTS users`
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
      `
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
      `
    }
  ];

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(orgMigrations);
    orgStore = createOrganizationStore(connection);
  });

  afterEach(() => {
    connection.close();
  });

  describe('create', () => {
    it('creates an organization and returns it with all fields', () => {
      const org = orgStore.create({ orgId: 'org_1', name: 'Test Org', slug: 'test-org' });

      expect(org.orgId).toBe('org_1');
      expect(org.name).toBe('Test Org');
      expect(org.slug).toBe('test-org');
      expect(org.createdAt).toBeTruthy();
      expect(org.updatedAt).toBeTruthy();
    });
  });

  describe('getById', () => {
    it('returns null for non-existent organization', () => {
      const result = orgStore.getById('nonexistent');
      expect(result).toBeNull();
    });

    it('returns correct organization for existing id', () => {
      orgStore.create({ orgId: 'org_1', name: 'Test Org', slug: 'test-org' });
      const result = orgStore.getById('org_1');

      expect(result).not.toBeNull();
      expect(result!.orgId).toBe('org_1');
      expect(result!.name).toBe('Test Org');
      expect(result!.slug).toBe('test-org');
    });
  });

  describe('getBySlug', () => {
    it('returns null for non-existent slug', () => {
      const result = orgStore.getBySlug('nonexistent');
      expect(result).toBeNull();
    });

    it('returns correct organization for existing slug', () => {
      orgStore.create({ orgId: 'org_1', name: 'Test Org', slug: 'test-org' });
      const result = orgStore.getBySlug('test-org');

      expect(result).not.toBeNull();
      expect(result!.orgId).toBe('org_1');
    });
  });

  describe('getDefault', () => {
    it('returns the default organization', () => {
      const result = orgStore.getDefault();

      expect(result.orgId).toBe('org_default');
      expect(result.name).toBe('Default Organization');
      expect(result.slug).toBe('default');
    });

    it('throws if default organization is missing', () => {
      orgStore.delete('org_default');
      expect(() => orgStore.getDefault()).toThrow('Default organization not found');
    });
  });

  describe('update', () => {
    it('updates name', () => {
      orgStore.create({ orgId: 'org_1', name: 'Old Name', slug: 'test-org' });
      const result = orgStore.update('org_1', { name: 'New Name' });

      expect(result).toBe(true);
      const org = orgStore.getById('org_1');
      expect(org!.name).toBe('New Name');
    });

    it('updates slug', () => {
      orgStore.create({ orgId: 'org_1', name: 'Test Org', slug: 'old-slug' });
      const result = orgStore.update('org_1', { slug: 'new-slug' });

      expect(result).toBe(true);
      const org = orgStore.getById('org_1');
      expect(org!.slug).toBe('new-slug');
    });

    it('returns false when no fields to update', () => {
      orgStore.create({ orgId: 'org_1', name: 'Test Org', slug: 'test-org' });
      const result = orgStore.update('org_1', {});

      expect(result).toBe(false);
    });

    it('returns false for duplicate slug', () => {
      orgStore.create({ orgId: 'org_1', name: 'Org 1', slug: 'slug-1' });
      orgStore.create({ orgId: 'org_2', name: 'Org 2', slug: 'slug-2' });
      const result = orgStore.update('org_1', { slug: 'slug-2' });

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('deletes an organization', () => {
      orgStore.create({ orgId: 'org_1', name: 'Test Org', slug: 'test-org' });
      const result = orgStore.delete('org_1');

      expect(result).toBe(true);
      expect(orgStore.getById('org_1')).toBeNull();
    });

    it('returns true for non-existent organization (idempotent)', () => {
      const result = orgStore.delete('nonexistent');
      expect(result).toBe(true);
    });
  });

  describe('list', () => {
    it('lists all organizations including default', () => {
      orgStore.create({ orgId: 'org_1', name: 'Org 1', slug: 'org-1' });
      orgStore.create({ orgId: 'org_2', name: 'Org 2', slug: 'org-2' });

      const orgs = orgStore.list();
      expect(orgs.length).toBe(3);
      expect(orgs.map(o => o.orgId)).toContain('org_default');
      expect(orgs.map(o => o.orgId)).toContain('org_1');
      expect(orgs.map(o => o.orgId)).toContain('org_2');
    });
  });

  describe('addUser', () => {
    it('adds user to organization with default member role', () => {
      connection.exec('INSERT INTO users (user_id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['user_1', 'testuser', 'hash', new Date().toISOString(), new Date().toISOString()]);

      const result = orgStore.addUser('user_1', 'org_default');

      expect(result.userId).toBe('user_1');
      expect(result.orgId).toBe('org_default');
      expect(result.role).toBe('member');
      expect(result.joinedAt).toBeTruthy();
    });

    it('adds user with specified role', () => {
      connection.exec('INSERT INTO users (user_id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['user_1', 'testuser', 'hash', new Date().toISOString(), new Date().toISOString()]);

      const result = orgStore.addUser('user_1', 'org_default', 'admin');

      expect(result.role).toBe('admin');
    });
  });

  describe('removeUser', () => {
    it('removes user from organization', () => {
      connection.exec('INSERT INTO users (user_id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['user_1', 'testuser', 'hash', new Date().toISOString(), new Date().toISOString()]);
      orgStore.addUser('user_1', 'org_default');

      const result = orgStore.removeUser('user_1', 'org_default');

      expect(result).toBe(true);
      expect(orgStore.getOrganizationUsers('org_default').length).toBe(0);
    });
  });

  describe('getUserOrganizations', () => {
    it('returns organizations for a user', () => {
      connection.exec('INSERT INTO users (user_id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['user_1', 'testuser', 'hash', new Date().toISOString(), new Date().toISOString()]);
      orgStore.addUser('user_1', 'org_default');
      orgStore.create({ orgId: 'org_2', name: 'Second Org', slug: 'second-org' });
      orgStore.addUser('user_1', 'org_2');

      const orgs = orgStore.getUserOrganizations('user_1');

      expect(orgs.length).toBe(2);
      expect(orgs.map(o => o.orgId)).toContain('org_default');
      expect(orgs.map(o => o.orgId)).toContain('org_2');
    });

    it('returns empty array for user with no organizations', () => {
      const orgs = orgStore.getUserOrganizations('nonexistent');
      expect(orgs).toEqual([]);
    });
  });

  describe('getOrganizationUsers', () => {
    it('returns users in an organization', () => {
      connection.exec('INSERT INTO users (user_id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['user_1', 'user1', 'hash', new Date().toISOString(), new Date().toISOString()]);
      connection.exec('INSERT INTO users (user_id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['user_2', 'user2', 'hash', new Date().toISOString(), new Date().toISOString()]);

      orgStore.addUser('user_1', 'org_default', 'owner');
      orgStore.addUser('user_2', 'org_default', 'member');

      const users = orgStore.getOrganizationUsers('org_default');

      expect(users.length).toBe(2);
      const roles = users.map(u => u.role);
      expect(roles).toContain('owner');
      expect(roles).toContain('member');
    });

    it('returns empty array for organization with no users', () => {
      orgStore.create({ orgId: 'org_empty', name: 'Empty Org', slug: 'empty-org' });
      const users = orgStore.getOrganizationUsers('org_empty');
      expect(users).toEqual([]);
    });
  });

  describe('updateUserRole', () => {
    it('changes user role in organization', () => {
      connection.exec('INSERT INTO users (user_id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['user_1', 'testuser', 'hash', new Date().toISOString(), new Date().toISOString()]);
      orgStore.addUser('user_1', 'org_default', 'member');

      const result = orgStore.updateUserRole('user_1', 'org_default', 'admin');

      expect(result).toBe(true);
      const users = orgStore.getOrganizationUsers('org_default');
      const user = users.find(u => u.userId === 'user_1');
      expect(user!.role).toBe('admin');
    });

    it('returns false for non-existent membership', () => {
      const result = orgStore.updateUserRole('nonexistent', 'org_default', 'admin');
      expect(result).toBe(false);
    });
  });

  describe('duplicate slug constraint', () => {
    it('prevents creating organization with duplicate slug', () => {
      orgStore.create({ orgId: 'org_1',name: 'Org 1', slug: 'unique-slug' });

      expect(() => {
        orgStore.create({ orgId: 'org_2', name: 'Org 2', slug: 'unique-slug' });
      }).toThrow();
    });

    it('prevents creating organization with default slug', () => {
      expect(() => {
        orgStore.create({ orgId: 'org_dup', name: 'Dup Org', slug: 'default' });
      }).toThrow();
    });
  });
});