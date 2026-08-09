/**
 * Background auto-continue configuration.
 *
 * Default ON: when a background task reaches a terminal state the parent
 * session is auto-continued with a synthetic notification turn. Set
 * AUTO_CONTINUE_ON_BACKGROUND_COMPLETE=false (or '0') to disable, in which
 * case the notification only surfaces on the next user message via the
 * existing collect-pending fallback.
 *
 * Read fresh on every call (no caching) so env changes between boot and
 * runtime are honoured.
 */

const ENV_KEY = 'AUTO_CONTINUE_ON_BACKGROUND_COMPLETE'

/**
 * Returns true unless the env var is explicitly set to a disabling value
 * ('false' / '0', case-insensitive, whitespace-trimmed). Absent -> true.
 */
export function getBackgroundAutoContinueEnabled(): boolean {
  const raw = process.env[ENV_KEY]
  if (raw === undefined) {
    return true
  }
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'false' || normalized === '0') {
    return false
  }
  return true
}
