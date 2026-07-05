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

export interface UseSelectedSessionOptions {
  initialSessionId?: string
  navigate?: (path: string) => void
  /**
   * Known-valid session IDs (typically from the session list). When non-empty,
   * the hook clears `selectedSessionId` if it is not in this list. When empty
   * (list not loaded yet), the hook leaves `selectedSessionId` untouched so a
   * stale localStorage value survives until the list arrives.
   */
  validSessionIds?: string[]
}

export interface UseSelectedSessionReturn {
  selectedSessionId: string | null
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>
  selectedSession: ConsoleSessionInfo | null
  setSelectedSession: React.Dispatch<React.SetStateAction<ConsoleSessionInfo | null>>
  selectedSessionIdRef: React.MutableRefObject<string | null>
  handleSelectSession: (sessionId: string) => void
}

export function useSelectedSession(options?: UseSelectedSessionOptions): UseSelectedSessionReturn {
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
  }, [options?.initialSessionId, selectedSessionId])

  // Reconcile against the known-valid session list. Only clears when the list
  // is non-empty (loaded) and the current selection is absent — avoids wiping
  // a valid selection before the list arrives.
  useEffect(() => {
    const validIds = options?.validSessionIds
    if (validIds && validIds.length > 0 && selectedSessionId && !validIds.includes(selectedSessionId)) {
      setSelectedSessionId(null)
    }
  }, [options?.validSessionIds, selectedSessionId])

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

  const navigate = options?.navigate
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setSelectedSessionId(sessionId)
      if (navigate) {
        navigate(`/chat/${encodeURIComponent(sessionId)}`)
      }
    },
    [navigate],
  )

  return {
    selectedSessionId,
    setSelectedSessionId,
    selectedSession,
    setSelectedSession,
    selectedSessionIdRef,
    handleSelectSession,
  }
}
