import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js'
import { createTransactionHelper, type TransactionHelper } from '../../../src/storage/transaction.js'

describe('SQLite Infrastructure', () => {
  describe('Connection Manager', () => {
    let connection: ConnectionManager

    afterEach(() => {
      connection?.close()
    })

    it('should create connection with WAL mode enabled (file-based)', () => {
      // WAL mode only works with file-based databases, not :memory:
      const tempPath = `/tmp/test-wal-${Date.now()}.db`
      connection = createConnectionManager(tempPath)
      connection.open()

      const result = connection.query<{ journal_mode: string }>('PRAGMA journal_mode')
      expect(result[0]?.journal_mode.toLowerCase()).toBe('wal')

      // Cleanup
      connection.close()
      try {
        require('fs').unlinkSync(tempPath)
        require('fs').unlinkSync(tempPath + '-wal')
        require('fs').unlinkSync(tempPath + '-shm')
      } catch {}
    })

    it('should handle memory database without WAL mode', () => {
      connection = createConnectionManager(':memory:')
      connection.open()

      // Memory database returns 'memory' for journal_mode
      const result = connection.query<{ journal_mode: string }>('PRAGMA journal_mode')
      expect(result[0]?.journal_mode.toLowerCase()).toBe('memory')
    })

    it('should set busy timeout to 5000ms', () => {
      connection = createConnectionManager(':memory:')
      connection.open()

      const result = connection.query<{ timeout: number }>('PRAGMA busy_timeout')
      expect(result[0]?.timeout).toBe(5000)
    })

    it('should set synchronous mode to NORMAL for durability/performance balance', () => {
      connection = createConnectionManager(':memory:')
      connection.open()

      // SQLite returns 1 for NORMAL, 2 for FULL, 0 for OFF
      const result = connection.query<{ synchronous: number }>('PRAGMA synchronous')
      expect(result[0]?.synchronous).toBe(1)
    })

    it('should close connection gracefully', () => {
      connection = createConnectionManager(':memory:')
      connection.open()

      expect(connection.isOpen()).toBe(true)
      connection.close()
      expect(connection.isOpen()).toBe(false)
    })

    it('should support foreign keys', () => {
      connection = createConnectionManager(':memory:')
      connection.open()

      const result = connection.query<{ foreign_keys: 0 | 1 }>('PRAGMA foreign_keys')
      expect(result[0]?.foreign_keys).toBe(1)
    })

    it('should be optimized for low-resource server (2 cores / 2GB RAM)', () => {
      connection = createConnectionManager(':memory:')
      connection.open()

      // Verify cache size is reasonable for 2GB RAM
      const cacheResult = connection.query<{ cache_size: number }>('PRAGMA cache_size')
      expect(cacheResult[0]?.cache_size).toBeLessThan(0)

      // SQLite returns 2 for MEMORY, 1 for FILE, 0 for DEFAULT
      const tempResult = connection.query<{ temp_store: number }>('PRAGMA temp_store')
      expect(tempResult[0]?.temp_store).toBe(2)
    })
  })

  describe('Migration Runner', () => {
    let connection: ConnectionManager
    let migrations: MigrationRunner

    beforeEach(() => {
      connection = createConnectionManager(':memory:')
      connection.open()
      migrations = createMigrationRunner(connection)
    })

    afterEach(() => {
      connection?.close()
    })

    it('should create migrations table on init', () => {
      migrations.init()

      const result = connection.query<{ name: string }>(`
        SELECT name FROM sqlite_master 
        WHERE type = 'table' AND name = 'migrations'
      `)
      expect(result.length).toBe(1)
      expect(result[0]?.name).toBe('migrations')
    })

    it('should track schema version in migrations table', () => {
      migrations.init()

      const columns = connection.query<{ name: string }>(`
        SELECT name FROM pragma_table_info('migrations')
      `)
      const columnNames = columns.map((c) => c.name)

      expect(columnNames).toContain('version')
      expect(columnNames).toContain('name')
      expect(columnNames).toContain('applied_at')
      expect(columnNames).toContain('checksum')
    })

    it('should return current version 0 for fresh database', () => {
      migrations.init()
      const version = migrations.getCurrentVersion()
      expect(version).toBe(0)
    })

    it('should apply single migration and update version', () => {
      migrations.init()

      const testMigration: Migration = {
        version: 1,
        name: 'create_users_table',
        up: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
        down: 'DROP TABLE IF EXISTS users',
      }

      migrations.apply([testMigration])

      const version = migrations.getCurrentVersion()
      expect(version).toBe(1)

      // Verify table was created
      const result = connection.query<{ name: string }>(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'
      `)
      expect(result.length).toBe(1)
    })

    it('should apply multiple migrations in order', () => {
      migrations.init()

      const migrationList: Migration[] = [
        {
          version: 1,
          name: 'create_users',
          up: 'CREATE TABLE users (id INTEGER PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS users',
        },
        {
          version: 2,
          name: 'create_posts',
          up: 'CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER)',
          down: 'DROP TABLE IF EXISTS posts',
        },
        {
          version: 3,
          name: 'add_posts_index',
          up: 'CREATE INDEX idx_posts_user ON posts(user_id)',
          down: 'DROP INDEX IF EXISTS idx_posts_user',
        },
      ]

      migrations.apply(migrationList)

      expect(migrations.getCurrentVersion()).toBe(3)

      // Verify migrations were recorded
      const applied = connection.query<{ version: number; name: string }>(
        'SELECT version, name FROM migrations ORDER BY version',
      )
      expect(applied.length).toBe(3)
      expect(applied[0]).toEqual({ version: 1, name: 'create_users' })
      expect(applied[1]).toEqual({ version: 2, name: 'create_posts' })
      expect(applied[2]).toEqual({ version: 3, name: 'add_posts_index' })
    })

    it('should skip already applied migrations', () => {
      migrations.init()

      const migrationList: Migration[] = [
        {
          version: 1,
          name: 'create_users',
          up: 'CREATE TABLE users (id INTEGER PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS users',
        },
      ]

      migrations.apply(migrationList)

      // Apply again - should not fail and should skip
      migrations.apply(migrationList)

      // Should still only have 1 migration record
      const applied = connection.query<{ version: number }>('SELECT version FROM migrations')
      expect(applied.length).toBe(1)
    })

    it('should fail migration and roll back cleanly', () => {
      migrations.init()

      const badMigration: Migration = {
        version: 1,
        name: 'bad_migration',
        up: 'INVALID SQL SYNTAX HERE',
        down: '',
      }

      expect(() => {
        migrations.apply([badMigration])
      }).toThrow()

      // Version should still be 0
      expect(migrations.getCurrentVersion()).toBe(0)

      // No migration should be recorded
      const applied = connection.query<{ version: number }>('SELECT version FROM migrations')
      expect(applied.length).toBe(0)
    })

    it('should roll back partial changes on migration failure', () => {
      migrations.init()

      // First create a good table
      connection.exec('CREATE TABLE existing_table (id INTEGER PRIMARY KEY)')

      const badMigration: Migration = {
        version: 1,
        name: 'partial_failure',
        // This creates a table first, then fails
        up: 'CREATE TABLE temp_table (id INTEGER); INVALID SQL;',
        down: 'DROP TABLE IF EXISTS temp_table',
      }

      expect(() => {
        migrations.apply([badMigration])
      }).toThrow()

      // temp_table should not exist due to rollback
      const result = connection.query<{ name: string }>(`
        SELECT name FROM sqlite_master 
        WHERE type = 'table' AND name = 'temp_table'
      `)
      expect(result.length).toBe(0)

      // Existing table should still exist
      const existing = connection.query<{ name: string }>(`
        SELECT name FROM sqlite_master 
        WHERE type = 'table' AND name = 'existing_table'
      `)
      expect(existing.length).toBe(1)
    })

    it('should not apply migrations with version gaps', () => {
      migrations.init()

      const migrationList: Migration[] = [
        {
          version: 1,
          name: 'step1',
          up: 'CREATE TABLE t1 (id INTEGER)',
          down: 'DROP TABLE IF EXISTS t1',
        },
        {
          version: 3, // Gap - version 2 is missing
          name: 'step3',
          up: 'CREATE TABLE t3 (id INTEGER)',
          down: 'DROP TABLE IF EXISTS t3',
        },
      ]

      expect(() => {
        migrations.apply(migrationList)
      }).toThrow('Migration version gap detected')

      // Only version 1 should be applied
      expect(migrations.getCurrentVersion()).toBe(1)
    })
  })

  describe('Transaction Helper', () => {
    let connection: ConnectionManager
    let transactions: TransactionHelper

    beforeEach(() => {
      connection = createConnectionManager(':memory:')
      connection.open()
      transactions = createTransactionHelper(connection)

      // Create a test table
      connection.exec('CREATE TABLE test_data (id INTEGER PRIMARY KEY, value TEXT)')
    })

    afterEach(() => {
      connection?.close()
    })

    it('should begin and commit transaction', () => {
      transactions.begin()
      connection.exec("INSERT INTO test_data (value) VALUES ('test1')")
      transactions.commit()

      const result = connection.query<{ value: string }>('SELECT value FROM test_data')
      expect(result.length).toBe(1)
      expect(result[0]?.value).toBe('test1')
    })

    it('should roll back transaction on error', () => {
      transactions.begin()
      connection.exec("INSERT INTO test_data (value) VALUES ('test1')")
      transactions.rollback()

      const result = connection.query<{ value: string }>('SELECT value FROM test_data')
      expect(result.length).toBe(0)
    })

    it('should support transaction callback with automatic commit', async () => {
      await transactions.withTransaction(async () => {
        connection.exec("INSERT INTO test_data (value) VALUES ('auto1')")
        connection.exec("INSERT INTO test_data (value) VALUES ('auto2')")
      })

      const result = connection.query<{ value: string }>('SELECT value FROM test_data ORDER BY value')
      expect(result.length).toBe(2)
      expect(result[0]?.value).toBe('auto1')
      expect(result[1]?.value).toBe('auto2')
    })

    it('should roll back transaction callback on error', async () => {
      try {
        await transactions.withTransaction(async () => {
          connection.exec("INSERT INTO test_data (value) VALUES ('should_rollback')")
          throw new Error('Intentional error')
        })
        expect.fail('Should have thrown')
      } catch {
        // Expected
      }

      const result = connection.query<{ value: string }>('SELECT value FROM test_data')
      expect(result.length).toBe(0)
    })

    it('should support nested transaction with savepoints', async () => {
      await transactions.withTransaction(async () => {
        connection.exec("INSERT INTO test_data (value) VALUES ('outer')")

        await transactions.withTransaction(async () => {
          connection.exec("INSERT INTO test_data (value) VALUES ('inner')")
        })
      })

      const result = connection.query<{ value: string }>('SELECT value FROM test_data ORDER BY value')
      expect(result.length).toBe(2)
    })

    it('should roll back inner transaction without affecting outer', async () => {
      await transactions.withTransaction(async () => {
        connection.exec("INSERT INTO test_data (value) VALUES ('outer_stays')")

        try {
          await transactions.withTransaction(async () => {
            connection.exec("INSERT INTO test_data (value) VALUES ('inner_rollback')")
            throw new Error('Inner error')
          })
        } catch {
          // Expected inner error
        }
      })

      const result = connection.query<{ value: string }>('SELECT value FROM test_data')
      expect(result.length).toBe(1)
      expect(result[0]?.value).toBe('outer_stays')
    })

    it('should track transaction depth', () => {
      expect(transactions.getDepth()).toBe(0)

      transactions.begin()
      expect(transactions.getDepth()).toBe(1)

      transactions.begin() // Savepoint
      expect(transactions.getDepth()).toBe(2)

      transactions.rollback()
      expect(transactions.getDepth()).toBe(1)

      transactions.rollback()
      expect(transactions.getDepth()).toBe(0)
    })

    it('should handle overlapping withTransaction calls without corrupting depth', async () => {
      const p1 = transactions.withTransaction(async () => {
        connection.exec("INSERT INTO test_data (value) VALUES ('tx1')")
        await new Promise((resolve) => setTimeout(resolve, 50))
        return 'tx1'
      })

      await new Promise((resolve) => setTimeout(resolve, 5))

      const p2 = transactions.withTransaction(async () => {
        connection.exec("INSERT INTO test_data (value) VALUES ('tx2')")
        return 'tx2'
      })

      const [r1, r2] = await Promise.all([p1, p2])

      expect(r1).toBe('tx1')
      expect(r2).toBe('tx2')

      const rows = connection.query<{ value: string }>(
        'SELECT value FROM test_data ORDER BY value',
      )
      expect(rows.length).toBe(2)
      expect(rows[0]?.value).toBe('tx1')
      expect(rows[1]?.value).toBe('tx2')

      expect(transactions.getDepth()).toBe(0)
    })

    it('should isolate rollback in overlapping withTransaction without corrupting depth', async () => {
      const p1 = transactions.withTransaction(async () => {
        connection.exec("INSERT INTO test_data (value) VALUES ('outer')")
        await new Promise((resolve) => setTimeout(resolve, 50))
        return 'outer'
      })

      await new Promise((resolve) => setTimeout(resolve, 5))

      let innerError: Error | undefined
      const p2 = transactions
        .withTransaction(async () => {
          connection.exec("INSERT INTO test_data (value) VALUES ('inner')")
          throw new Error('inner fails')
        })
        .catch((e: unknown) => {
          innerError = e as Error
        })

      const [r1] = await Promise.all([p1, p2])

      expect(r1).toBe('outer')
      expect(innerError?.message).toBe('inner fails')

      const rows = connection.query<{ value: string }>('SELECT value FROM test_data')
      expect(rows.length).toBe(1)
      expect(rows[0]?.value).toBe('outer')

      expect(transactions.getDepth()).toBe(0)
    })
  })

  describe('Integration: Migrations use transactions', () => {
    let connection: ConnectionManager
    let migrations: MigrationRunner

    beforeEach(() => {
      connection = createConnectionManager(':memory:')
      connection.open()
      migrations = createMigrationRunner(connection)
      migrations.init()
    })

    afterEach(() => {
      connection?.close()
    })

    it('should wrap each migration in a transaction', () => {
      const migration: Migration = {
        version: 1,
        name: 'transaction_test',
        up: `
          CREATE TABLE table1 (id INTEGER);
          CREATE TABLE table2 (id INTEGER);
        `,
        down: `
          DROP TABLE IF EXISTS table1;
          DROP TABLE IF EXISTS table2;
        `,
      }

      migrations.apply([migration])

      // Both tables should exist
      const tables = connection.query<{ name: string }>(`
        SELECT name FROM sqlite_master 
        WHERE type = 'table' AND name IN ('table1', 'table2')
      `)
      expect(tables.length).toBe(2)
    })
  })
})
