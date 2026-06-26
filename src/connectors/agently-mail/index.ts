/**
 * AgentlyMail connector barrel.
 *
 * Public surface:
 *   - All type exports from ./types.js
 *   - `createAgentlyMailConnectorAdapter(options?)` — factory for the adapter
 *   - `createAgentlyMailCapabilities()` — capability list
 *   - Capability lookup helpers from ./capabilities.js
 *   - `registerAgentlyMailConnector(runtime, options?)` — explicit runtime registration
 *
 * IMPORTANT: Importing this module MUST NOT trigger side effects.
 * No CLI invocation, no OAuth flows, no package installation, no process spawning.
 */

// ─── Type re-exports ──────────────────────────────────────────────────────────
// Every public type from the types module is re-exported here so consumers
// can import from the package root instead of reaching into sub-modules.

export type {
  AgentlyMailOperation,
  AgentlyMailExitCode,
  AgentlyMailCliEnvelope,
  AgentlyMailCliSuccessEnvelope,
  AgentlyMailCliErrorEnvelope,
  AgentlyMailCliRequest,
  MessageId,
  AttachmentId,
  AgentlyMailConfirmationToken,
  AgentlyMailAttachment,
  AgentlyMailContact,
  AgentlyMailMessage,
  ConfirmationActionInput,
  ListMessagesInput,
  ReadMessageInput,
  SearchMessagesInput,
  SendMessageInput,
  ReplyMessageInput,
  ForwardMessageInput,
  TrashMessageInput,
  DownloadAttachmentInput,
  AgentlyMailOperationInputMap,
} from './types.js'

export { AGENTLY_MAIL_EXIT_DESCRIPTIONS } from './types.js'

// ─── Capability re-exports ────────────────────────────────────────────────────

export {
  createAgentlyMailCapabilities,
  AGENTLY_MAIL_EXPOSED_OPERATIONS,
  AGENTLY_MAIL_HIDDEN_OPERATIONS,
  getCapabilityByOperation,
} from './capabilities.js'

// ─── Adapter factory ──────────────────────────────────────────────────────────

import { AgentlyMailAdapter } from './adapter.js'
import { AgentlyCliRunner } from './cli-runner.js'
import type { ExecFileFn } from './cli-runner.js'
import type { ConnectorAdapter } from '../types.js'

/**
 * Options for the AgentlyMail connector adapter.
 * All fields are optional; omitted values use sensible defaults.
 */
export interface AgentlyMailConnectorAdapterOptions {
  /**
   * Custom `execFile` function for the CLI runner.
   * Primarily used in tests to inject a mock without spawning real processes.
   * When omitted, the runner uses `node:child_process.execFile`.
   */
  readonly execFileFn?: ExecFileFn
}

/**
 * Create an AgentlyMail connector adapter backed by a fresh CLI runner.
 *
 * The returned adapter implements `ConnectorAdapter` (execute, discoverCapabilities,
 * checkHealth) and is ready to be registered with a `ConnectorRuntime`.
 *
 * This function is a pure factory — it performs no I/O, spawns no processes,
 * and triggers no OAuth flows. Side effects happen only when `adapter.execute()`
 * is called with a real request.
 */
export function createAgentlyMailConnectorAdapter(
  options?: AgentlyMailConnectorAdapterOptions,
): ConnectorAdapter {
  const runner = new AgentlyCliRunner(options?.execFileFn)
  return new AgentlyMailAdapter(runner)
}

// ─── Runtime registration ─────────────────────────────────────────────────────

import type { ConnectorRuntime } from '../types.js'

/**
 * Register the AgentlyMail adapter with a connector runtime.
 *
 * This is the explicit, mode-gated registration entry point. Callers must
 * invoke this deliberately — importing the module does NOT register anything.
 *
 * @param runtime - The connector runtime instance (must expose `registerAdapter`).
 * @param options - Optional adapter configuration.
 * @returns The registered adapter instance.
 */
export function registerAgentlyMailConnector(
  runtime: ConnectorRuntime,
  options?: AgentlyMailConnectorAdapterOptions,
): ConnectorAdapter {
  const adapter = createAgentlyMailConnectorAdapter(options)
  // ConnectorRuntime interface does not expose registerAdapter, but the
  // runtime implementation (ConnectorRuntimeImpl) does. The mock connectors
  // use the same cast pattern.
  ;(
    runtime as unknown as {
      registerAdapter: (type: string, adapter: unknown) => void
    }
  ).registerAdapter('agently_mail', adapter)
  return adapter
}
