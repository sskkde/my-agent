#!/usr/bin/env node
import { createConnectionManager } from '../storage/connection.js';
import { createMigrationRunner } from '../storage/migrations.js';
import type { Migration } from '../storage/migrations.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DATABASE_URL || './data/agent-platform.db';

async function main(): Promise<void> {
  const command = process.argv[2] || 'up';
  
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  const connection = createConnectionManager(DB_PATH);
  connection.open();
  
  try {
    const migrations = createMigrationRunner(connection);
    migrations.init();
    
    if (command === 'up') {
      const migrationFiles = loadMigrations();
      if (migrationFiles.length === 0) {
        console.log('No migrations found.');
        return;
      }
      
      const currentVersion = migrations.getCurrentVersion();
      console.log(`Current database version: ${currentVersion}`);
      
      migrations.apply(migrationFiles);
      
      const newVersion = migrations.getCurrentVersion();
      console.log(`Migrated to version: ${newVersion}`);
      
      if (newVersion === currentVersion) {
        console.log('Database is up to date.');
      } else {
        console.log(`Applied ${newVersion - currentVersion} migration(s).`);
      }
    } else if (command === 'status') {
      const version = migrations.getCurrentVersion();
      console.log(`Current database version: ${version}`);
      
      const migrationFiles = loadMigrations();
      console.log(`Available migrations: ${migrationFiles.length}`);
      
      if (migrationFiles.length > 0) {
        console.log('\nMigration files:');
        for (const m of migrationFiles) {
          const status = m.version <= version ? '✓ applied' : '○ pending';
          console.log(`  ${status} ${m.version.toString().padStart(3, '0')}_${m.name}`);
        }
      }
    } else if (command === 'create') {
      const name = process.argv[3];
      if (!name) {
        console.error('Usage: db:migrate create <migration-name>');
        process.exit(1);
      }
      
      const migrationFiles = loadMigrations();
      const nextVersion = migrationFiles.length > 0 
        ? Math.max(...migrationFiles.map(m => m.version)) + 1 
        : 1;
      
      const migrationsDir = path.join(process.cwd(), 'migrations');
      if (!fs.existsSync(migrationsDir)) {
        fs.mkdirSync(migrationsDir, { recursive: true });
      }
      
      const filename = `${nextVersion.toString().padStart(3, '0')}_${name}.sql`;
      const filepath = path.join(migrationsDir, filename);
      
      const template = `-- Migration: ${name}
-- Version: ${nextVersion}
-- Created: ${new Date().toISOString()}

-- Up migration


-- Down migration (for rollback)

`;
      
      fs.writeFileSync(filepath, template);
      console.log(`Created migration: ${filepath}`);
    } else {
      console.error(`Unknown command: ${command}`);
      console.error('Usage: db:migrate [up|status|create]');
      process.exit(1);
    }
  } finally {
    connection.close();
  }
}

function loadMigrations(): Migration[] {
  const migrationsDir = path.join(process.cwd(), 'migrations');
  
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  const migrations: Migration[] = [];
  
  for (const filename of files) {
    const match = filename.match(/^(\d+)_(.+)\.sql$/);
    if (!match) continue;
    
    const version = parseInt(match[1], 10);
    const name = match[2];
    const content = fs.readFileSync(path.join(migrationsDir, filename), 'utf-8');
    
    // Parse up and down sections
    const upMatch = content.match(/--\s*Up\s*migration\s*\n([\s\S]*?)(?=--\s*Down|$)/i);
    const downMatch = content.match(/--\s*Down\s*migration\s*\n([\s\S]*)/i);
    
    migrations.push({
      version,
      name,
      up: upMatch ? upMatch[1].trim() : '',
      down: downMatch ? downMatch[1].trim() : ''
    });
  }
  
  return migrations;
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
