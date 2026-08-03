/**
 * Child-task contract: terminal error shape + bounded-result policy.
 *
 * Shared, side-effect-free contract types/policies for child subagent tasks
 * (plan: opencode-like-subagent-sessions). Reused by the foreground wait path,
 * background notification path and the search child-session runner.
 *
 * Contract guarantees (locked by tests/unit/tools/child-task-contract.test.ts):
 *  - Terminal errors are exactly `{code, message, recoverable, phase?}` — never
 *    raw stacks, secret values or thrown-object dumps.
 *  - Structured results above the existing 32KiB inline threshold go by
 *    reference through `src/tools/tool-result-reference.ts`; the model-facing
 *    summary is sanitized and capped at 2,000 characters.
 */

import { getOutputSize, shouldStoreAsRef, INLINE_THRESHOLD } from '../../tools/tool-result-reference.js'
import { sanitizeErrorMessage } from '../../tools/error-sanitizer.js'

/** Max characters for a model-facing child-task result summary. */
export const CHILD_TASK_MODEL_SUMMARY_MAX_CHARS = 2000

/**
 * Structured child-task results at/above this serialized size are persisted by
 * reference via the existing tool-result-reference path instead of inlining.
 */
export const CHILD_TASK_RESULT_REF_THRESHOLD_BYTES = INLINE_THRESHOLD

/** Lifecycle phase of a child task, used to orient terminal failures. */
export type ChildTaskPhase = 'launch' | 'run' | 'wait' | 'notify' | 'resume' | 'cancel'

/**
 * Terminal error envelope for child tasks.
 * This is the ONLY error shape that may reach the parent model or user-visible
 * output. It intentionally carries no stack, no raw error object and no secret
 * payload — `toChildTaskTerminalError` guarantees that.
 */
export interface ChildTaskTerminalError {
  /** Stable machine-readable error code (e.g. 'CHILD_TASK_TIMEOUT'). */
  code: string
  /** Sanitized, bounded human-readable message. */
  message: string
  /** Whether the parent may retry the child task. */
  recoverable: boolean
  /** Optional phase during which the task failed. */
  phase?: ChildTaskPhase
}

/** Default terminal error code when none is provided. */
export const CHILD_TASK_ERROR_CODE = 'CHILD_TASK_ERROR'

/**
 * Converts an unknown thrown value into the safe terminal error envelope.
 *
 * Never includes the stack trace, never serializes arbitrary thrown objects,
 * and runs the message through the shared secret-redaction sanitizer so
 * API-key/token-shaped values never reach the parent model or user output.
 *
 * @param error - Any thrown value (Error, string, object, ...).
 * @param options - Optional stable code / recoverability / phase overrides.
 * @returns A `ChildTaskTerminalError` safe for model/user-visible output.
 */
export function toChildTaskTerminalError(
  error: unknown,
  options: { code?: string; recoverable?: boolean; phase?: ChildTaskPhase } = {},
): ChildTaskTerminalError {
  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Child task failed'

  const terminal: ChildTaskTerminalError = {
    code: options.code ?? CHILD_TASK_ERROR_CODE,
    message: sanitizeErrorMessage(rawMessage),
    recoverable: options.recoverable ?? false,
  }

  if (options.phase !== undefined) {
    terminal.phase = options.phase
  }

  return terminal
}

/**
 * Sanitizes a model-facing child-task summary.
 *
 * Redacts secret-shaped values (via the shared error sanitizer), strips ANSI
 * escape / control sequences that could corrupt model input rendering, and
 * bounds the length to `maxChars` (default 2,000) with an ellipsis.
 *
 * @param text - Raw summary text (may contain secrets/control sequences).
 * @param maxChars - Maximum summary length (default CHILD_TASK_MODEL_SUMMARY_MAX_CHARS).
 * @returns A sanitized, length-bounded summary safe for model input.
 */
export function sanitizeChildTaskSummary(text: string, maxChars: number = CHILD_TASK_MODEL_SUMMARY_MAX_CHARS): string {
  // Strip ANSI escape sequences and other control characters.
  // eslint-disable-next-line no-control-regex
  const noControl = typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]/g, '') : ''
  const sanitized = sanitizeErrorMessage(noControl)
  if (sanitized.length <= maxChars) {
    return sanitized
  }
  return `${sanitized.slice(0, maxChars - 3)}...`
}

/** Result of applying the bounded-result policy to a child-task output. */
export interface BoundedChildTaskResult {
  /** 'ref' when the structured result must persist by reference (>= 32KiB). */
  mode: 'inline' | 'ref'
  /** Serialized JSON size in bytes. */
  sizeBytes: number
  /** Sanitized model-facing summary, capped at 2,000 characters. */
  summary: string
}

/**
 * Bounded-result policy for child-task terminal outputs.
 *
 * Pure decision function (no side effects): structured results at/above the
 * existing 32KiB tool-result-reference threshold must be persisted by
 * reference — the caller persists them via `processToolOutput` from
 * `src/tools/tool-result-reference.ts` and exposes only `summary` to the
 * parent model. Smaller results stay inline.
 *
 * @param output - The structured child-task result.
 * @returns The policy decision: mode, serialized size and safe summary.
 */
export function applyBoundedResultPolicy(output: unknown): BoundedChildTaskResult {
  const sizeBytes = getOutputSize(output)
  const mode = shouldStoreAsRef(output) ? 'ref' : 'inline'
  return {
    mode,
    sizeBytes,
    summary: sanitizeChildTaskSummary(sizeBytes > 0 ? JSON.stringify(output) : ''),
  }
}
