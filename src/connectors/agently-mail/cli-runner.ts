// AgentlyMail CLI runner — safe subprocess execution via execFile (no shell).
// Imports types from ./types.js. Never interpolates shell strings.

import { execFile } from 'node:child_process'
import type {
  AgentlyMailOperation,
  AgentlyMailCliEnvelope,
} from './types.js'

// ─── Public types ──────────────────────────────────────────────────────────────

export interface AgentlyCliRunnerOptions {
  /** Path to agently-cli binary. Defaults to 'agently-cli' (on PATH). */
  readonly cliPath?: string
  /** Timeout in ms. Defaults to 30 000. */
  readonly timeoutMs?: number
  /** Working directory for the subprocess. */
  readonly cwd?: string
  /** Complete env map for the subprocess. If omitted, inherits process.env. */
  readonly env?: Readonly<Record<string, string>>
  /** Cancellation signal. Rejects with AbortError when fired. */
  readonly abortSignal?: AbortSignal
}

export interface AgentlyCliRunResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly envelope: AgentlyMailCliEnvelope | null
}

// Injectable execFile signature — compatible with node:child_process.execFile
type ExecFileError = {
  code?: string | number
  killed?: boolean
  signal?: string
  message: string
}

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: Record<string, unknown>,
  callback: (error: ExecFileError | null, stdout: string, stderr: string) => void,
) => { kill: (signal?: string) => boolean }

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CLI_PATH = 'agently-cli'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_BUFFER_BYTES = 10 * 1024 * 1024 // 10 MiB

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Patterns for tokens, cookies, API keys in diagnostic text. */
const SENSITIVE_RE: readonly RegExp[] = [
  /(?:token|cookie|secret|password|auth|bearer)[=:]\s*\S+/gi,
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, // JWT
  /(?:sk|ak|ctk)_[A-Za-z0-9_-]{10,}/g, // prefixed keys
]

function redactSensitive(text: string): string {
  let result = text
  for (const re of SENSITIVE_RE) {
    // Reset lastIndex for global regexes
    re.lastIndex = 0
    result = result.replace(re, '[REDACTED]')
  }
  return result
}

function parseEnvelope(stdout: string): AgentlyMailCliEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      ('data' in (parsed as Record<string, unknown>) || 'error' in (parsed as Record<string, unknown>))
    ) {
      return parsed as AgentlyMailCliEnvelope
    }
    return null
  } catch {
    return null
  }
}

// ─── AgentlyCliRunner ──────────────────────────────────────────────────────────

export class AgentlyCliRunner {
  private readonly execFileFn: ExecFileFn

  constructor(execFileFn?: ExecFileFn) {
    this.execFileFn = (execFileFn ?? execFile) as unknown as ExecFileFn
  }

  async run(
    operation: AgentlyMailOperation,
    argv: readonly string[],
    options?: AgentlyCliRunnerOptions,
  ): Promise<AgentlyCliRunResult> {
    const cliPath = options?.cliPath ?? DEFAULT_CLI_PATH
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    void operation
    const args = [...argv]
    const signal = options?.abortSignal

    return new Promise<AgentlyCliRunResult>((resolve, reject) => {
      // Fast path: already aborted
      if (signal?.aborted) {
        reject(createAbortError())
        return
      }

      let abortedByUser = false
      // Declare before execFileFn so the callback closure can reference it
      // even when the mock fires synchronously.
      let abortHandler: (() => void) | undefined

      const env = options?.env ?? process.env

      const child = this.execFileFn(
        cliPath,
        args,
        {
          timeout: timeoutMs,
          cwd: options?.cwd,
          env,
          shell: false,
          maxBuffer: MAX_BUFFER_BYTES,
          encoding: 'utf-8',
        },
        (error, stdout, stderr) => {
          // Clean up abort listener
          if (abortHandler !== undefined) {
            signal?.removeEventListener('abort', abortHandler)
          }

          const safeStderr = redactSensitive(stderr ?? '')

          // Abort wins over any other outcome
          if (abortedByUser || signal?.aborted) {
            reject(createAbortError())
            return
          }

          if (error !== null) {
            // Numeric code = child exited with that code
            if (typeof error.code === 'number') {
              resolve({
                stdout: stdout ?? '',
                stderr: safeStderr,
                exitCode: error.code,
                envelope: parseEnvelope(stdout ?? ''),
              })
              return
            }

            // String code (e.g. maxBuffer exceeded) or signal kill
            resolve({
              stdout: stdout ?? '',
              stderr: safeStderr,
              exitCode: 1,
              envelope: parseEnvelope(stdout ?? ''),
            })
            return
          }

          resolve({
            stdout: stdout ?? '',
            stderr: safeStderr,
            exitCode: 0,
            envelope: parseEnvelope(stdout ?? ''),
          })
        },
      )

      // Wire up abort → kill
      if (signal !== undefined) {
        abortHandler = () => {
          abortedByUser = true
          child.kill('SIGTERM')
        }
        signal.addEventListener('abort', abortHandler, { once: true })
      }
    })
  }
}

function createAbortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError')
}
