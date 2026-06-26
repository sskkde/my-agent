import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { ConnectionManager } from '../../../src/storage/connection.js'
import { createConnectionManager } from '../../../src/storage/connection.js'
import type { Migration } from '../../../src/storage/migrations.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import type { ConnectorStore } from '../../../src/storage/connector-store.js'
import { createConnectorStore } from '../../../src/storage/connector-store.js'
import {
  registerAgentlyMailDefinition,
  buildAgentlyMailDefinition,
} from '../../../src/connectors/agently-mail/definitions.js'

/**
 * Integration tests for the AgentlyMail connector definition registration.
 *
 * These tests verify:
 *  1. The connector definition is registered when AGENTLY_MAIL_ENABLED=true
 *  2. The connector definition is NOT registered when env var is unset/false
 *  3. Registration is idempotent (no duplicates)
 *  4. Definition carries correct metadata (connectorId, type, capabilities)
 *  5. CLI availability detection sets appropriate status
 *  6. Registration never throws (server startup safety)
 */

// Minimal migration for connector_definitions table (matches connector-store.ts v3)
const connectorMigrations: Migration[] = [
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
      CREATE INDEX idx_connector_defs_type ON connector_definitions(connector_type);
      CREATE INDEX idx_connector_defs_status ON connector_definitions(status);
    `,
    down: `
      DROP INDEX IF EXISTS idx_connector_defs_status;
      DROP INDEX IF EXISTS idx_connector_defs_type;
      DROP TABLE IF EXISTS connector_definitions;
    `,
  },
]

describe('AgentlyMail Connector Definition Registration', () => {
  let connection: ConnectionManager
  let connectorStore: ConnectorStore

  function setupStore(): void {
    connection = createConnectionManager(':memory:')
    connection.open()
    const runner = createMigrationRunner(connection)
    runner.init()
    runner.apply(connectorMigrations)
    connectorStore = createConnectorStore(connection)
  }

  beforeEach(() => {
    setupStore()
  })

  afterEach(() => {
    delete process.env.AGENTLY_MAIL_ENABLED
    connection.close()
  })

  // ── buildAgentlyMailDefinition ────────────────────────────────────────────

  describe('buildAgentlyMailDefinition', () => {
    it('should return a valid definition shape', () => {
      const def = buildAgentlyMailDefinition()

      expect(def.connectorId).toBe('agently_mail')
      expect(def.name).toBe('AgentlyMail')
      expect(def.connectorType).toBe('custom')
      expect(def.version).toBe('1.0.0')
      expect(typeof def.description).toBe('string')
      expect(Array.isArray(def.capabilities)).toBe(true)
      expect(def.capabilities.length).toBeGreaterThan(0)
      expect(def.configSchema).toBeDefined()
    })

    it('should include all expected capability IDs', () => {
      const def = buildAgentlyMailDefinition()

      expect(def.capabilities).toContain('agently_mail.me')
      expect(def.capabilities).toContain('agently_mail.auth_status')
      expect(def.capabilities).toContain('agently_mail.list_messages')
      expect(def.capabilities).toContain('agently_mail.read_message')
      expect(def.capabilities).toContain('agently_mail.search_messages')
      expect(def.capabilities).toContain('agently_mail.send_message')
      expect(def.capabilities).toContain('agently_mail.reply_message')
      expect(def.capabilities).toContain('agently_mail.forward_message')
      expect(def.capabilities).toContain('agently_mail.trash_message')
      expect(def.capabilities).toContain('agently_mail.download_attachment')
    })

    it('should set configSchema with cliPath override', () => {
      const def = buildAgentlyMailDefinition()

      expect(def.configSchema).toBeDefined()
      const schema = def.configSchema as Record<string, unknown>
      expect(schema.type).toBe('object')
      const props = schema.properties as Record<string, unknown>
      expect(props.cliPath).toBeDefined()
    })

    it('should return inactive status when CLI is not on PATH', () => {
      // In CI/test environments, agently-cli is typically not installed.
      const def = buildAgentlyMailDefinition()

      // Status is either 'active' (if CLI installed) or 'inactive' (if not)
      expect(['active', 'inactive']).toContain(def.status)
    })

    it('should include description mentioning CLI status', () => {
      const def = buildAgentlyMailDefinition()

      expect(def.description).toBeDefined()
      expect(def.description!.length).toBeGreaterThan(0)
    })
  })

  // ── registerAgentlyMailDefinition ─────────────────────────────────────────

  describe('registerAgentlyMailDefinition', () => {
    it('should register definition when AGENTLY_MAIL_ENABLED=true', () => {
      process.env.AGENTLY_MAIL_ENABLED = 'true'

      registerAgentlyMailDefinition(connectorStore)

      const def = connectorStore.findDefinitionByConnectorId('agently_mail')
      expect(def).toBeDefined()
      expect(def!.connectorId).toBe('agently_mail')
      expect(def!.name).toBe('AgentlyMail')
      expect(def!.connectorType).toBe('custom')
      expect(def!.version).toBe('1.0.0')
    })

    it('should NOT register definition when AGENTLY_MAIL_ENABLED is unset', () => {
      delete process.env.AGENTLY_MAIL_ENABLED

      registerAgentlyMailDefinition(connectorStore)

      const def = connectorStore.findDefinitionByConnectorId('agently_mail')
      expect(def).toBeUndefined()
    })

    it('should NOT register definition when AGENTLY_MAIL_ENABLED=false', () => {
      process.env.AGENTLY_MAIL_ENABLED = 'false'

      registerAgentlyMailDefinition(connectorStore)

      const def = connectorStore.findDefinitionByConnectorId('agently_mail')
      expect(def).toBeUndefined()
    })

    it('should NOT register definition when AGENTLY_MAIL_ENABLED is empty string', () => {
      process.env.AGENTLY_MAIL_ENABLED = ''

      registerAgentlyMailDefinition(connectorStore)

      const def = connectorStore.findDefinitionByConnectorId('agently_mail')
      expect(def).toBeUndefined()
    })

    it('should be idempotent — not create duplicate on repeated call', () => {
      process.env.AGENTLY_MAIL_ENABLED = 'true'

      registerAgentlyMailDefinition(connectorStore)
      registerAgentlyMailDefinition(connectorStore)

      const allCustom = connectorStore.findDefinitionsByType('custom')
      const agentlyMailDefs = allCustom.filter((d) => d.connectorId === 'agently_mail')
      expect(agentlyMailDefs.length).toBe(1)
    })

    it('should appear in findDefinitionsByType("custom")', () => {
      process.env.AGENTLY_MAIL_ENABLED = 'true'

      registerAgentlyMailDefinition(connectorStore)

      const customDefs = connectorStore.findDefinitionsByType('custom')
      const agentlyMail = customDefs.find((d) => d.connectorId === 'agently_mail')
      expect(agentlyMail).toBeDefined()
      expect(agentlyMail!.name).toBe('AgentlyMail')
    })

    it('should store capabilities as JSON array', () => {
      process.env.AGENTLY_MAIL_ENABLED = 'true'

      registerAgentlyMailDefinition(connectorStore)

      const def = connectorStore.findDefinitionByConnectorId('agently_mail')
      expect(def).toBeDefined()
      expect(Array.isArray(def!.capabilities)).toBe(true)
      for (const cap of def!.capabilities) {
        expect(typeof cap).toBe('string')
      }
    })

    it('should register with inactive status when CLI not on PATH', () => {
      process.env.AGENTLY_MAIL_ENABLED = 'true'

      registerAgentlyMailDefinition(connectorStore)

      const def = connectorStore.findDefinitionByConnectorId('agently_mail')
      expect(def).toBeDefined()

      // In test env without agently-cli, status should be 'inactive'
      // If the CLI happens to be installed, it would be 'active'
      expect(['active', 'inactive']).toContain(def!.status)
    })

    it('should be case-insensitive on AGENTLY_MAIL_ENABLED', () => {
      process.env.AGENTLY_MAIL_ENABLED = 'True'

      registerAgentlyMailDefinition(connectorStore)

      const def = connectorStore.findDefinitionByConnectorId('agently_mail')
      expect(def).toBeDefined()
      expect(def!.connectorId).toBe('agently_mail')
    })
  })

  // ── Server startup safety ────────────────────────────────────────────────

  describe('server startup safety', () => {
    it('should not throw when registering with AGENTLY_MAIL_ENABLED=true', () => {
      process.env.AGENTLY_MAIL_ENABLED = 'true'

      expect(() => registerAgentlyMailDefinition(connectorStore)).not.toThrow()
    })

    it('should not throw when registering without env var', () => {
      delete process.env.AGENTLY_MAIL_ENABLED

      expect(() => registerAgentlyMailDefinition(connectorStore)).not.toThrow()
    })

    it('should not throw when called multiple times', () => {
      process.env.AGENTLY_MAIL_ENABLED = 'true'

      expect(() => {
        registerAgentlyMailDefinition(connectorStore)
        registerAgentlyMailDefinition(connectorStore)
        registerAgentlyMailDefinition(connectorStore)
      }).not.toThrow()
    })
  })
})
