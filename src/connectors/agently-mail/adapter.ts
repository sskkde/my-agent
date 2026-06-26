/**
 * AgentlyMail Connector Adapter
 *
 * Implements the ConnectorAdapter interface for the agently-cli mail tool.
 * Converts validated operation params into CLI argv arrays, runs them
 * through AgentlyCliRunner, and normalises responses.
 */

import type { ConnectorAdapter, ConnectorCapability, ConnectorCallRequest, ConnectorResponse } from '../types.js'
import type { ConnectorInstance } from '../types.js'
import type { AgentlyCliRunner } from './cli-runner.js'
import type {
  AgentlyMailOperation,
  ListMessagesInput,
  ReadMessageInput,
  SearchMessagesInput,
} from './types.js'
import { normalizeAgentlyMailResponse } from './response-normalizer.js'
import { AGENTLY_MAIL_CAPABILITIES } from './capability-definitions.js'
import { AgentlyMailConfirmationManager } from './confirmation.js'
import { buildDownloadAttachmentArgv } from './download-argv.js'

// ─── Validation helpers ────────────────────────────────────────────────────────

/** Message IDs must start with `msg_`. */
const MESSAGE_ID_RE = /^msg_/

interface ValidationError {
  readonly code: 'INVALID_PARAMETERS' | 'REQUIRES_CONFIRMATION'
  readonly message: string
}

function validateMessageId(id: unknown): ValidationError | undefined {
  if (typeof id !== 'string' || !MESSAGE_ID_RE.test(id)) {
    return {
      code: 'INVALID_PARAMETERS',
      message: `Invalid message ID: expected string starting with "msg_", received ${JSON.stringify(id)}`,
    }
  }
  return undefined
}

// ─── Argv builders ─────────────────────────────────────────────────────────────

function buildListArgv(params: Record<string, unknown>): readonly string[] {
  const p = params as unknown as ListMessagesInput
  const argv: string[] = ['message', '+list']

  if (p.dir !== undefined) {
    argv.push('--dir', p.dir)
  }
  if (p.limit !== undefined) {
    argv.push('--limit', String(p.limit))
  }
  if (p.cursor !== undefined) {
    argv.push('--cursor', p.cursor)
  }
  if (p.after !== undefined) {
    argv.push('--after', p.after)
  }
  if (p.before !== undefined) {
    argv.push('--before', p.before)
  }
  if (p.hasAttachments === true) {
    argv.push('--has-attachments')
  }
  if (p.isUnread === true) {
    argv.push('--is-unread')
  }

  return argv
}

function buildReadArgv(params: Record<string, unknown>): readonly string[] {
  const p = params as unknown as ReadMessageInput
  return ['message', '+read', '--id', p.id]
}

function buildSearchArgv(params: Record<string, unknown>): readonly string[] {
  const p = params as unknown as SearchMessagesInput
  const argv: string[] = ['message', '+search', '--q', p.q]

  if (p.searchIn !== undefined) {
    argv.push('--search-in', p.searchIn)
  }
  if (p.from !== undefined) {
    argv.push('--from', p.from)
  }
  if (p.to !== undefined) {
    argv.push('--to', p.to)
  }
  if (p.dir !== undefined) {
    argv.push('--dir', p.dir)
  }
  if (p.after !== undefined) {
    argv.push('--after', p.after)
  }
  if (p.before !== undefined) {
    argv.push('--before', p.before)
  }
  if (p.hasAttachments === true) {
    argv.push('--has-attachments')
  }
  if (p.isUnread === true) {
    argv.push('--is-unread')
  }
  if (p.limit !== undefined) {
    argv.push('--limit', String(p.limit))
  }
  if (p.cursor !== undefined) {
    argv.push('--cursor', p.cursor)
  }

  return argv
}

// ─── Operation → argv + validation ─────────────────────────────────────────────

interface ArgvResult {
  readonly operation: AgentlyMailOperation
  readonly argv: readonly string[]
  readonly validationError?: ValidationError
}

