import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import {
  customProviderTypeMigration,
  deepseekProviderTypeMigration,
  domesticProviderTypesPgMigration,
} from '../../../src/storage/adapters/postgres/pg-migrations.js'

describe('provider config migrations', () => {
  let connection: ConnectionManager

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
  })

  afterEach(() => {
    connection.close()
  })

  it('preserves provider tenant columns and indexes after latest SQLite migrations', () => {
    const runner = createMigrationRunner(connection)
    runner.init()
    runner.apply(allStoreMigrations)

    const columns = connection.query<{ name: string }>("PRAGMA table_info('provider_configs')")
    const columnNames = columns.map((column) => column.name)
    expect(columnNames).toContain('tenant_id')

    const indexes = connection.query<{ name: string }>("PRAGMA index_list('provider_configs')")
    const indexNames = indexes.map((index) => index.name)
    expect(indexNames).toContain('idx_provider_configs_user')
    expect(indexNames).toContain('idx_provider_configs_tenant')
  })

  it('preserves provider tenant columns and indexes in the PostgreSQL DeepSeek migration SQL', () => {
    expect(deepseekProviderTypeMigration.up).toContain("tenant_id TEXT NOT NULL DEFAULT 'org_default'")
    expect(deepseekProviderTypeMigration.up).toContain(
      'source, last_test_status, last_tested_at, tenant_id, created_at, updated_at',
    )
    expect(deepseekProviderTypeMigration.up).toContain(
      'CREATE INDEX idx_provider_configs_tenant ON provider_configs(tenant_id)',
    )

    expect(deepseekProviderTypeMigration.down).toContain("tenant_id TEXT NOT NULL DEFAULT 'org_default'")
    expect(deepseekProviderTypeMigration.down).toContain(
      'source, last_test_status, last_tested_at, tenant_id, created_at, updated_at',
    )
    expect(deepseekProviderTypeMigration.down).toContain(
      'CREATE INDEX idx_provider_configs_tenant ON provider_configs(tenant_id)',
    )
  })

  it('keeps historical PostgreSQL provider migrations compatible with pre-tenant databases', () => {
    expect(customProviderTypeMigration.up).not.toContain('tenant_id')
    expect(customProviderTypeMigration.up).not.toContain('idx_provider_configs_tenant')
  })

  /**
   * v60 Migration: Runtime metadata columns for provider discovery
   * Adds family, protocol, priority, and JSON columns for headers, capabilities, models, and options
   */
  it('should apply v60 migration adding runtime metadata columns', async () => {
    const runner = createMigrationRunner(connection)
    runner.init()
    runner.apply(allStoreMigrations)

    expect(runner.getCurrentVersion()).toBeGreaterThanOrEqual(60)

    const columns = connection.query<{ name: string }>("PRAGMA table_info('provider_configs')")
    const columnNames = columns.map((column) => column.name)

    expect(columnNames).toContain('family')
    expect(columnNames).toContain('protocol')
    expect(columnNames).toContain('priority')
    expect(columnNames).toContain('headers_json')
    expect(columnNames).toContain('capabilities_json')
    expect(columnNames).toContain('models_json')
    expect(columnNames).toContain('default_model')
    expect(columnNames).toContain('options_json')
  })

  it('should apply v65 migration widening provider_type CHECK constraint for domestic providers', async () => {
    const runner = createMigrationRunner(connection)
    runner.init()
    runner.apply(allStoreMigrations)

    expect(runner.getCurrentVersion()).toBeGreaterThanOrEqual(65)

    const columns = connection.query<{ name: string }>("PRAGMA table_info('provider_configs')")
    const columnNames = columns.map((column) => column.name)
    expect(columnNames).toContain('tenant_id')
    expect(columnNames).toContain('family')
    expect(columnNames).toContain('options_json')

    const indexes = connection.query<{ name: string }>("PRAGMA index_list('provider_configs')")
    const indexNames = indexes.map((index) => index.name)
    expect(indexNames).toContain('idx_provider_configs_user')
    expect(indexNames).toContain('idx_provider_configs_tenant')
  })

  it('preserves provider tenant columns and runtime metadata in the PostgreSQL domestic provider migration SQL', () => {
    expect(domesticProviderTypesPgMigration.up).toContain("tenant_id TEXT NOT NULL DEFAULT 'org_default'")
    expect(domesticProviderTypesPgMigration.up).toContain('family TEXT DEFAULT NULL')
    expect(domesticProviderTypesPgMigration.up).toContain('options_json TEXT DEFAULT NULL')
    expect(domesticProviderTypesPgMigration.up).toContain(
      'CREATE INDEX idx_provider_configs_tenant ON provider_configs(tenant_id)',
    )

    expect(domesticProviderTypesPgMigration.down).toContain("tenant_id TEXT NOT NULL DEFAULT 'org_default'")
    expect(domesticProviderTypesPgMigration.down).toContain(
      'CREATE INDEX idx_provider_configs_tenant ON provider_configs(tenant_id)',
    )
  })

  it('should allow all domestic provider types to be inserted after migration', async () => {
    const runner = createMigrationRunner(connection)
    runner.init()
    runner.apply(allStoreMigrations)

    const domesticTypes = [
      'dashscope', 'volcengine', 'qianfan', 'zhipu', 'moonshot',
      'minimax', 'jdcloud-yanxi', 'mimo', 'iflytek-spark', 'stepfun',
      'hunyuan', 'deepseek', 'siliconflow',
    ]

    for (const providerType of domesticTypes) {
      connection.exec(
        `INSERT INTO provider_configs (provider_id, user_id, provider_type, display_name, source, created_at, updated_at)
         VALUES (?, 'user-test', ?, ?, 'database', datetime('now'), datetime('now'))`,
        [`test-${providerType}`, providerType, `Test ${providerType}`],
      )

      const rows = connection.query<{ provider_id: string; provider_type: string }>(
        'SELECT provider_id, provider_type FROM provider_configs WHERE provider_id = ?',
        [`test-${providerType}`],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].provider_type).toBe(providerType)
    }
  })

  it('should reject unknown provider types after migration', async () => {
    const runner = createMigrationRunner(connection)
    runner.init()
    runner.apply(allStoreMigrations)

    expect(() => {
      connection.exec(
        `INSERT INTO provider_configs (provider_id, user_id, provider_type, display_name, source, created_at, updated_at)
         VALUES ('test-unknown', 'user-test', 'nonexistent-provider', 'Unknown', 'database', datetime('now'), datetime('now'))`,
      )
    }).toThrow()
  })
})
