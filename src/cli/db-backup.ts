#!/usr/bin/env node
import { createConnectionManager } from '../storage/connection.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DATABASE_URL || './data/agent-platform.db';

interface BackupOptions {
  outputPath?: string;
  includeWAL?: boolean;
  compress?: boolean;
}

interface BackupResult {
  success: boolean;
  sourcePath: string;
  backupPath: string;
  timestamp: string;
  files: {
    database: { path: string; size: number };
    wal?: { path: string; size: number };
    shm?: { path: string; size: number };
  };
  totalSize: number;
  error?: string;
}

async function createBackup(options: BackupOptions = {}): Promise<BackupResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOutput = path.join(
    path.dirname(DB_PATH),
    'backups',
    `backup-${timestamp}.db`
  );
  const outputPath = options.outputPath || defaultOutput;

  const result: BackupResult = {
    success: false,
    sourcePath: DB_PATH,
    backupPath: outputPath,
    timestamp: new Date().toISOString(),
    files: {
      database: { path: outputPath, size: 0 },
    },
    totalSize: 0,
  };

  try {
    // Ensure source database exists
    if (!fs.existsSync(DB_PATH)) {
      throw new Error(`Source database not found: ${DB_PATH}`);
    }

    // Ensure backup directory exists
    const backupDir = path.dirname(outputPath);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Use SQLite's backup API for consistency
    const sourceConn = createConnectionManager(DB_PATH);
    sourceConn.open();

    try {
      // Checkpoint WAL to ensure all data is in the main database
      sourceConn.query('PRAGMA wal_checkpoint(TRUNCATE)');

      // Create backup using SQLite backup
      const backupConn = createConnectionManager(outputPath);
      backupConn.open();

      try {
        // Copy schema and data
        const schema = sourceConn.query<{ sql: string }>(`
          SELECT sql FROM sqlite_master 
          WHERE type IN ('table', 'index', 'view', 'trigger') 
          AND sql IS NOT NULL
          ORDER BY type, name
        `);

        for (const { sql } of schema) {
          backupConn.exec(sql);
        }

        // Get all tables
        const tables = sourceConn.query<{ name: string }>(`
          SELECT name FROM sqlite_master 
          WHERE type = 'table' 
          AND name NOT LIKE 'sqlite_%'
        `);

        // Copy data from each table
        for (const { name } of tables) {
          const rows = sourceConn.query<Record<string, unknown>>(`SELECT * FROM "${name}"`);
          
          if (rows.length > 0) {
            const columns = Object.keys(rows[0]!);
            const placeholders = columns.map(() => '?').join(', ');
            const insertSql = `INSERT INTO "${name}" (${columns.join(', ')}) VALUES (${placeholders})`;
            
            for (const row of rows) {
              const values = columns.map(col => {
                const val = row[col];
                if (val === null || val === undefined) return null;
                if (typeof val === 'object') return JSON.stringify(val);
                return val;
              });
              backupConn.exec(insertSql, values);
            }
          }
        }

        result.success = true;
      } finally {
        backupConn.close();
      }
    } finally {
      sourceConn.close();
    }

    // Get file sizes
    const dbStats = fs.statSync(outputPath);
    result.files.database.size = dbStats.size;
    result.totalSize = dbStats.size;

    // Optionally include WAL files
    if (options.includeWAL) {
      const walSource = DB_PATH + '-wal';
      const walDest = outputPath + '-wal';
      const shmSource = DB_PATH + '-shm';
      const shmDest = outputPath + '-shm';

      if (fs.existsSync(walSource)) {
        fs.copyFileSync(walSource, walDest);
        const walStats = fs.statSync(walDest);
        result.files.wal = { path: walDest, size: walStats.size };
        result.totalSize += walStats.size;
      }

      if (fs.existsSync(shmSource)) {
        fs.copyFileSync(shmSource, shmDest);
        const shmStats = fs.statSync(shmDest);
        result.files.shm = { path: shmDest, size: shmStats.size };
        result.totalSize += shmStats.size;
      }
    }

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.success = false;
  }

  return result;
}

