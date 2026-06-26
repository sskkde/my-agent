/**
 * AgentlyMail connector definition — registers a single 'custom' connector
 * definition into the connector store when the AGENTLY_MAIL_ENABLED env var
 * is set to "true".
 *
 * Definitions contain NO secret values — only schema descriptions.
 * CLI availability is detected at registration time; when the CLI binary is
 * not found the definition is registered with status 'inactive' so the API
 * lists it as unavailable without crashing startup.
 */

import { execFileSync } from 'node:child_process'
import type { ConnectorStore, ConnectorDefinition } from '../../storage/connector-store.js'
import { AGENTLY_MAIL_CAPABILITIES } from './capability-definitions.js'

// ---------------------------------------------------------------------------
// CLI availability detection
// ---------------------------------------------------------------------------

/**
 * Synchronously check whether the `agently-cli` binary is on PATH.
 * Uses `which` (POSIX) with a 5-second timeout. Returns false on any error
 * (binary missing, timeout, unexpected failure) — never throws.
 */
function detectCliAvailability(): boolean {
  try {
    execFileSync('which', ['agently-cli'], { stdio: 'ignore', timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Definition data
// ---------------------------------------------------------------------------

export type AgentlyMailDefinitionInput = Omit<
  ConnectorDefinition,
  'id' | 'createdAt' | 'updatedAt'
>

/**
 * Build the AgentlyMail connector definition.
 * Capability IDs are derived from the canonical capability-definitions module
 * so the store definition stays in sync with the runtime capability surface.
 */
export function buildAgentlyMailDefinition(): AgentlyMailDefinitionInput {
  const cliAvailable = detectCliAvailability()

  return {
    connectorId: 'agently_mail',
    name: 'AgentlyMail',
    connectorType: 'custom',
    version: '1.0.0',
    description: cliAvailable
      ? 'CLI-backed email connector for reading, searching, sending, and managing messages via agently-cli.'
      : 'CLI-backed email connector (agently-cli not found on PATH — install the CLI to activate).',
    capabilities: AGENTLY_MAIL_CAPABILITIES.map((c) => c.capabilityId),
    configSchema: {
      type: 'object',
      properties: {
        cliPath: {
          type: 'string',
          description: 'Override path to the agently-cli binary (default: agently-cli on PATH)',
        },
      },
    },
    status: cliAvailable ? 'active' : 'inactive',
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the AgentlyMail connector definition into the store.
 * Idempotent — skips if the definition is already registered.
 *
 * Gated by the `AGENTLY_MAIL_ENABLED` environment variable:
 *  - `"true"` (case-insensitive): register the definition
 *  - any other value or unset: no-op
 */
export function registerAgentlyMailDefinition(connectorStore: ConnectorStore): void {
  const enabled = (process.env.AGENTLY_MAIL_ENABLED ?? '').toLowerCase() === 'true'
  if (!enabled) {
    return
  }

  const existing = connectorStore.findDefinitionByConnectorId('agently_mail')
  if (existing) {
    return
  }

  const def = buildAgentlyMailDefinition()
  connectorStore.createDefinition(def)
}
