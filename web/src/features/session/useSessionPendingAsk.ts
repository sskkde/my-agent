import { useCallback, useEffect, useState } from 'react'
import type { AskInfo } from '../../api/types'
import { getAsks } from '../../api/client'

export interface UseSessionPendingAskReturn {
  pendingAsk: AskInfo | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useSessionPendingAsk(sessionId: string | null): UseSessionPendingAskReturn {
  const [pendingAsk, setPendingAsk] = useState<AskInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPendingAsk = useCallback(async () => {
    if (!sessionId) {
      setPendingAsk(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await getAsks()
      const asks = response.asks || []
      const pendingForSession = asks
        .filter((ask) => ask.sessionId === sessionId && ask.status === 'pending')
        .sort((a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime())

      setPendingAsk(pendingForSession[0] || null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch asks'
      setError(errorMessage)
      setPendingAsk(null)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void fetchPendingAsk()
  }, [fetchPendingAsk])

  return {
    pendingAsk,
    loading,
    error,
    refresh: fetchPendingAsk,
  }
}
