import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import './SessionConsole.css'
import * as api from '../../api/client'
import type {
  ConsoleSessionInfo,
  ConsoleTimelineEvent,
  CreateProviderRequest,
  UpdateProviderRequest,
  TokenStreamPayload,
} from '../../api/types'
import type { TabId } from '../../components/TabNav'
import { loadPreferences } from '../../commands/preferences'
import type { CommandContext, AuthContext } from '../../commands/types'
import { ProcessingStatus } from './ProcessingStatus'
import { ApprovalDecisionModal } from './ApprovalDecisionModal'
import { useSessionPendingApproval } from './useSessionPendingApproval'
import { useSessionList } from './hooks/useSessionList'
import { useSelectedSession } from './hooks/useSelectedSession'
import { useSSEStream } from './hooks/useSSEStream'
import { useComposerSubmission } from './hooks/useComposerSubmission'
import { getBaselineServerMessageCount } from './session-utils'
import type { AssistantPlaceholder, StreamingDraft } from './session-utils'
import { SessionSidebar } from './components/SessionSidebar'
import { TimelinePanel } from './components/TimelinePanel'
import { SessionEmptyState } from './components/SessionEmptyState'
import { MobileSessionDrawer } from './components/MobileSessionDrawer'
import ComposerDock from '../../components/ComposerDock'
import { useAgentShellSidebar } from '../../layout/AgentShellSidebarContext'

interface SessionConsoleTabProps {
  setActiveTab?: (tabId: TabId) => void
  auth?: AuthContext
  initialSessionId?: string
}

