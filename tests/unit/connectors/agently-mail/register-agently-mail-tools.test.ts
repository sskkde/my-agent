/**
 * Unit tests for AgentlyMail production tool registration bootstrap.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../../src/storage/connection.js'
import { createMigrationRunner, type Migration } from '../../../../src/storage/migrations.js'
import { createConnectorStore, type ConnectorStore } from '../../../../src/storage/connector-store.js'
import { createToolRegistry } from '../../../../src/tools/tool-registry.js'
import { registerAgentlyMailTools } from '../../../../src/connectors/agently-mail/register-agently-mail-tools.js'
import { buildAgentlyMailDefinition } from '../../../../src/connectors/agently-mail/definitions.js'

const migrations: Migration[] = [
  {
    version: 1,
    name: 'create_connector_definitions_table',
    up: `
      CREATE TABLE connector_definitions (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        connector_type TEXT NOT NULL CHECK(connector_type IN ('api', 'messaging', 'storage', 'database', 'custom')),
        version TEXT NOT NULL,
        description TEXT,
        capabilities TEXT NOT NULL,
        config_schema TEXT,
        status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'deprecated', 'inactive')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
    `,
    down: `DROP TABLE IF EXISTS connector_definitions;`,
  },
  {
    version: 2,
    name: 'create_connector_instances_table',
    up: `
      CREATE TABLE connector_instances (
        id TEXT PRIMARY KEY,
        connector_instance_id TEXT NOT NULL UNIQUE,
        connector_definition_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        auth_state_ref TEXT NOT NULL,
        config TEXT,
        status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'deprecated', 'inactive')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
    `,
    down: `DROP TABLE IF EXISTS connector_instances;`,
  },
]

describe('registerAgentlyMailTools', () => {
  let connection: ConnectionManager
  let connectorStore: ConnectorStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    const runner = createMigrationRunner(connection)
    runner.init()
    runner.apply(migrations)
    connectorStore = createConnectorStore(connection)
  })

  afterEach(() => {
    connection.close()
  })

  it('is a no-op when AGENTLY_MAIL_ENABLED is not true', () => {
    const toolRegistry = createToolRegistry()
    const result = registerAgentlyMailTools({
      connectorStore,
      toolRegistry,
      env: { AGENTLY_MAIL_ENABLED: 'false' },
    })

    expect(result.enabled).toBe(false)
    expect(result.registered).toBe(false)
    expect(result.toolCount).toBe(0)
    expect(toolRegistry.listTools()).toHaveLength(0)
    expect(connectorStore.findDefinitionByConnectorId('agently_mail')).toBeUndefined()
  })

  it('registers connector tools when enabled and definition is active', () => {
    // Pre-seed an active definition to avoid depending on host CLI availability.
    const defInput = buildAgentlyMailDefinition()
    connectorStore.createDefinition({ ...defInput, status: 'active' })

    const toolRegistry = createToolRegistry()
    const result = registerAgentlyMailTools({
      connectorStore,
      toolRegistry,
      env: { AGENTLY_MAIL_ENABLED: 'true' },
    })

    expect(result.enabled).toBe(true)
    expect(result.registered).toBe(true)
    expect(result.toolCount).toBeGreaterThanOrEqual(9)

    const names = toolRegistry.listTools().map((t) => t.name)
    expect(names).toContain('connector_agently_mail_list_messages')
    expect(names).toContain('connector_agently_mail_search_messages')
    expect(names).toContain('connector_agently_mail_send_message')
    expect(names).toContain('connector_agently_mail_trash_message')
    expect(names).not.toContain('email_search')
    expect(names).not.toContain('email_send_draft')

    const search = toolRegistry.getTool('connector_agently_mail_search_messages')
    expect(search?.category).toBe('search')
    expect(search?.metadata?.connectorId).toBe('agently_mail')
  })

  it('does not register tools when definition is inactive (CLI missing)', () => {
    connectorStore.createDefinition({
      ...buildAgentlyMailDefinition(),
      status: 'inactive',
    })

    const toolRegistry = createToolRegistry()
    const result = registerAgentlyMailTools({
      connectorStore,
      toolRegistry,
      env: { AGENTLY_MAIL_ENABLED: 'true' },
    })

    expect(result.enabled).toBe(true)
    expect(result.registered).toBe(false)
    expect(result.reason).toBe('instance_unavailable')
    expect(toolRegistry.listTools()).toHaveLength(0)
  })
})
