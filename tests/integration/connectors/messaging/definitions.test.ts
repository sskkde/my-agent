import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { ConnectionManager } from '../../../../src/storage/connection.js'
import { createConnectionManager } from '../../../../src/storage/connection.js'
import type { MigrationRunner, Migration } from '../../../../src/storage/migrations.js'
import { createMigrationRunner } from '../../../../src/storage/migrations.js'
import type { ConnectorStore } from '../../../../src/storage/connector-store.js'
import { createConnectorStore } from '../../../../src/storage/connector-store.js'
import {
  MESSAGING_CONNECTOR_DEFINITIONS,
  registerMessagingDefinitions,
  getMessagingCapabilities,
} from '../../../../src/connectors/messaging/definitions.js'

// ---------------------------------------------------------------------------
// Migrations for connector definitions table
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all string values from an object tree. */
function collectStrings(obj: unknown): string[] {
  const results: string[] = []
  if (typeof obj === 'string') {
    results.push(obj)
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      results.push(...collectStrings(item))
    }
  } else if (obj !== null && typeof obj === 'object') {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      results.push(...collectStrings(value))
    }
  }
  return results
}

const SECRET_PATTERNS = [
  /sk[-_]/i,
  /token[:=]\s*\S{20,}/i,
  /secret[:=]\s*\S{20,}/i,
  /password[:=]\s*\S{8,}/i,
  /^ghp_/i,
  /^xoxb-/i,
  /^-----BEGIN/,
]

function containsSecretValue(text: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(text))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const PROVIDER_IDS = [
  'feishu',
  'telegram',
  'dingtalk',
  'qq',
  'wechat',
] as const

