import { useState, useCallback, useRef } from 'react'
import * as api from '../../../api/client'
import type { ConsoleTimelineEvent, ProcessingStatusPayload, TokenStreamPayload } from '../../../api/types'
import { SSE_RECONNECT_BASE_DELAY_MS, SSE_RECONNECT_MAX_DELAY_MS } from '../session-constants'

type StreamStatus = 'connecting' | 'connected' | 'disconnected'

export interface UseSSEStreamReturn {
  streamStatus: StreamStatus
  processingStatus: ProcessingStatusPayload | null
  connectSse: (sessionId: string) => void
  handleRetryStream: () => void
  clearSseReconnectTimeout: () => void
  resetStreamStatus: () => void
  disconnectSse: () => void
}

/**
 * Manages SSE connection lifecycle: connect, exponential backoff reconnect (max 5),
 * status tracking, and cleanup. Delegates business logic (events, tokens) to callbacks.
 */
export function useSSEStream(options: {
  mountedRef: React.MutableRefObject<boolean>
  selectedSessionIdRef: React.MutableRefObject<string | null>
  onEvent: (event: ConsoleTimelineEvent) => void
  onToken: (token: TokenStreamPayload) => void
}): UseSSEStreamReturn {
  const { mountedRef, selectedSessionIdRef } = options

  const [streamStatus, setStreamStatus] = useState<StreamStatus>('disconnected')
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatusPayload | null>(null)

  const sseReconnectAttemptsRef = useRef(0)
  const sseReconnectTimeoutRef = useRef<number | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  const onEventRef = useRef(options.onEvent)
  onEventRef.current = options.onEvent
  const onTokenRef = useRef(options.onToken)
  onTokenRef.current = options.onToken

  const clearSseReconnectTimeout = useCallback(() => {
    if (sseReconnectTimeoutRef.current !== null) {
      clearTimeout(sseReconnectTimeoutRef.current)
      sseReconnectTimeoutRef.current = null
    }
  }, [])

  const connectSse = useCallback(
    (sessionId: string) => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }

      setStreamStatus('connecting')

      unsubscribeRef.current = api.subscribeSessionTimeline(
        sessionId,
        (event) => {
          if (!mountedRef.current) return
          if (selectedSessionIdRef.current !== sessionId) return

          sseReconnectAttemptsRef.current = 0
          onEventRef.current(event)
        },
        () => {
          if (!mountedRef.current) return
          if (selectedSessionIdRef.current !== sessionId) return

          setStreamStatus('disconnected')

          if (sseReconnectAttemptsRef.current < 5) {
            const delay = Math.min(
              SSE_RECONNECT_BASE_DELAY_MS * Math.pow(2, sseReconnectAttemptsRef.current),
              SSE_RECONNECT_MAX_DELAY_MS,
            )
            sseReconnectAttemptsRef.current += 1

            sseReconnectTimeoutRef.current = window.setTimeout(() => {
              if (mountedRef.current && selectedSessionIdRef.current === sessionId) {
                connectSse(sessionId)
              }
            }, delay)
          }
        },
        (status) => {
          if (!mountedRef.current) return
          if (selectedSessionIdRef.current !== sessionId) return
          setProcessingStatus(status)
        },
        (token) => {
          if (!mountedRef.current) return
          if (selectedSessionIdRef.current !== sessionId) return
          onTokenRef.current(token)
        },
      )

      setStreamStatus('connected')
    },
    [mountedRef, selectedSessionIdRef],
  )

  const handleRetryStream = useCallback(() => {
    const sessionId = selectedSessionIdRef.current
    if (sessionId) {
      sseReconnectAttemptsRef.current = 0
      connectSse(sessionId)
    }
  }, [connectSse, selectedSessionIdRef])

  const resetStreamStatus = useCallback(() => {
    setStreamStatus('disconnected')
  }, [])

  const disconnectSse = useCallback(() => {
    clearSseReconnectTimeout()
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
    }
  }, [clearSseReconnectTimeout])

  return {
    streamStatus,
    processingStatus,
    connectSse,
    handleRetryStream,
    clearSseReconnectTimeout,
    resetStreamStatus,
    disconnectSse,
  }
}
