/**
 * SessionMapPage — Standalone authenticated route /map/:sessionId.
 *
 * Reads sessionId from route params, fetches timeline via getSessionTimeline,
 * subscribes via subscribeSessionTimeline, renders SessionMapPanel, captures
 * MapContextSnapshot, and sends formatted context via useMapContextSender +
 * sendMessage.
 *
 * Independent from SessionConsoleTab. Uses explicit send button.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  getSessionTimeline,
  subscribeSessionTimeline,
  sendMessage,
} from '../../api/client'
import type { ConsoleTimelineEvent } from '../../api/types'
import type { MapContextSnapshot } from './types'
import { useMapContextSender } from './map-context-injector'
import SessionMapPanel from './components/SessionMapPanel'
import './SessionMapPage.css'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SessionMapPage() {
  const { sessionId } = useParams<{ sessionId: string }>()

  const [events, setEvents] = useState<ConsoleTimelineEvent[]>([])
  const [snapshot, setSnapshot] = useState<MapContextSnapshot | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  const seenIdsRef = useRef(new Set<string>())

  // sendMessage wrapper — delegates to the real API client
  const apiSendMessage = useCallback(
    async (text: string) => {
      if (!sessionId) return
      await sendMessage(sessionId, text)
    },
    [sessionId],
  )

  const { sendMapContext } = useMapContextSender({
    sessionId: sessionId ?? '',
    sendMessage: apiSendMessage,
  })

  // -------------------------------------------------------------------------
  // Timeline fetch + SSE subscription
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!sessionId) return

    // Reset state on sessionId change
    setEvents([])
    setFetchError(null)
    setSendError(null)
    setSnapshot(null)
    seenIdsRef.current = new Set()

    // Fetch historical timeline
    getSessionTimeline(sessionId)
      .then((result) => {
        for (const evt of result.events) {
          seenIdsRef.current.add(evt.eventId)
        }
        setEvents(result.events)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load timeline'
        setFetchError(message)
      })

    // Subscribe to live SSE events (deduplicated by eventId)
    const unsubscribe = subscribeSessionTimeline(
      sessionId,
      (event: ConsoleTimelineEvent) => {
        if (!seenIdsRef.current.has(event.eventId)) {
          seenIdsRef.current.add(event.eventId)
          setEvents((prev) => [...prev, event])
        }
      },
      () => {
        // SSE error — the client handles reconnection internally
      },
    )

    return () => {
      unsubscribe()
    }
  }, [sessionId])

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleMapClick = useCallback((snap: MapContextSnapshot) => {
    setSnapshot(snap)
  }, [])

  const handleSend = useCallback(async () => {
    if (!snapshot) return
    setSendError(null)
    setIsSending(true)
    try {
      await sendMapContext(snapshot)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send'
      setSendError(message)
    } finally {
      setIsSending(false)
    }
  }, [snapshot, sendMapContext])

  // -------------------------------------------------------------------------
  // Render — missing session id
  // -------------------------------------------------------------------------

  if (!sessionId) {
    return (
      <div className="session-map-page session-map-page--missing" data-testid="missing-session-id">
        <p>No session selected</p>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Render — fetch error
  // -------------------------------------------------------------------------

  if (fetchError) {
    return (
      <div className="session-map-page session-map-page--error" data-testid="fetch-error">
        <p>{fetchError}</p>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Render — normal
  // -------------------------------------------------------------------------

  return (
    <div className="session-map-page">
      <SessionMapPanel
        sessionId={sessionId}
        events={events}
        onMapClick={handleMapClick}
      />
      <div className="session-map-page__send">
        <button
          type="button"
          disabled={isSending || !snapshot}
          onClick={handleSend}
        >
          Send
        </button>
        {sendError && (
          <div className="session-map-page__send-error" data-testid="send-error">
            <p>{sendError}</p>
          </div>
        )}
      </div>
    </div>
  )
}
