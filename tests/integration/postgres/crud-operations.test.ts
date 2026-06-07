import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { PostgresAdapter } from '../../../src/storage/adapters/postgres/postgres-adapter.js'
import type { DatabaseAdapter } from '../../../src/storage/database-adapter.js'

const DATABASE_URL = process.env.DATABASE_URL
const hasDatabase = typeof DATABASE_URL === 'string' && DATABASE_URL.length > 0

describe.skipIf(!hasDatabase)('PostgreSQL CRUD Operations', () => {
  let adapter: DatabaseAdapter

  beforeAll(async () => {
    adapter = new PostgresAdapter({ connectionString: DATABASE_URL! })
    await (adapter as any).getConnection().open()
  }, 15000)

  afterAll(async () => {
    if ((adapter as any).isOpen()) {
      await (adapter as any).getConnection().close()
    }
  }, 15000)

  // ─── CREATE ────────────────────────────────────────────────────────

  describe('CREATE', () => {
    afterEach(async () => {
      await adapter.asyncExec('DROP TABLE IF EXISTS _test_crud CASCADE')
    })

    it('creates a table and inserts a row', async () => {
      await adapter.asyncExec(
        'CREATE TABLE IF NOT EXISTS _test_crud (id SERIAL PRIMARY KEY, name TEXT NOT NULL, value INTEGER NOT NULL)',
      )
      await adapter.asyncExec('INSERT INTO _test_crud (name, value) VALUES ($1, $2)', ['alpha', 100])

      const rows = await adapter.asyncQuery<{ name: string; value: number }>(
        'SELECT name, value FROM _test_crud WHERE name = $1',
        ['alpha'],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('alpha')
      expect(rows[0].value).toBe(100)
    })

    it('inserts multiple rows and returns row count', async () => {
      await adapter.asyncExec(
        'CREATE TABLE IF NOT EXISTS _test_crud (id SERIAL PRIMARY KEY, name TEXT NOT NULL, value INTEGER NOT NULL)',
      )
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('a', 1)")
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('b', 2)")
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('c', 3)")

      const rows = await adapter.asyncQuery<{ count: string }>('SELECT COUNT(*)::text as count FROM _test_crud')
      expect(Number(rows[0].count)).toBe(3)
    })

    it('inserts with parameterized values including null', async () => {
      await adapter.asyncExec(
        'CREATE TABLE IF NOT EXISTS _test_crud (id SERIAL PRIMARY KEY, name TEXT NOT NULL, value INTEGER)',
      )
      await adapter.asyncExec('INSERT INTO _test_crud (name, value) VALUES ($1, $2)', ['nullable', null])

      const rows = await adapter.asyncQuery<{ name: string; value: number | null }>(
        'SELECT name, value FROM _test_crud WHERE name = $1',
        ['nullable'],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('nullable')
      expect(rows[0].value).toBeNull()
    })
  })

  // ─── READ ──────────────────────────────────────────────────────────

  describe('READ', () => {
    beforeAll(async () => {
      await adapter.asyncExec(
        'CREATE TABLE IF NOT EXISTS _test_crud (id SERIAL PRIMARY KEY, name TEXT NOT NULL, value INTEGER NOT NULL)',
      )
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('alpha', 10)")
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('beta', 20)")
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('gamma', 30)")
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('delta', 40)")
    })

    afterAll(async () => {
      await adapter.asyncExec('DROP TABLE IF EXISTS _test_crud CASCADE')
    })

    it('reads all rows from table', async () => {
      const rows = await adapter.asyncQuery<{ name: string }>('SELECT name FROM _test_crud ORDER BY id')
      expect(rows).toHaveLength(4)
      expect(rows.map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma', 'delta'])
    })

    it('reads with WHERE clause using parameterized query', async () => {
      const rows = await adapter.asyncQuery<{ name: string; value: number }>(
        'SELECT name, value FROM _test_crud WHERE value > $1',
        [20],
      )
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.name)).toEqual(['gamma', 'delta'])
    })

    it('reads with ORDER BY and LIMIT', async () => {
      const rows = await adapter.asyncQuery<{ name: string }>(
        'SELECT name FROM _test_crud ORDER BY value DESC LIMIT $1',
        [2],
      )
      expect(rows).toHaveLength(2)
      expect(rows[0].name).toBe('delta')
      expect(rows[1].name).toBe('gamma')
    })

    it('reads with ORDER BY, LIMIT and OFFSET', async () => {
      const rows = await adapter.asyncQuery<{ name: string }>(
        'SELECT name FROM _test_crud ORDER BY id LIMIT $1 OFFSET $2',
        [2, 1],
      )
      expect(rows).toHaveLength(2)
      expect(rows[0].name).toBe('beta')
      expect(rows[1].name).toBe('gamma')
    })

    it('returns empty array when no rows match', async () => {
      const rows = await adapter.asyncQuery<{ name: string }>('SELECT name FROM _test_crud WHERE name = $1', [
        'nonexistent',
      ])
      expect(rows).toHaveLength(0)
    })
  })

  // ─── UPDATE ────────────────────────────────────────────────────────

  describe('UPDATE', () => {
    beforeEach(async () => {
      await adapter.asyncExec('DROP TABLE IF EXISTS _test_crud CASCADE')
      await adapter.asyncExec(
        'CREATE TABLE _test_crud (id SERIAL PRIMARY KEY, name TEXT NOT NULL, value INTEGER NOT NULL)',
      )
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('alpha', 10)")
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('beta', 20)")
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('gamma', 30)")
    })

    afterEach(async () => {
      await adapter.asyncExec('DROP TABLE IF EXISTS _test_crud CASCADE')
    })

    it('updates existing rows with parameterized values', async () => {
      await adapter.asyncExec('UPDATE _test_crud SET value = $1 WHERE name = $2', [999, 'alpha'])

      const rows = await adapter.asyncQuery<{ name: string; value: number }>(
        'SELECT name, value FROM _test_crud WHERE name = $1',
        ['alpha'],
      )
      expect(rows[0].value).toBe(999)
    })

    it('update affects only matching rows', async () => {
      await adapter.asyncExec('UPDATE _test_crud SET value = $1 WHERE value > $2', [0, 15])

      const rows = await adapter.asyncQuery<{ name: string; value: number }>(
        'SELECT name, value FROM _test_crud ORDER BY id',
      )
      // alpha (10) should be unchanged, beta (20) and gamma (30) updated to 0
      expect(rows[0].value).toBe(10)
      expect(rows[1].value).toBe(0)
      expect(rows[2].value).toBe(0)
    })

    it('update with no matching rows is a no-op', async () => {
      await adapter.asyncExec('UPDATE _test_crud SET value = $1 WHERE name = $2', [999, 'nonexistent'])

      const rows = await adapter.asyncQuery<{ count: string }>('SELECT COUNT(*)::text as count FROM _test_crud')
      expect(Number(rows[0].count)).toBe(3)
    })
  })

  // ─── DELETE ────────────────────────────────────────────────────────

  describe('DELETE', () => {
    beforeEach(async () => {
      await adapter.asyncExec('DROP TABLE IF EXISTS _test_crud CASCADE')
      await adapter.asyncExec(
        'CREATE TABLE _test_crud (id SERIAL PRIMARY KEY, name TEXT NOT NULL, value INTEGER NOT NULL)',
      )
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('alpha', 10)")
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('beta', 20)")
      await adapter.asyncExec("INSERT INTO _test_crud (name, value) VALUES ('gamma', 30)")
    })

    afterEach(async () => {
      await adapter.asyncExec('DROP TABLE IF EXISTS _test_crud CASCADE')
    })

    it('deletes existing rows by parameterized condition', async () => {
      await adapter.asyncExec('DELETE FROM _test_crud WHERE name = $1', ['beta'])

      const rows = await adapter.asyncQuery<{ name: string }>('SELECT name FROM _test_crud ORDER BY id')
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.name)).toEqual(['alpha', 'gamma'])
    })

    it('delete removes only matching rows', async () => {
      await adapter.asyncExec('DELETE FROM _test_crud WHERE value >= $1', [20])

      const rows = await adapter.asyncQuery<{ name: string }>('SELECT name FROM _test_crud ORDER BY id')
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('alpha')
    })

    it('delete with no matching rows is a no-op', async () => {
      await adapter.asyncExec('DELETE FROM _test_crud WHERE name = $1', ['nonexistent'])

      const rows = await adapter.asyncQuery<{ count: string }>('SELECT COUNT(*)::text as count FROM _test_crud')
      expect(Number(rows[0].count)).toBe(3)
    })
  })

  // ─── DDL ───────────────────────────────────────────────────────────

  describe('DDL', () => {
    afterEach(async () => {
      await adapter.asyncExec('DROP TABLE IF EXISTS _test_crud CASCADE')
    })

    it('creates table with various column types', async () => {
      await adapter.asyncExec(`
        CREATE TABLE _test_crud (
          id SERIAL PRIMARY KEY,
          text_col TEXT NOT NULL,
          int_col INTEGER NOT NULL,
          bool_col BOOLEAN NOT NULL DEFAULT FALSE,
          json_col JSONB,
          ts_col TIMESTAMP DEFAULT NOW()
        )
      `)

      await adapter.asyncExec(
        'INSERT INTO _test_crud (text_col, int_col, bool_col, json_col) VALUES ($1, $2, $3, $4)',
        ['test', 42, true, { key: 'value' }],
      )

      const rows = await adapter.asyncQuery<{
        text_col: string
        int_col: number
        bool_col: boolean
        json_col: { key: string }
      }>('SELECT text_col, int_col, bool_col, json_col FROM _test_crud')

      expect(rows).toHaveLength(1)
      expect(rows[0].text_col).toBe('test')
      expect(rows[0].int_col).toBe(42)
      expect(rows[0].bool_col).toBe(true)
      expect(rows[0].json_col).toEqual({ key: 'value' })
    })

    it('drops and recreates table', async () => {
      await adapter.asyncExec('CREATE TABLE _test_crud (id SERIAL PRIMARY KEY, val TEXT)')
      await adapter.asyncExec("INSERT INTO _test_crud (val) VALUES ('first')")

      await adapter.asyncExec('DROP TABLE _test_crud')
      await adapter.asyncExec('CREATE TABLE _test_crud (id SERIAL PRIMARY KEY, val TEXT)')

      const rows = await adapter.asyncQuery<{ count: string }>('SELECT COUNT(*)::text as count FROM _test_crud')
      expect(Number(rows[0].count)).toBe(0)
    })
  })

  // ─── Adapter Interface ─────────────────────────────────────────────

  describe('Adapter Interface', () => {
    it('getType returns postgresql', () => {
      expect(adapter.getType()).toBe('postgresql')
    })

    it('getDialect returns postgresql dialect', () => {
      expect(adapter.getDialect().type).toBe('postgresql')
    })

    it('isOpen returns true after open', () => {
      expect(adapter.isOpen()).toBe(true)
    })

    it('sync methods throw DatabaseAdapterError', async () => {
      const { DatabaseAdapterError } = await import('../../../src/storage/database-adapter.js')
      expect(() => adapter.query('SELECT 1')).toThrow(DatabaseAdapterError)
      expect(() => adapter.exec('SELECT 1')).toThrow(DatabaseAdapterError)
      expect(() => adapter.transaction(() => 1)).toThrow(DatabaseAdapterError)
    })
  })
})
