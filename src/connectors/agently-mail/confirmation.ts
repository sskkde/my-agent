// AgentlyMail two-stage confirmation manager for write operations.
// Send, reply, forward, and trash require two-stage confirmation because
// writes are irreversible. Stage 1 returns a ctk_xxx token + summary;
// Stage 2 passes the token via --confirmation-token to proceed.

import { createHash } from 'node:crypto'
import type { ConnectorResponse } from '../types.js'
import type { AgentlyMailOperation, AgentlyMailConfirmationToken } from './types.js'
import type { AgentlyCliRunner, AgentlyCliRunnerOptions } from './cli-runner.js'
import { normalizeAgentlyMailResponse } from './response-normalizer.js'
import { buildArgv } from './cli-argv.js'

// ─── Constants ─────────────────────────────────────────────────────────────────

const CONFIRMATION_TTL_MS = 5 * 60 * 1000 // 5 minutes
const TOKEN_PATTERN = /ctk_[A-Za-z0-9_-]+/
const CONFIRMATION_OPERATIONS: ReadonlySet<AgentlyMailOperation> = new Set([
  'send_message',
  'reply_message',
  'forward_message',
  'trash_message',
])

// ─── Public types ──────────────────────────────────────────────────────────────

export interface PendingConfirmation {
  readonly operation: AgentlyMailOperation
  readonly params: Record<string, unknown>
  readonly paramsHash: string
  readonly createdAt: number
  readonly expiresAt: number
}

export interface ConfirmationResult {
  readonly response: ConnectorResponse
  readonly token?: AgentlyMailConfirmationToken
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Stable JSON serialization for hash comparison. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** SHA-256 hash of stable-serialized params. */
function hashParams(params: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(params)).digest('hex')
}

/** Extract ctk_xxx token from CLI stdout or stderr. */
function extractToken(text: string): AgentlyMailConfirmationToken | undefined {
  const match = TOKEN_PATTERN.exec(text)
  return match ? (match[0] as AgentlyMailConfirmationToken) : undefined
}

/** Map operation name to the CLI operation string. */
function toCliOperation(operation: AgentlyMailOperation): AgentlyMailOperation {
  return operation
}

// ─── AgentlyMailConfirmationManager ────────────────────────────────────────────

export class AgentlyMailConfirmationManager {
  readonly pendingConfirmations = new Map<string, PendingConfirmation>()

  /**
   * Stage 1: Execute a write operation without a confirmation token.
   * If the CLI returns exit code 8 (missing confirmation token), stores the
   * pending confirmation and returns a ConnectorResponse with status 'failed'
   * and code 'REQUIRES_CONFIRMATION'.
   *
   * If the operation succeeds (exit 0), returns the success response directly.
   */
  async startConfirmation(
    operation: AgentlyMailOperation,
    params: Record<string, unknown>,
    runner: AgentlyCliRunner,
    instanceId: string,
    requestId: string,
    options?: AgentlyCliRunnerOptions,
  ): Promise<ConfirmationResult> {
    if (!CONFIRMATION_OPERATIONS.has(operation)) {
      return {
        response: normalizeAgentlyMailResponse('', '', 0, requestId, instanceId),
      }
    }

    const argv = buildArgv(operation, params)
    const result = await runner.run(toCliOperation(operation), argv, options)

    // Exit code 8 = missing confirmation token
    if (result.exitCode === 8) {
      const token = extractToken(result.stdout) ?? extractToken(result.stderr)
      if (!token) {
        // CLI should have returned a token but didn't — treat as error
        return {
          response: normalizeAgentlyMailResponse(
            result.stdout,
            result.stderr,
            result.exitCode,
            requestId,
            instanceId,
          ),
        }
      }

      const now = Date.now()
      const pending: PendingConfirmation = {
        operation,
        params: { ...params },
        paramsHash: hashParams(params),
        createdAt: now,
        expiresAt: now + CONFIRMATION_TTL_MS,
      }
      this.pendingConfirmations.set(token, pending)

      const summary = this.extractSummary(result.stdout, result.stderr)

      return {
        response: {
          status: 'failed',
          requestId,
          connectorInstanceId: instanceId,
          error: {
            code: 'REQUIRES_CONFIRMATION',
            message: summary ?? 'This operation requires explicit confirmation.',
            recoverable: true,
          },
          metadata: {
            confirmationToken: token,
            summary,
            expiresAt: new Date(pending.expiresAt).toISOString(),
          },
        } as ConnectorResponse,
        token,
      }
    }

    // Any other exit code — return normalized response as-is
    return {
      response: normalizeAgentlyMailResponse(
        result.stdout,
        result.stderr,
        result.exitCode,
        requestId,
        instanceId,
      ),
    }
  }

