/**
 * Exec Tool and Bash Tool
 *
 * Execute shell commands with security validation, timeout, and output management.
 * Supports both foreground (with yield) and background execution modes.
 */

import type { ToolDefinition, ToolHandler, ToolExecutionResult, ToolExecutionContext } from '../types.js'
import type { ProcessSessionStore } from './process-session-store.js'
import { validateExecParams } from './command-safety.js'

export interface ExecParams {
  command: string
  workdir?: string
  env?: Record<string, string>
  timeoutMs?: number
  yieldMs?: number
  background?: boolean
  maxOutputChars?: number
}

export interface ExecResult {
  status: 'completed' | 'running' | 'timeout' | 'failed' | 'killed'
  sessionId?: string
  exitCode?: number | null
  signal?: string | null
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  durationMs: number
  timedOut: boolean
}

export function createExecTool(store: ProcessSessionStore): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as ExecParams
    const startTime = Date.now()

    const validation = validateExecParams({
      command: typedParams.command,
      timeoutMs: typedParams.timeoutMs,
      yieldMs: typedParams.yieldMs,
      maxOutputChars: typedParams.maxOutputChars,
      workdir: typedParams.workdir,
      env: typedParams.env,
      workspaceRoot: _context.workDirRoot,
    })

    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: validation.error!.code,
          message: validation.error!.message,
          recoverable: false,
        },
      }
    }

    const normalized = validation.normalized!

    if (typedParams.background) {
      const sessionId = store.start({
        userId: _context.userId,
        command: normalized.command,
        workdir: normalized.workdir,
        env: normalized.env,
        timeoutMs: normalized.timeoutMs,
        maxOutputChars: normalized.maxOutputChars,
        workDirId: _context.workDirId,
      })

      const result: ExecResult = {
        status: 'running',
        sessionId: sessionId,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 0,
        timedOut: false,
      }

      return {
        success: true,
        data: result,
        resultPreview: `Started background process: ${sessionId}`,
        structuredContent: result as unknown as Record<string, unknown>,
      }
    }

    const sessionId = store.start({
      userId: _context.userId,
      command: normalized.command,
      workdir: normalized.workdir,
      env: normalized.env,
      timeoutMs: normalized.timeoutMs,
      maxOutputChars: normalized.maxOutputChars,
      workDirId: _context.workDirId,
    })

    const yieldMs = normalized.yieldMs
    const startTimeMs = Date.now()

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const session = store.get(_context.userId, sessionId)
        if (!session) {
          clearInterval(checkInterval)
          resolve({
            success: false,
            error: {
              code: 'SESSION_NOT_FOUND',
              message: 'Process session disappeared',
              recoverable: false,
            },
          })
          return
        }

        const elapsed = Date.now() - startTimeMs

        if (session.status !== 'running') {
          clearInterval(checkInterval)
          const durationMs = Date.now() - startTime

          const result: ExecResult = {
            status:
              session.status === 'timeout'
                ? 'timeout'
                : session.status === 'killed'
                  ? 'killed'
                  : session.status === 'failed'
                    ? 'failed'
                    : 'completed',
            exitCode: session.exitCode,
            signal: session.signal,
            stdout: session.output,
            stderr: '',
            stdoutTruncated: session.outputTruncated,
            stderrTruncated: false,
            durationMs,
            timedOut: session.status === 'timeout',
          }

          store.clear(_context.userId, sessionId)

          resolve({
            success: session.status === 'completed' || session.status === 'failed',
            data: result,
            resultPreview: `Process ${session.status}: exit code ${session.exitCode}, ${durationMs}ms`,
            structuredContent: result as unknown as Record<string, unknown>,
          })
          return
        }

        if (elapsed >= yieldMs) {
          clearInterval(checkInterval)
          const result: ExecResult = {
            status: 'running',
            sessionId: sessionId,
            stdout: session.output,
            stderr: '',
            stdoutTruncated: session.outputTruncated,
            stderrTruncated: false,
            durationMs: elapsed,
            timedOut: false,
          }

          resolve({
            success: true,
            data: result,
            resultPreview: `Process still running after ${elapsed}ms, sessionId: ${sessionId}`,
            structuredContent: result as unknown as Record<string, unknown>,
          })
        }
      }, 50)
    })
  }

  return {
    name: 'exec',
    description:
      'Execute a shell command with security validation, timeout, and output management. Use background:true for async execution, then poll with process tool.',
    category: 'execute',
    sensitivity: 'high',
    requiresPermission: true,
    idempotent: false,
    schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute',
        },
        workdir: {
          type: 'string',
          description: 'Working directory (must be within workspace, default: workspace root)',
        },
        env: {
          type: 'object',
          description: 'Environment variables (all values must be strings)',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000, max: 600000)',
        },
        yieldMs: {
          type: 'number',
          description: 'Yield time before returning running status (default: 10000)',
        },
        background: {
          type: 'boolean',
          description: 'Execute in background and return immediately (default: false)',
        },
        maxOutputChars: {
          type: 'number',
          description: 'Maximum output characters per stream (default: 64000)',
        },
      },
      required: ['command'],
    },
    handler,
  }
}

export function createBashTool(store: ProcessSessionStore): ToolDefinition {
  const execTool = createExecTool(store)

  return {
    ...execTool,
    name: 'bash',
    description:
      'Execute a bash command (alias for exec tool). Supports background execution, timeout, and output truncation.',
  }
}
