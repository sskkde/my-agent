/**
 * Session Console Constants
 *
 * Centralized constants for session console behavior including:
 * - localStorage keys for persistence
 * - SSE reconnection timing parameters
 * - Post-send polling configuration
 * - Event ID prefixes
 */

// ============================================================================
// LocalStorage Keys
// ============================================================================

/**
 * LocalStorage key for persisting the currently selected session ID.
 * Used to restore the last viewed session on page reload.
 */
export const SELECTED_SESSION_KEY = 'session-console-selected-session'

/**
 * Prefix for local user message event IDs.
 * These are client-generated events that haven't been confirmed by the server yet.
 */
export const LOCAL_USER_MESSAGE_PREFIX = 'local-user-message'

// ============================================================================
// SSE Reconnection Configuration
// ============================================================================

/**
 * Base delay (in milliseconds) for SSE reconnection attempts.
 * Uses exponential backoff: delay = BASE_DELAY * 2^attempts
 */
export const SSE_RECONNECT_BASE_DELAY_MS = 1000

/**
 * Maximum delay (in milliseconds) for SSE reconnection attempts.
 * Caps the exponential backoff to prevent excessively long waits.
 */
export const SSE_RECONNECT_MAX_DELAY_MS = 30000

// ============================================================================
// Post-Send Polling Configuration
// ============================================================================

/**
 * Maximum number of polling attempts after sending a message.
 * Prefer SSE for live updates; polling is a fallback only.
 * With SSE connected, fewer/slower polls are used (see POST_SEND_POLL_*_SSE).
 */
export const POST_SEND_POLL_MAX_ATTEMPTS = 12

/**
 * Interval (in milliseconds) between post-send polling attempts when SSE is
 * disconnected / unavailable (fallback path).
 */
export const POST_SEND_POLL_INTERVAL_MS = 2500

/**
 * First poll delay when SSE is connected — give the stream time to deliver
 * the user message / assistant events before hitting REST.
 */
export const POST_SEND_POLL_INITIAL_DELAY_SSE_MS = 4000

/**
 * Interval between fallback polls while SSE remains connected.
 * Much slower than the disconnected path to avoid double-fetch with SSE.
 */
export const POST_SEND_POLL_INTERVAL_SSE_MS = 8000

/**
 * Max poll attempts while SSE is connected (safety net only).
 */
export const POST_SEND_POLL_MAX_ATTEMPTS_SSE = 4

// ============================================================================
// Date Formatting Constants
// ============================================================================

/**
 * Locale used for date formatting in the session console.
 */
export const DATE_FORMAT_LOCALE = 'zh-CN'

/**
 * Date formatting options for session timestamps.
 */
export const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}