describe('Messaging Connector Definitions', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let connectorStore: ConnectorStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()
    migrations.apply(connectorMigrations)
    connectorStore = createConnectorStore(connection)
  })

  afterEach(() => {
    connection?.close()
  })

  // -------------------------------------------------------------------------
  // Static definitions array
  // -------------------------------------------------------------------------

  describe('MESSAGING_CONNECTOR_DEFINITIONS', () => {
    it('contains exactly five entries', () => {
      expect(MESSAGING_CONNECTOR_DEFINITIONS).toHaveLength(5)
    })

    it('each definition has connectorType messaging', () => {
      for (const def of MESSAGING_CONNECTOR_DEFINITIONS) {
        expect(def.connectorType).toBe('messaging')
      }
    })

    it('each definition includes text-inbound and text-outbound capabilities', () => {
      for (const def of MESSAGING_CONNECTOR_DEFINITIONS) {
        expect(def.capabilities).toContain('text-inbound')
        expect(def.capabilities).toContain('text-outbound')
      }
    })

    it('each definition has a configSchema with type object', () => {
      for (const def of MESSAGING_CONNECTOR_DEFINITIONS) {
        expect(def.configSchema).toBeDefined()
        expect((def.configSchema as Record<string, unknown>).type).toBe('object')
      }
    })

    it('each definition has status active', () => {
      for (const def of MESSAGING_CONNECTOR_DEFINITIONS) {
        expect(def.status).toBe('active')
      }
    })

    it('each definition has version 1.0.0', () => {
      for (const def of MESSAGING_CONNECTOR_DEFINITIONS) {
        expect(def.version).toBe('1.0.0')
      }
    })
  })

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  describe('registerMessagingDefinitions', () => {
    it('registers all five definitions into the store', () => {
      registerMessagingDefinitions(connectorStore)

      for (const id of PROVIDER_IDS) {
        const def = connectorStore.findDefinitionByConnectorId(id)
        expect(def).toBeDefined()
        expect(def!.connectorType).toBe('messaging')
        expect(def!.status).toBe('active')
      }
    })

    it('definitions appear when listing by type', () => {
      registerMessagingDefinitions(connectorStore)

      const messagingDefs = connectorStore.findDefinitionsByType('messaging')
      expect(messagingDefs).toHaveLength(5)
      for (const def of messagingDefs) {
        expect(PROVIDER_IDS).toContain(def.connectorId)
      }
    })

    it('is idempotent — re-registration does not throw or duplicate', () => {
      registerMessagingDefinitions(connectorStore)
      registerMessagingDefinitions(connectorStore)

      const messagingDefs = connectorStore.findDefinitionsByType('messaging')
      expect(messagingDefs).toHaveLength(5)
    })

    it('existing definitions are preserved on re-registration', () => {
      registerMessagingDefinitions(connectorStore)
      const firstRun = connectorStore.findDefinitionsByType('messaging')

      registerMessagingDefinitions(connectorStore)
      const secondRun = connectorStore.findDefinitionsByType('messaging')

      for (let i = 0; i < firstRun.length; i++) {
        expect(secondRun[i].id).toBe(firstRun[i].id)
        expect(secondRun[i].createdAt).toBe(firstRun[i].createdAt)
      }
    })
  })

  // -------------------------------------------------------------------------
  // No secrets in metadata
  // -------------------------------------------------------------------------

  describe('secret safety', () => {
    it('definition metadata contains no secret values', () => {
      registerMessagingDefinitions(connectorStore)

      const allDefs = connectorStore.findDefinitionsByType('messaging')
      for (const def of allDefs) {
        const allStrings = collectStrings(def)
        for (const s of allStrings) {
          expect(containsSecretValue(s)).toBe(false)
        }
      }
    })

    it('configSchema fields marked isSecret have no default values', () => {
      for (const def of MESSAGING_CONNECTOR_DEFINITIONS) {
        const schema = def.configSchema as Record<string, unknown>
        const properties = schema.properties as Record<string, Record<string, unknown>>
        for (const [, prop] of Object.entries(properties)) {
          if (prop.isSecret === true) {
            expect(prop.default).toBeUndefined()
            expect(prop.value).toBeUndefined()
            expect(prop.example).toBeUndefined()
          }
        }
      }
    })
  })

  // -------------------------------------------------------------------------
  // getMessagingCapabilities
  // -------------------------------------------------------------------------

  describe('getMessagingCapabilities', () => {
    it('returns two capabilities for each known provider', () => {
      for (const id of PROVIDER_IDS) {
        const caps = getMessagingCapabilities(id)
        expect(caps).toHaveLength(2)
      }
    })

    it('capabilities include text inbound and outbound categories', () => {
      for (const id of PROVIDER_IDS) {
        const caps = getMessagingCapabilities(id)
        const categories = caps.map((c) => c.category)
        expect(categories).toContain('read')
        expect(categories).toContain('send')
      }
    })

    it('capabilities include correct supported operations', () => {
      for (const id of PROVIDER_IDS) {
        const caps = getMessagingCapabilities(id)
        const inbound = caps.find((c) => c.supportedOperations.includes('receive_text'))
        const outbound = caps.find((c) => c.supportedOperations.includes('send_text'))
        expect(inbound).toBeDefined()
        expect(outbound).toBeDefined()
      }
    })

    it('all capabilities require auth', () => {
      for (const id of PROVIDER_IDS) {
        const caps = getMessagingCapabilities(id)
        for (const cap of caps) {
          expect(cap.requiresAuth).toBe(true)
        }
      }
    })

    it('returns empty array for unknown connectorId', () => {
      expect(getMessagingCapabilities('messaging-unknown')).toEqual([])
    })

    it('capability IDs follow naming convention', () => {
      for (const id of PROVIDER_IDS) {
        const caps = getMessagingCapabilities(id)
        for (const cap of caps) {
          expect(cap.capabilityId).toMatch(new RegExp(`^${id}:`))
        }
      }
    })
  })

  // -------------------------------------------------------------------------
  // Capabilities discoverable from store definitions
  // -------------------------------------------------------------------------

  describe('store-backed capability discovery', () => {
    it('capabilities can be resolved for each registered definition', () => {
      registerMessagingDefinitions(connectorStore)

      for (const id of PROVIDER_IDS) {
        const def = connectorStore.findDefinitionByConnectorId(id)
        expect(def).toBeDefined()

        const caps = getMessagingCapabilities(id)
        expect(caps.length).toBeGreaterThan(0)

        // Capability IDs are prefixed with the connectorId
        for (const cap of caps) {
          expect(cap.capabilityId).toContain(id)
        }
      }
    })

    it('definition capabilities match getMessagingCapabilities categories', () => {
      registerMessagingDefinitions(connectorStore)

      for (const id of PROVIDER_IDS) {
        const def = connectorStore.findDefinitionByConnectorId(id)!
        const caps = getMessagingCapabilities(id)

        // The definition declares ['text-inbound', 'text-outbound']
        expect(def.capabilities).toContain('text-inbound')
        expect(def.capabilities).toContain('text-outbound')

        // getMessagingCapabilities returns matching read/send operations
        const operations = caps.flatMap((c) => c.supportedOperations)
        expect(operations).toContain('receive_text')
        expect(operations).toContain('send_text')
      }
    })
  })
})
