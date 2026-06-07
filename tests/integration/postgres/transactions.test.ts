import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PostgresAdapter } from '../../../src/storage/adapters/postgres/postgres-adapter.js'
import type { DatabaseAdapter } from '../../../src/storage/database-adapter.js'

const DATABASE_URL = process.env.DATABASE_URL
const hasDatabase = typeof DATABASE_URL === 'string' && DATABASE_URL.length > 0

describe.skipIf(!hasDatabase)('PostgreSQL Transactions', () => {
  let adapter: DatabaseAdapter

  beforeAll(async () => {
    adapter = new PostgresAdapter({ connectionString: DATABASE_URL! })
    await (adapter as any).getConnection().open()
  }, 15000)

  afterAll(async () => {
    await adapter.asyncExec('DROP TABLE IF EXISTS _test_txn CASCADE')

    if ((adapter as any).isOpen()) {
      await (adapter as any).getConnection().close()
    }
  }, 15000)

  beforeEach(async () => {
    await adapter.asyncExec('DROP TABLE IF EXISTS _test_txn CASCADE')
    await adapter.asyncExec(
      'CREATE TABLE _test_txn (id SERIAL PRIMARY KEY, name TEXT NOT NULL, value INTEGER NOT NULL)',
    )
  })

  it('commits successful transaction', async () => {
    await adapter.asyncTransaction(async () => {
      await adapter.asyncExec('INSERT INTO _test_txn (name, value) VALUES ($1, $2)', ['committed', 1])
    })

    const rows = await adapter.asyncQuery<{ name: string }>('SELECT name FROM _test_txn')
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('committed')
  })

  it('rolls back failed transaction', async () => {
    await expect(
      adapter.asyncTransaction(async () => {
        await adapter.asyncExec('INSERT INTO _test_txn (name, value) VALUES ($1, $2)', ['will_rollback', 1])
        throw new Error('intentional failure')
      }),
    ).rejects.toThrow('intentional failure')

    const rows = await adapter.asyncQuery<{ name: string }>('SELECT name FROM _test_txn')
    expect(rows).toHaveLength(0)
  })

  it('rolls back on constraint violation', async () => {
    await adapter.asyncExec('ALTER TABLE _test_txn ADD CONSTRAINT _test_txn_unique_name UNIQUE (name)')
    await adapter.asyncExec("INSERT INTO _test_txn (name, value) VALUES ('unique_name', 1)")

    await expect(
      adapter.asyncTransaction(async () => {
        await adapter.asyncExec("INSERT INTO _test_txn (name, value) VALUES ('unique_name', 2)")
      }),
    ).rejects.toThrow()

    const rows = await adapter.asyncQuery<{ name: string; value: number }>(
      'SELECT name, value FROM _test_txn WHERE name = $1',
      ['unique_name'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].value).toBe(1)
  })

  it('multiple operations in a single transaction are atomic', async () => {
    await adapter.asyncTransaction(async () => {
      await adapter.asyncExec('INSERT INTO _test_txn (name, value) VALUES ($1, $2)', ['first', 10])
      await adapter.asyncExec('INSERT INTO _test_txn (name, value) VALUES ($1, $2)', ['second', 20])
      await adapter.asyncExec('UPDATE _test_txn SET value = $1 WHERE name = $2', [99, 'first'])
    })

    const rows = await adapter.asyncQuery<{ name: string; value: number }>(
      'SELECT name, value FROM _test_txn ORDER BY id',
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ name: 'first', value: 99 })
    expect(rows[1]).toEqual({ name: 'second', value: 20 })
  })

  it('partial rollback does not affect committed data', async () => {
    await adapter.asyncExec("INSERT INTO _test_txn (name, value) VALUES ('pre_existing', 1)")

    await expect(
      adapter.asyncTransaction(async () => {
        await adapter.asyncExec('INSERT INTO _test_txn (name, value) VALUES ($1, $2)', ['in_txn', 2])
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')

    const rows = await adapter.asyncQuery<{ name: string }>('SELECT name FROM _test_txn ORDER BY id')
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('pre_existing')
  })

  it('transaction return value is propagated', async () => {
    const result = await adapter.asyncTransaction(async () => {
      await adapter.asyncExec('INSERT INTO _test_txn (name, value) VALUES ($1, $2)', ['return_test', 42])
      const rows = await adapter.asyncQuery<{ value: number }>('SELECT value FROM _test_txn WHERE name = $1', [
        'return_test',
      ])
      return rows[0].value
    })

    expect(result).toBe(42)
  })

  it('concurrent transactions are isolated (READ COMMITTED)', async () => {
    // Transaction 1 inserts but does not commit yet
    // Transaction 2 should not see uncommitted data
    const conn = (adapter as any).getConnection()
    const pool = conn.pool

    const client1 = await pool.connect()
    const client2 = await pool.connect()

    try {
      await client1.query('BEGIN')
      await client1.query('INSERT INTO _test_txn (name, value) VALUES ($1, $2)', ['uncommitted', 1])

      // client2 should NOT see client1's uncommitted insert
      const result2 = await client2.query('SELECT name FROM _test_txn WHERE name = $1', ['uncommitted'])
      expect(result2.rows).toHaveLength(0)

      await client1.query('COMMIT')

      // After commit, client2 CAN see the data
      const result2After = await client2.query('SELECT name FROM _test_txn WHERE name = $1', ['uncommitted'])
      expect(result2After.rows).toHaveLength(1)
    } finally {
      await client1.query('ROLLBACK').catch(() => {})
      await client2.query('ROLLBACK').catch(() => {})
      client1.release()
      client2.release()
    }
  })

  it('savepoints allow partial rollback within transaction', async () => {
    const conn = (adapter as any).getConnection()
    const pool = conn.pool
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      await client.query('INSERT INTO _test_txn (name, value) VALUES ($1, $2)', ['before_savepoint', 1])

      await client.query('SAVEPOINT my_savepoint')

      await client.query('INSERT INTO _test_txn (name, value) VALUES ($1, $2)', ['after_savepoint', 2])

      await client.query('ROLLBACK TO SAVEPOINT my_savepoint')

      await client.query('INSERT INTO _test_txn (name, value) VALUES ($1, $2)', ['after_rollback', 3])

      await client.query('COMMIT')

      const rows = await adapter.asyncQuery<{ name: string; value: number }>(
        'SELECT name, value FROM _test_txn ORDER BY id',
      )
      expect(rows).toHaveLength(2)
      expect(rows[0].name).toBe('before_savepoint')
      expect(rows[1].name).toBe('after_rollback')
    } finally {
      await client.query('ROLLBACK').catch(() => {})
      client.release()
    }
  })
})