function buildArgvForOperation(
  operation: string,
  params: Record<string, unknown>,
): ArgvResult {
  switch (operation) {
    case 'me':
      return { operation: 'me', argv: ['+me'] }

    case 'auth_status':
      return { operation: 'auth_status', argv: ['+status'] }

    case 'list_messages':
      return { operation: 'list_messages', argv: buildListArgv(params) }

    case 'read_message': {
      const err = validateMessageId((params as unknown as ReadMessageInput).id)
      if (err) return { operation: 'read_message', argv: [], validationError: err }
      return { operation: 'read_message', argv: buildReadArgv(params) }
    }

    case 'search_messages':
      return { operation: 'search_messages', argv: buildSearchArgv(params) }

    case 'download_attachment': {
      const result = buildDownloadAttachmentArgv(params)
      if (!result.ok) {
        return {
          operation: 'download_attachment',
          argv: [],
          validationError: { code: 'INVALID_PARAMETERS', message: result.message },
        }
      }
      return { operation: 'download_attachment', argv: result.argv }
    }

    case 'send_message':
    case 'reply_message':
    case 'forward_message':
    case 'trash_message':
      return { operation: operation as AgentlyMailOperation, argv: [] }

    default:
      return {
        operation: operation as AgentlyMailOperation,
        argv: [],
        validationError: {
          code: 'INVALID_PARAMETERS',
          message: `Unknown operation: ${operation}`,
        },
      }
  }
}

function getConfirmationToken(params: Record<string, unknown>): string | undefined {
  const token = params.confirmationToken
  return typeof token === 'string' && token.length > 0 ? token : undefined
}

function stripConfirmationToken(params: Record<string, unknown>): Record<string, unknown> {
  const { confirmationToken: _confirmationToken, ...rest } = params
  return rest
}

// ─── AgentlyMailAdapter ────────────────────────────────────────────────────────

export class AgentlyMailAdapter implements ConnectorAdapter {
  private readonly runner: AgentlyCliRunner
  private readonly confirmationManager: AgentlyMailConfirmationManager

  constructor(runner: AgentlyCliRunner, confirmationManager = new AgentlyMailConfirmationManager()) {
    this.runner = runner
    this.confirmationManager = confirmationManager
  }

  async execute(
    _instance: ConnectorInstance,
    request: ConnectorCallRequest,
  ): Promise<unknown> {
    const { operation, params, requestId, connectorInstanceId } = request

    // 1. Build argv (includes validation)
    const argvResult = buildArgvForOperation(operation, params as Record<string, unknown>)

    // 2. Validation failure → return normalised error without calling runner
    if (argvResult.validationError !== undefined) {
      const err = argvResult.validationError
      if (err.code === 'REQUIRES_CONFIRMATION') {
        return {
          status: 'failed',
          requestId,
          connectorInstanceId,
          error: {
            code: 'REQUIRES_CONFIRMATION',
            message: err.message,
            recoverable: false,
          },
        } satisfies ConnectorResponse
      }
      return {
        status: 'failed',
        requestId,
        connectorInstanceId,
        error: {
          code: err.code,
          message: err.message,
          recoverable: false,
        },
      } satisfies ConnectorResponse
    }

    if (this.confirmationManager.isConfirmationRequired(argvResult.operation)) {
      const confirmationToken = getConfirmationToken(params)
      const confirmedParams = stripConfirmationToken(params)
      if (confirmationToken !== undefined) {
        return this.confirmationManager.confirmOperation(
          confirmationToken,
          confirmedParams,
          this.runner,
          connectorInstanceId,
          requestId,
        )
      }

      const result = await this.confirmationManager.startConfirmation(
        argvResult.operation,
        confirmedParams,
        this.runner,
        connectorInstanceId,
        requestId,
      )
      return result.response
    }

    // 3. Run CLI
    const result = await this.runner.run(argvResult.operation, argvResult.argv)

    // 4. Normalise response
    return normalizeAgentlyMailResponse(
      result.stdout,
      result.stderr,
      result.exitCode,
      requestId,
      connectorInstanceId,
    )
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return [...AGENTLY_MAIL_CAPABILITIES]
  }

  checkHealth(
    _instance: ConnectorInstance,
  ): { healthy: boolean; message?: string } {
    // Synchronous stub — real health check happens via execute('me')
    return { healthy: true, message: 'AgentlyMail adapter ready' }
  }
}
