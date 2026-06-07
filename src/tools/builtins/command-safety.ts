/**
 * Command Safety Validation
 *
 * Enforces workspace boundaries, command denylist, timeouts, and output limits
 * for command execution tools (exec, bash, code_execution).
 */

import { resolve, isAbsolute, relative } from 'path'
import { getWorkspaceRoot } from './safe-paths.js'

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_EXEC_TIMEOUT_MS = 30_000
export const MAX_EXEC_TIMEOUT_MS = 600_000
export const DEFAULT_EXEC_YIELD_MS = 10_000
export const MAX_EXEC_OUTPUT_CHARS = 64_000
export const DEFAULT_EXEC_OUTPUT_CHARS = 8000
export const MAX_COMMAND_LENGTH = 8_000
export const MIN_EXEC_TIMEOUT_MS = 1000
export const MIN_EXEC_YIELD_MS = 100
export const MIN_EXEC_OUTPUT_CHARS = 100

export const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+(-[a-z]*(?:rf|fr)|--recursive.*--force|--force.*--recursive)\s+\/\S*/i,
  /\bsudo\s+rm\s+(-[a-z]*(?:rf|fr)|--recursive.*--force|--force.*--recursive)\s+\/\S*/i,
  /\bmkfs\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bpoweroff\b/i,
  /:\(\)\s*\{[^}]*:\|:&[^}]*\};\s*:/,
  /\bcurl\s+.*\|\s*(sudo\s+)?(sh|bash)\b/i,
  /\bwget\s+.*\|\s*(sudo\s+)?(sh|bash)\b/i,
  /\bdd\s+.*\bof\s*=\s*\/dev\/(sd|nvme|hd)[a-z0-9]*/i,
]

export interface ValidateExecParams {
  command: string
  workdir?: string
  env?: Record<string, string>
  timeoutMs?: number
  yieldMs?: number
  maxOutputChars?: number
  workspaceRoot?: string
}

export interface ValidateExecResult {
  valid: boolean
  normalized?: {
    command: string
    workdir: string
    env: Record<string, string>
    timeoutMs: number
    yieldMs: number
    maxOutputChars: number
  }
  error?: {
    code: string
    message: string
  }
}

function isDangerousCommand(command: string): boolean {
  const trimmedCommand = command.trim()
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return true
    }
  }
  return false
}

function validateEnv(env?: Record<string, string>): { valid: boolean; error?: string } {
  if (!env) {
    return { valid: true }
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof key !== 'string') {
      return { valid: false, error: `Environment key must be a string, got ${typeof key}` }
    }
    if (typeof value !== 'string') {
      return { valid: false, error: `Environment value for '${key}' must be a string, got ${typeof value}` }
    }
  }
  return { valid: true }
}

export function validateExecParams(params: ValidateExecParams): ValidateExecResult {
  const root = params.workspaceRoot ?? getWorkspaceRoot()

  if (!params.command || typeof params.command !== 'string') {
    return {
      valid: false,
      error: {
        code: 'EMPTY_COMMAND',
        message: 'Command must be a non-empty string',
      },
    }
  }

  if (params.command.trim().length === 0) {
    return {
      valid: false,
      error: {
        code: 'EMPTY_COMMAND',
        message: 'Command must be a non-empty string',
      },
    }
  }

  if (params.command.length > MAX_COMMAND_LENGTH) {
    return {
      valid: false,
      error: {
        code: 'COMMAND_TOO_LONG',
        message: `Command exceeds maximum length of ${MAX_COMMAND_LENGTH} characters`,
      },
    }
  }

  if (isDangerousCommand(params.command)) {
    return {
      valid: false,
      error: {
        code: 'DANGEROUS_COMMAND',
        message: 'Command matches dangerous pattern and is not allowed',
      },
    }
  }

  const envValidation = validateEnv(params.env)
  if (!envValidation.valid) {
    return {
      valid: false,
      error: {
        code: 'INVALID_ENV',
        message: envValidation.error!,
      },
    }
  }

  let workdir = root
  if (params.workdir) {
    if (params.workdir.includes('..')) {
      return {
        valid: false,
        error: {
          code: 'WORKDIR_OUTSIDE_WORKSPACE',
          message: 'workdir contains ".." which may escape workspace',
        },
      }
    }

    const absoluteWorkdir = isAbsolute(params.workdir) ? params.workdir : resolve(root, params.workdir)

    const relativePath = relative(root, absoluteWorkdir)
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      return {
        valid: false,
        error: {
          code: 'WORKDIR_OUTSIDE_WORKSPACE',
          message: 'workdir resolves outside workspace root',
        },
      }
    }

    workdir = absoluteWorkdir
  }

  let timeoutMs = params.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS
  if (timeoutMs > MAX_EXEC_TIMEOUT_MS) {
    timeoutMs = MAX_EXEC_TIMEOUT_MS
  }
  if (timeoutMs < MIN_EXEC_TIMEOUT_MS) {
    timeoutMs = MIN_EXEC_TIMEOUT_MS
  }

  let yieldMs = params.yieldMs ?? DEFAULT_EXEC_YIELD_MS
  if (yieldMs > MAX_EXEC_TIMEOUT_MS) {
    yieldMs = MAX_EXEC_TIMEOUT_MS
  }
  if (yieldMs < MIN_EXEC_YIELD_MS) {
    yieldMs = MIN_EXEC_YIELD_MS
  }

  let maxOutputChars = params.maxOutputChars ?? DEFAULT_EXEC_OUTPUT_CHARS
  if (maxOutputChars > MAX_EXEC_OUTPUT_CHARS) {
    maxOutputChars = MAX_EXEC_OUTPUT_CHARS
  }
  if (maxOutputChars < MIN_EXEC_OUTPUT_CHARS) {
    maxOutputChars = MIN_EXEC_OUTPUT_CHARS
  }

  return {
    valid: true,
    normalized: {
      command: params.command,
      workdir,
      env: params.env ?? {},
      timeoutMs,
      yieldMs,
      maxOutputChars,
    },
  }
}
