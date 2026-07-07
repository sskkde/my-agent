import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ChatShell from './ChatShell'
import ChatSessionList from './ChatSessionList'
import ChatMessageList from './ChatMessageList'
import ChatComposer, { type ChatComposerStatus } from './ChatComposer'
import ChatContextPanel from './ChatContextPanel'
import ChatToast from './ChatToast'
import './chat-theme.css'
import { useSessionList } from '../hooks/useSessionList'
import { useSelectedSession } from '../hooks/useSelectedSession'
import { useComposerSubmission } from '../hooks/useComposerSubmission'
import { useSSEStream } from '../hooks/useSSEStream'
import * as api from '../../../api/client'
import type { ConsoleTimelineEvent, ProcessingStatusPayload } from '../../../api/types'
import type { AssistantPlaceholder } from '../session-utils'
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
  // Bridge ref so useSessionList's onSessionCreated can call setSelectedSessionId
  // without forcing useSelectedSession to be declared before useSessionList.
  const setSelectedSessionIdRef = useRef<React.Dispatch<React.SetStateAction<string | null>> | null>(null)

  const { sessions, sessionsLoading, sessionsError, fetchSessions, handleCreateSession } = useSessionList({
    onSessionCreated: (sessionId: string) => setSelectedSessionIdRef.current?.(sessionId),
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

  setSelectedSessionIdRef.current = setSelectedSessionId

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
        return timelineResponse.events
      } catch {
        return null
      }
    },
    [],
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

  const mergedEvents: ConsoleTimelineEvent[] = events

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
