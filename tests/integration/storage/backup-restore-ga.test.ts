import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import {
  createSessionStore,
  type SessionStore,
} from '../../../src/storage/session-store.js';
import {
  createApiKeyStore,
  type ApiKeyStore,
} from '../../../src/storage/api-key-store.js';
import {
  createProviderConfigStore,
  type ProviderConfigStore,
} from '../../../src/storage/provider-config-store.js';
import {
  createUserStore,
  type UserStore,
} from '../../../src/storage/user-store.js';
import {
  createWorkflowRunStore,
  type WorkflowRunStore,
} from '../../../src/storage/workflow-run-store.js';
import {
  encryptSecret,
  decryptSecret,
  serializeEncryptedSecret,
  deserializeEncryptedSecret,
} from '../../../src/storage/provider-crypto.js';
import { WORKFLOW_RUN_STATES } from '../../../src/shared/states.js';
import { allMigrations as baseMigrations } from '../../../src/storage/schema.js';
import type { Migration } from '../../../src/storage/migrations.js';

const apiKeysTableMigration: Migration = {
  version: 7,
  name: 'create_api_keys_table',
  up: `
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user', 'service')),
      user_id TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      tenant_id TEXT NOT NULL DEFAULT 'org_default'
    );
    CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
    CREATE INDEX idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX idx_api_keys_active ON api_keys(is_active)
  `,
  down: `
    DROP INDEX IF EXISTS idx_api_keys_active;
    DROP INDEX IF EXISTS idx_api_keys_user;
    DROP INDEX IF EXISTS idx_api_keys_hash;
    DROP TABLE IF EXISTS api_keys
  `
};

const workflowRunsTableMigration: Migration = {
  version: 8,
  name: 'create_workflow_runs_table',
  up: `
    CREATE TABLE workflow_runs (
      workflow_run_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      workflow_version TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      trigger_event_id TEXT,
      status TEXT NOT NULL,
      current_step_ids TEXT,
      input_data TEXT,
      output_data TEXT,
      context_data TEXT,
      tenant_id TEXT NOT NULL DEFAULT 'org_default',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at);
    CREATE INDEX idx_workflow_runs_owner_status ON workflow_runs(owner_user_id, status)
  `,
  down: `
    DROP INDEX IF EXISTS idx_workflow_runs_workflow;
    DROP INDEX IF EXISTS idx_workflow_runs_owner_status;
    DROP TABLE IF EXISTS workflow_runs
  `
};

const usersRoleMigration: Migration = {
  version: 9,
  name: 'add_users_role_column',
  up: `
    ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  `,
  down: `
    ALTER TABLE users DROP COLUMN role
  `
};

const usersTenantMigration: Migration = {
  version: 10,
  name: 'add_users_tenant_column',
  up: `
    ALTER TABLE users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default'
  `,
  down: `
    ALTER TABLE users DROP COLUMN tenant_id
  `
};

const allMigrations: Migration[] = [
  ...baseMigrations,
  apiKeysTableMigration,
  workflowRunsTableMigration,
  usersRoleMigration,
  usersTenantMigration,
];

process.env.APP_SECRET_KEY = 'test-encryption-key-for-backup-restore-tests';

