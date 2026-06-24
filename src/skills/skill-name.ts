/**
 * Skill ID validation and sanitization utilities.
 *
 * Parallel to tool-name.ts but named for skill identifiers.
 * Skill IDs must match [A-Za-z0-9_-]{1,64} — the same rule as tool names.
 * This keeps skill IDs safe for use in prompt text, API paths, and
 * permission allowlists without escaping.
 */

const SKILL_ID_MAX_LENGTH = 64
const SKILL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Returns true if `id` conforms to the legal [A-Za-z0-9_-]{1,64} rule.
 */
export function isValidSkillId(id: string): boolean {
  return SKILL_ID_PATTERN.test(id)
}

/**
 * Sanitizes an arbitrary string into a legal skill ID:
 * 1. Replaces every run of illegal characters with a single `_`.
 * 2. Collapses consecutive underscores.
 * 3. Strips leading / trailing underscores.
 * 4. Truncates to {@link SKILL_ID_MAX_LENGTH}.
 * 5. Falls back to `"skill"` if the result is empty.
 *
 * This is intentionally lossy — callers MUST store enough metadata
 * to route back to the original skill if needed.
 */
export function sanitizeSkillId(id: string): string {
  const sanitized = id
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, SKILL_ID_MAX_LENGTH)

  return sanitized || 'skill'
}