#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

interface TestResult {
  step: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

function logStep(step: string, passed: boolean, message: string): void {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${step}: ${message}`);
  results.push({ step, passed, message });
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function createAppSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      message_count INTEGER DEFAULT 0,
      last_activity_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'org_default'
    )
  `);
  
  db.exec(`
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      role TEXT NOT NULL,
      user_id TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      tenant_id TEXT NOT NULL DEFAULT 'org_default'
    )
  `);
  
  db.exec(`
    CREATE TABLE provider_configs (
      provider_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      display_name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      base_url TEXT,
      selected_model TEXT,
      encrypted_api_key TEXT,
      api_key_last4 TEXT,
      source TEXT NOT NULL DEFAULT 'database',
      tenant_id TEXT NOT NULL DEFAULT 'org_default',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  
  db.exec(`
    CREATE TABLE users (
      user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'org_default',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      checksum TEXT NOT NULL
    )
  `);
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Backup/Restore GA Verification Script');
  console.log('='.repeat(60));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-restore-ga-'));
  const testDbPath = path.join(tempDir, 'test.db');
  const backupDir = path.join(tempDir, 'backups');
  const backupPath = path.join(backupDir, 'backup-test.db');

  console.log(`\n📁 Temp directory: ${tempDir}`);
  console.log(`📁 Test database: ${testDbPath}`);

  let db: Database.Database | null = null;

  try {
    console.log('\n[1/8] Create test database with app schema');
    console.log('-'.repeat(60));
    
    db = new Database(testDbPath);
    createAppSchema(db);
    
    const now = new Date().toISOString();
    const plainApiKey = 'ak_test_secret_key_for_backup_test_12345';
    const keyHash = hashKey(plainApiKey);
    
    db.prepare(`INSERT INTO sessions (session_id, user_id, title, last_activity_at, created_at, updated_at) 
                VALUES (?, ?, ?, ?, ?, ?)`).run('sess-001', 'user-001', 'Test Session', now, now, now);
    
    db.prepare(`INSERT INTO api_keys (id, name, key_hash, key_prefix, role, user_id, created_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run('key-001', 'Test API Key', keyHash, 'ak_test_', 'user', 'user-001', now);
    
    db.prepare(`INSERT INTO provider_configs (provider_id, user_id, provider_type, display_name, encrypted_api_key, api_key_last4, created_at, updated_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('prov-001', 'user-001', 'openrouter', 'Test Provider', 'aes-256-gcm:iv:tag:encrypted', '1234', now, now);
    
    db.prepare(`INSERT INTO users (user_id, username, password_hash, created_at, updated_at) 
                VALUES (?, ?, ?, ?, ?)`).run('user-001', 'testuser', 'hashed_password_value', now, now);

    db.prepare(`INSERT INTO migrations (version, name, applied_at, checksum) 
                VALUES (?, ?, ?, ?)`).run(100, 'test_migration', now, 'abc123');
    
    const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    const apiKeyCount = db.prepare('SELECT COUNT(*) as count FROM api_keys').get() as { count: number };
    const providerCount = db.prepare('SELECT COUNT(*) as count FROM provider_configs').get() as { count: number };
    
    logStep(
      'Create database',
      sessionCount.count === 1 && apiKeyCount.count === 1 && providerCount.count === 1,
      `Created database with sessions=${sessionCount.count}, api_keys=${apiKeyCount.count}, providers=${providerCount.count}`
    );
    
    db.close();
    db = null;

    console.log('\n[2/8] Run db:backup');
    console.log('-'.repeat(60));
    
    fs.mkdirSync(backupDir, { recursive: true });
    
    const absoluteTestDbPath = path.resolve(testDbPath);
    const absoluteBackupPath = path.resolve(backupPath);
    
    const backupResult = spawnSync('npx', ['tsx', 'src/cli/db-backup.ts', 'create', '--output', absoluteBackupPath], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: absoluteTestDbPath },
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    
    const backupCreated = backupResult.status === 0 && fs.existsSync(backupPath);
    logStep('Run backup', backupCreated, backupCreated ? 'Backup command completed' : `Backup failed: ${backupResult.stderr}`);

    console.log('\n[3/8] Verify backup file');
    console.log('-'.repeat(60));
    
    if (fs.existsSync(backupPath)) {
      const stats = fs.statSync(backupPath);
      const sizeValid = stats.size > 0;
      logStep('Backup file', sizeValid, `Backup exists with size ${stats.size} bytes`);
    } else {
      logStep('Backup file', false, 'Backup file does not exist');
    }

    console.log('\n[4/8] SQLite integrity check on backup');
    console.log('-'.repeat(60));
    
    const backupDb = new Database(backupPath, { readonly: true });
    const integrityResult = backupDb.pragma('integrity_check') as { integrity_check: string }[];
    backupDb.close();
    const integrityPassed = integrityResult[0]?.integrity_check === 'ok';
    logStep('Integrity check', integrityPassed, `Result: ${integrityResult[0]?.integrity_check}`);

    console.log('\n[5/8] Compare table counts');
    console.log('-'.repeat(60));
    
    const sourceDb = new Database(testDbPath, { readonly: true });
    const sourceTableCount = sourceDb.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { count: number };
    sourceDb.close();
    
    const backupDb2 = new Database(backupPath, { readonly: true });
    const backupTableCount = backupDb2.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { count: number };
    backupDb2.close();
    
    const tableCountMatch = sourceTableCount.count === backupTableCount.count;
    logStep('Table count', tableCountMatch, `Source: ${sourceTableCount.count}, Backup: ${backupTableCount.count}`);

    console.log('\n[6/8] Test restore flow');
    console.log('-'.repeat(60));
    
    const modifyDb = new Database(testDbPath);
    modifyDb.exec("INSERT INTO sessions (session_id, user_id, title, last_activity_at, created_at, updated_at) VALUES ('sess-002', 'user-001', 'Extra Session', datetime('now'), datetime('now'), datetime('now'))");
    const beforeRestoreCount = modifyDb.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    modifyDb.close();
    
    console.log(`  Sessions before restore: ${beforeRestoreCount.count} (added extra session)`);
    
    fs.copyFileSync(backupPath, testDbPath);
    
    const restoreDb = new Database(testDbPath);
    const afterRestoreCount = restoreDb.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    restoreDb.close();
    
    console.log(`  Sessions after restore: ${afterRestoreCount.count}`);
    
    const restoreSuccess = afterRestoreCount.count === 1 && beforeRestoreCount.count === 2;
    logStep('Restore flow', restoreSuccess, `Restored from ${beforeRestoreCount.count} to ${afterRestoreCount.count} sessions`);

    console.log('\n[7/8] Verify data integrity after restore');
    console.log('-'.repeat(60));
    
    const verifyDb = new Database(testDbPath, { readonly: true });
    
    const session = verifyDb.prepare("SELECT title FROM sessions WHERE session_id='sess-001'").get() as { title: string } | undefined;
    const apiKeyRow = verifyDb.prepare("SELECT key_hash, key_prefix FROM api_keys WHERE id='key-001'").get() as { key_hash: string; key_prefix: string } | undefined;
    const providerRow = verifyDb.prepare("SELECT encrypted_api_key, api_key_last4 FROM provider_configs WHERE provider_id='prov-001'").get() as { encrypted_api_key: string; api_key_last4: string } | undefined;
    const userRow = verifyDb.prepare("SELECT username FROM users WHERE user_id='user-001'").get() as { username: string } | undefined;
    const migrationRow = verifyDb.prepare("SELECT version FROM migrations WHERE version=100").get() as { version: number } | undefined;
    
    verifyDb.close();
    
    const sessionValid = session?.title === 'Test Session';
    const apiKeyHashValid = apiKeyRow?.key_hash === keyHash;
    const providerEncryptedValid = providerRow?.encrypted_api_key?.startsWith('aes-256-gcm:') ?? false;
    const userValid = userRow?.username === 'testuser';
    const migrationValid = migrationRow?.version === 100;
    
    const dataIntegrity = sessionValid && apiKeyHashValid && providerEncryptedValid && userValid && migrationValid;
    
    logStep('Data integrity', dataIntegrity, 
      `Session=${sessionValid}, APIKeyHash=${apiKeyHashValid}, ProviderEncrypted=${providerEncryptedValid}, User=${userValid}, Migration=${migrationValid}`);

    console.log('\n[8/8] Verify secrets remain hashed/encrypted');
    console.log('-'.repeat(60));
    
    const secretVerifyDb = new Database(testDbPath, { readonly: true });
    
    const allApiKeys = secretVerifyDb.prepare("SELECT key_hash FROM api_keys").all() as Array<{ key_hash: string }>;
    const noPlaintextApiKeys = !allApiKeys.some(k => k.key_hash === plainApiKey);
    
    const allProviders = secretVerifyDb.prepare("SELECT encrypted_api_key FROM provider_configs WHERE encrypted_api_key IS NOT NULL").all() as Array<{ encrypted_api_key: string }>;
    const allProvidersEncrypted = allProviders.every(p => p.encrypted_api_key.startsWith('aes-256-gcm:'));
    
    secretVerifyDb.close();
    
    const secretsPreserved = noPlaintextApiKeys && allProvidersEncrypted;
    
    logStep('Secrets preserved', secretsPreserved, 
      `API keys hashed (not plaintext)=${noPlaintextApiKeys}, Provider keys encrypted=${allProvidersEncrypted}`);

  } finally {
    if (db) {
      db.close();
    }
    console.log('\n🧹 Cleaning up temp files...');
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log('✅ Temp directory removed');
    } catch {
      console.log('⚠️ Could not remove temp directory');
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`  ${icon} ${result.step}: ${result.message}`);
  }
  
  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${passed}/${total} checks passed`);
  
  if (passed === total) {
    console.log('\n✅ All backup/restore verification checks PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ Some checks FAILED');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
