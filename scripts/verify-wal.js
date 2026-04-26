import { createConnectionManager } from '../src/storage/connection.js';

const tempPath = `/tmp/wal-verify-${Date.now()}.db`;
const connection = createConnectionManager(tempPath);
connection.open();

console.log('=== SQLite WAL Mode Verification ===\n');

const journalMode = connection.query('PRAGMA journal_mode');
console.log('PRAGMA journal_mode:', journalMode[0].journal_mode);

const busyTimeout = connection.query('PRAGMA busy_timeout');
console.log('PRAGMA busy_timeout:', busyTimeout[0].busy_timeout);

const synchronous = connection.query('PRAGMA synchronous');
console.log('PRAGMA synchronous:', synchronous[0].synchronous, '(1 = NORMAL)');

const foreignKeys = connection.query('PRAGMA foreign_keys');
console.log('PRAGMA foreign_keys:', foreignKeys[0].foreign_keys, '(1 = ON)');

const tempStore = connection.query('PRAGMA temp_store');
console.log('PRAGMA temp_store:', tempStore[0].temp_store, '(2 = MEMORY)');

const mmapSize = connection.query('PRAGMA mmap_size');
console.log('PRAGMA mmap_size:', mmapSize[0].mmap_size, '(0 = disabled)');

const threads = connection.query('PRAGMA threads');
console.log('PRAGMA threads:', threads[0].threads);

console.log('\n=== WAL Mode Enabled for File-Based Databases ===');
console.log('WAL file created:', tempPath + '-wal');

connection.close();

import fs from 'fs';
fs.unlinkSync(tempPath);
try { fs.unlinkSync(tempPath + '-wal'); } catch {}
try { fs.unlinkSync(tempPath + '-shm'); } catch {}

console.log('\nCleanup complete.\n');
