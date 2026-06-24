/**
 * Compact Response Parser - Parses and validates LLM compaction responses.
 *
 * Accepts raw LLM response text and validates it against the CompactSummaryResult
 * schema. Returns a discriminated union: success with typed data or failure with
 * a descriptive error message.
 *
 * Parse-don't-validate: boundary parsing produces typed values; interior code
 * never re-validates.
 *
 * @module kernel/compaction/compact-response-parser
 */

const MAX_ARRAY_LENGTH = 20

/** Typed result of a successful compact response parse. */
export interface CompactSummaryResult {
  readonly summary: string
  readonly keyFacts: readonly string[]
  readonly decisions: readonly string[]
  readonly openQuestions: readonly string[]
  readonly risks?: readonly string[]
}

/** Discriminated union for parse outcome. */
export type CompactParseResult =
  | { readonly ok: true; readonly data: CompactSummaryResult }
  | { readonly ok: false; readonly error: string }

export function parseCompactResponse(raw: string): CompactParseResult {
  if (raw.trim().length === 0) {
    return { ok: false, error: 'Empty response: expected JSON' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Invalid JSON: response is not valid JSON' }
  }

  if (!isObject(parsed)) {
    return { ok: false, error: 'Invalid JSON: expected an object' }
  }

  const obj = parsed as Record<string, unknown>

  if (typeof obj.summary !== 'string' || obj.summary.length === 0) {
    return { ok: false, error: 'Invalid compact response: missing or empty summary' }
  }

  const keyFacts = parseStringArray(obj.keyFacts)
  if (keyFacts === undefined) {
    return { ok: false, error: arrayValidationError(obj.keyFacts, 'keyFacts') }
  }

  const decisions = parseStringArray(obj.decisions)
  if (decisions === undefined) {
    return { ok: false, error: arrayValidationError(obj.decisions, 'decisions') }
  }

  const openQuestions = parseStringArray(obj.openQuestions)
  if (openQuestions === undefined) {
    return { ok: false, error: arrayValidationError(obj.openQuestions, 'openQuestions') }
  }

  let risks: readonly string[] | undefined
  if (obj.risks !== undefined) {
    risks = parseStringArray(obj.risks)
    if (risks === undefined) {
      return { ok: false, error: arrayValidationError(obj.risks, 'risks') }
    }
  }

  return {
    ok: true,
    data: { summary: obj.summary, keyFacts, decisions, openQuestions, risks },
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function parseStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.length > MAX_ARRAY_LENGTH) return undefined
  for (const item of value) {
    if (typeof item !== 'string') return undefined
  }
  return Object.freeze([...value]) as readonly string[]
}

function arrayValidationError(value: unknown, fieldName: string): string {
  if (!Array.isArray(value)) {
    return `Invalid compact response: ${fieldName} must be an array`
  }
  if (value.length > MAX_ARRAY_LENGTH) {
    return `Invalid compact response: ${fieldName} exceeds max length of ${MAX_ARRAY_LENGTH}`
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      return `Invalid compact response: ${fieldName}[${i}] must be a string`
    }
  }
  return `Invalid compact response: ${fieldName} validation failed`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
