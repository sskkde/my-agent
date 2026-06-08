/**
 * useSessionList - Hook for managing session list state and CRUD operations
 *
 * Manages:
 * - Session list fetching and refresh
 * - Session creation
 * - Debounced session list refresh scheduling
 * - Loading and error states
 *
 * The hook calls onSessionCreated callback when a new session is created,
 * allowing the orchestrator to coordinate session selection.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import * as api from '../../../api/client'
import type { ConsoleSessionInfo } from '../../../api/types'

export interface UseSessionListReturn {
  /** List of all sessions */
  sessions: ConsoleSessionInfo[]
  /** Whether the session list is currently loading */
  sessionsLoading: boolean
  /** Error message if session list fetch failed */
  sessionsError: string | null
  /** Fetch sessions from the API. isRefresh=true skips loading spinner. */
  fetchSessions: (isRefresh?: boolean) => Promise<void>
  /** Schedule a debounced session list refresh (250ms) */
  scheduleSessionRefresh: () => void
  /** Create a new session and select it */
  handleCreateSession: () => Promise<void>
  /** Refresh sessions (alias for fetchSessions(true)) */
  refreshSessions: () => Promise<void>
  /** Cancel any pending debounced session refresh */
  clearSessionRefreshTimeout: () => void
}

/**
 * Hook to manage the session list lifecycle.
 *
 * @param options.onSessionCreated - Called after a new session is created with its ID
 */
export function useSessionList(options?: {
  onSessionCreated?: (sessionId: string) => void
}): UseSessionListReturn {
  const [sessions, setSessions] = useState<ConsoleSessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  const mountedRef = useRef(true)
  const sessionRefreshTimeoutRef = useRef<number | null>(null)
  const onSessionCreatedRef = useRef(options?.onSessionCreated)
  onSessionCreatedRef.current = options?.onSessionCreated

  const clearSessionRefreshTimeout = useCallback(() => {
    if (sessionRefreshTimeoutRef.current !== null) {
      clearTimeout(sessionRefreshTimeoutRef.current)
      sessionRefreshTimeoutRef.current = null
    }
  }, [])

  const fetchSessions = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setSessionsError(null)
      } else {
        setSessionsLoading(true)
      }
      const response = await api.getSessions()
      if (mountedRef.current) {
        setSessions(response.sessions)
      }
    } catch (err) {
      if (mountedRef.current) {
        setSessionsError(err instanceof Error ? err.message : 'Failed to load sessions')
      }
    } finally {
      if (mountedRef.current) {
        setSessionsLoading(false)
      }
    }
  }, [])

  const scheduleSessionRefresh = useCallback(() => {
    if (sessionRefreshTimeoutRef.current !== null) return
    sessionRefreshTimeoutRef.current = window.setTimeout(() => {
      sessionRefreshTimeoutRef.current = null
      fetchSessions(true)
    }, 250)
  }, [fetchSessions])

  const handleCreateSession = useCallback(async () => {
    try {
      const response = await api.createSession()
      const newSession: ConsoleSessionInfo = {
        ...response.session,
        title: `Session ${response.session.sessionId.slice(-8)}`,
        status: 'active',
        createdAt: response.session.lastActivityAt,
        updatedAt: response.session.lastActivityAt,
      }
      setSessions((prev) => [newSession, ...prev])
      onSessionCreatedRef.current?.(newSession.sessionId)
    } catch (err) {
      if (mountedRef.current) {
        setSessionsError(err instanceof Error ? err.message : 'Failed to create session')
      }
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    await fetchSessions(true)
  }, [fetchSessions])

  // Fetch sessions on mount, cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    fetchSessions()

    return () => {
      mountedRef.current = false
      clearSessionRefreshTimeout()
    }
  }, [fetchSessions, clearSessionRefreshTimeout])

  return {
    sessions,
    sessionsLoading,
    sessionsError,
    fetchSessions,
    scheduleSessionRefresh,
    handleCreateSession,
    refreshSessions,
    clearSessionRefreshTimeout,
  }
}
