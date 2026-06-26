// AgentlyMail connector capability orchestrator.
// Imports pure data from capability-definitions.ts and exposes lookup helpers.
// auth_login / auth_logout are intentionally excluded — they are interactive
// OAuth flows that MUST NOT be exposed as model-callable tools.

import type { ConnectorCapability } from '../types.js'
import type { AgentlyMailOperation } from './types.js'
import { AGENTLY_MAIL_CAPABILITIES } from './capability-definitions.js'

// ─── Capability factory ───────────────────────────────────────────────────────

/**
 * Returns the full capability set for the AgentlyMail connector.
 * Each capability maps 1:1 to a CLI operation (except auth_login/auth_logout).
 */
export function createAgentlyMailCapabilities(): ConnectorCapability[] {
  return [...AGENTLY_MAIL_CAPABILITIES]
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

const CAPABILITY_BY_OPERATION = new Map<AgentlyMailOperation, ConnectorCapability>(
  AGENTLY_MAIL_CAPABILITIES.map((cap) => [
    cap.supportedOperations[0] as AgentlyMailOperation,
    cap,
  ]),
)

/** All AgentlyMail operations that are exposed as model-callable capabilities. */
export const AGENTLY_MAIL_EXPOSED_OPERATIONS: readonly AgentlyMailOperation[] = [
  ...CAPABILITY_BY_OPERATION.keys(),
]

/**
 * auth_login and auth_logout are intentionally excluded from the capability
 * surface. They are interactive OAuth flows that require user setup context
 * (PTY, browser redirect) and MUST NOT be callable by the model as ordinary tools.
 */
export const AGENTLY_MAIL_HIDDEN_OPERATIONS: readonly AgentlyMailOperation[] = [
  'auth_login',
  'auth_logout',
]

/** Look up a capability by its operation name. Returns undefined for hidden ops. */
export function getCapabilityByOperation(
  operation: AgentlyMailOperation,
): ConnectorCapability | undefined {
  return CAPABILITY_BY_OPERATION.get(operation)
}
