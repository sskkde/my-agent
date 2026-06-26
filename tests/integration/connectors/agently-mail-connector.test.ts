/**
 * Integration test: AgentlyMail connector registered with ConnectorRuntime.
 * noqa: SIZE_OK — single integration scenario; migrations + setup boilerplate ~150 LOC are indivisible
 *
 * Exercises the full stack — in-memory store → runtime → adapter → fake CLI runner →
 * normalized response — for every read/write operation. Write operations (send,
 * trash) test the REQUIRES_CONFIRMATION short-circuit path because the adapter
 * defers two-stage confirmation to the confirmation manager.
 *
 * Exit code passthrough tests verify that non-zero exits are never reported as
 * success, and that specific codes map to the correct ConnectorResponseStatus.
 *
 * No real agently-cli binary or network is involved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { createConnectorStore } from '../../../src/storage/connector-store.js'
import { createEventStore } from '../../../src/storage/event-store.js'
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js'
import { createConnectorToolBridge } from '../../../src/connectors/connector-tool-bridge.js'
import type { ConnectorRuntime, ConnectorCallRequest, ConnectorResponse } from '../../../src/connectors/types.js'
import type { ExecFileFn } from '../../../src/connectors/agently-mail/cli-runner.js'
import {
  registerAgentlyMailConnector,
} from '../../../src/connectors/agently-mail/index.js'

// ─── Fake execFile ────────────────────────────────────────────────────────────

/**
 * Build a fake execFile function that resolves CLI calls with canned JSON
 * envelopes based on the CLI argv. No child process is spawned.
 */