  /**
   * Stage 2: Confirm a pending operation with a matching token.
   * Validates the token exists, hasn't expired, and params haven't changed.
   * Then executes the CLI with --confirmation-token.
   */
  async confirmOperation(
    token: string,
    currentParams: Record<string, unknown>,
    runner: AgentlyCliRunner,
    instanceId: string,
    requestId: string,
    options?: AgentlyCliRunnerOptions,
  ): Promise<ConnectorResponse> {
    const pending = this.pendingConfirmations.get(token)

    if (!pending) {
      return {
        status: 'failed',
        requestId,
        connectorInstanceId: instanceId,
        error: {
          code: 'INVALID_CONFIRMATION_TOKEN',
          message: 'Confirmation token not found. It may have been cancelled or never existed.',
          recoverable: false,
        },
      }
    }

    // Expired?
    if (Date.now() > pending.expiresAt) {
      this.pendingConfirmations.delete(token)
      return {
        status: 'failed',
        requestId,
        connectorInstanceId: instanceId,
        error: {
          code: 'CONFIRMATION_TOKEN_EXPIRED',
          message: 'Confirmation token has expired. Please retry the operation.',
          recoverable: true,
        },
      }
    }

    // Params changed?
    const currentHash = hashParams(currentParams)
    if (currentHash !== pending.paramsHash) {
      this.pendingConfirmations.delete(token)
      return {
        status: 'failed',
        requestId,
        connectorInstanceId: instanceId,
        error: {
          code: 'CONFIRMATION_PARAMS_CHANGED',
          message: 'Operation parameters changed between confirmation stages. Please retry.',
          recoverable: true,
        },
      }
    }

    // Execute with confirmation token
    const argv = buildArgv(pending.operation, pending.params, token as AgentlyMailConfirmationToken)
    const result = await runner.run(toCliOperation(pending.operation), argv, options)

    // Clean up pending confirmation regardless of outcome
    this.pendingConfirmations.delete(token)

    return normalizeAgentlyMailResponse(
      result.stdout,
      result.stderr,
      result.exitCode,
      requestId,
      instanceId,
    )
  }

  /**
   * Cancel a pending confirmation. Removes it from the store.
   * Returns true if the token existed, false otherwise.
   */
  cancelConfirmation(token: string): boolean {
    return this.pendingConfirmations.delete(token)
  }

  /**
   * Check if an operation requires two-stage confirmation.
   */
  isConfirmationRequired(operation: AgentlyMailOperation): boolean {
    return CONFIRMATION_OPERATIONS.has(operation)
  }

  /**
   * Purge all expired pending confirmations.
   * Returns the number of purged entries.
   */
  purgeExpired(): number {
    const now = Date.now()
    let purged = 0
    for (const [token, pending] of this.pendingConfirmations) {
      if (now > pending.expiresAt) {
        this.pendingConfirmations.delete(token)
        purged++
      }
    }
    return purged
  }

  /** Extract a human-readable summary from CLI stdout/stderr. */
  private extractSummary(stdout: string, stderr: string): string | undefined {
    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'error' in parsed &&
        typeof (parsed as Record<string, unknown>).error === 'object'
      ) {
        const err = (parsed as Record<string, unknown>).error as Record<string, unknown>
        if (typeof err.message === 'string') return err.message
      }
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'summary' in parsed &&
        typeof (parsed as Record<string, unknown>).summary === 'string'
      ) {
        return (parsed as Record<string, unknown>).summary as string
      }
    } catch {
      // Not valid JSON — fall through
    }

    if (stderr.trim().length > 0) {
      return stderr.replace(TOKEN_PATTERN, '[REDACTED]').trim()
    }

    return undefined
  }
}