const SessionConsoleTab: React.FC<SessionConsoleTabProps> = ({ setActiveTab, auth, initialSessionId }) => {
  const navigate = useNavigate()

  const {
    selectedSessionId,
    setSelectedSessionId,
    selectedSession,
    setSelectedSession,
    selectedSessionIdRef,
    handleSelectSession: selectSession,
  } = useSelectedSession({ initialSessionId, navigate })

  const {
    sessions,
    sessionsLoading,
    sessionsError,
    fetchSessions,
    scheduleSessionRefresh,
    handleCreateSession,
    refreshSessions,
    clearSessionRefreshTimeout,
  } = useSessionList({
    onSessionCreated: setSelectedSessionId,
  })

  const [events, setEvents] = useState<ConsoleTimelineEvent[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)

  const [streamingDrafts, setStreamingDrafts] = useState<Map<string, StreamingDraft>>(new Map())
  const [pendingAssistantPlaceholders, setPendingAssistantPlaceholders] = useState<Map<string, AssistantPlaceholder>>(
    new Map(),
  )

  const [isSessionsDrawerOpen, setIsSessionsDrawerOpen] = useState(false)

  const [submittingApproval, setSubmittingApproval] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const preferences = useMemo(() => loadPreferences(), [])

  const shellSidebar = useAgentShellSidebar()
  const { pendingApproval, refresh: refreshPendingApproval } = useSessionPendingApproval(selectedSessionId)

  const mountedRef = useRef(true)
  const pendingAssistantPlaceholdersRef = useRef(pendingAssistantPlaceholders)

  const updatePendingAssistantPlaceholders = useCallback(
    (updater: (prev: Map<string, AssistantPlaceholder>) => Map<string, AssistantPlaceholder>) => {
      setPendingAssistantPlaceholders((prev) => {
        const next = updater(prev)
        pendingAssistantPlaceholdersRef.current = next
        return next
      })
    },
    [],
  )

  const createAssistantPlaceholder = useCallback(
    (sessionId: string): { attemptId: string; placeholder: AssistantPlaceholder } => ({
      attemptId: `placeholder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      placeholder: { sessionId, timestamp: Date.now() },
    }),
    [],
  )

  const resolveAssistantPlaceholder = useCallback(
    (currentAttemptId: string, resolvedAttemptId?: string): void => {
      if (!resolvedAttemptId || resolvedAttemptId === currentAttemptId) return
      updatePendingAssistantPlaceholders((prev) => {
        const placeholder = prev.get(currentAttemptId)
        if (!placeholder) return prev
        const next = new Map(prev)
        next.delete(currentAttemptId)
        next.set(resolvedAttemptId, placeholder)
        return next
      })
    },
    [updatePendingAssistantPlaceholders],
  )

  const clearAssistantActivity = useCallback(
    (
      attemptIds: Array<string | undefined>,
      clearOldestIfUnmatched = false,
      sessionId = selectedSessionIdRef.current,
    ): void => {
      const ids = attemptIds.filter((id): id is string => Boolean(id))
      if (ids.length === 0 && !clearOldestIfUnmatched) return

      updatePendingAssistantPlaceholders((prev) => {
        const next = new Map(prev)
        const sizeBefore = next.size
        for (const id of ids) next.delete(id)
        const matchedAny = next.size < sizeBefore
        if (!matchedAny && clearOldestIfUnmatched) {
          const oldestId = Array.from(next.entries()).find(
            ([, placeholder]) => !sessionId || placeholder.sessionId === sessionId,
          )?.[0]
          if (oldestId) next.delete(oldestId)
        }
        return next.size === prev.size ? prev : next
      })

      setStreamingDrafts((prev) => {
        const next = new Map(prev)
        const sizeBefore = next.size
        for (const id of ids) next.delete(id)
        const matchedAny = next.size < sizeBefore
        if (!matchedAny && clearOldestIfUnmatched) {
          const oldestId = Array.from(next.entries()).find(
            ([, draft]) => !sessionId || draft.sessionId === sessionId,
          )?.[0]
          if (oldestId) next.delete(oldestId)
        }
        return next.size === prev.size ? prev : next
      })
    },
    [updatePendingAssistantPlaceholders],
  )

  const clearAssistantActivityForSession = useCallback(
    (sessionId: string): void => {
      updatePendingAssistantPlaceholders((prev) => {
        const next = new Map(prev)
        for (const [id, placeholder] of next.entries()) {
          if (placeholder.sessionId === sessionId) next.delete(id)
        }
        return next.size === prev.size ? prev : next
      })

      setStreamingDrafts((prev) => {
        const next = new Map(prev)
        for (const [id, draft] of next.entries()) {
          if (draft.sessionId === sessionId) next.delete(id)
        }
        return next.size === prev.size ? prev : next
      })
    },
    [updatePendingAssistantPlaceholders],
  )

  const fetchTimeline = useCallback(async (sessionId: string) => {
    try {
      const timelineResponse = await api.getSessionTimeline(sessionId)
      if (mountedRef.current && selectedSessionIdRef.current === sessionId) {
        setEvents((prev) => {
          const existingIds = new Set(prev.map((e) => e.eventId))
          const newEvents = timelineResponse.events.filter((e) => !existingIds.has(e.eventId))
          if (newEvents.length === 0) return prev
          const merged = [...prev, ...newEvents]
          merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
          return merged
        })
      }
      return timelineResponse.events
    } catch (err) {
      if (mountedRef.current && selectedSessionIdRef.current === sessionId) {
        setTimelineError(err instanceof Error ? err.message : 'Failed to load timeline')
      }
      return null
    }
  }, [])

  const refreshProviders = useCallback(async () => {
    try {
      await api.getProviders()
    } catch (err) {
      console.warn('Failed to refresh providers:', err)
    }
  }, [])

  const createCommandContext = useCallback((): CommandContext => {
    return {
      sessionId: selectedSessionId,
      setSelectedSessionId,
      refreshSessions,
      setActiveTab: setActiveTab ?? (() => {}),
      refreshProviders,
      auth: auth ?? { isAuthenticated: false, logout: () => {} },
      api: {
        get: async (path: string) => {
          if (path === '/providers') {
            return api.getProviders()
          }
          throw new Error(`GET ${path} not implemented`)
        },
        post: async (path: string, body?: unknown) => {
          if (path === '/providers') {
            return api.createProvider(body as CreateProviderRequest)
          }
          if (path.startsWith('/providers/') && path.endsWith('/test')) {
            const providerId = path.split('/')[2]
            return api.testProvider(providerId)
          }
          throw new Error(`POST ${path} not implemented`)
        },
        put: async (path: string, body?: unknown) => {
          if (path.startsWith('/providers/')) {
            const providerId = path.split('/')[2]
            return api.updateProvider(providerId, body as UpdateProviderRequest)
          }
          throw new Error(`PUT ${path} not implemented`)
        },
        delete: async (path: string) => {
          if (path.startsWith('/providers/')) {
            const providerId = path.split('/')[2]
            return api.deleteProvider(providerId)
          }
          throw new Error(`DELETE ${path} not implemented`)
        },
      },
    }
  }, [selectedSessionId, setActiveTab, auth, refreshSessions, refreshProviders])

  const handleSSEEvent = useCallback(
    (event: ConsoleTimelineEvent) => {
      setEvents((prev) => {
        if (prev.some((e) => e.eventId === event.eventId)) {
          return prev
        }
        return [...prev, event]
      })

      if (['user_message', 'assistant_message', 'error'].includes(event.eventType)) {
        scheduleSessionRefresh()
      }

      if (
        ['approval_request', 'approval_requested', 'approval_decision', 'approval_resolved'].includes(
          event.eventType,
        )
      ) {
        refreshPendingApproval()
      }

      if (['assistant_message', 'error'].includes(event.eventType)) {
        const attemptId = typeof event.metadata?.attemptId === 'string' ? event.metadata.attemptId : undefined
        const turnId = typeof event.metadata?.turnId === 'string' ? event.metadata.turnId : undefined
        clearAssistantActivity([attemptId, turnId], true)
      }
    },
    [scheduleSessionRefresh, refreshPendingApproval, clearAssistantActivity],
  )

  const handleSSEToken = useCallback(
    (token: TokenStreamPayload) => {
      const sessionId = token.sessionId
      const exactPlaceholder = pendingAssistantPlaceholdersRef.current.get(token.attemptId)
      const fallbackPlaceholderEntry = exactPlaceholder
        ? undefined
        : Array.from(pendingAssistantPlaceholdersRef.current.entries()).find(
            ([, placeholder]) => placeholder.sessionId === sessionId,
          )
      const placeholderTimestamp = exactPlaceholder?.timestamp ?? fallbackPlaceholderEntry?.[1].timestamp
      const placeholderIdToClear = exactPlaceholder ? token.attemptId : fallbackPlaceholderEntry?.[0]

      updatePendingAssistantPlaceholders((prev) => {
        const next = new Map(prev)
        if (placeholderIdToClear) next.delete(placeholderIdToClear)
        return next
      })

      setStreamingDrafts((prev) => {
        const next = new Map(prev)
        const existing = next.get(token.attemptId)

        if (!existing || token.sequence > existing.sequence) {
          next.set(token.attemptId, {
            sessionId,
            content: (existing?.content || '') + token.delta,
            sequence: token.sequence,
            timestamp: existing?.timestamp ?? placeholderTimestamp ?? Date.now(),
          })
        }
        return next
      })
    },
    [updatePendingAssistantPlaceholders],
  )

  const {
    streamStatus,
    processingStatus,
    connectSse,
    handleRetryStream,
    clearSseReconnectTimeout,
    resetStreamStatus,
    disconnectSse,
  } = useSSEStream({
    mountedRef,
    selectedSessionIdRef,
    onEvent: handleSSEEvent,
    onToken: handleSSEToken,
  })

  const {
    draft,
    setDraft,
    sending,
    sendError,
    setSendError,
    handleSend,
    localCommandEvents,
    localMessageEvents,
    clearPostSendPollTimeout,
  } = useComposerSubmission({
    selectedSessionId,
    mountedRef,
    selectedSessionIdRef,
    events,
    callbacks: {
      createAssistantPlaceholder,
      resolveAssistantPlaceholder,
      updatePendingAssistantPlaceholders,
      clearAssistantActivity,
      clearAssistantActivityForSession,
      fetchTimeline,
      fetchSessions,
      createCommandContext,
    },
  })

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      disconnectSse()
      clearPostSendPollTimeout()
      setPendingAssistantPlaceholders(new Map())
      pendingAssistantPlaceholdersRef.current = new Map()
      setStreamingDrafts(new Map())
    }
  }, [disconnectSse, clearPostSendPollTimeout])

  useEffect(() => {
    pendingAssistantPlaceholdersRef.current = pendingAssistantPlaceholders
  }, [pendingAssistantPlaceholders])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        fetchSessions(true)
        if (selectedSessionId) {
          fetchTimeline(selectedSessionId)
          refreshPendingApproval()
          if (streamStatus === 'disconnected') {
            connectSse(selectedSessionId)
          }
        }
      }
    }

    const handleFocus = () => {
      if (mountedRef.current) {
        fetchSessions(true)
        if (selectedSessionId) {
          fetchTimeline(selectedSessionId)
          refreshPendingApproval()
          if (streamStatus === 'disconnected') {
            connectSse(selectedSessionId)
          }
        }
      }
    }

    const handlePageShow = () => {
      if (mountedRef.current) {
        fetchSessions(true)
        if (selectedSessionId) {
          fetchTimeline(selectedSessionId)
          refreshPendingApproval()
          if (streamStatus === 'disconnected') {
            connectSse(selectedSessionId)
          }
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [connectSse, fetchSessions, fetchTimeline, selectedSessionId, streamStatus, refreshPendingApproval])

  useEffect(() => {
    if (!selectedSessionId) {
      return
    }

    const intervalId = setInterval(() => {
      refreshPendingApproval()
    }, 3000)

    return () => {
      clearInterval(intervalId)
    }
  }, [selectedSessionId, refreshPendingApproval])

  useEffect(() => {
    if (!selectedSessionId) {
      setSelectedSession(null)
      setEvents([])
      setTimelineError(null)
      resetStreamStatus()
      clearSseReconnectTimeout()
      clearPostSendPollTimeout()
      clearSessionRefreshTimeout()
      disconnectSse()
      return
    }

    const loadSessionAndTimeline = async () => {
      try {
        setTimelineLoading(true)
        setTimelineError(null)

        const sessionResponse = await api.getSession(selectedSessionId)
        if (!mountedRef.current) return
        if (selectedSessionIdRef.current !== selectedSessionId) return
        const sessionInfo: ConsoleSessionInfo = {
          ...sessionResponse.session,
          title: `Session ${sessionResponse.session.sessionId.slice(-8)}`,
          status: 'active',
          createdAt: sessionResponse.session.lastActivityAt,
          updatedAt: sessionResponse.session.lastActivityAt,
        }
        setSelectedSession(sessionInfo)

        const timelineResponse = await api.getSessionTimeline(selectedSessionId)
        if (!mountedRef.current) return
        if (selectedSessionIdRef.current !== selectedSessionId) return
        setEvents(timelineResponse.events)

        connectSse(selectedSessionId)
      } catch (err) {
        if (mountedRef.current && selectedSessionIdRef.current === selectedSessionId) {
          if (err instanceof api.ApiClientError && ['FORBIDDEN', 'NOT_FOUND'].includes(err.code)) {
            setSelectedSessionId(null)
          }
          setTimelineError(err instanceof Error ? err.message : 'Failed to load timeline')
          resetStreamStatus()
        }
      } finally {
        if (mountedRef.current && selectedSessionIdRef.current === selectedSessionId) {
          setTimelineLoading(false)
        }
      }
    }

    loadSessionAndTimeline()

    return () => {
      clearSseReconnectTimeout()
      clearPostSendPollTimeout()
      clearAssistantActivityForSession(selectedSessionId)
      disconnectSse()
    }
  }, [
    selectedSessionId,
    connectSse,
    clearSseReconnectTimeout,
    clearPostSendPollTimeout,
    clearSessionRefreshTimeout,
    clearAssistantActivityForSession,
    disconnectSse,
    resetStreamStatus,
  ])

  const closeSessionsSidebar = useCallback(() => {
    setIsSessionsDrawerOpen(false)
    shellSidebar?.closeNavDrawer()
  }, [shellSidebar])

  const openSessionsSidebar = useCallback(() => {
    if (shellSidebar) {
      shellSidebar.openNavDrawer()
      return
    }

    setIsSessionsDrawerOpen(true)
  }, [shellSidebar])

  const handleSelectSession = useCallback((sessionId: string) => {
    selectSession(sessionId)
    setDraft('')
    setSendError(null)
    closeSessionsSidebar()
  }, [selectSession, setDraft, setSendError, closeSessionsSidebar])

  const handleReject = useCallback(
    async (reason?: string) => {
      if (!pendingApproval) return

      setSubmittingApproval(true)
      setSubmitError(null)

      try {
        await api.respondApproval(pendingApproval.id, 'reject', reason)
        await refreshPendingApproval()
        if (selectedSessionId) {
          fetchTimeline(selectedSessionId)
        }
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to reject approval')
      } finally {
        setSubmittingApproval(false)
      }
    },
    [pendingApproval, refreshPendingApproval, selectedSessionId, fetchTimeline],
  )

  const handleApproveOnce = useCallback(
    async (reason?: string) => {
      if (!pendingApproval) return

      setSubmittingApproval(true)
      setSubmitError(null)

      try {
        await api.respondApproval(pendingApproval.id, 'approve_once', reason)
        await refreshPendingApproval()
        if (selectedSessionId) {
          fetchTimeline(selectedSessionId)
        }
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to approve')
      } finally {
        setSubmittingApproval(false)
      }
    },
    [pendingApproval, refreshPendingApproval, selectedSessionId, fetchTimeline],
  )

  const handleApproveAlways = useCallback(
    async (reason?: string) => {
      if (!pendingApproval) return

      setSubmittingApproval(true)
      setSubmitError(null)

      try {
        await api.respondApproval(pendingApproval.id, 'approve_always', reason)
        await refreshPendingApproval()
        if (selectedSessionId) {
          fetchTimeline(selectedSessionId)
        }
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to approve')
      } finally {
        setSubmittingApproval(false)
      }
    },
    [pendingApproval, refreshPendingApproval, selectedSessionId, fetchTimeline],
  )

  const handleCloseApprovalModal = useCallback(() => {
    setSubmitError(null)
  }, [])

  const sessionsSidebar = useMemo(
    () => (
      <SessionSidebar
        sessions={sessions}
        loading={sessionsLoading}
        error={sessionsError}
        selectedSessionId={selectedSessionId}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        onCloseDrawer={closeSessionsSidebar}
      />
    ),
    [
      sessions,
      sessionsLoading,
      sessionsError,
      selectedSessionId,
      handleSelectSession,
      handleCreateSession,
      closeSessionsSidebar,
    ],
  )

  useEffect(() => {
    if (!shellSidebar) return undefined

    shellSidebar.setChatSidebarContent(sessionsSidebar)

    return () => {
      shellSidebar.setChatSidebarContent(null)
    }
  }, [shellSidebar, sessionsSidebar])

  const mergedEvents = useMemo(() => {
    const sessionLocalEvents = selectedSessionId ? localCommandEvents.get(selectedSessionId) || [] : []
    const sessionLocalMessageEvents = selectedSessionId ? localMessageEvents.get(selectedSessionId) || [] : []

    const serverUserMessageCounts = new Map<string, number>()
    events.forEach((event) => {
      if (event.eventType !== 'user_message' || !event.content) return
      serverUserMessageCounts.set(event.content, (serverUserMessageCounts.get(event.content) || 0) + 1)
    })

    const nextServerMessageOrdinals = new Map<string, number>()
    const orderedLocalMessageEvents = [...sessionLocalMessageEvents].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )

    const pendingMessageEvents = orderedLocalMessageEvents.filter((event) => {
      if (!event.content) return true

      const baselineServerMessageCount = getBaselineServerMessageCount(event)
      const serverEventCount = serverUserMessageCounts.get(event.content) || 0
      const nextServerMessageOrdinal = nextServerMessageOrdinals.get(event.content) || 1
      const matchingServerMessageOrdinal = Math.max(nextServerMessageOrdinal, baselineServerMessageCount + 1)

      if (matchingServerMessageOrdinal > serverEventCount) return true

      nextServerMessageOrdinals.set(event.content, matchingServerMessageOrdinal + 1)
      return false
    })

    const syntheticEvents: ConsoleTimelineEvent[] = []

    if (selectedSessionId) {
      pendingAssistantPlaceholders.forEach((placeholder, attemptId) => {
        if (placeholder.sessionId !== selectedSessionId) return
        syntheticEvents.push({
          eventId: `synthetic-placeholder-${attemptId}`,
          eventType: 'assistant_message',
          sessionId: selectedSessionId,
          timestamp: new Date(placeholder.timestamp).toISOString(),
          metadata: {
            assistantPlaceholder: true,
            attemptId,
          },
          actor: 'assistant',
        })
      })

      streamingDrafts.forEach((draft, attemptId) => {
        if (draft.sessionId !== selectedSessionId) return
        syntheticEvents.push({
          eventId: `synthetic-draft-${attemptId}`,
          eventType: 'assistant_message',
          sessionId: selectedSessionId,
          timestamp: new Date(draft.timestamp).toISOString(),
          content: draft.content,
          metadata: {
            streamingDraft: true,
            attemptId,
          },
          actor: 'assistant',
        })
      })
    }

    const allEvents = [...events, ...pendingMessageEvents, ...sessionLocalEvents, ...syntheticEvents]
    const dedupedEvents = allEvents.filter(
      (event, index) => allEvents.findIndex((candidate) => candidate.eventId === event.eventId) === index,
    )

    dedupedEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    if (!preferences.reasoningVisible) {
      return dedupedEvents.filter((event) => event.eventType !== 'thinking_summary')
    }

    return dedupedEvents
  }, [
    events,
    localCommandEvents,
    localMessageEvents,
    selectedSessionId,
    preferences.reasoningVisible,
    pendingAssistantPlaceholders,
    streamingDrafts,
  ])

  return (
    <div className={`session-console-rich ${isSessionsDrawerOpen ? 'session-console-rich--drawer-open' : ''}`}>
      {/* Mobile Drawer Backdrop */}
      {!shellSidebar && <MobileSessionDrawer isOpen={isSessionsDrawerOpen} onClose={closeSessionsSidebar} />}

      {/* Standalone fallback: AgentShell owns this sidebar in the routed app. */}
      {!shellSidebar && sessionsSidebar}

      {/* Main Content Area */}
      <main className="session-main">
        {!selectedSessionId ? (
          <SessionEmptyState onToggleSidebar={openSessionsSidebar} isDrawerOpen={isSessionsDrawerOpen} />
        ) : (
          <>
            <TimelinePanel
              sessionTitle={selectedSession?.title || `会话 ${selectedSessionId.slice(-8)}`}
              streamStatus={streamStatus}
              events={mergedEvents}
              loading={timelineLoading}
              error={timelineError || undefined}
              onRetryStream={handleRetryStream}
              onToggleSidebar={openSessionsSidebar}
              isDrawerOpen={isSessionsDrawerOpen}
            />

            {/* Error Display */}
            {sendError && (
              <div className="session-error" data-testid="session-error">
                {sendError}
              </div>
            )}

            {/* Processing Status Indicator */}
            <ProcessingStatus
              streamStatus={streamStatus}
              processingStatus={processingStatus}
              onRetry={handleRetryStream}
            />

            {/* Input Dock */}
            <ComposerDock
              value={draft}
              onChange={setDraft}
              onSend={handleSend}
              sending={sending}
              placeholder="输入消息或 /help 查看命令..."
            />
          </>
        )}
      </main>

      <ApprovalDecisionModal
        approval={pendingApproval}
        loading={submittingApproval}
        error={submitError}
        onReject={handleReject}
        onApproveOnce={handleApproveOnce}
        onApproveAlways={handleApproveAlways}
        onClose={handleCloseApprovalModal}
      />
    </div>
  )
}

export default SessionConsoleTab
