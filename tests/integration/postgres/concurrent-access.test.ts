import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PostgresAdapter } from '../../../src/storage/adapters/postgres/postgres-adapter.js'
import type { DatabaseAdapter } from '../../../src/storage/database-adapter.js'

const DATABASE_URL = process.env.DATABASE_URL
const hasDatabase = typeof DATABASE_URL === 'string' && DATABASE_URL.length > 0

describe.skipIf(!hasDatabase)('PostgreSQL Concurrent Access', () => {
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

  beforeEach(async () => {
    await adapter.asyncExec('DROP TABLE IF EXISTS _test_concurrent CASCADE')
    await adapter.asyncExec(
      "CREATE TABLE _test_concurrent (id SERIAL PRIMARY KEY, val INTEGER NOT NULL, label TEXT NOT NULL DEFAULT '')",
    )
  })

  it('handles multiple concurrent inserts', async () => {
    const CONCURRENT_COUNT = 10
    const promises = Array.from({ length: CONCURRENT_COUNT }, (_, i) =>
      adapter.asyncExec('INSERT INTO _test_concurrent (val, label) VALUES ($1, $2)', [i, `row_${i}`]),
    )
    await Promise.all(promises)

    const rows = await adapter.asyncQuery<{ val: number }>('SELECT val FROM _test_concurrent ORDER BY val')
    expect(rows).toHaveLength(CONCURRENT_COUNT)
    expect(rows.map((r) => r.val)).toEqual(Array.from({ length: CONCURRENT_COUNT }, (_, i) => i))
  })

  it('handles concurrent reads and writes', async () => {
    await adapter.asyncExec("INSERT INTO _test_concurrent (val, label) VALUES (0, 'initial')")

    const operations: Promise<unknown>[] = []

    // Concurrent writes
    for (let i = 1; i <= 5; i++) {
      operations.push(adapter.asyncExec('INSERT INTO _test_concurrent (val, label) VALUES ($1, $2)', [i, `write_${i}`]))
    }

    // Concurrent reads
    for (let i = 0; i < 5; i++) {
      operations.push(
        adapter.asyncQuery<{ val: number }>('SELECT val FROM _test_concurrent ORDER BY val').then((rows) => {
          expect(rows.length).toBeGreaterThanOrEqual(1)
        }),
      )
    }

    await Promise.all(operations)

    const finalRows = await adapter.asyncQuery<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM _test_concurrent',
    )
    expect(Number(finalRows[0].count)).toBe(6)
  })

  it('handles concurrent updates on different rows', async () => {
    await adapter.asyncExec("INSERT INTO _test_concurrent (val, label) VALUES (10, 'a')")
    await adapter.asyncExec("INSERT INTO _test_concurrent (val, label) VALUES (20, 'b')")
    await adapter.asyncExec("INSERT INTO _test_concurrent (val, label) VALUES (30, 'c')")

    const updates = [
      adapter.asyncExec('UPDATE _test_concurrent SET val = $1 WHERE label = $2', [100, 'a']),
      adapter.asyncExec('UPDATE _test_concurrent SET val = $1 WHERE label = $2', [200, 'b']),
      adapter.asyncExec('UPDATE _test_concurrent SET val = $1 WHERE label = $2', [300, 'c']),
    ]
    await Promise.all(updates)

    const rows = await adapter.asyncQuery<{ label: string; val: number }>(
      'SELECT label, val FROM _test_concurrent ORDER BY label',
    )
    expect(rows).toEqual([
      { label: 'a', val: 100 },
      { label: 'b', val: 200 },
      { label: 'c', val: 300 },
    ])
  })

  it('serializes conflicting updates on same row', async () => {
    await adapter.asyncExec("INSERT INTO _test_concurrent (val, label) VALUES (0, 'counter')")

    const conn = (adapter as any).getConnection()
    const pool = conn.pool

    const client1 = await pool.connect()
    const client2 = await pool.connect()

    try {
      await client1.query('BEGIN')
      await client2.query('BEGIN')

      // client1 reads current value
      const r1 = (await client1.query("SELECT val FROM _test_concurrent WHERE label = 'counter'")) as {
        rows: Array<{ val: number }>
      }
      const val1 = r1.rows[0].val

      // client2 reads current value (before client1 commits)
      const r2 = (await client2.query("SELECT val FROM _test_concurrent WHERE label = 'counter'")) as {
        rows: Array<{ val: number }>
      }
      const val2 = r2.rows[0].val

      // Both should see the same initial value (READ COMMITTED)
      expect(val1).toBe(0)
      expect(val2).toBe(0)

      // client1 updates and commits
      await client1.query("UPDATE _test_concurrent SET val = $1 WHERE label = 'counter'", [val1 + 10])
      await client1.query('COMMIT')

      // client2 updates — in READ COMMITTED, this will overwrite client1's value
      // unless it re-reads after client1 commits
      await client2.query("UPDATE _test_concurrent SET val = $1 WHERE label = 'counter'", [val2 + 5])
      await client2.query('COMMIT')

      // Final value depends on serialization order — both committed successfully
      const finalResult = await adapter.asyncQuery<{ val: number }>(
        "SELECT val FROM _test_concurrent WHERE label = 'counter'",
      )
      // The last writer wins — value should be one of the two updates
      expect([5, 10]).toContain(finalResult[0].val)
    } finally {
      await client1.query('ROLLBACK').catch(() => {})
      await client2.query('ROLLBACK').catch(() => {})
      client1.release()
      client2.release()
    }
  })

  it('handles concurrent deletes on different rows', async () => {
    for (let i = 0; i < 5; i++) {
      await adapter.asyncExec('INSERT INTO _test_concurrent (val, label) VALUES ($1, $2)', [i, `del_${i}`])
    }

    const deletes = [
      adapter.asyncExec("DELETE FROM _test_concurrent WHERE label = 'del_0'"),
      adapter.asyncExec("DELETE FROM _test_concurrent WHERE label = 'del_2'"),
      adapter.asyncExec("DELETE FROM _test_concurrent WHERE label = 'del_4'"),
    ]
    await Promise.all(deletes)

    const rows = await adapter.asyncQuery<{ label: string }>('SELECT label FROM _test_concurrent ORDER BY label')
    expect(rows.map((r) => r.label)).toEqual(['del_1', 'del_3'])
  })

  it('handles high volume concurrent inserts', async () => {
    const BATCH_SIZE = 50
    const promises = Array.from({ length: BATCH_SIZE }, (_, i) =>
      adapter.asyncExec('INSERT INTO _test_concurrent (val, label) VALUES ($1, $2)', [i, `bulk_${i}`]),
    )
    await Promise.all(promises)

    const rows = await adapter.asyncQuery<{ count: string }>('SELECT COUNT(*)::text as count FROM _test_concurrent')
    expect(Number(rows[0].count)).toBe(BATCH_SIZE)
  })

  it('pool metrics reflect concurrent connections', async () => {
    const metrics = adapter.getPoolMetrics()
    expect(metrics.totalCount).toBeGreaterThanOrEqual(1)
    expect(metrics.idleCount).toBeGreaterThanOrEqual(0)
    expect(metrics.waitingCount).toBeGreaterThanOrEqual(0)

    // After concurrent operations, pool should have been utilized
    const CONCURRENT = 5
    const promises = Array.from({ length: CONCURRENT }, (_, i) =>
      adapter.asyncQuery<{ val: number }>('SELECT $1::int as val', [i]),
    )
    await Promise.all(promises)

    const afterMetrics = adapter.getPoolMetrics()
    expect(afterMetrics.totalCount).toBeGreaterThanOrEqual(1)
  })
})
