/**
 * Process Tool
 *
 * Manage background process sessions: list, poll, kill, clear.
 */

import type { ToolDefinition, ToolHandler, ToolExecutionResult, ToolExecutionContext } from '../types.js'
import type { ProcessSessionStore } from './process-session-store.js'

export type ProcessAction = 'list' | 'poll' | 'kill' | 'clear'

export interface ProcessParams {
  action: ProcessAction
  sessionId?: string
  signal?: string
}

export interface ProcessResult {
  action: ProcessAction
  sessions?: Array<{
    id: string
    command: string
    status: string
    startedAt: string
    endedAt?: string
    exitCode?: number | null
  }>
  session?: {
    id: string
    command: string
    status: string
    startedAt: string
    endedAt?: string
    exitCode?: number | null
    output: string
    outputTruncated: boolean
  }
  killed?: boolean
  cleared?: boolean
}

export function createProcessTool(store: ProcessSessionStore): ToolDefinition {
  const handler: ToolHandler = async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const typedParams = params as ProcessParams
    const { action } = typedParams

    switch (action) {
      case 'list': {
        const sessions = store.list(context.userId)
        const result: ProcessResult = {
          action: 'list',
          sessions: sessions.map((s) => ({
            id: s.id,
            command: s.command,
            status: s.status,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            exitCode: s.exitCode,
          })),
        }
        return {
          success: true,
          data: result,
          resultPreview: `${sessions.length} session(s) for user ${context.userId}`,
          structuredContent: result as unknown as Record<string, unknown>,
        }
      }

      case 'poll': {
        if (!typedParams.sessionId) {
          return {
            success: false,
            error: {
              code: 'MISSING_SESSION_ID',
              message: 'sessionId is required for poll action',
              recoverable: true,
            },
          }
        }

        const session = store.get(context.userId, typedParams.sessionId)
        if (!session) {
          return {
            success: false,
            error: {
              code: 'SESSION_NOT_FOUND',
              message: `Session ${typedParams.sessionId} not found`,
              recoverable: true,
            },
          }
        }

        const result: ProcessResult = {
          action: 'poll',
          session: {
            id: session.id,
            command: session.command,
            status: session.status,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            exitCode: session.exitCode,
            output: session.output,
            outputTruncated: session.outputTruncated,
          },
        }
        return {
          success: true,
          data: result,
          resultPreview: `Session ${session.id}: ${session.status}`,
          structuredContent: result as unknown as Record<string, unknown>,
        }
      }

      case 'kill': {
        if (!typedParams.sessionId) {
          return {
            success: false,
            error: {
              code: 'MISSING_SESSION_ID',
              message: 'sessionId is required for kill action',
              recoverable: true,
            },
          }
        }

        const killed = store.kill(context.userId, typedParams.sessionId, typedParams.signal)

        if (!killed) {
          return {
            success: false,
            error: {
              code: 'KILL_FAILED',
              message: 'Failed to kill session (not running or not found)',
              recoverable: false,
            },
          }
        }

        const result: ProcessResult = {
          action: 'kill',
          killed: true,
        }
        return {
          success: true,
          data: result,
          resultPreview: `Killed session ${typedParams.sessionId}`,
          structuredContent: result as unknown as Record<string, unknown>,
        }
      }

      case 'clear': {
        if (!typedParams.sessionId) {
          return {
            success: false,
            error: {
              code: 'MISSING_SESSION_ID',
              message: 'sessionId is required for clear action',
              recoverable: true,
            },
          }
        }

        const cleared = store.clear(context.userId, typedParams.sessionId)

        if (!cleared) {
          return {
            success: false,
            error: {
              code: 'CLEAR_FAILED',
              message: 'Failed to clear session (still running or not found)',
              recoverable: false,
            },
          }
        }

        const result: ProcessResult = {
          action: 'clear',
          cleared: true,
        }
        return {
          success: true,
          data: result,
          resultPreview: `Cleared session ${typedParams.sessionId}`,
          structuredContent: result as unknown as Record<string, unknown>,
        }
      }

      default:
        return {
          success: false,
          error: {
            code: 'INVALID_ACTION',
            message: `Invalid action: ${action}`,
            recoverable: true,
          },
        }
    }
  }

  return {
    name: 'process',
    description: 'Manage background process sessions: list, poll status, kill, or clear completed sessions.',
    category: 'execute',
    sensitivity: 'high',
    requiresPermission: true,
    idempotent: false,
    schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'poll', 'kill', 'clear'],
          description: 'Action to perform on process sessions',
        },
        sessionId: {
          type: 'string',
          description: 'Session ID (required for all actions except list)',
        },
        signal: {
          type: 'string',
          description: 'Signal to send (for kill action, default: SIGTERM)',
        },
      },
      required: ['action'],
    },
    handler,
  }
}
