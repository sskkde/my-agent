/**
 * Route Constants
 *
 * Defines URL path patterns for the application.
 * These constants are used by route mapping helpers to convert between
 * URL paths and navigation state.
 *
 * Route structure:
 * - / → redirects to /chat
 * - /chat → chat section (no specific session)
 * - /chat/:sessionId → chat section with specific session
 * - /workspace/:tabId → workspace section with specific tab
 * - /operations/:tabId → operations section with specific tab
 * - /admin/:tabId → admin section with specific tab
 */

/**
 * Route path patterns.
 * Use these for defining routes in react-router-dom.
 */
export const ROUTES = {
  /**
   * Root route - redirects to /chat
   */
  ROOT: '/',

  /**
   * Chat section routes
   */
  CHAT: '/chat',
  CHAT_SESSION: '/chat/:sessionId',

  /**
   * Workspace section routes
   */
  WORKSPACE: '/workspace/:tabId',

  /**
   * Operations section routes
   */
  OPERATIONS: '/operations/:tabId',

  /**
   * Admin section routes
   */
  ADMIN: '/admin/:tabId',
} as const

/**
 * Route parameter names.
 * Used for extracting parameters from route matches.
 */
export const ROUTE_PARAMS = {
  SESSION_ID: 'sessionId',
  TAB_ID: 'tabId',
} as const

/**
 * Build a path with parameters.
 * Replaces :param placeholders with actual values.
 *
 * @param path - Route path with :param placeholders
 * @param params - Object with parameter values
 * @returns Path with parameters filled in
 *
 * @example
 * buildPath(ROUTES.CHAT_SESSION, { sessionId: 'abc123' })
 * // Returns: '/chat/abc123'
 */
export function buildPath(path: string, params: Record<string, string>): string {
  let result = path
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, value)
  }
  return result
}