function createFakeExecFile(): ExecFileFn {
  return (_file, args, _options, callback) => {
    const argv = args as readonly string[]
    // The runner calls: execFile(cliPath, [operation, ...argv], opts, cb)
    // So args[0] is the operation (e.g. '+me', 'message') and args[1:] are flags.
    const cmd = argv[0] ?? ''

    if (cmd === '+me') {
      callback(null, JSON.stringify({
        data: {
          user: { email: 'test@example.com', name: 'Test User' },
          aliases: ['test+work@example.com'],
        },
      }), '')
    } else if (cmd === 'message' && argv[1] === '+list') {
      callback(null, JSON.stringify({
        data: {
          messages: [
            { id: 'msg_001', subject: 'Hello', from: { name: 'Alice', address: 'alice@example.com' } },
            { id: 'msg_002', subject: 'World', from: { name: 'Bob', address: 'bob@example.com' } },
          ],
          nextCursor: null,
        },
      }), '')
    } else if (cmd === 'message' && argv[1] === '+read') {
      callback(null, JSON.stringify({
        data: {
          id: argv[3] ?? 'msg_001',
          subject: 'Hello',
          from: { name: 'Alice', address: 'alice@example.com' },
          to: [{ name: 'Test User', address: 'test@example.com' }],
          body: 'Hello from integration test',
          date: '2026-06-26T00:00:00Z',
          is_read: false,
          folder: 'inbox',
          attachments: [],
        },
      }), '')
    } else if (cmd === 'message' && argv[1] === '+search') {
      callback(null, JSON.stringify({
        data: {
          messages: [
            { id: 'msg_003', subject: 'Search hit', from: { name: 'Charlie', address: 'charlie@example.com' } },
          ],
          nextCursor: null,
        },
      }), '')
    } else if (cmd === 'message' && (argv[1] === '+send' || argv[1] === '+trash')) {
      callback(
        { code: 8, message: 'confirmation required', killed: false, signal: undefined },
        JSON.stringify({ error: { code: 'MISSING_CONFIRMATION_TOKEN', message: 'Confirmation required. Token: ctk_integration_123' } }),
        '',
      )
    } else {
      callback(null, JSON.stringify({ data: null }), '')
    }

    return { kill: () => false }
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONNECTOR_DEFINITION = {
  connectorId: 'agently_mail',
  name: 'AgentlyMail',
  connectorType: 'custom' as const,
  version: '1.0.0',
  description: 'Agently CLI mail connector',
  capabilities: [
    'agently_mail.me',
    'agently_mail.auth_status',
    'agently_mail.list_messages',
    'agently_mail.read_message',
    'agently_mail.search_messages',
    'agently_mail.send_message',
    'agently_mail.reply_message',
    'agently_mail.forward_message',
    'agently_mail.trash_message',
    'agently_mail.download_attachment',
  ],
  configSchema: {},
  status: 'active' as const,
}

const CONNECTOR_INSTANCE_BASE = {
  connectorInstanceId: 'inst-agently-mail-001',
  userId: 'user-001',
  name: 'My AgentlyMail',
  authStateRef: 'auth-ref-001',
  config: {},
  status: 'active' as const,
}

// ─── Store migrations ─────────────────────────────────────────────────────────

const storeMigrations = [
  {
    version: 1,
    name: 'create_connector_definitions_table',
    up: `
      CREATE TABLE connector_definitions (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        connector_type TEXT NOT NULL,
        version TEXT NOT NULL,
        description TEXT,
        capabilities TEXT NOT NULL,
        config_schema TEXT,
        status TEXT NOT NULL,
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
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
    `,
    down: `DROP TABLE IF EXISTS connector_instances;`,
  },
  {
    version: 3,
    name: 'create_connector_events_table',
    up: `
      CREATE TABLE connector_events (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        connector_instance_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT,
        processed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
    `,
    down: `DROP TABLE IF EXISTS connector_events;`,
  },
  {
    version: 4,
    name: 'create_events_table',
    up: `
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        source_module TEXT NOT NULL,
        user_id TEXT,
        session_id TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        idempotency_key TEXT,
        planner_run_id TEXT,
        plan_id TEXT,
        run_id TEXT,
        workflow_run_id TEXT,
        workflow_step_run_id TEXT,
        background_run_id TEXT,
        subagent_run_id TEXT,
        tool_call_id TEXT,
        approval_id TEXT,
        wait_condition_id TEXT,
        artifact_id TEXT,
        memory_id TEXT,
        payload TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        retention_class TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default',
        created_at TEXT NOT NULL
      );
    `,
    down: `DROP TABLE IF EXISTS events;`,
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wire up a fresh runtime + adapter + definition + instance. Returns instance.id. */
function setupRuntime(conn: ConnectionManager) {
  const mig = createMigrationRunner(conn)
  mig.init()
  mig.apply(storeMigrations)

  const store = createConnectorStore(conn)
  const evtStore = createEventStore(conn)
  const rt = createConnectorRuntime({
    connectorStore: store,
    toolBridge: createConnectorToolBridge(),
    eventStore: evtStore,
  })

  return { store, evtStore, rt }
}

function makeRequest(
  instanceId: string,
  overrides: Partial<ConnectorCallRequest> & { operation: string },
): ConnectorCallRequest {
  return {
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    connectorInstanceId: instanceId,
    capabilityId: `agently_mail.${overrides.operation}`,
    params: {},
    userId: 'user-001',
    ...overrides,
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('AgentlyMail Connector Integration', () => {
  let connection: ConnectionManager
  let runtime: ConnectorRuntime
  let instanceId: string

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const { rt } = setupRuntime(connection)
    runtime = rt

    const execFileFn = createFakeExecFile()
    registerAgentlyMailConnector(runtime, { execFileFn })

    const def = runtime.registerDefinition(CONNECTOR_DEFINITION)
    const instance = runtime.createInstance({
      ...CONNECTOR_INSTANCE_BASE,
      connectorDefinitionId: def.id,
    })
    instanceId = instance.id
  })

  afterEach(() => {
    connection?.close()
  })

  // ── Registration ────────────────────────────────────────────────────────────

  describe('Registration', () => {
    it('should register adapter and create definition + instance', () => {
      // Given/When: setup happens in beforeEach
      // Then: instance has expected id
      expect(instanceId).toBeDefined()
    })
  })

  // ── Capability discovery ────────────────────────────────────────────────────

  describe('Capability discovery', () => {
    it('should return all capabilities from the adapter', () => {
      // When: capabilities are discovered via the runtime
      const capabilities = runtime.discoverCapabilities(instanceId)

      // Then: adapter returns its 9 inline capabilities (me through trash_message)
      expect(capabilities.length).toBeGreaterThanOrEqual(9)

      // And: key capability IDs are present
      const capIds = capabilities.map((c) => c.capabilityId)
      expect(capIds).toContain('agently_mail.me')
      expect(capIds).toContain('agently_mail.auth_status')
      expect(capIds).toContain('agently_mail.list_messages')
      expect(capIds).toContain('agently_mail.read_message')
      expect(capIds).toContain('agently_mail.search_messages')
      expect(capIds).toContain('agently_mail.send_message')
      expect(capIds).toContain('agently_mail.reply_message')
      expect(capIds).toContain('agently_mail.forward_message')
      expect(capIds).toContain('agently_mail.trash_message')
    })
  })

  // ── Read operations ─────────────────────────────────────────────────────────

  describe('Read operations via executeCall', () => {
    it('me → returns success with user data and audit metadata', async () => {
      // When: executing the 'me' operation
      const response = await runtime.executeCall(
        makeRequest(instanceId, { operation: 'me' }),
      ) as ConnectorResponse

      // Then: response is success with user data
      expect(response.status).toBe('success')
      expect(response.requestId).toBeDefined()
      expect(response.connectorInstanceId).toBeDefined()
      expect(response.data).toBeDefined()
      expect(response.error).toBeUndefined()
    })

    it('list_messages → returns success with message list', async () => {
      // When: executing the 'list_messages' operation
      const response = await runtime.executeCall(
        makeRequest(instanceId, {
          operation: 'list_messages',
          params: { dir: 'inbox', limit: 10 },
        }),
      ) as ConnectorResponse

      // Then: response is success with data
      expect(response.status).toBe('success')
      expect(response.data).toBeDefined()
      expect(response.error).toBeUndefined()
    })

    it('read_message → returns success with message body', async () => {
      // When: executing the 'read_message' operation
      const response = await runtime.executeCall(
        makeRequest(instanceId, {
          operation: 'read_message',
          params: { id: 'msg_001' },
        }),
      ) as ConnectorResponse

      // Then: response is success with message data
      expect(response.status).toBe('success')
      expect(response.data).toBeDefined()
      expect(response.error).toBeUndefined()
    })

    it('search_messages → returns success with search results', async () => {
      // When: executing the 'search_messages' operation
      const response = await runtime.executeCall(
        makeRequest(instanceId, {
          operation: 'search_messages',
          params: { q: 'integration test' },
        }),
      ) as ConnectorResponse

      // Then: response is success with results
      expect(response.status).toBe('success')
      expect(response.data).toBeDefined()
      expect(response.error).toBeUndefined()
    })
  })

  // ── Write operations ────────────────────────────────────────────────────────

  describe('Write operations via executeCall', () => {
    it('send_message first stage → REQUIRES_CONFIRMATION', async () => {
      // When: executing send_message without a confirmation token
      const response = await runtime.executeCall(
        makeRequest(instanceId, {
          operation: 'send_message',
          params: { to: ['alice@example.com'], subject: 'Test', body: 'Hello' },
        }),
      ) as ConnectorResponse

      // Then: the adapter starts the upstream confirmation flow
      expect(response.status).toBe('failed')
      expect(response.error).toBeDefined()
      expect(response.error!.code).toBe('REQUIRES_CONFIRMATION')
      expect(response.error!.recoverable).toBe(true)
    })

    it('trash_message first stage → REQUIRES_CONFIRMATION', async () => {
      // When: executing trash_message without a confirmation token
      const response = await runtime.executeCall(
        makeRequest(instanceId, {
          operation: 'trash_message',
          params: { id: 'msg_001' },
        }),
      ) as ConnectorResponse

      // Then: the adapter starts the upstream confirmation flow
      expect(response.status).toBe('failed')
      expect(response.error).toBeDefined()
      expect(response.error!.code).toBe('REQUIRES_CONFIRMATION')
      expect(response.error!.recoverable).toBe(true)
    })
  })

  // ── Exit code passthrough ───────────────────────────────────────────────────

  describe('Exit code passthrough', () => {
    it('exit 7 → rate_limited with retry metadata', async () => {
      // Given: a runtime with an execFile that returns exit code 7 (rate limited)
      const conn = createConnectionManager(':memory:')
      conn.open()
      const { rt } = setupRuntime(conn)

      const execFileFn: ExecFileFn = (_file, _args, _options, callback) => {
        callback(
          { code: 7, message: 'rate limited', killed: false, signal: undefined },
          JSON.stringify({ metadata: { retry_after: 60 } }),
          '',
        )
        return { kill: () => false }
      }

      registerAgentlyMailConnector(rt, { execFileFn })
      const d = rt.registerDefinition(CONNECTOR_DEFINITION)
      const inst = rt.createInstance({ ...CONNECTOR_INSTANCE_BASE, connectorDefinitionId: d.id })

      // When: executing an operation
      const response = await rt.executeCall(
        makeRequest(inst.id, { operation: 'me' }),
      ) as ConnectorResponse

      // Then: response is rate_limited with retry metadata
      expect(response.status).toBe('rate_limited')
      expect(response.error).toBeDefined()
      expect(response.error!.code).toBe('RATE_LIMITED')
      expect(response.error!.recoverable).toBe(true)
      expect(response.metadata).toBeDefined()
      expect(response.metadata!.retryAfterMs).toBeGreaterThan(0)

      conn.close()
    })

    it('exit 3 → auth_required', async () => {
      // Given: a runtime with an execFile that returns exit code 3 (auth expired)
      const conn = createConnectionManager(':memory:')
      conn.open()
      const { rt } = setupRuntime(conn)

      const execFileFn: ExecFileFn = (_file, _args, _options, callback) => {
        callback(
          { code: 3, message: 'auth expired', killed: false, signal: undefined },
          '',
          'Authentication expired',
        )
        return { kill: () => false }
      }

      registerAgentlyMailConnector(rt, { execFileFn })
      const d = rt.registerDefinition(CONNECTOR_DEFINITION)
      const inst = rt.createInstance({ ...CONNECTOR_INSTANCE_BASE, connectorDefinitionId: d.id })

      // When: executing an operation
      const response = await rt.executeCall(
        makeRequest(inst.id, { operation: 'me' }),
      ) as ConnectorResponse

      // Then: response is auth_required
      expect(response.status).toBe('auth_required')
      expect(response.error).toBeDefined()
      expect(response.error!.code).toBe('AUTH_EXPIRED')
      expect(response.error!.recoverable).toBe(true)

      conn.close()
    })

    it('non-zero exit codes never claim success', async () => {
      // Given: exit codes that should all fail
      const exitCodes = [1, 2, 3, 4, 6, 7, 8]

      for (const exitCode of exitCodes) {
        const conn = createConnectionManager(':memory:')
        conn.open()
        const { rt } = setupRuntime(conn)

        const execFileFn: ExecFileFn = (_file, _args, _options, callback) => {
          callback(
            { code: exitCode, message: `exit ${exitCode}`, killed: false, signal: undefined },
            '',
            `Error exit ${exitCode}`,
          )
          return { kill: () => false }
        }

        registerAgentlyMailConnector(rt, { execFileFn })
        const d = rt.registerDefinition(CONNECTOR_DEFINITION)
        const inst = rt.createInstance({ ...CONNECTOR_INSTANCE_BASE, connectorDefinitionId: d.id })

        const response = await rt.executeCall(
          makeRequest(inst.id, { operation: 'me' }),
        ) as ConnectorResponse

        expect(response.status).not.toBe('success')

        conn.close()
      }
    })
  })
})
