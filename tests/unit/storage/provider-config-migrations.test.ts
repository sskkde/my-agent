import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { customProviderTypeMigration, deepseekProviderTypeMigration } from '../../../src/storage/adapters/postgres/pg-migrations.js';

describe('provider config migrations', () => {
  let connection: ConnectionManager;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
  });

  afterEach(() => {
    connection.close();
  });

  it('preserves provider tenant columns and indexes after latest SQLite migrations', () => {
    const runner = createMigrationRunner(connection);
    runner.init();
    runner.apply(allStoreMigrations);

    const columns = connection.query<{ name: string }>("PRAGMA table_info('provider_configs')");
    const columnNames = columns.map(column => column.name);
    expect(columnNames).toContain('tenant_id');

    const indexes = connection.query<{ name: string }>("PRAGMA index_list('provider_configs')");
    const indexNames = indexes.map(index => index.name);
    expect(indexNames).toContain('idx_provider_configs_user');
    expect(indexNames).toContain('idx_provider_configs_tenant');
  });

  it('preserves provider tenant columns and indexes in the PostgreSQL DeepSeek migration SQL', () => {
    expect(deepseekProviderTypeMigration.up).toContain("tenant_id TEXT NOT NULL DEFAULT 'org_default'");
    expect(deepseekProviderTypeMigration.up).toContain('source, last_test_status, last_tested_at, tenant_id, created_at, updated_at');
    expect(deepseekProviderTypeMigration.up).toContain('CREATE INDEX idx_provider_configs_tenant ON provider_configs(tenant_id)');

    expect(deepseekProviderTypeMigration.down).toContain("tenant_id TEXT NOT NULL DEFAULT 'org_default'");
    expect(deepseekProviderTypeMigration.down).toContain('source, last_test_status, last_tested_at, tenant_id, created_at, updated_at');
    expect(deepseekProviderTypeMigration.down).toContain('CREATE INDEX idx_provider_configs_tenant ON provider_configs(tenant_id)');
  });

  it('keeps historical PostgreSQL provider migrations compatible with pre-tenant databases', () => {
    expect(customProviderTypeMigration.up).not.toContain('tenant_id');
    expect(customProviderTypeMigration.up).not.toContain('idx_provider_configs_tenant');
  });
});
