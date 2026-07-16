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
import type { ConsoleSessionInfo, ConsoleTimelineEvent, ModelsResponse, ProcessingStatusPayload, TokenStreamPayload } from '../../../api/types'
import { getBaselineServerMessageCount, type AssistantPlaceholder, type StreamingDraft } from '../session-utils'
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

const getContextUsage = (processingStatus: ProcessingStatusPayload | null): { totalTokens: number; maxContextTokens?: number } | null => {
  const usage = processingStatus?.contextUsage
  if (!usage) return null
  return { totalTokens: usage.totalTokens, maxContextTokens: usage.maxContextTokens }
}

const ChatPage: React.FC<ChatPageProps> = ({ initialSessionId }) => {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const handleSelectSessionRef = useRef<((sessionId: string) => void) | null>(null)
  const fetchingModelsForSessionRef = useRef<string | null>(null)

  const {
    sessions,
    sessionsLoading,
    sessionsError,
    fetchSessions,
    scheduleSessionRefresh,
    handleCreateSession,
  } = useSessionList({
    onSessionCreated: (sessionId: string) => handleSelectSessionRef.current?.(sessionId),
  })

  /** Updated by useSSEStream effect; post-send poll reads this for SSE-first policy. */
  const streamStatusRef = React.useRef<'connecting' | 'connected' | 'disconnected'>('disconnected')

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

  const [agentModel, setAgentModel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getAgentConfig('foreground.default')
      .then((config) => {
        if (!cancelled && config.effective?.model) {
          setAgentModel(config.effective.model)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const [archiveView, setArchiveView] = useState(false)
  const [archivedSessions, setArchivedSessions] = useState<ConsoleSessionInfo[]>([])
  const [archiveActionLoading, setArchiveActionLoading] = useState(false)

  const [modelsCache, setModelsCache] = useState<Record<string, ModelsResponse>>({})
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [selectedSessionModel, setSelectedSessionModel] = useState<string | undefined>(undefined)
  const [reasoningDepth, setReasoningDepth] = useState<import('../../../api/types').ReasoningDepth>('off')
  const [reasoningDepthOpen, setReasoningDepthOpen] = useState(false)
  const [switchingReasoningDepth, setSwitchingReasoningDepth] = useState(false)
  const [switchingModel, setSwitchingModel] = useState(false)

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
        // If the archived session is the currently selected one, jump back to the
        // welcome page so the user is not left viewing an archived conversation.
        // ChatRouteContent re-derives the session from URL + localStorage, so we
        // must clear both state and localStorage and update the URL together.
        if (selectedSessionIdRef.current === sessionId) {
          setSelectedSessionId(null)
          safeRemoveLocalStorage(SELECTED_SESSION_KEY)
          navigate('/chat')
        }
        showToast('会话已归档')
      } catch (err) {
        showToast('归档失败')
      } finally {
        setArchiveActionLoading(false)
      }
    },
    [fetchSessions, selectedSessionIdRef, setSelectedSessionId, navigate],
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

  useEffect(() => {
    setModelSelectorOpen(false)
    setReasoningDepthOpen(false)
    setModelsError(null)
    setSelectedSessionModel(undefined)
    setReasoningDepth('off')
  }, [selectedSessionId])

  // Load session model + reasoning depth when session is selected or model picker opens.
  useEffect(() => {
    if (!selectedSessionId) return

    const cached = modelsCache[selectedSessionId]
    if (cached) {
      setSelectedSessionModel(cached.selectedModel ?? undefined)
      setReasoningDepth(cached.reasoningDepth ?? 'off')
      // Still allow re-fetch when opening picker with no providers cached? keep cache hit return
      return
    }
    if (fetchingModelsForSessionRef.current === selectedSessionId) return

    fetchingModelsForSessionRef.current = selectedSessionId
    if (modelSelectorOpen) {
      setModelsLoading(true)
      setModelsError(null)
    }

    let cancelled = false
    const load = async () => {
      try {
        const data = await api.getModels(selectedSessionId)
        if (cancelled) return
        setModelsCache((prev) => ({ ...prev, [selectedSessionId]: data }))
        setSelectedSessionModel(data.selectedModel ?? undefined)
        setReasoningDepth(data.reasoningDepth ?? 'off')
      } catch (err) {
        if (cancelled) return
        const message = err instanceof api.ApiClientError ? err.message : '加载模型列表失败'
        if (modelSelectorOpen) setModelsError(message)
      } finally {
        if (!cancelled) setModelsLoading(false)
        if (fetchingModelsForSessionRef.current === selectedSessionId) {
          fetchingModelsForSessionRef.current = null
        }
      }
    }

    load()
    return () => {
      cancelled = true
      if (fetchingModelsForSessionRef.current === selectedSessionId) {
        fetchingModelsForSessionRef.current = null
      }
    }
  }, [modelSelectorOpen, selectedSessionId, modelsCache])

  const handleModelSelect = useCallback(
    async (providerId: string, model: string) => {
      if (!selectedSessionId) return
      setSwitchingModel(true)
      try {
        await api.setSessionModel(selectedSessionId, { providerId, model })
        setSelectedSessionModel(model)
        setModelsCache((prev) => {
          const existing = prev[selectedSessionId]
          if (!existing) return prev
          return {
            ...prev,
            [selectedSessionId]: { ...existing, selectedModel: model, selectedProviderId: providerId },
          }
        })
        setModelSelectorOpen(false)
      } catch (err) {
        const message = err instanceof api.ApiClientError ? err.message : '切换模型失败'
        showToast(message)
      } finally {
        setSwitchingModel(false)
      }
    },
    [selectedSessionId],
  )

  const handleReasoningDepthSelect = useCallback(
    async (depth: import('../../../api/types').ReasoningDepth) => {
      if (!selectedSessionId) return
      setSwitchingReasoningDepth(true)
      try {
        await api.setSessionReasoningDepth(selectedSessionId, { reasoningDepth: depth })
        setReasoningDepth(depth)
        setModelsCache((prev) => {
          const existing = prev[selectedSessionId]
          if (!existing) return prev
          return {
            ...prev,
            [selectedSessionId]: { ...existing, reasoningDepth: depth },
          }
        })
        setReasoningDepthOpen(false)
      } catch (err) {
        const message = err instanceof api.ApiClientError ? err.message : '切换推理深度失败'
        showToast(message)
      } finally {
        setSwitchingReasoningDepth(false)
      }
    },
    [selectedSessionId],
  )

  const [events, setEvents] = useState<ConsoleTimelineEvent[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [streamingDrafts, setStreamingDrafts] = useState<Map<string, StreamingDraft>>(new Map())
  const [pendingAssistantPlaceholders, setPendingAssistantPlaceholders] = useState<Map<string, AssistantPlaceholder>>(new Map())

  const mountedRef = useRef(true)
  const pendingAssistantPlaceholdersRef = useRef(pendingAssistantPlaceholders)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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
      setStreamingDrafts((prev) => {
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
      sessionId: selectedSessionIdRef.current,
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
  }, [selectedSessionIdRef, setSelectedSessionId, fetchSessions])

  const handleSessionRequired = useCallback(async () => {
    const sessionId = await handleCreateSession()
    return sessionId
  }, [handleCreateSession])

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
      getStreamStatus: () => streamStatusRef.current,
      createCommandContext,
      onSessionRequired: handleSessionRequired,
    },
  })

  const {
    streamStatus,
    processingStatus,
    lastProcessingStatus,
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
        scheduleSessionRefresh()
      }
      if (['assistant_message', 'error'].includes(event.eventType)) {
        const attemptId = typeof event.metadata?.attemptId === 'string' ? event.metadata.attemptId : undefined
        const turnId = typeof event.metadata?.turnId === 'string' ? event.metadata.turnId : undefined
        clearAssistantActivity([attemptId, turnId], true)
      }
    },
    onToken: (token: TokenStreamPayload) => {
      if (!mountedRef.current) return
      if (selectedSessionIdRef.current !== token.sessionId) return

      const placeholderTimestamp =
        pendingAssistantPlaceholdersRef.current.get(token.attemptId)?.timestamp ??
        Array.from(pendingAssistantPlaceholdersRef.current.entries()).find(
          ([, p]) => p.sessionId === token.sessionId,
        )?.[1].timestamp
      const placeholderIdToClear = pendingAssistantPlaceholdersRef.current.has(token.attemptId)
        ? token.attemptId
        : Array.from(pendingAssistantPlaceholdersRef.current.entries()).find(
            ([, p]) => p.sessionId === token.sessionId,
          )?.[0]

      if (placeholderIdToClear) {
        updatePendingAssistantPlaceholders((prev) => {
          const next = new Map(prev)
          next.delete(placeholderIdToClear)
          return next
        })
      }

      setStreamingDrafts((prev) => {
        const existing = prev.get(token.attemptId)
        if (existing && token.sequence <= existing.sequence) return prev
        const next = new Map(prev)
        next.set(token.attemptId, {
          sessionId: token.sessionId,
          content: (existing?.content || '') + token.delta,
          sequence: token.sequence,
          timestamp: existing?.timestamp ?? placeholderTimestamp ?? Date.now(),
        })
        return next
      })
    },
  })

  useEffect(() => {
    streamStatusRef.current = streamStatus
  }, [streamStatus])

  useEffect(() => {
    return () => {
      clearPostSendPollTimeout()
    }
  }, [clearPostSendPollTimeout])

  useEffect(() => {
    pendingAssistantPlaceholdersRef.current = pendingAssistantPlaceholders
  }, [pendingAssistantPlaceholders])

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

    const syntheticEvents: ConsoleTimelineEvent[] = []
    if (selectedSessionId) {
      pendingAssistantPlaceholders.forEach((placeholder, attemptId) => {
        if (placeholder.sessionId !== selectedSessionId) return
        syntheticEvents.push({
          eventId: `synthetic-placeholder-${attemptId}`,
          eventType: 'assistant_message',
          sessionId: selectedSessionId,
          timestamp: new Date(placeholder.timestamp).toISOString(),
          metadata: { assistantPlaceholder: true, attemptId },
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
          metadata: { streamingDraft: true, attemptId },
          actor: 'assistant',
        })
      })
    }

    const allEvents = [...events, ...pendingMessageEvents, ...syntheticEvents]
    const dedupedEvents = allEvents.filter(
      (event, index) => allEvents.findIndex((candidate) => candidate.eventId === event.eventId) === index,
    )
    dedupedEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return dedupedEvents
  }, [events, localMessageEvents, selectedSessionId, pendingAssistantPlaceholders, streamingDrafts])

  const currentProcessingStatus =
    processingStatus && processingStatus.sessionId === selectedSessionId ? processingStatus : null
  const lastStatusForSession =
    lastProcessingStatus && lastProcessingStatus.sessionId === selectedSessionId ? lastProcessingStatus : null
  const status = toComposerStatus(currentProcessingStatus, streamStatus, sending)
  const isProcessingActive = Boolean(
    currentProcessingStatus && ACTIVE_PROCESSING_STAGES.has(currentProcessingStatus.stage),
  )
  const model = selectedSessionId
    ? (isProcessingActive
      ? (currentProcessingStatus?.model || selectedSessionModel || agentModel || '无')
      : (selectedSessionModel || currentProcessingStatus?.model || agentModel || '无'))
    : '无'
  const ctxUsage = selectedSessionId
    ? getContextUsage(currentProcessingStatus) ?? getContextUsage(lastStatusForSession)
    : null

  const modelSelectorDisabled =
    sending || Boolean(currentProcessingStatus && ACTIVE_PROCESSING_STAGES.has(currentProcessingStatus.stage))

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
          sessionId={selectedSessionId}
          modelSelectorOpen={modelSelectorOpen}
          modelSelectorDisabled={modelSelectorDisabled || switchingModel}
          modelsData={selectedSessionId ? modelsCache[selectedSessionId] : undefined}
          modelsLoading={modelsLoading}
          modelsError={modelsError}
          selectedSessionModel={selectedSessionModel}
          onModelSelectorOpen={() => {
            setReasoningDepthOpen(false)
            setModelSelectorOpen(true)
          }}
          onModelSelectorClose={() => setModelSelectorOpen(false)}
          onModelSelect={handleModelSelect}
          reasoningDepth={reasoningDepth}
          reasoningDepthOpen={reasoningDepthOpen}
          reasoningDepthDisabled={modelSelectorDisabled || switchingReasoningDepth}
          onReasoningDepthOpen={() => {
            setModelSelectorOpen(false)
            setReasoningDepthOpen(true)
          }}
          onReasoningDepthClose={() => setReasoningDepthOpen(false)}
          onReasoningDepthSelect={handleReasoningDepthSelect}
        />
      </ChatShell>
      <ChatToast />
    </>
  )
}

export default ChatPage
