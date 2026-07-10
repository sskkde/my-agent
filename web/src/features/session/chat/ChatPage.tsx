import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import ChatShell from './ChatShell'
import ChatSessionList from './ChatSessionList'
import ChatMessageList from './ChatMessageList'
import ChatComposer, { type ChatComposerStatus } from './ChatComposer'
import ChatContextPanel from './ChatContextPanel'
import ChatToast, { showToast } from './ChatToast'
import './chat-theme.css'
import { useSessionList } from '../hooks/useSessionList'
import { useSelectedSession } from '../hooks/useSelectedSession'
import { useComposerSubmission } from '../hooks/useComposerSubmission'
import { useSSEStream } from '../hooks/useSSEStream'
import * as api from '../../../api/client'
import type { ConsoleSessionInfo, ConsoleTimelineEvent, ProcessingStatusPayload } from '../../../api/types'
import { getBaselineServerMessageCount, type AssistantPlaceholder } from '../session-utils'
import type { CommandContext } from '../../../commands/types'
import { safeRemoveLocalStorage } from '../session-migration'
import { SELECTED_SESSION_KEY } from '../session-constants'
import { useAuth } from '../../../context/AuthContext'

export interface ChatPageProps {
  initialSessionId?: string
}

const ACTIVE_PROCESSING_STAGES = new Set<ProcessingStatusPayload['stage']>([
  'receiving',
  'routing',
  'model_call',
  'tool_call',
  'streaming',
  'persisting',
])

const toComposerStatus = (
  processingStatus: ProcessingStatusPayload | null,
  streamStatus: 'connecting' | 'connected' | 'disconnected',
  sending: boolean,
): ChatComposerStatus => {
  if (processingStatus && ACTIVE_PROCESSING_STAGES.has(processingStatus.stage)) {
    if (processingStatus.stage === 'tool_call' || processingStatus.activeTools.some((tool) => tool.status === 'running')) {
      return 'tool'
    }
    if (processingStatus.stage === 'model_call' || processingStatus.stage === 'streaming') {
      return 'generating'
    }
    return 'thinking'
  }

  if (sending) return 'generating'
  if (streamStatus === 'connecting') return 'thinking'
  return 'idle'
}

const getContextUsagePercent = (processingStatus: ProcessingStatusPayload | null): number | null => {
  const usage = processingStatus?.contextUsage
  if (!usage?.maxContextTokens) return null
  return (usage.totalTokens / usage.maxContextTokens) * 100
}

