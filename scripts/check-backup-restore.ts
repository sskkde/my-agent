#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Backup/Restore Verification Script');
  console.log('='.repeat(60));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-restore-test-'));
  const testDbPath = path.join(tempDir, 'test.db');
  const backupDir = path.join(tempDir, 'backups');
  const backupPath = path.join(backupDir, 'backup-test.db');

  console.log(`\n📁 Temp directory: ${tempDir}`);
  console.log(`📁 Test database: ${testDbPath}`);

  let db: Database.Database | null = null;

  try {
    console.log('\n[1/7] Create test database with sample data');
    console.log('-'.repeat(60));
    
    db = new Database(testDbPath);
    
    db.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.exec(`CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.exec(`INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')`);
    db.exec(`INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')`);
    db.exec(`INSERT INTO users (name, email) VALUES ('Charlie', 'charlie@example.com')`);
    
    db.exec(`INSERT INTO messages (user_id, content) VALUES (1, 'Hello from Alice')`);
    db.exec(`INSERT INTO messages (user_id, content) VALUES (2, 'Hello from Bob')`);
    db.exec(`INSERT INTO messages (user_id, content) VALUES (1, 'Another message from Alice')`);
    
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
    
    logStep(
      'Create database',
      userCount.count === 3 && messageCount.count === 3,
      `Created database with ${userCount.count} users and ${messageCount.count} messages`
    );
    
    db.close();
    db = null;

    console.log('\n[2/7] Run db:backup');
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

    console.log('\n[3/7] Verify backup file');
    console.log('-'.repeat(60));
    
    if (fs.existsSync(backupPath)) {
      const stats = fs.statSync(backupPath);
      const sizeValid = stats.size > 0;
      logStep('Backup file', sizeValid, `Backup exists with size ${stats.size} bytes`);
    } else {
      logStep('Backup file', false, 'Backup file does not exist');
    }

    console.log('\n[4/7] SQLite integrity check on backup');
    console.log('-'.repeat(60));
    
    const backupDb = new Database(backupPath, { readonly: true });
    const integrityResult = backupDb.pragma('integrity_check') as { integrity_check: string }[];
    backupDb.close();
    const integrityPassed = integrityResult[0]?.integrity_check === 'ok';
    logStep('Integrity check', integrityPassed, `Result: ${integrityResult[0]?.integrity_check}`);

    console.log('\n[5/7] Compare table counts');
    console.log('-'.repeat(60));
    
    const sourceDb = new Database(testDbPath, { readonly: true });
    const sourceTableCount = sourceDb.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { count: number };
    sourceDb.close();
    
    const backupDb2 = new Database(backupPath, { readonly: true });
    const backupTableCount = backupDb2.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { count: number };
    backupDb2.close();
    
    const tableCountMatch = sourceTableCount.count === backupTableCount.count;
    logStep('Table count', tableCountMatch, `Source: ${sourceTableCount.count}, Backup: ${backupTableCount.count}`);

    console.log('\n[6/7] Test restore flow');
    console.log('-'.repeat(60));
    
    const modifyDb = new Database(testDbPath);
    modifyDb.exec("INSERT INTO users (name, email) VALUES ('Dave', 'dave@example.com')");
    const beforeRestoreCount = modifyDb.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    modifyDb.close();
    
    console.log(`  Users before restore: ${beforeRestoreCount.count} (added Dave)`);
    
    fs.copyFileSync(backupPath, testDbPath);
    
    const restoreDb = new Database(testDbPath);
    const afterRestoreCount = restoreDb.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    restoreDb.close();
    
    console.log(`  Users after restore: ${afterRestoreCount.count}`);
    
    const restoreSuccess = afterRestoreCount.count === 3 && beforeRestoreCount.count === 4;
    logStep('Restore flow', restoreSuccess, `Restored from ${beforeRestoreCount.count} to ${afterRestoreCount.count} users`);

    console.log('\n[7/7] Verify data integrity after restore');
    console.log('-'.repeat(60));
    
    const verifyDb = new Database(testDbPath, { readonly: true });
    
    const alice = verifyDb.prepare("SELECT name FROM users WHERE email='alice@example.com'").get() as { name: string } | undefined;
    const bob = verifyDb.prepare("SELECT name FROM users WHERE email='bob@example.com'").get() as { name: string } | undefined;
    const charlie = verifyDb.prepare("SELECT name FROM users WHERE email='charlie@example.com'").get() as { name: string } | undefined;
    const messageCountAfter = verifyDb.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
    
    verifyDb.close();
    
    const aliceExists = alice?.name === 'Alice';
    const bobExists = bob?.name === 'Bob';
    const charlieExists = charlie?.name === 'Charlie';
    const messagesCorrect = messageCountAfter.count === 3;
    
    const dataIntegrity = aliceExists && bobExists && charlieExists && messagesCorrect;
    logStep('Data integrity', dataIntegrity, 
      `Users: Alice=${aliceExists}, Bob=${bobExists}, Charlie=${charlieExists}; Messages: ${messageCountAfter.count}`);

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
