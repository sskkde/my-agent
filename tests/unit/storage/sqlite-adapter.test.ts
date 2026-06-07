import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteAdapter, createSqliteAdapter } from '../../../src/storage/adapters/sqlite/sqlite-adapter.js'
import { DatabaseAdapterError } from '../../../src/storage/database-adapter.js'
import type { DatabaseAdapter } from '../../../src/storage/database-adapter.js'

describe('SqliteAdapter', () => {
  let adapter: DatabaseAdapter

  beforeEach(() => {
    adapter = createSqliteAdapter(':memory:')
  })

  afterEach(() => {
    if (adapter.isOpen()) {
      adapter.close()
    }
  })

  describe('construction and opening', () => {
    it('creates adapter with path', () => {
      expect(adapter).toBeDefined()
      expect(adapter.isOpen()).toBe(false)
    })

    it('opens connection', () => {
      adapter.open()
      expect(adapter.isOpen()).toBe(true)
    })

    it('isOpen returns false before open', () => {
      expect(adapter.isOpen()).toBe(false)
    })

    it('isOpen returns true after open', () => {
      adapter.open()
      expect(adapter.isOpen()).toBe(true)
    })
  })

  describe('sync query/exec', () => {
    beforeEach(() => {
      adapter.open()
    })

    it('exec creates a table', () => {
      adapter.exec('CREATE TABLE test_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
      adapter.exec("INSERT INTO test_items (name) VALUES ('alpha')")
      const rows = adapter.query<{ id: number; name: string }>('SELECT * FROM test_items')
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('alpha')
    })

    it('query returns rows', () => {
      adapter.exec('CREATE TABLE test_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
      adapter.exec("INSERT INTO test_items (name) VALUES ('alpha')")
      adapter.exec("INSERT INTO test_items (name) VALUES ('beta')")
      const rows = adapter.query<{ id: number; name: string }>('SELECT * FROM test_items')
      expect(rows).toHaveLength(2)
    })

    it('query with params returns filtered results', () => {
      adapter.exec('CREATE TABLE test_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
      adapter.exec("INSERT INTO test_items (name) VALUES ('alpha')")
      adapter.exec("INSERT INTO test_items (name) VALUES ('beta')")
      const rows = adapter.query<{ id: number; name: string }>('SELECT * FROM test_items WHERE name = ?', ['alpha'])
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('alpha')
    })

    it('exec with params inserts data', () => {
      adapter.exec('CREATE TABLE test_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
      adapter.exec('INSERT INTO test_items (name) VALUES (?)', ['gamma'])
      const rows = adapter.query<{ id: number; name: string }>('SELECT * FROM test_items')
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('gamma')
    })
  })

  describe('transaction', () => {
    beforeEach(() => {
      adapter.open()
      adapter.exec('CREATE TABLE test_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    })

    it('wraps multiple operations correctly', () => {
      const runTxn = adapter.transaction(() => {
        adapter.exec("INSERT INTO test_items (name) VALUES ('one')")
        adapter.exec("INSERT INTO test_items (name) VALUES ('two')")
        return true
      })
      runTxn()
      const rows = adapter.query<{ id: number; name: string }>('SELECT * FROM test_items')
      expect(rows).toHaveLength(2)
    })

    it('rollback on error', () => {
      try {
        const runTxn = adapter.transaction(() => {
          adapter.exec("INSERT INTO test_items (name) VALUES ('before-error')")
          throw new Error('deliberate failure')
        })
        runTxn()
      } catch {}
      const rows = adapter.query<{ id: number; name: string }>('SELECT * FROM test_items')
      expect(rows).toHaveLength(0)
    })
  })

  describe('async methods throw', () => {
    beforeEach(() => {
      adapter.open()
    })

    it('asyncQuery throws DatabaseAdapterError', () => {
      expect(() => adapter.asyncQuery('SELECT 1')).toThrow(DatabaseAdapterError)
    })

    it('asyncQuery error message mentions sync methods', () => {
      expect(() => adapter.asyncQuery('SELECT 1')).toThrow('Use sync methods instead')
    })

    it('asyncExec throws DatabaseAdapterError', () => {
      expect(() => adapter.asyncExec('CREATE TABLE foo (id INTEGER)')).toThrow(DatabaseAdapterError)
    })

    it('asyncExec error message mentions sync methods', () => {
      expect(() => adapter.asyncExec('CREATE TABLE foo (id INTEGER)')).toThrow('Use sync methods instead')
    })

    it('asyncTransaction throws DatabaseAdapterError', () => {
      expect(() => adapter.asyncTransaction(async () => 1)).toThrow(DatabaseAdapterError)
    })

    it('asyncTransaction error message mentions sync methods', () => {
      expect(() => adapter.asyncTransaction(async () => 1)).toThrow('Use sync methods instead')
    })
  })

  describe('dialect and type', () => {
    it('getDialect() returns SqlDialect with type sqlite', () => {
      const dialect = adapter.getDialect()
      expect(dialect.type).toBe('sqlite')
    })

    it('getType() returns sqlite', () => {
      expect(adapter.getType()).toBe('sqlite')
    })
  })

  describe('close and reopen', () => {
    it('close works', () => {
      adapter.open()
      expect(adapter.isOpen()).toBe(true)
      adapter.close()
      expect(adapter.isOpen()).toBe(false)
    })

    it('isOpen returns false after close', () => {
      adapter.open()
      adapter.close()
      expect(adapter.isOpen()).toBe(false)
    })

    it('can reopen after close', () => {
      adapter.open()
      adapter.close()
      adapter.open()
      expect(adapter.isOpen()).toBe(true)
    })
  })

  describe('error handling', () => {
    it('query on unopened connection throws', () => {
      expect(() => adapter.query('SELECT 1')).toThrow('Database connection is not open')
    })

    it('exec on unopened connection throws', () => {
      expect(() => adapter.exec('CREATE TABLE foo (id INTEGER)')).toThrow('Database connection is not open')
    })

    it('transaction on unopened connection throws', () => {
      expect(() => adapter.transaction(() => 1)).toThrow('Database connection is not open')
    })
  })
})

describe('createSqliteAdapter', () => {
  it('returns a DatabaseAdapter instance', () => {
    const adapter = createSqliteAdapter(':memory:')
    expect(adapter).toBeDefined()
    expect(typeof adapter.open).toBe('function')
    expect(typeof adapter.close).toBe('function')
    expect(typeof adapter.query).toBe('function')
    expect(typeof adapter.exec).toBe('function')
    expect(typeof adapter.transaction).toBe('function')
    expect(typeof adapter.asyncQuery).toBe('function')
    expect(typeof adapter.asyncExec).toBe('function')
    expect(typeof adapter.asyncTransaction).toBe('function')
    expect(typeof adapter.getDialect).toBe('function')
    expect(typeof adapter.getType).toBe('function')
  })

  it('returns SqliteAdapter instance', () => {
    const adapter = createSqliteAdapter(':memory:')
    expect(adapter).toBeInstanceOf(SqliteAdapter)
  })
})