const ChatPage: React.FC<ChatPageProps> = ({ initialSessionId }) => {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const handleSelectSessionRef = useRef<((sessionId: string) => void) | null>(null)

  const { sessions, sessionsLoading, sessionsError, fetchSessions, handleCreateSession } = useSessionList({
    onSessionCreated: (sessionId: string) => handleSelectSessionRef.current?.(sessionId),
  })

  const {
    selectedSessionId,
    setSelectedSessionId,
    selectedSession,
    setSelectedSession,
    selectedSessionIdRef,
    handleSelectSession,
  } = useSelectedSession({
    initialSessionId,
    navigate,
    validSessionIds: sessions.map((s) => s.sessionId),
  })

  handleSelectSessionRef.current = handleSelectSession

  const [archiveView, setArchiveView] = useState(false)
  const [archivedSessions, setArchivedSessions] = useState<ConsoleSessionInfo[]>([])
  const [archiveActionLoading, setArchiveActionLoading] = useState(false)

  const handleToggleArchiveView = useCallback(async () => {
    if (!archiveView) {
      try {
        setArchiveActionLoading(true)
        const response = await api.getSessions('archived', 50, 0)
        setArchivedSessions(response.sessions)
      } catch (err) {
        showToast('加载归档会话失败')
      } finally {
        setArchiveActionLoading(false)
      }
    }
    setArchiveView((prev) => !prev)
  }, [archiveView])

  const handleArchiveSession = useCallback(
    async (sessionId: string) => {
      try {
        setArchiveActionLoading(true)
        await api.updateSession(sessionId, { status: 'archived' })
        await fetchSessions(true)
        showToast('会话已归档')
      } catch (err) {
        showToast('归档失败')
      } finally {
        setArchiveActionLoading(false)
      }
    },
    [fetchSessions],
  )

  const handleRestoreSession = useCallback(
    async (sessionId: string) => {
      try {
        setArchiveActionLoading(true)
        await api.updateSession(sessionId, { status: 'active' })
        setArchivedSessions((prev) => prev.filter((s) => s.sessionId !== sessionId))
        await fetchSessions(true)
        showToast('会话已恢复')
      } catch (err) {
        showToast('恢复失败')
      } finally {
        setArchiveActionLoading(false)
      }
    },
    [fetchSessions],
  )

  const [events, setEvents] = useState<ConsoleTimelineEvent[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)

  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const updatePendingAssistantPlaceholders = useCallback(
    (updater: (prev: Map<string, AssistantPlaceholder>) => Map<string, AssistantPlaceholder>) => {
      // ChatPage does not render streaming placeholders; state is no-op.
      void updater
    },
    [],
  )

  const createAssistantPlaceholder = useCallback((sessionId: string) => {
    const attemptId = `placeholder-${Date.now()}-${Math.random().toString(36).slice(2)}`
    return { attemptId, placeholder: { sessionId, timestamp: Date.now() } }
  }, [])

  const resolveAssistantPlaceholder = useCallback(
    (currentAttemptId: string, resolvedAttemptId?: string) => {
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
    (attemptIds: Array<string | undefined>, _clearOldestIfUnmatched?: boolean, _sessionId?: string) => {
      const ids = attemptIds.filter((id): id is string => Boolean(id))
      if (ids.length === 0) return
      updatePendingAssistantPlaceholders((prev) => {
        const next = new Map(prev)
        for (const id of ids) next.delete(id)
        return next.size === prev.size ? prev : next
      })
    },
    [updatePendingAssistantPlaceholders],
  )

  const clearAssistantActivityForSession = useCallback(
    (sessionId: string) => {
      updatePendingAssistantPlaceholders((prev) => {
        const next = new Map(prev)
        for (const [id, placeholder] of next.entries()) {
          if (placeholder.sessionId === sessionId) next.delete(id)
        }
        return next.size === prev.size ? prev : next
      })
    },
    [updatePendingAssistantPlaceholders],
  )

  const fetchTimeline = useCallback(
    async (sessionId: string): Promise<ConsoleTimelineEvent[] | null> => {
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
      } catch {
        return null
      }
    },
    [selectedSessionIdRef],
  )

  const createCommandContext = useCallback((): CommandContext => {
    return {
      sessionId: selectedSessionId,
      setSelectedSessionId,
      refreshSessions: async () => fetchSessions(true),
      setActiveTab: () => {},
      refreshProviders: async () => {},
      auth: { isAuthenticated: true, logout: () => {} },
      api: {
        get: async () => ({}),
        post: async () => ({}),
        put: async () => ({}),
        delete: async () => ({}),
      },
    }
  }, [selectedSessionId, setSelectedSessionId, fetchSessions])

  const {
    draft,
    setDraft,
    sending,
    sendError,
    clearPostSendPollTimeout,
    selectedFiles,
    setSelectedFiles,
    handleFilesSelected,
    uploadErrors,
    isUploading,
    handleSend,
    localMessageEvents,
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

  const {
    streamStatus,
    processingStatus,
    connectSse,
    resetStreamStatus,
    disconnectSse,
  } = useSSEStream({
    mountedRef,
    selectedSessionIdRef,
    onEvent: (event: ConsoleTimelineEvent) => {
      setEvents((prev) => {
        if (prev.some((e) => e.eventId === event.eventId)) return prev
        return [...prev, event]
      })
      if (['user_message', 'assistant_message', 'error'].includes(event.eventType)) {
        fetchSessions(true)
      }
    },
    onToken: () => {},
  })

  useEffect(() => {
    return () => {
      clearPostSendPollTimeout()
    }
  }, [clearPostSendPollTimeout])

  useEffect(() => {
    if (!selectedSessionId) {
      setEvents([])
      setTimelineError(null)
      disconnectSse()
      resetStreamStatus()
      return
    }

    let cancelled = false
    const load = async () => {
      try {
        setTimelineLoading(true)
        setTimelineError(null)
        const sessionResponse = await api.getSession(selectedSessionId)
        if (cancelled || selectedSessionIdRef.current !== selectedSessionId) return
        setSelectedSession({
          ...sessionResponse.session,
          title: `Session ${sessionResponse.session.sessionId.slice(-8)}`,
          status: 'active',
          createdAt: sessionResponse.session.lastActivityAt,
          updatedAt: sessionResponse.session.lastActivityAt,
        })
        const timelineResponse = await api.getSessionTimeline(selectedSessionId)
        if (cancelled || selectedSessionIdRef.current !== selectedSessionId) return
        setEvents(timelineResponse.events)
        connectSse(selectedSessionId)
      } catch (err) {
        if (!cancelled && selectedSessionIdRef.current === selectedSessionId) {
          const isMissingSession = err instanceof api.ApiClientError && ['FORBIDDEN', 'NOT_FOUND'].includes(err.code)
          if (isMissingSession) {
            setSelectedSessionId(null)
            safeRemoveLocalStorage(SELECTED_SESSION_KEY)
          }
          setTimelineError(err instanceof Error ? err.message : 'Failed to load timeline')
        }
      } finally {
        if (!cancelled && selectedSessionIdRef.current === selectedSessionId) {
          setTimelineLoading(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
      disconnectSse()
    }
  }, [selectedSessionId, selectedSessionIdRef, setSelectedSession, setSelectedSessionId, connectSse, disconnectSse, resetStreamStatus])

  const mergedEvents = useMemo<ConsoleTimelineEvent[]>(() => {
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
      if (!event.content) return false

      const baselineServerMessageCount = getBaselineServerMessageCount(event)
      const serverEventCount = serverUserMessageCounts.get(event.content) || 0
      const nextServerMessageOrdinal = nextServerMessageOrdinals.get(event.content) || 1
      const matchingServerMessageOrdinal = Math.max(nextServerMessageOrdinal, baselineServerMessageCount + 1)

      if (matchingServerMessageOrdinal > serverEventCount) return true

      nextServerMessageOrdinals.set(event.content, matchingServerMessageOrdinal + 1)
      return false
    })

    const allEvents = [...events, ...pendingMessageEvents]
    allEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return allEvents
  }, [events, localMessageEvents, selectedSessionId])

  const currentProcessingStatus =
    processingStatus && processingStatus.sessionId === selectedSessionId ? processingStatus : null
  const status = toComposerStatus(currentProcessingStatus, streamStatus, sending)
  const model = currentProcessingStatus?.model || 'GLM-4.6'
  const ctxUsage = getContextUsagePercent(currentProcessingStatus) ?? Math.min(98, 12 + events.length * 2)

  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles((files) => files.filter((_, i) => i !== index))
  }, [setSelectedFiles])

  return (
    <>
      <ChatShell
        title={selectedSession?.title || 'My Agent'}
        user={user}
        onLogout={logout}
        sidebar={
          <ChatSessionList
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            loading={sessionsLoading}
            error={sessionsError}
            archiveView={archiveView}
            archivedSessions={archivedSessions}
            onToggleArchiveView={handleToggleArchiveView}
            onArchiveSession={handleArchiveSession}
            onRestoreSession={handleRestoreSession}
            archiveActionLoading={archiveActionLoading}
          />
        }
        rightPanel={<ChatContextPanel sessionId={selectedSessionId} />}
      >
        <ChatMessageList
          events={mergedEvents}
          loading={timelineLoading || sending}
          error={timelineError || sendError || undefined}
          onPromptSelect={setDraft}
          onRetryStream={() => {
            if (selectedSessionId) connectSse(selectedSessionId)
          }}
        />
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSend={handleSend}
          sending={sending}
          model={model}
          status={status}
          statusLabel={currentProcessingStatus?.stageLabel}
          ctxUsage={ctxUsage}
          selectedFiles={selectedFiles}
          onFilesSelected={handleFilesSelected}
          onRemoveFile={handleRemoveFile}
          uploadErrors={uploadErrors}
          isUploading={isUploading}
        />
      </ChatShell>
      <ChatToast />
    </>
  )
}

export default ChatPage
