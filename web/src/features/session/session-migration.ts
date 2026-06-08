/**
 * Session Migration Guard Helpers
 *
 * Provides URL/localStorage precedence for session ID resolution with safe handling
 * of malformed localStorage values.
 *
 * Precedence Rules:
 * 1. Valid URL session ID wins over localStorage
 * 2. localStorage is fallback when URL has no session ID
 * 3. Malformed localStorage values are ignored safely (no crash)
 *
 * Preserved Keys:
 * - session-console-selected-session
 * - event-counter
 * - opencode-prefs
 */

/**
 * Validates if a value is a valid session ID format.
 * Session IDs follow either pattern:
 * - ses_<alphanumeric> (legacy/test format)
 * - session-<timestamp>-<random> (backend-generated format)
 *
 * @param value - The value to validate
 * @returns true if the value is a valid session ID, false otherwise
 */
export function isValidSessionId(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  // Session IDs must be non-empty strings
  if (value.trim() === '') {
    return false
  }

  // Accept both formats:
  // 1. ses_<alphanumeric> (legacy/test format)
  // 2. session-<timestamp>-<random> (backend-generated format)
  const sessionIdPattern = /^(ses_[a-zA-Z0-9_-]+|session-[a-zA-Z0-9_-]+)$/
  return sessionIdPattern.test(value)
}

/**
 * Safely reads a value from localStorage with malformed value protection.
 * Returns null if the key doesn't exist, is empty, or if localStorage is unavailable.
 *
 * @param key - The localStorage key to read
 * @returns The value if valid, null otherwise
 */
export function safeReadLocalStorage(key: string): string | null {
  try {
    const value = localStorage.getItem(key)

    // Return null for missing keys
    if (value === null) {
      return null
    }

    // Return null for empty strings (malformed)
    if (value.trim() === '') {
      return null
    }

    return value
  } catch (error) {
    // localStorage may be unavailable in some environments (e.g., SSR, private mode)
    console.warn(`Failed to read localStorage key "${key}":`, error)
    return null
  }
}

/**
 * Resolves the session ID based on URL/localStorage precedence rules.
 *
 * Precedence:
 * 1. Valid URL session ID wins over localStorage
 * 2. localStorage is fallback when URL has no session ID
 * 3. Malformed values are ignored safely
 *
 * @param urlSessionId - Session ID from URL parameters (may be null or invalid)
 * @param localStorageValue - Session ID from localStorage (may be null or malformed)
 * @returns The resolved session ID, or null if neither source provides a valid ID
 */
export function resolveSessionId(
  urlSessionId: string | null,
  localStorageValue: string | null,
): string | null {
  // Rule 1: Valid URL session ID wins
  if (isValidSessionId(urlSessionId)) {
    return urlSessionId
  }

  // Rule 2: localStorage is fallback when URL has no valid session ID
  if (isValidSessionId(localStorageValue)) {
    return localStorageValue
  }

  // Rule 3: Neither source provides a valid session ID
  return null
}

/**
 * Gets the session ID from URL search parameters.
 *
 * @param searchParams - URL search params object
 * @returns The session ID from URL if present and valid, null otherwise
 */
export function getSessionIdFromUrl(searchParams: URLSearchParams): string | null {
  const sessionId = searchParams.get('session')
  return isValidSessionId(sessionId) ? sessionId : null
}

/**
 * Preserved localStorage keys that should never be deleted during migration.
 */
export const PRESERVED_LOCAL_STORAGE_KEYS = [
  'session-console-selected-session',
  'event-counter',
  'opencode-prefs',
] as const

/**
 * Type for preserved localStorage keys.
 */
export type PreservedLocalStorageKey = (typeof PRESERVED_LOCAL_STORAGE_KEYS)[number]

/**
 * Checks if a localStorage key is preserved and should not be deleted.
 *
 * @param key - The localStorage key to check
 * @returns true if the key is preserved, false otherwise
 */
export function isPreservedKey(key: string): key is PreservedLocalStorageKey {
  return PRESERVED_LOCAL_STORAGE_KEYS.includes(key as PreservedLocalStorageKey)
}
