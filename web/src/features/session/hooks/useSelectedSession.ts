/**
 * useSelectedSession - Hook for managing selected session state with localStorage persistence
 *
 * Manages:
 * - selectedSessionId state with localStorage fallback via migration guard
 * - selectedSession detail state
 * - selectedSessionIdRef for stable callback access
 * - Automatic localStorage persistence of selected session ID
 *
 * Uses safeReadLocalStorage from session-migration.ts for safe initialization,
 * avoiding crashes from malformed localStorage values.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { ConsoleSessionInfo } from '../../../api/types'
import { SELECTED_SESSION_KEY } from '../session-constants'
import { safeReadLocalStorage } from '../session-migration'

export interface UseSelectedSessionReturn {
  /** Currently selected session ID, or null if none selected */
  selectedSessionId: string | null
  /** Setter for selectedSessionId */
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>
  /** Full session info for the selected session */
  selectedSession: ConsoleSessionInfo | null
  /** Setter for selectedSession */
  setSelectedSession: React.Dispatch<React.SetStateAction<ConsoleSessionInfo | null>>
  /** Mutable ref synced with selectedSessionId for use in stable callbacks */
  selectedSessionIdRef: React.MutableRefObject<string | null>
  /** Select a session by ID (convenience wrapper for setSelectedSessionId) */
  handleSelectSession: (sessionId: string) => void
}

/**
 * Hook to manage the selected session state with localStorage persistence.
 *
 * Initialization uses safeReadLocalStorage to safely read the persisted session ID,
 * handling malformed values and localStorage unavailability gracefully.
 *
 * @param options.initialSessionId - Optional session ID from URL routing.
 *   When provided, takes precedence over localStorage for session selection.
 *   Used by /chat/:sessionId route to drive session selection from URL.
 */
export function useSelectedSession(options?: {
  initialSessionId?: string
}): UseSelectedSessionReturn {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => {
    // URL sessionId takes precedence over localStorage (Task 4 precedence rules)
    if (options?.initialSessionId) {
      return options.initialSessionId
    }
    return safeReadLocalStorage(SELECTED_SESSION_KEY)
  })
  const [selectedSession, setSelectedSession] = useState<ConsoleSessionInfo | null>(null)
  const selectedSessionIdRef = useRef<string | null>(selectedSessionId)

  // Keep ref in sync with state
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])

  // Sync with URL sessionId when it changes (e.g., /chat/ses_abc → /chat/ses_xyz)
  useEffect(() => {
    if (options?.initialSessionId && options.initialSessionId !== selectedSessionId) {
      setSelectedSessionId(options.initialSessionId)
    }
  }, [options?.initialSessionId])

  // Persist selected session ID to localStorage
  useEffect(() => {
    if (selectedSessionId) {
      try {
        localStorage.setItem(SELECTED_SESSION_KEY, selectedSessionId)
      } catch (err) {
        console.warn('Failed to persist selected session:', err)
      }
    } else {
      try {
        localStorage.removeItem(SELECTED_SESSION_KEY)
      } catch (err) {
        console.warn('Failed to clear selected session:', err)
      }
    }
  }, [selectedSessionId])

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId)
  }, [])

  return {
    selectedSessionId,
    setSelectedSessionId,
    selectedSession,
    setSelectedSession,
    selectedSessionIdRef,
    handleSelectSession,
  }
}