async function exportToSQL(outputPath: string): Promise<{ success: boolean; path: string; error?: string }> {
  try {
    if (!fs.existsSync(DB_PATH)) {
      throw new Error(`Source database not found: ${DB_PATH}`);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const connection = createConnectionManager(DB_PATH);
    connection.open();

    let sql = `-- Agent Platform Database Export
-- Generated: ${new Date().toISOString()}
-- Source: ${DB_PATH}

PRAGMA foreign_keys = OFF;

`;

    try {
      // Get schema
      const schema = connection.query<{ type: string; name: string; sql: string }>(`
        SELECT type, name, sql FROM sqlite_master 
        WHERE type IN ('table', 'index', 'view', 'trigger') 
        AND sql IS NOT NULL
        ORDER BY 
          CASE type 
            WHEN 'table' THEN 1 
            WHEN 'index' THEN 2 
            WHEN 'view' THEN 3 
            WHEN 'trigger' THEN 4 
          END,
          name
      `);

      // Add table schemas
      sql += `-- Schema\n\n`;
      for (const item of schema.filter(s => s.type === 'table')) {
        sql += `${item.sql};\n\n`;
      }

      // Get data from each table
      const tables = connection.query<{ name: string }>(`
        SELECT name FROM sqlite_master 
        WHERE type = 'table' 
        AND name NOT LIKE 'sqlite_%'
      `);

      for (const { name } of tables) {
        const rows = connection.query<Record<string, unknown>>(`SELECT * FROM "${name}"`);
        
        if (rows.length > 0) {
          sql += `-- Data for table: ${name}\n`;
          
          const columns = Object.keys(rows[0]!);
          const columnList = columns.join(', ');
          
          for (const row of rows) {
            const values = columns.map(col => {
              const val = row[col];
              if (val === null || val === undefined) return 'NULL';
              if (typeof val === 'number') return val.toString();
              const escaped = String(val).replace(/'/g, "''");
              return `'${escaped}'`;
            });
            
            sql += `INSERT INTO "${name}" (${columnList}) VALUES (${values.join(', ')});\n`;
          }
          
          sql += '\n';
        }
      }

      // Add indexes
      sql += `-- Indexes\n\n`;
      for (const item of schema.filter(s => s.type === 'index')) {
        sql += `${item.sql};\n`;
      }

      sql += `\nPRAGMA foreign_keys = ON;\n`;

      fs.writeFileSync(outputPath, sql);

      return { success: true, path: outputPath };
    } finally {
      connection.close();
    }
  } catch (error) {
    return { 
      success: false, 
      path: outputPath, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function printUsage(): void {
  console.log('Database Backup Tool');
  console.log('');
  console.log('Usage:');
  console.log('  db:backup create [options]     Create a backup of the database');
  console.log('  db:backup export [options]     Export database to SQL file');
  console.log('  db:backup list                 List available backups');
  console.log('');
  console.log('Options:');
  console.log('  --output <path>               Output file path');
  console.log('  --include-wal                 Include WAL files in backup');
  console.log('  --json                        Output in JSON format');
}

async function listBackups(): Promise<void> {
  const backupDir = path.join(path.dirname(DB_PATH), 'backups');
  
  if (!fs.existsSync(backupDir)) {
    console.log('No backups directory found.');
    return;
  }

  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const stats = fs.statSync(path.join(backupDir, f));
      return {
        name: f,
        size: stats.size,
        created: stats.birthtime,
      };
    })
    .sort((a, b) => b.created.getTime() - a.created.getTime());

  if (files.length === 0) {
    console.log('No backups found.');
    return;
  }

  console.log('Available Backups:');
  console.log('─'.repeat(80));
  console.log('Date                      Size        Filename');
  console.log('─'.repeat(80));
  
  for (const file of files) {
    const date = file.created.toISOString().slice(0, 19).replace('T', ' ');
    const size = formatBytes(file.size).padStart(10);
    console.log(`${date}  ${size}  ${file.name}`);
  }
  
  console.log('─'.repeat(80));
  console.log(`Total: ${files.length} backup(s)`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const useJson = args.includes('--json');

  try {
    switch (command) {
      case 'create': {
        const outputIndex = args.indexOf('--output');
        const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
        const includeWAL = args.includes('--include-wal');

        const result = await createBackup({ outputPath, includeWAL });

        if (useJson) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.success) {
            console.log('✓ Backup created successfully');
            console.log(`  Source: ${result.sourcePath}`);
            console.log(`  Backup: ${result.backupPath}`);
            console.log(`  Size:   ${formatBytes(result.totalSize)}`);
            if (result.files.wal) {
              console.log(`  WAL:    ${formatBytes(result.files.wal.size)}`);
            }
          } else {
            console.error('✗ Backup failed:', result.error);
            process.exit(1);
          }
        }
        break;
      }

      case 'export': {
        const outputIndex = args.indexOf('--output');
        const outputPath = outputIndex >= 0 
          ? args[outputIndex + 1] 
          : path.join(path.dirname(DB_PATH), 'backups', `export-${Date.now()}.sql`);

        const result = await exportToSQL(outputPath);

        if (useJson) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.success) {
            const stats = fs.statSync(result.path);
            console.log('✓ Database exported to SQL');
            console.log(`  Path: ${result.path}`);
            console.log(`  Size: ${formatBytes(stats.size)}`);
          } else {
            console.error('✗ Export failed:', result.error);
            process.exit(1);
          }
        }
        break;
      }

      case 'list': {
        await listBackups();
        break;
      }

      default:
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