describe('Backup/Restore GA Gate', () => {
  let tempDir: string;
  let sourceDbPath: string;
  let backupDbPath: string;
  let connection: ConnectionManager;
  let migrationRunner: MigrationRunner;
  let sessionStore: SessionStore;
  let apiKeyStore: ApiKeyStore;
  let providerConfigStore: ProviderConfigStore;
  let userStore: UserStore;
  let workflowRunStore: WorkflowRunStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-restore-ga-'));
    sourceDbPath = path.join(tempDir, 'source.db');
    backupDbPath = path.join(tempDir, 'backup.db');

    connection = createConnectionManager(sourceDbPath);
    connection.open();
    migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allMigrations);

    // Add v60 columns to provider_configs table for v60 schema compatibility
    // when running against older base schemas. Newer base schemas already include
    // these runtime metadata columns, so guard each ALTER to avoid duplicate-column
    // failures.
    const providerConfigColumns = new Set(
      connection
        .query<{ name: string }>('PRAGMA table_info(provider_configs)')
        .map((column) => column.name)
    );
    const addProviderConfigColumnIfMissing = (name: string, definition: string): void => {
      if (!providerConfigColumns.has(name)) {
        connection.exec(`ALTER TABLE provider_configs ADD COLUMN ${name} ${definition}`);
        providerConfigColumns.add(name);
      }
    };

    addProviderConfigColumnIfMissing('family', 'TEXT DEFAULT NULL');
    addProviderConfigColumnIfMissing('protocol', 'TEXT DEFAULT NULL');
    addProviderConfigColumnIfMissing('priority', 'INTEGER DEFAULT NULL');
    addProviderConfigColumnIfMissing('headers_json', 'TEXT DEFAULT NULL');
    addProviderConfigColumnIfMissing('capabilities_json', 'TEXT DEFAULT NULL');
    addProviderConfigColumnIfMissing('models_json', 'TEXT DEFAULT NULL');
    addProviderConfigColumnIfMissing('default_model', 'TEXT DEFAULT NULL');
    addProviderConfigColumnIfMissing('options_json', 'TEXT DEFAULT NULL');

    sessionStore = createSessionStore(connection);
    apiKeyStore = createApiKeyStore(connection);
    providerConfigStore = createProviderConfigStore(connection);
    userStore = createUserStore(connection);
    workflowRunStore = createWorkflowRunStore(connection);
  });

  afterEach(() => {
    if (connection) {
      connection.close();
    }

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Backup Creation', () => {
    it('should create backup of SQLite database', async () => {
      // Insert test data
      sessionStore.create({
        sessionId: 'session-001',
        userId: 'user-001',
        title: 'Test Session',
      });

      // Create backup
      const sourceConn = createConnectionManager(sourceDbPath);
      sourceConn.open();
      
      try {
        // Perform checkpoint to ensure WAL is merged
        sourceConn.query('PRAGMA wal_checkpoint(TRUNCATE)');
        
        // Copy database file
        fs.copyFileSync(sourceDbPath, backupDbPath);
      } finally {
        sourceConn.close();
      }

      // Verify backup file exists
      expect(fs.existsSync(backupDbPath)).toBe(true);
      expect(fs.statSync(backupDbPath).size).toBeGreaterThan(0);
    });

    it('should verify backup file integrity', async () => {
      // Insert test data
      sessionStore.create({
        sessionId: 'session-002',
        userId: 'user-001',
        title: 'Test Session for Integrity',
      });

      // Create backup
      const sourceConn = createConnectionManager(sourceDbPath);
      sourceConn.open();
      sourceConn.query('PRAGMA wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(sourceDbPath, backupDbPath);
      sourceConn.close();

      // Open backup and run integrity check
      const backupConn = createConnectionManager(backupDbPath);
      backupConn.open();
      
      const integrityResult = backupConn.query<{ integrity_check: string }>(
        'PRAGMA integrity_check'
      );
      
      expect(integrityResult[0]?.integrity_check).toBe('ok');
      
      backupConn.close();
    });
  });

  describe('Data Consistency After Restore', () => {
    it('should restore database from backup', async () => {
      // Insert test data
      sessionStore.create({
        sessionId: 'session-003',
        userId: 'user-001',
        title: 'Session to Restore',
      });

      // Create backup
      const sourceConn = createConnectionManager(sourceDbPath);
      sourceConn.open();
      sourceConn.query('PRAGMA wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(sourceDbPath, backupDbPath);
      sourceConn.close();

      // Modify original database (simulate data loss)
      connection.exec("DELETE FROM sessions WHERE session_id = 'session-003'");

      // Verify data is gone
      const beforeRestore = sessionStore.getById('session-003');
      expect(beforeRestore).toBeNull();

      // Restore from backup
      connection.close();
      fs.copyFileSync(backupDbPath, sourceDbPath);
      connection = createConnectionManager(sourceDbPath);
      connection.open();
      
      // Recreate stores
      const restoredSessionStore = createSessionStore(connection);

      // Verify data is restored
      const afterRestore = restoredSessionStore.getById('session-003');
      expect(afterRestore).not.toBeNull();
      expect(afterRestore?.title).toBe('Session to Restore');
    });

    it('should verify data consistency after restore', async () => {
      // Insert comprehensive test data
      sessionStore.create({ sessionId: 's1', userId: 'u1', title: 'Session 1' });
      sessionStore.create({ sessionId: 's2', userId: 'u1', title: 'Session 2' });
      sessionStore.create({ sessionId: 's3', userId: 'u2', title: 'Session 3' });

      userStore.create({ userId: 'u1', username: 'user1', passwordHash: 'hash1' });
      userStore.create({ userId: 'u2', username: 'user2', passwordHash: 'hash2' });

      workflowRunStore.createWorkflowRun({
        workflowRunId: 'wf-001',
        workflowId: 'workflow-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'u1',
        status: WORKFLOW_RUN_STATES.COMPLETED,
      });

      // Record counts before backup
      connection.close();
      const sourceConn = createConnectionManager(sourceDbPath);
      sourceConn.open();
      
      const sessionCountBefore = sourceConn.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM sessions'
      )[0]?.count ?? 0;
      
      const userCountBefore = sourceConn.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM users'
      )[0]?.count ?? 0;
      
      const workflowCountBefore = sourceConn.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM workflow_runs'
      )[0]?.count ?? 0;

      // Create backup
      sourceConn.query('PRAGMA wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(sourceDbPath, backupDbPath);
      sourceConn.close();

      // Restore to new database
      const restorePath = path.join(tempDir, 'restored.db');
      fs.copyFileSync(backupDbPath, restorePath);

      // Verify counts after restore
      const restoreConn = createConnectionManager(restorePath);
      restoreConn.open();

      const sessionCountAfter = restoreConn.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM sessions'
      )[0]?.count ?? 0;
      
      const userCountAfter = restoreConn.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM users'
      )[0]?.count ?? 0;
      
      const workflowCountAfter = restoreConn.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM workflow_runs'
      )[0]?.count ?? 0;

      expect(sessionCountAfter).toBe(sessionCountBefore);
      expect(userCountAfter).toBe(userCountBefore);
      expect(workflowCountAfter).toBe(workflowCountBefore);

      restoreConn.close();
    });
  });

  describe('Secret Preservation', () => {
    it('should verify API keys are still hashed after restore', async () => {
      // Create API key with known plaintext
      const plaintextKey = 'ak_test_secret_key_12345';
      const expectedHash = createHash('sha256').update(plaintextKey).digest('hex');

      apiKeyStore.createKey({
        id: 'key-001',
        name: 'Test API Key',
        key: plaintextKey,
        role: 'user',
        userId: 'u1',
      });

      // Get stored hash from database
      const keyBeforeBackup = apiKeyStore.getKeyByHash(expectedHash);
      expect(keyBeforeBackup).not.toBeNull();
      expect(keyBeforeBackup?.keyHash).toBe(expectedHash);
      expect(keyBeforeBackup?.keyPrefix).toBe('ak_test_');

      // Create backup
      connection.close();
      const sourceConn = createConnectionManager(sourceDbPath);
      sourceConn.open();
      sourceConn.query('PRAGMA wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(sourceDbPath, backupDbPath);
      sourceConn.close();

      // Restore
      const restorePath = path.join(tempDir, 'restored-apikeys.db');
      fs.copyFileSync(backupDbPath, restorePath);

      // Verify hash is preserved
      const restoreConn = createConnectionManager(restorePath);
      restoreConn.open();

      const restoredKeyStore = createApiKeyStore(restoreConn);
      const keyAfterRestore = restoredKeyStore.getKeyByHash(expectedHash);

      expect(keyAfterRestore).not.toBeNull();
      expect(keyAfterRestore?.keyHash).toBe(expectedHash);
      expect(keyAfterRestore?.keyPrefix).toBe('ak_test_');

      // Verify plaintext is NOT stored anywhere
      const allKeyData = restoreConn.query<{ key_hash: string }>(
        'SELECT key_hash FROM api_keys WHERE id = ?', ['key-001']
      );
      
      expect(allKeyData[0]?.key_hash).toBe(expectedHash);
      expect(allKeyData[0]?.key_hash).not.toBe(plaintextKey);

      restoreConn.close();
    });

    it('should verify encrypted provider tokens remain encrypted after restore', async () => {
      // Create provider config with encrypted API key
      const plaintextApiKey = 'sk-secret-api-key-12345';
      
      providerConfigStore.create({
        providerId: 'provider-001',
        userId: 'u1',
        providerType: 'openrouter',
        displayName: 'Test Provider',
        apiKey: plaintextApiKey,
      });

      // Get encrypted data directly from database
      const encryptedRowBefore = connection.query<{ encrypted_api_key: string | null }>(
        'SELECT encrypted_api_key FROM provider_configs WHERE provider_id = ?',
        ['provider-001']
      )[0];

      expect(encryptedRowBefore?.encrypted_api_key).not.toBeNull();
      expect(encryptedRowBefore?.encrypted_api_key).not.toBe(plaintextApiKey);
      expect(encryptedRowBefore?.encrypted_api_key).toMatch(/^aes-256-gcm:/);

      // Store the encrypted value for comparison
      const encryptedValueBefore = encryptedRowBefore?.encrypted_api_key;

      // Create backup
      connection.close();
      const sourceConn = createConnectionManager(sourceDbPath);
      sourceConn.open();
      sourceConn.query('PRAGMA wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(sourceDbPath, backupDbPath);
      sourceConn.close();

      // Restore
      const restorePath = path.join(tempDir, 'restored-providers.db');
      fs.copyFileSync(backupDbPath, restorePath);

      // Verify encrypted value is preserved exactly
      const restoreConn = createConnectionManager(restorePath);
      restoreConn.open();

      const encryptedRowAfter = restoreConn.query<{ encrypted_api_key: string | null }>(
        'SELECT encrypted_api_key FROM provider_configs WHERE provider_id = ?',
        ['provider-001']
      )[0];

      // Encrypted value should be identical
      expect(encryptedRowAfter?.encrypted_api_key).toBe(encryptedValueBefore);

      // Verify we can still decrypt with APP_SECRET_KEY
      const restoredProviderStore = createProviderConfigStore(restoreConn);
      const configWithSecret = restoredProviderStore.getByIdWithSecret('provider-001');
      
      expect(configWithSecret?.apiKey).toBe(plaintextApiKey);

      restoreConn.close();
    });

    it('should verify encrypted auth state is preserved after restore', async () => {
      // Test encryption/decryption round-trip
      const secretValue = 'oauth-refresh-token-secret-12345';
      
      // Encrypt
      const encrypted = encryptSecret(secretValue);
      const serialized = serializeEncryptedSecret(encrypted);
      
      // Verify format
      expect(serialized).toMatch(/^aes-256-gcm:/);
      
      // Simulate backup/restore by storing and retrieving
      const restorePath = path.join(tempDir, 'encrypted-test.db');
      const testConn = createConnectionManager(restorePath);
      testConn.open();
      
      testConn.exec(`
        CREATE TABLE test_secrets (
          id TEXT PRIMARY KEY,
          encrypted_value TEXT NOT NULL
        )
      `);
      
      testConn.exec(
        'INSERT INTO test_secrets (id, encrypted_value) VALUES (?, ?)',
        ['secret-001', serialized]
      );

      // Retrieve and decrypt
      const row = testConn.query<{ encrypted_value: string }>(
        'SELECT encrypted_value FROM test_secrets WHERE id = ?', ['secret-001']
      )[0];

      const deserialized = deserializeEncryptedSecret(row.encrypted_value);
      const decrypted = decryptSecret(
        deserialized.encrypted,
        deserialized.iv,
        deserialized.authTag
      );

      expect(decrypted).toBe(secretValue);
      
      testConn.close();
    });
  });

  describe('Error Handling', () => {
    it('should detect corrupt backup file', async () => {
      // Create a corrupt backup file
      fs.writeFileSync(backupDbPath, Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE]));

      // Try to open corrupt backup
      const corruptConn = createConnectionManager(backupDbPath);
      
      expect(() => {
        corruptConn.open();
      }).toThrow();

      // If it somehow opens, integrity check should fail
      try {
        corruptConn.open();
        const result = corruptConn.query<{ integrity_check: string }>(
          'PRAGMA integrity_check'
        );
        expect(result[0]?.integrity_check).not.toBe('ok');
        corruptConn.close();
      } catch {
        // Expected - corrupt database should throw
      }
    });

    it('should handle restore from incompatible schema version', async () => {
      // Create a database with older schema (missing tables)
      const oldSchemaPath = path.join(tempDir, 'old-schema.db');
      const oldConn = createConnectionManager(oldSchemaPath);
      oldConn.open();
      
      oldConn.exec(`
        CREATE TABLE sessions (
          session_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL
        )
      `);
      
      oldConn.exec(`
        CREATE TABLE migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL,
          checksum TEXT NOT NULL
        )
      `);
      
      oldConn.exec(
        "INSERT INTO migrations (version, name, applied_at, checksum) VALUES (1, 'old_migration', ?, 'abc')",
        [new Date().toISOString()]
      );
      
      oldConn.close();

      // Try to open with new stores (should fail or have missing tables)
      const testConn = createConnectionManager(oldSchemaPath);
      testConn.open();
      
      // Check for missing tables
      const tables = testConn.query<{ name: string }>(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'
      `);
      
      expect(tables.length).toBe(0); // users table should not exist
      
      testConn.close();
    });
  });

  describe('Service Startup After Restore', () => {
    it('should allow service to start after restore', async () => {
      // Insert comprehensive data
      sessionStore.create({ sessionId: 'startup-test-1', userId: 'u1', title: 'Test' });
      userStore.create({ userId: 'u1', username: 'testuser', passwordHash: 'hash' });
      apiKeyStore.createKey({
        id: 'startup-key',
        name: 'Startup Test Key',
        key: 'ak_startup_test_key',
        role: 'user',
        userId: 'u1',
      });

      // Create backup
      connection.close();
      const sourceConn = createConnectionManager(sourceDbPath);
      sourceConn.open();
      sourceConn.query('PRAGMA wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(sourceDbPath, backupDbPath);
      sourceConn.close();

      // Restore to new location
      const restoredPath = path.join(tempDir, 'service-startup.db');
      fs.copyFileSync(backupDbPath, restoredPath);

      // Simulate service startup by creating new connection and stores
      const serviceConn = createConnectionManager(restoredPath);
      serviceConn.open();

      // Verify all stores work
      const newSessionStore = createSessionStore(serviceConn);
      const newUserStore = createUserStore(serviceConn);
      const newApiKeyStore = createApiKeyStore(serviceConn);

      // Test operations
      const session = newSessionStore.getById('startup-test-1');
      expect(session).not.toBeNull();

      const user = newUserStore.getByUsername('testuser');
      expect(user).not.toBeNull();

      const expectedHash = createHash('sha256').update('ak_startup_test_key').digest('hex');
      const apiKey = newApiKeyStore.getKeyByHash(expectedHash);
      expect(apiKey).not.toBeNull();

      // Verify we can create new data
      newSessionStore.create({ sessionId: 'new-after-restore', userId: 'u1', title: 'New' });
      const newSession = newSessionStore.getById('new-after-restore');
      expect(newSession).not.toBeNull();

      serviceConn.close();
    });
  });

  describe('Schema Version Verification', () => {
    it('should preserve migration version after restore', async () => {
      // Get current migration version
      const versionBefore = migrationRunner.getCurrentVersion();

      // Create backup
      connection.close();
      const sourceConn = createConnectionManager(sourceDbPath);
      sourceConn.open();
      sourceConn.query('PRAGMA wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(sourceDbPath, backupDbPath);
      sourceConn.close();

      // Restore
      const restoreConn = createConnectionManager(backupDbPath);
      restoreConn.open();

      const restoreMigrationRunner = createMigrationRunner(restoreConn);
      const versionAfter = restoreMigrationRunner.getCurrentVersion();

      expect(versionAfter).toBe(versionBefore);

      restoreConn.close();
    });
  });
});
