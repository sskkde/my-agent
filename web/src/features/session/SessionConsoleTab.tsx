import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import * as api from '../../api/client'
import { TimelineList } from '../../components/timeline/TimelineList'
import type {
  ConsoleSessionInfo,
  ConsoleTimelineEvent,
  CreateProviderRequest,
  UpdateProviderRequest,
} from '../../api/types'
import type { TabId } from '../../components/TabNav'
import LoadingSpinner from '../../components/LoadingSpinner'
import ComposerDock from '../../components/ComposerDock'

import { executeCommand } from '../../commands/executor'
import { parseInput, isCommand } from '../../commands/parser'
import { createCommandEvent } from '../../commands/formatters'
import { loadPreferences } from '../../commands/preferences'
import type { CommandContext, AuthContext } from '../../commands/types'
import { ProcessingStatus } from './ProcessingStatus'
import type { ProcessingStatusPayload } from '../../api/types'

type StreamStatus = 'connecting' | 'connected' | 'disconnected'

const LOCAL_USER_MESSAGE_PREFIX = 'local-user-message'
const SELECTED_SESSION_KEY = 'session-console-selected-session'
const SSE_RECONNECT_BASE_DELAY_MS = 1000
const SSE_RECONNECT_MAX_DELAY_MS = 30000
const POST_SEND_POLL_MAX_ATTEMPTS = 30
const POST_SEND_POLL_INTERVAL_MS = 1000

interface AssistantPlaceholder {
  sessionId: string
  timestamp: number
}

interface StreamingDraft {
  sessionId: string
  content: string
  sequence: number
  timestamp: number
}

