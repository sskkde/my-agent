/**
 * AgentlyMail connector tool bootstrap.
 *
 * Wires definition → runtime adapter → system instance → ToolRegistry tools
 * during API context startup. Gated by AGENTLY_MAIL_ENABLED=true.
 *
 * Replaces the legacy mock email_* builtins when enabled.
 *
 * @module connectors/agently-mail/register-agently-mail-tools
 */

import type { ConnectorStore } from '../../storage/connector-store.js'
import type { ToolRegistry } from '../../tools/types.js'
import type { ConnectorRuntime } from '../types.js'
import { createConnectorRuntime } from '../connector-runtime.js'
import { createConnectorToolBridge, registerConnectorTools } from '../connector-tool-bridge.js'
import { createAgentlyMailCapabilities } from './capabilities.js'
import { buildAgentlyMailDefinition } from './definitions.js'
import { registerAgentlyMailConnector } from './index.js'

const SYSTEM_USER_ID = 'system'
const SYSTEM_INSTANCE_NAME = 'AgentlyMail System Instance'
const SYSTEM_AUTH_STATE_REF = 'agently_mail:system'

export interface RegisterAgentlyMailToolsDeps {
  connectorStore: ConnectorStore
  toolRegistry: ToolRegistry
  env?: Record<string, string | undefined>
  /** Optional pre-built runtime (tests). When omitted, a new runtime is created. */
  runtime?: ConnectorRuntime
}

export interface RegisterAgentlyMailToolsResult {
  enabled: boolean
  registered: boolean
  toolCount: number
  runtime?: ConnectorRuntime
  reason?: string
}

function parseTimeoutMs(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

function ensureDefinition(connectorStore: ConnectorStore): void {
  const existing = connectorStore.findDefinitionByConnectorId('agently_mail')
  if (existing) return
  connectorStore.createDefinition(buildAgentlyMailDefinition())
}

/**
 * Register AgentlyMail connector tools into the live ToolRegistry.
 *
 * Behaviour:
 * - AGENTLY_MAIL_ENABLED !== "true" → no-op
 * - definition registration is idempotent
 * - ensures a system-scoped active instance when definition is active
 * - registers connector_* tools via ConnectorToolBridge
 * - never throws (startup-safe)
 */
export function registerAgentlyMailTools(deps: RegisterAgentlyMailToolsDeps): RegisterAgentlyMailToolsResult {
  const env = deps.env ?? process.env
  const enabled = (env.AGENTLY_MAIL_ENABLED ?? '').toLowerCase() === 'true'
  if (!enabled) {
    return { enabled: false, registered: false, toolCount: 0, reason: 'disabled' }
  }

  try {
    ensureDefinition(deps.connectorStore)

    const definition = deps.connectorStore.findDefinitionByConnectorId('agently_mail')
    if (!definition) {
      console.warn('[agently-mail] AGENTLY_MAIL_ENABLED=true but definition was not registered')
      return { enabled: true, registered: false, toolCount: 0, reason: 'definition_missing' }
    }

    const runtime =
      deps.runtime ??
      createConnectorRuntime({
        connectorStore: deps.connectorStore,
        toolBridge: createConnectorToolBridge(),
      })

    const cliPath = env.AGENTLY_MAIL_CLI_PATH?.trim()
    const timeoutMs = parseTimeoutMs(env.AGENTLY_MAIL_TIMEOUT_MS)
    registerAgentlyMailConnector(runtime, {
      ...(cliPath ? { cliPath } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    })

    let instance = deps.connectorStore
      .findInstancesByUserAndConnector(SYSTEM_USER_ID, definition.id)
      .find((row) => row.status === 'active')

    if (!instance && definition.status === 'active') {
      instance = deps.connectorStore.createInstance({
        connectorInstanceId: `agently_mail_system_${definition.id.slice(0, 8)}`,
        connectorDefinitionId: definition.id,
        userId: SYSTEM_USER_ID,
        name: SYSTEM_INSTANCE_NAME,
        authStateRef: SYSTEM_AUTH_STATE_REF,
        config: {
          connectorId: 'agently_mail',
          ...(cliPath ? { cliPath } : {}),
        },
        status: 'active',
      })
    }

    if (!instance) {
      console.warn(
        '[agently-mail] Definition registered but no active instance (CLI may be missing). Tools not registered.',
      )
      return {
        enabled: true,
        registered: false,
        toolCount: 0,
        runtime,
        reason: 'instance_unavailable',
      }
    }

    const capabilities = createAgentlyMailCapabilities()
    registerConnectorTools(deps.toolRegistry, { ...instance, connectorId: 'agently_mail' }, capabilities, { runtime })

    const toolCount = deps.toolRegistry.listTools().filter((t) => t.metadata?.connectorId === 'agently_mail').length

    console.log(`[agently-mail] Registered ${toolCount} connector tool(s) for instance ${instance.id}`)
    return { enabled: true, registered: true, toolCount, runtime }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[agently-mail] Failed to register tools: ${message}`)
    return { enabled: true, registered: false, toolCount: 0, reason: 'error' }
  }
}
