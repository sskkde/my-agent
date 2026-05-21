import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgresAdapter, createPostgresAdapter, createPostgresAdapterWithConfig } from '../../../src/storage/adapters/postgres/postgres-adapter.js';
import { PostgresConnectionManager } from '../../../src/storage/adapters/postgres/postgres-connection.js';
import { DatabaseAdapterError } from '../../../src/storage/database-adapter.js';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDatabase = typeof DATABASE_URL === 'string' && DATABASE_URL.length > 0;

describe('PostgresAdapter', () => {
  describe('construction', () => {
    it('creates adapter with connection string via factory', () => {
      const adapter = createPostgresAdapter('postgresql://localhost/test');
      expect(adapter).toBeDefined();
      expect(adapter.getType()).toBe('postgresql');
    });

    it('creates adapter with config via factory', () => {
      const adapter = createPostgresAdapterWithConfig({
        connectionString: 'postgresql://localhost/test',
        max: 5,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 3000,
      });
      expect(adapter).toBeDefined();
      expect(adapter.getType()).toBe('postgresql');
    });

    it('getType() returns "postgresql"', () => {
      const adapter = createPostgresAdapter('postgresql://localhost/test');
      expect(adapter.getType()).toBe('postgresql');
    });

    it('getDialect().type returns "postgresql"', () => {
      const adapter = createPostgresAdapter('postgresql://localhost/test');
      expect(adapter.getDialect().type).toBe('postgresql');
    });

    it('isOpen() returns false before open', () => {
      const adapter = createPostgresAdapter('postgresql://localhost/test');
      expect(adapter.isOpen()).toBe(false);
    });
  });

  describe('sync methods throw DatabaseAdapterError', () => {
    let adapter: PostgresAdapter;

    beforeEach(() => {
      adapter = new PostgresAdapter({ connectionString: 'postgresql://localhost/test' });
    });

    it('query() throws DatabaseAdapterError', () => {
      expect(() => adapter.query('SELECT 1')).toThrow(DatabaseAdapterError);
    });

    it('query() error message mentions async methods', () => {
      expect(() => adapter.query('SELECT 1')).toThrow(/async/i);
    });

    it('exec() throws DatabaseAdapterError', () => {
      expect(() => adapter.exec('CREATE TABLE t (id INT)')).toThrow(DatabaseAdapterError);
    });

    it('transaction() throws DatabaseAdapterError', () => {
      expect(() => adapter.transaction(() => 1)).toThrow(DatabaseAdapterError);
    });
  });

  describe('getConnection()', () => {
    it('returns the underlying PostgresConnectionManager', () => {
      const adapter = new PostgresAdapter({ connectionString: 'postgresql://localhost/test' });
      const conn = adapter.getConnection();
      expect(conn).toBeInstanceOf(PostgresConnectionManager);
    });
  });

  describe('PostgresConnectionManager', () => {
    it('getPoolMetrics returns zeros when pool not open', () => {
      const conn = new PostgresConnectionManager({ connectionString: 'postgresql://localhost/test' });
      const metrics = conn.getPoolMetrics();
      expect(metrics).toEqual({ totalCount: 0, idleCount: 0, waitingCount: 0 });
    });

    it('isOpen() returns false before open', () => {
      const conn = new PostgresConnectionManager({ connectionString: 'postgresql://localhost/test' });
      expect(conn.isOpen()).toBe(false);
    });
  });
});

// Live database tests — skipped when DATABASE_URL is not set
describe.skipIf(!hasDatabase)('PostgresAdapter (live database)', () => {
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = new PostgresAdapter({ connectionString: DATABASE_URL! });
    await adapter.getConnection().open();
  });

  afterAll(async () => {
    if (adapter?.isOpen()) {
      await adapter.getConnection().close();
    }
  });

  it('isOpen() returns true after open', () => {
    expect(adapter.isOpen()).toBe(true);
  });

  it('asyncQuery with SELECT 1 returns rows', async () => {
    const rows = await adapter.asyncQuery<{ '?column?': number }>('SELECT 1');
    expect(rows).toHaveLength(1);
  });

  it('asyncExec with CREATE TABLE + DROP TABLE', async () => {
    await adapter.asyncExec('CREATE TABLE IF NOT EXISTS _pg_adapter_test (id INTEGER PRIMARY KEY)');
    await adapter.asyncExec('DROP TABLE IF EXISTS _pg_adapter_test');
  });

  it('asyncTransaction commits on success', async () => {
    await adapter.asyncExec('CREATE TABLE IF NOT EXISTS _pg_adapter_tx_test (id INTEGER PRIMARY KEY, val TEXT)');

    try {
      await adapter.asyncTransaction(async () => {
        await adapter.asyncExec("INSERT INTO _pg_adapter_tx_test (id, val) VALUES (1, 'hello')");
      });

      const rows = await adapter.asyncQuery<{ val: string }>('SELECT val FROM _pg_adapter_tx_test WHERE id = 1');
      expect(rows[0].val).toBe('hello');
    } finally {
      await adapter.asyncExec('DROP TABLE IF EXISTS _pg_adapter_tx_test');
    }
  });

  it('asyncTransaction rolls back on error', async () => {
    await adapter.asyncExec('CREATE TABLE IF NOT EXISTS _pg_adapter_tx_test (id INTEGER PRIMARY KEY, val TEXT)');

    try {
      await expect(
        adapter.asyncTransaction(async () => {
          await adapter.asyncExec("INSERT INTO _pg_adapter_tx_test (id, val) VALUES (2, 'world')");
          throw new Error('intentional');
        }),
      ).rejects.toThrow('intentional');

      const rows = await adapter.asyncQuery<{ id: number }>('SELECT id FROM _pg_adapter_tx_test WHERE id = 2');
      expect(rows).toHaveLength(0);
    } finally {
      await adapter.asyncExec('DROP TABLE IF EXISTS _pg_adapter_tx_test');
    }
  });

  it('healthCheck returns true when connected', async () => {
    const healthy = await adapter.getConnection().healthCheck();
    expect(healthy).toBe(true);
  });

  it('getPoolMetrics returns expected structure when open', () => {
    const metrics = adapter.getConnection().getPoolMetrics();
    expect(metrics).toHaveProperty('totalCount');
    expect(metrics).toHaveProperty('idleCount');
    expect(metrics).toHaveProperty('waitingCount');
    expect(typeof metrics.totalCount).toBe('number');
    expect(typeof metrics.idleCount).toBe('number');
    expect(typeof metrics.waitingCount).toBe('number');
  });

  it('close sets isOpen to false', async () => {
    const localAdapter = new PostgresAdapter({ connectionString: DATABASE_URL! });
    await localAdapter.getConnection().open();
    expect(localAdapter.isOpen()).toBe(true);

    await localAdapter.getConnection().close();
    expect(localAdapter.isOpen()).toBe(false);
  });

  it('healthCheck returns false after close', async () => {
    const localAdapter = new PostgresAdapter({ connectionString: DATABASE_URL! });
    await localAdapter.getConnection().open();
    await localAdapter.getConnection().close();

    const healthy = await localAdapter.getConnection().healthCheck();
    expect(healthy).toBe(false);
  });
});
