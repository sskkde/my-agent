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
 * Used to verify message delivery and assistant response.
 */
export const POST_SEND_POLL_MAX_ATTEMPTS = 30

/**
 * Interval (in milliseconds) between post-send polling attempts.
 */
export const POST_SEND_POLL_INTERVAL_MS = 1000

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
