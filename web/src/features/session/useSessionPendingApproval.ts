/**
 * useSessionPendingApproval - Hook for fetching pending approval for a session
 *
 * SELECTION RULE:
 * 1. Fetch all approvals via getApprovals()
 * 2. Filter to: sessionId matches + status === 'pending'
 * 3. Sort by requestedAt ascending (earliest first)
 * 4. Return the earliest pending approval (deterministic)
 *
 * EXPIRED APPROVAL HANDLING:
 * - Hook does NOT filter out expired approvals
 * - Returns them so UI can show expired message and disable actions
 * - Parent component should check approval.expiresAt < now
 *
 * ERROR HANDLING:
 * - API errors are caught and returned via error state
 * - Does not throw; returns null approval with error message
 */

import { useState, useEffect, useCallback } from 'react'
import { ApprovalInfo } from '../../api/types'
import { getApprovals } from '../../api/client'

export interface UseSessionPendingApprovalReturn {
  /** The earliest pending approval for the session, or null if none */
  pendingApproval: ApprovalInfo | null
  /** Loading state during API fetch */
  loading: boolean
  /** Error message if API call failed, or null */
  error: string | null
  /** Manually refresh the pending approval */
  refresh: () => Promise<void>
}

/**
 * Hook to fetch and select the pending approval for a session.
 *
 * @param sessionId - The session ID to filter approvals for, or null to skip fetching
 * @returns Object with pendingApproval, loading, error, and refresh function
 */
export function useSessionPendingApproval(sessionId: string | null): UseSessionPendingApprovalReturn {
  const [pendingApproval, setPendingApproval] = useState<ApprovalInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPendingApproval = useCallback(async () => {
    // Skip if no session ID
    if (!sessionId) {
      setPendingApproval(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await getApprovals()
      const approvals = response.approvals || []

      // Filter: current session + status === 'pending'
      const pendingForSession = approvals.filter(
        (approval) => approval.sessionId === sessionId && approval.status === 'pending',
      )

      // Sort by requestedAt ascending (earliest first)
      pendingForSession.sort((a, b) => {
        const timeA = new Date(a.requestedAt).getTime()
        const timeB = new Date(b.requestedAt).getTime()
        return timeA - timeB
      })

      // Return earliest (deterministic)
      setPendingApproval(pendingForSession[0] || null)
    } catch (err) {
      // Handle API errors without crashing
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch approvals'
      setError(errorMessage)
      setPendingApproval(null)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // Fetch on mount and when sessionId changes
  useEffect(() => {
    fetchPendingApproval()
  }, [fetchPendingApproval])

  return {
    pendingApproval,
    loading,
    error,
    refresh: fetchPendingApproval,
  }
}
