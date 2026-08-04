import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as api from '../../../api/client'
import { filterChildTimelineEvents } from '../../../childTaskTimeline'
import type { ChildSessionInfo, ConsoleTimelineEvent, TokenStreamPayload } from '../../../api/types'
import ChatMessageList from '../chat/ChatMessageList'
import ChatShell from '../chat/ChatShell'
import { useSSEStream } from '../hooks/useSSEStream'
import {
  appendStreamingToken,
  clearDraftsForTerminalEvent,
  compareTimelineEventsForChat,
  mergeTimelineEvents,
  shouldClearDraftOnServerEvent,
  upsertTimelineEvent,
  type StreamingDraft,
} from '../session-utils'
import { loadPreferences } from '../../../commands/preferences'
import { ChildSessionContext, ChildSessionError, ChildSessionNotFound, ChildSessionSidebar } from './ChildSessionPanels'
import { getTerminalStatus, isAccessError, statusLabels } from './child-session-utils'
import './ChildSessionPage.css'
import '../chat/chat-theme.css'

const CHILD_TIMELINE_PAGE_SIZE = 50

type PageState = 'loading' | 'ready' | 'not_found' | 'error'

const ChildSessionPage: React.FC = () => {
  const { sessionId: parentSessionId, taskId } = useParams<{ sessionId: string; taskId: string }>()
  const navigate = useNavigate()
  const mountedRef = useRef(true)
  const selectedSessionIdRef = useRef<string | null>(null)
  const [pageState, setPageState] = useState<PageState>('loading')
  const [child, setChild] = useState<ChildSessionInfo | null>(null)
  const [events, setEvents] = useState<ConsoleTimelineEvent[]>([])
  const [timelineLoading, setTimelineLoading] = useState(true)
  const [timelineError, setTimelineError] = useState<string | undefined>()
  const [streamingDrafts, setStreamingDrafts] = useState<Map<string, StreamingDraft>>(new Map())

  const goBackToParent = useCallback(() => {
    if (parentSessionId) navigate(`/chat/${encodeURIComponent(parentSessionId)}`)
    else navigate('/chat')
  }, [navigate, parentSessionId])

  const handleEvent = useCallback((event: ConsoleTimelineEvent, source: 'live' | 'historical' = 'live') => {
    if (event.sessionId !== selectedSessionIdRef.current) return
    setEvents((previous) => upsertTimelineEvent(previous, event))
    if (event.eventType === 'assistant_message' || event.eventType === 'error') {
      if (shouldClearDraftOnServerEvent(event, source)) {
        setStreamingDrafts((previous) =>
          clearDraftsForTerminalEvent(previous, event, {
            allowOldestFallback: source === 'live',
            sessionId: selectedSessionIdRef.current,
            source,
          }),
        )
      }
    }
  }, [])

  const handleToken = useCallback((token: TokenStreamPayload) => {
    if (token.sessionId !== selectedSessionIdRef.current) return
    setStreamingDrafts((previous) =>
      appendStreamingToken(previous, token, token.timestamp ? Date.parse(token.timestamp) : undefined),
    )
  }, [])

  const { streamStatus, processingStatus, connectSse, disconnectSse, resetStreamStatus } = useSSEStream({
    mountedRef,
    selectedSessionIdRef,
    onEvent: handleEvent,
    onToken: handleToken,
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      selectedSessionIdRef.current = null
      disconnectSse()
    }
  }, [disconnectSse])

  useEffect(() => {
    if (!parentSessionId || !taskId) {
      setPageState('not_found')
      setTimelineLoading(false)
      return
    }

    let cancelled = false
    setPageState('loading')
    setTimelineLoading(true)
    setTimelineError(undefined)
    setChild(null)
    setEvents([])
    setStreamingDrafts(new Map())
    selectedSessionIdRef.current = null
    disconnectSse()
    resetStreamStatus()

    const loadChild = async () => {
      try {
        const response = await api.getChildSessions(parentSessionId, CHILD_TIMELINE_PAGE_SIZE, 0)
        if (cancelled) return
        const matchedChild = response.items.find((candidate) => candidate.taskId === taskId)
        if (!matchedChild) {
          setPageState('not_found')
          setTimelineLoading(false)
          return
        }

        const timelineResponse = await api.getSessionTimeline(matchedChild.sessionId, CHILD_TIMELINE_PAGE_SIZE)
        if (cancelled) return
        const initialEvents = mergeTimelineEvents(
          [],
          filterChildTimelineEvents(timelineResponse.events, matchedChild.sessionId),
        )
        initialEvents.sort(compareTimelineEventsForChat)
        setChild(matchedChild)
        setEvents(initialEvents)
        selectedSessionIdRef.current = matchedChild.sessionId
        setPageState('ready')
        setTimelineLoading(false)
        connectSse(matchedChild.sessionId)
      } catch (error) {
        if (cancelled) return
        setPageState(isAccessError(error) ? 'not_found' : 'error')
        setTimelineLoading(false)
      }
    }

    void loadChild()
    return () => {
      cancelled = true
      disconnectSse()
      selectedSessionIdRef.current = null
    }
  }, [connectSse, disconnectSse, parentSessionId, resetStreamStatus, taskId])

  const mergedEvents = useMemo(() => {
    const reasoningVisible = loadPreferences().reasoningVisible
    const visibleEvents = reasoningVisible ? events : events.filter((event) => event.eventType !== 'thinking_summary')
    const syntheticEvents: ConsoleTimelineEvent[] = []
    streamingDrafts.forEach((draft, draftKey) => {
      if (draft.sessionId !== selectedSessionIdRef.current || (draft.content.length === 0 && draft.sealed)) return
      syntheticEvents.push({
        eventId: `synthetic-child-draft-${draftKey}`,
        eventType: 'assistant_message',
        sessionId: draft.sessionId,
        timestamp: new Date(draft.timestamp).toISOString(),
        content: draft.content,
        metadata: {
          streamingDraft: true,
          attemptId: draft.attemptId,
          draftSegment: draft.segment,
          sealed: draft.sealed,
        },
        actor: 'assistant',
      })
    })
    return [...visibleEvents, ...syntheticEvents].sort(compareTimelineEventsForChat)
  }, [events, streamingDrafts])

  const status = child ? (getTerminalStatus(events) ?? child.status) : 'active'
  const retryStream = useCallback(() => {
    const childSessionId = selectedSessionIdRef.current
    if (childSessionId) connectSse(childSessionId)
  }, [connectSse])

  if (pageState === 'not_found') {
    return <ChildSessionNotFound onBack={goBackToParent} />
  }

  if (pageState === 'error') {
    return <ChildSessionError onBack={goBackToParent} />
  }

  if (!child) {
    return (
      <div className="child-session-page child-session-page--loading" data-testid="child-session-page">
        <div className="child-session-loading" role="status">
          正在加载子会话…
        </div>
      </div>
    )
  }

  const statusLabel = processingStatus?.stageLabel

  return (
    <div className="child-session-page" data-testid="child-session-page">
      <ChatShell
        title={child.title || '子会话'}
        sidebar={<ChildSessionSidebar onBack={goBackToParent} />}
        rightPanel={
          <ChildSessionContext child={child} status={status} streamStatus={streamStatus} onRetry={retryStream} />
        }
        initialSidebarOpen
        initialRightOpen
      >
        <header className="child-session-header">
          <button
            type="button"
            className="child-session-header__back"
            onClick={goBackToParent}
            data-testid="child-session-back"
          >
            <span aria-hidden="true">←</span>
            返回父会话
          </button>
          <div className="child-session-header__summary">
            <span className="child-session-header__kind">子会话</span>
            <span className="child-session-header__status" data-testid="child-session-inline-status">
              {statusLabels[status]}
            </span>
            {statusLabel && <span className="child-session-header__stage">{statusLabel}</span>}
          </div>
        </header>
        <ChatMessageList
          events={mergedEvents}
          parentSessionId={selectedSessionIdRef.current ?? undefined}
          loading={timelineLoading}
          error={timelineError}
          onPromptSelect={() => {}}
          onRetryStream={retryStream}
        />
      </ChatShell>
    </div>
  )
}

export default ChildSessionPage