const createLocalUserMessageEvent = (
  sessionId: string,
  content: string,
  baselineServerMessageCount: number,
): ConsoleTimelineEvent => ({
  eventId: `${LOCAL_USER_MESSAGE_PREFIX}-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  eventType: 'user_message',
  sessionId,
  timestamp: new Date().toISOString(),
  content,
  metadata: {
    localOnly: true,
    status: 'pending',
    baselineServerMessageCount,
  },
  actor: 'user',
})

const countServerUserMessagesByContent = (events: ConsoleTimelineEvent[], content: string): number =>
  events.filter((event) => event.eventType === 'user_message' && event.content === content).length

const getBaselineServerMessageCount = (event: ConsoleTimelineEvent): number => {
  const value = event.metadata?.baselineServerMessageCount
  return typeof value === 'number' ? value : 0
}

const isLocalMessageConfirmed = (serverEvents: ConsoleTimelineEvent[], localEvent: ConsoleTimelineEvent): boolean => {
  if (!localEvent.content) return false
  return countServerUserMessagesByContent(serverEvents, localEvent.content) > getBaselineServerMessageCount(localEvent)
}

const hasAssistantOrErrorReplyAfter = (
  serverEvents: ConsoleTimelineEvent[],
  localEvent: ConsoleTimelineEvent,
): boolean => {
  const sentAt = new Date(localEvent.timestamp).getTime()
  return serverEvents.some((event) => {
    if (!['assistant_message', 'error'].includes(event.eventType)) return false
    return new Date(event.timestamp).getTime() >= sentAt
  })
}

interface SessionConsoleTabProps {
  setActiveTab?: (tabId: TabId) => void
  auth?: AuthContext
}

const SessionConsoleTab: React.FC<SessionConsoleTabProps> = ({ setActiveTab, auth }) => {
  const [sessions, setSessions] = useState<ConsoleSessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_SESSION_KEY)
    } catch {
      return null
    }
  })
  const [selectedSession, setSelectedSession] = useState<ConsoleSessionInfo | null>(null)

  const [events, setEvents] = useState<ConsoleTimelineEvent[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('disconnected')

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const [localCommandEvents, setLocalCommandEvents] = useState<Map<string, ConsoleTimelineEvent[]>>(new Map())
  const [localMessageEvents, setLocalMessageEvents] = useState<Map<string, ConsoleTimelineEvent[]>>(new Map())
  const [streamingDrafts, setStreamingDrafts] = useState<Map<string, StreamingDraft>>(new Map())
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatusPayload | null>(null)
  const [pendingAssistantPlaceholders, setPendingAssistantPlaceholders] = useState<Map<string, AssistantPlaceholder>>(
    new Map(),
  )

  // Mobile drawer state
  const [isSessionsDrawerOpen, setIsSessionsDrawerOpen] = useState(false)

  const preferences = useMemo(() => loadPreferences(), [])

  const mountedRef = useRef(true)
  const sseReconnectAttemptsRef = useRef(0)
  const sseReconnectTimeoutRef = useRef<number | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const postSendPollAttemptsRef = useRef(0)
  const postSendPollTimeoutRef = useRef<number | null>(null)
  const selectedSessionIdRef = useRef<string | null>(selectedSessionId)
  const sessionRefreshTimeoutRef = useRef<number | null>(null)
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

  const clearSseReconnectTimeout = useCallback(() => {
    if (sseReconnectTimeoutRef.current !== null) {
      clearTimeout(sseReconnectTimeoutRef.current)
      sseReconnectTimeoutRef.current = null
    }
  }, [])

  const clearPostSendPollTimeout = useCallback(() => {
    if (postSendPollTimeoutRef.current !== null) {
      clearTimeout(postSendPollTimeoutRef.current)
      postSendPollTimeoutRef.current = null
    }
  }, [])

  const clearSessionRefreshTimeout = useCallback(() => {
    if (sessionRefreshTimeoutRef.current !== null) {
      clearTimeout(sessionRefreshTimeoutRef.current)
      sessionRefreshTimeoutRef.current = null
    }
  }, [])

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

  const fetchSessions = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setSessionsError(null)
      } else {
        setSessionsLoading(true)
      }
      const response = await api.getSessions()
      if (mountedRef.current) {
        setSessions(response.sessions)
      }
    } catch (err) {
      if (mountedRef.current) {
        setSessionsError(err instanceof Error ? err.message : 'Failed to load sessions')
      }
    } finally {
      if (mountedRef.current) {
        setSessionsLoading(false)
      }
    }
  }, [])

  const scheduleSessionRefresh = useCallback(() => {
    if (sessionRefreshTimeoutRef.current !== null) return
    sessionRefreshTimeoutRef.current = window.setTimeout(() => {
      sessionRefreshTimeoutRef.current = null
      fetchSessions(true)
    }, 250)
  }, [fetchSessions])

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

  const startPostSendPoll = useCallback(
    (sessionId: string, localEvent: ConsoleTimelineEvent) => {
      clearPostSendPollTimeout()
      postSendPollAttemptsRef.current = 0

      const poll = async () => {
        if (
          !mountedRef.current ||
          selectedSessionIdRef.current !== sessionId ||
          postSendPollAttemptsRef.current >= POST_SEND_POLL_MAX_ATTEMPTS
        ) {
          return
        }

        postSendPollAttemptsRef.current += 1
        const serverEvents = await fetchTimeline(sessionId)
        await fetchSessions(true)

        if (
          serverEvents &&
          mountedRef.current &&
          selectedSessionIdRef.current === sessionId &&
          isLocalMessageConfirmed(serverEvents, localEvent) &&
          hasAssistantOrErrorReplyAfter(serverEvents, localEvent)
        ) {
          clearAssistantActivityForSession(sessionId)
          return
        }

        if (mountedRef.current && selectedSessionIdRef.current === sessionId) {
          postSendPollTimeoutRef.current = window.setTimeout(poll, POST_SEND_POLL_INTERVAL_MS)
        }
      }

      postSendPollTimeoutRef.current = window.setTimeout(poll, POST_SEND_POLL_INTERVAL_MS)
    },
    [clearPostSendPollTimeout, clearAssistantActivityForSession, fetchSessions, fetchTimeline],
  )

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

          setEvents((prev) => {
            if (prev.some((e) => e.eventId === event.eventId)) {
              return prev
            }
            return [...prev, event]
          })

          sseReconnectAttemptsRef.current = 0

          if (['user_message', 'assistant_message', 'error'].includes(event.eventType)) {
            scheduleSessionRefresh()
          }

          if (['assistant_message', 'error'].includes(event.eventType)) {
            const attemptId = typeof event.metadata?.attemptId === 'string' ? event.metadata.attemptId : undefined
            const turnId = typeof event.metadata?.turnId === 'string' ? event.metadata.turnId : undefined
            clearAssistantActivity([attemptId, turnId], true)
          }
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
      )

      setStreamStatus('connected')
    },
    [clearAssistantActivity, scheduleSessionRefresh, updatePendingAssistantPlaceholders],
  )

  useEffect(() => {
    mountedRef.current = true
    fetchSessions()

    return () => {
      mountedRef.current = false
      clearSseReconnectTimeout()
      clearPostSendPollTimeout()
      clearSessionRefreshTimeout()
      setPendingAssistantPlaceholders(new Map())
      pendingAssistantPlaceholdersRef.current = new Map()
      setStreamingDrafts(new Map())
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
      }
    }
  }, [fetchSessions, clearSseReconnectTimeout, clearPostSendPollTimeout, clearSessionRefreshTimeout])

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])

  useEffect(() => {
    pendingAssistantPlaceholdersRef.current = pendingAssistantPlaceholders
  }, [pendingAssistantPlaceholders])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        fetchSessions(true)
        if (selectedSessionId) {
          fetchTimeline(selectedSessionId)
          if (streamStatus === 'disconnected') {
            sseReconnectAttemptsRef.current = 0
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
          if (streamStatus === 'disconnected') {
            sseReconnectAttemptsRef.current = 0
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
          if (streamStatus === 'disconnected') {
            sseReconnectAttemptsRef.current = 0
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
  }, [connectSse, fetchSessions, fetchTimeline, selectedSessionId, streamStatus])

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

  useEffect(() => {
    if (!selectedSessionId) {
      setSelectedSession(null)
      setEvents([])
      setTimelineError(null)
      setStreamStatus('disconnected')
      clearSseReconnectTimeout()
      clearPostSendPollTimeout()
      clearSessionRefreshTimeout()
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
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
          setStreamStatus('disconnected')
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
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [
    selectedSessionId,
    connectSse,
    clearSseReconnectTimeout,
    clearPostSendPollTimeout,
    clearSessionRefreshTimeout,
    clearAssistantActivityForSession,
  ])

  const handleCreateSession = async () => {
    try {
      const response = await api.createSession()
      const newSession: ConsoleSessionInfo = {
        ...response.session,
        title: `Session ${response.session.sessionId.slice(-8)}`,
        status: 'active',
        createdAt: response.session.lastActivityAt,
        updatedAt: response.session.lastActivityAt,
      }
      setSessions((prev) => [newSession, ...prev])
      setSelectedSessionId(newSession.sessionId)
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to create session')
    }
  }

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId)
    setDraft('')
    setSendError(null)
    // Close mobile drawer when selecting a session
    setIsSessionsDrawerOpen(false)
  }, [])

  const refreshSessions = useCallback(async () => {
    await fetchSessions(true)
  }, [fetchSessions])

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

  const addLocalCommandEvent = useCallback((sessionId: string, event: ConsoleTimelineEvent) => {
    setLocalCommandEvents((prev) => {
      const newMap = new Map(prev)
      const existingEvents = newMap.get(sessionId) || []
      newMap.set(sessionId, [...existingEvents, event])
      return newMap
    })
  }, [])

  const addLocalMessageEvent = useCallback(
    (sessionId: string, content: string): ConsoleTimelineEvent => {
      const baselineServerMessageCount = countServerUserMessagesByContent(events, content)
      const event = createLocalUserMessageEvent(sessionId, content, baselineServerMessageCount)
      setLocalMessageEvents((prev) => {
        const newMap = new Map(prev)
        const existingEvents = newMap.get(sessionId) || []
        newMap.set(sessionId, [...existingEvents, event])
        return newMap
      })
      return event
    },
    [events],
  )

  const removeLocalMessageEvent = useCallback((sessionId: string, eventId: string) => {
    setLocalMessageEvents((prev) => {
      const existingEvents = prev.get(sessionId)
      if (!existingEvents) return prev

      const remainingEvents = existingEvents.filter((event) => event.eventId !== eventId)
      const newMap = new Map(prev)
      if (remainingEvents.length > 0) {
        newMap.set(sessionId, remainingEvents)
      } else {
        newMap.delete(sessionId)
      }
      return newMap
    })
  }, [])

  const handleSend = async () => {
    if (!selectedSessionId || !draft.trim() || sending) return

    const trimmedDraft = draft.trim()

    if (trimmedDraft.startsWith('//')) {
      const escapedText = trimmedDraft.slice(2)
      setSending(true)
      setSendError(null)
      const localEvent = addLocalMessageEvent(selectedSessionId, escapedText)
      const { attemptId: placeholderAttemptId, placeholder } = createAssistantPlaceholder(selectedSessionId)
      updatePendingAssistantPlaceholders((prev) => {
        const next = new Map(prev)
        next.set(placeholderAttemptId, placeholder)
        return next
      })

      try {
        const response = await api.sendMessage(selectedSessionId, escapedText)
        setDraft('')
        resolveAssistantPlaceholder(placeholderAttemptId, response.correlationId)
        startPostSendPoll(selectedSessionId, localEvent)
      } catch (err) {
        removeLocalMessageEvent(selectedSessionId, localEvent.eventId)
        setSendError(err instanceof Error ? err.message : 'Failed to send message')
        clearAssistantActivity([placeholderAttemptId])
      } finally {
        setSending(false)
      }
      return
    }

    if (isCommand(trimmedDraft)) {
      setSending(true)
      setSendError(null)

      try {
        const parseResult = parseInput(trimmedDraft)

        if (parseResult.isCommand && parseResult.parsed) {
          const context = createCommandContext()
          const result = await executeCommand(parseResult.parsed, context)

          const commandEvent = createCommandEvent(result, selectedSessionId)
          addLocalCommandEvent(selectedSessionId, commandEvent)

          setDraft('')
        }
      } catch (err) {
        setSendError(err instanceof Error ? err.message : 'Command execution failed')
      } finally {
        setSending(false)
      }
      return
    }

    setSending(true)
    setSendError(null)
    const localEvent = addLocalMessageEvent(selectedSessionId, trimmedDraft)

    const { attemptId: placeholderAttemptId, placeholder } = createAssistantPlaceholder(selectedSessionId)
    updatePendingAssistantPlaceholders((prev) => {
      const next = new Map(prev)
      next.set(placeholderAttemptId, placeholder)
      return next
    })

    try {
      const response = await api.sendMessage(selectedSessionId, trimmedDraft)
      setDraft('')

      resolveAssistantPlaceholder(placeholderAttemptId, response.correlationId)

      startPostSendPoll(selectedSessionId, localEvent)
    } catch (err) {
      removeLocalMessageEvent(selectedSessionId, localEvent.eventId)
      setSendError(err instanceof Error ? err.message : 'Failed to send message')
      clearAssistantActivity([placeholderAttemptId])
    } finally {
      setSending(false)
    }
  }

  const handleRetryStream = useCallback(() => {
    if (selectedSessionId) {
      sseReconnectAttemptsRef.current = 0
      connectSse(selectedSessionId)
    }
  }, [selectedSessionId, connectSse])

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

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

    // Create synthetic events for assistant placeholders and streaming drafts
    const syntheticEvents: ConsoleTimelineEvent[] = []

    // Add assistant placeholders
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

      // Add streaming drafts
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

  const renderStreamStatus = () => {
    const statusText = streamStatus === 'connected' ? '已连接' : streamStatus === 'connecting' ? '连接中...' : '已断开'
    const statusClass =
      streamStatus === 'connected'
        ? 'stream-status-connected'
        : streamStatus === 'connecting'
          ? 'stream-status-connecting'
          : 'stream-status-disconnected'

    return (
      <div className="stream-status-indicator" data-testid="session-timeline-stream-status">
        <span className={`stream-status-badge ${statusClass}`}>{statusText}</span>
        {streamStatus === 'disconnected' && (
          <button className="stream-retry-button" onClick={handleRetryStream}>
            重试
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`session-console-rich ${isSessionsDrawerOpen ? 'session-console-rich--drawer-open' : ''}`}>
      {/* Mobile Drawer Backdrop */}
      {isSessionsDrawerOpen && (
        <div
          className="session-sidebar-backdrop"
          data-testid="session-sidebar-backdrop"
          onClick={() => setIsSessionsDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sessions List Sidebar */}
      <aside className="sessions-sidebar" data-testid="sessions-sidebar">
        <div className="sessions-sidebar-header">
          <h3>会话列表</h3>
          {/* Mobile close button */}
          <button
            className="session-sidebar-close"
            data-testid="session-sidebar-close"
            onClick={() => setIsSessionsDrawerOpen(false)}
            aria-label="关闭会话列表"
          >
            ✕
          </button>
          <button
            className="session-new-button"
            data-testid="session-new-button"
            onClick={handleCreateSession}
            disabled={sessionsLoading}
          >
            新建会话
          </button>
        </div>

        {sessionsLoading && <LoadingSpinner size="small" label="加载会话列表..." />}

        {sessionsError && <div className="sessions-error">{sessionsError}</div>}

        {!sessionsLoading && !sessionsError && (
          <div className="sessions-list" data-testid="sessions-list">
            {sessions.length === 0 ? (
              <div className="sessions-empty">
                <p>暂无会话</p>
                <p>点击上方按钮创建新会话</p>
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.sessionId}
                  className={`session-item ${selectedSessionId === session.sessionId ? 'session-item--selected' : ''}`}
                  data-testid={`session-item-${session.sessionId}`}
                  onClick={() => handleSelectSession(session.sessionId)}
                >
                  <div className="session-item-title">{session.title || `会话 ${session.sessionId.slice(-8)}`}</div>
                  <div className="session-item-meta">
                    <span className="session-item-count">{session.messageCount} 消息</span>
                    <span className="session-item-time">{formatDate(session.lastActivityAt)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="session-main">
        {!selectedSessionId ? (
          <>
            {/* Mobile session sidebar toggle for empty state */}
            <div className="timeline-header timeline-header--empty">
              <button
                className="session-sidebar-toggle"
                data-testid="session-sidebar-toggle"
                onClick={() => setIsSessionsDrawerOpen(true)}
                aria-controls="sessions-sidebar"
                aria-label="打开会话列表"
                aria-expanded={isSessionsDrawerOpen}
              >
                ☰
              </button>
              <h3>会话控制台</h3>
            </div>
            <div className="session-empty-state" data-testid="session-empty-state">
              <div className="empty-icon">💬</div>
              <p>从左侧选择一个会话</p>
              <p>或创建一个新会话开始对话</p>
            </div>
          </>
        ) : (
          <>
            {/* Timeline Header */}
            <div className="timeline-header">
              {/* Mobile session sidebar toggle */}
              <button
                className="session-sidebar-toggle"
                data-testid="session-sidebar-toggle"
                onClick={() => setIsSessionsDrawerOpen(true)}
                aria-controls="sessions-sidebar"
                aria-label="打开会话列表"
                aria-expanded={isSessionsDrawerOpen}
              >
                ☰
              </button>
              <h3>{selectedSession?.title || `会话 ${selectedSessionId.slice(-8)}`}</h3>
              {renderStreamStatus()}
            </div>

            {/* Timeline */}
            <div className="session-timeline-container" data-testid="session-timeline">
              <TimelineList events={mergedEvents} loading={timelineLoading} error={timelineError || undefined} />
            </div>

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

            {/* Composer Dock */}
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
    </div>
  )
}

export default SessionConsoleTab
