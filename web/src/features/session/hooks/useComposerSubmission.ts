import { useState, useCallback, useRef } from 'react'
import * as api from '../../../api/client'
import type { ConsoleTimelineEvent, FileUploadMetadata } from '../../../api/types'
import type { CommandContext } from '../../../commands/types'
import { isCommand, parseInput } from '../../../commands/parser'
import { executeCommand } from '../../../commands/executor'
import { createCommandEvent } from '../../../commands/formatters'
import { POST_SEND_POLL_MAX_ATTEMPTS, POST_SEND_POLL_INTERVAL_MS } from '../session-constants'
import {
  createLocalUserMessageEvent,
  countServerUserMessagesByContent,
  isLocalMessageConfirmed,
  hasAssistantOrErrorReplyAfter,
} from '../session-utils'
import type { AssistantPlaceholder } from '../session-utils'

/** Attachment metadata stored on a local optimistic message event. */
export interface LocalAttachmentMeta {
  fileId: string
  originalFilename: string
  sizeBytes: number
  mimeType: string
}

export interface UseComposerSubmissionCallbacks {
  createAssistantPlaceholder: (sessionId: string) => { attemptId: string; placeholder: AssistantPlaceholder }
  resolveAssistantPlaceholder: (currentAttemptId: string, resolvedAttemptId?: string) => void
  updatePendingAssistantPlaceholders: (
    updater: (prev: Map<string, AssistantPlaceholder>) => Map<string, AssistantPlaceholder>,
  ) => void
  clearAssistantActivity: (
    attemptIds: Array<string | undefined>,
    clearOldestIfUnmatched?: boolean,
    sessionId?: string,
  ) => void
  clearAssistantActivityForSession: (sessionId: string) => void
  fetchTimeline: (sessionId: string) => Promise<ConsoleTimelineEvent[] | null>
  fetchSessions: (isRefresh?: boolean) => Promise<void>
  createCommandContext: () => CommandContext
}

export interface UseComposerSubmissionReturn {
  draft: string
  setDraft: React.Dispatch<React.SetStateAction<string>>
  sending: boolean
  sendError: string | null
  setSendError: React.Dispatch<React.SetStateAction<string | null>>
  handleSend: () => Promise<void>
  handleKeyDown: (e: React.KeyboardEvent) => void
  localCommandEvents: Map<string, ConsoleTimelineEvent[]>
  localMessageEvents: Map<string, ConsoleTimelineEvent[]>
  clearPostSendPollTimeout: () => void
  selectedFiles: File[]
  setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>
  uploadErrors: string[]
  isUploading: boolean
}

/**
 * Manages composer input state and message submission flow including:
 * - Draft text, sending state, error state
 * - Command parsing/execution dispatch
 * - Optimistic local message/command event creation
 * - Post-send polling for server confirmation
 */
export function useComposerSubmission(options: {
  selectedSessionId: string | null
  mountedRef: React.MutableRefObject<boolean>
  selectedSessionIdRef: React.MutableRefObject<string | null>
  events: ConsoleTimelineEvent[]
  callbacks: UseComposerSubmissionCallbacks
}): UseComposerSubmissionReturn {
  const { selectedSessionId, mountedRef, selectedSessionIdRef, callbacks } = options

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [localCommandEvents, setLocalCommandEvents] = useState<Map<string, ConsoleTimelineEvent[]>>(new Map())
  const [localMessageEvents, setLocalMessageEvents] = useState<Map<string, ConsoleTimelineEvent[]>>(new Map())
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const postSendPollAttemptsRef = useRef(0)
  const postSendPollTimeoutRef = useRef<number | null>(null)

  const eventsRef = useRef(options.events)
  eventsRef.current = options.events

  const selectedFilesRef = useRef<File[]>([])
  selectedFilesRef.current = selectedFiles

  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const clearPostSendPollTimeout = useCallback(() => {
    if (postSendPollTimeoutRef.current !== null) {
      clearTimeout(postSendPollTimeoutRef.current)
      postSendPollTimeoutRef.current = null
    }
  }, [])

  const addLocalCommandEvent = useCallback((sessionId: string, event: ConsoleTimelineEvent) => {
    setLocalCommandEvents((prev) => {
      const newMap = new Map(prev)
      const existingEvents = newMap.get(sessionId) || []
      newMap.set(sessionId, [...existingEvents, event])
      return newMap
    })
  }, [])

  const addLocalMessageEvent = useCallback(
    (sessionId: string, content: string, attachments?: LocalAttachmentMeta[]): ConsoleTimelineEvent => {
      const baselineServerMessageCount = countServerUserMessagesByContent(eventsRef.current, content)
      const event = createLocalUserMessageEvent(sessionId, content, baselineServerMessageCount)
      if (attachments && attachments.length > 0) {
        event.metadata = { ...event.metadata, attachments }
      }
      setLocalMessageEvents((prev) => {
        const newMap = new Map(prev)
        const existingEvents = newMap.get(sessionId) || []
        newMap.set(sessionId, [...existingEvents, event])
        return newMap
      })
      return event
    },
    [],
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

  const uploadFiles = useCallback(
    async (sessionId: string, files: File[]): Promise<{ attachmentIds: string[]; metas: LocalAttachmentMeta[] }> => {
      const attachmentIds: string[] = []
      const metas: LocalAttachmentMeta[] = []
      for (const file of files) {
        const uploaded: FileUploadMetadata = await api.uploadSessionFile(sessionId, file)
        attachmentIds.push(uploaded.fileId)
        metas.push({
          fileId: uploaded.fileId,
          originalFilename: uploaded.originalFilename,
          sizeBytes: uploaded.sizeBytes,
          mimeType: uploaded.mimeType,
        })
      }
      return { attachmentIds, metas }
    },
    [],
  )

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
        const serverEvents = await callbacksRef.current.fetchTimeline(sessionId)
        await callbacksRef.current.fetchSessions(true)

        if (
          serverEvents &&
          mountedRef.current &&
          selectedSessionIdRef.current === sessionId &&
          isLocalMessageConfirmed(serverEvents, localEvent) &&
          hasAssistantOrErrorReplyAfter(serverEvents, localEvent)
        ) {
          callbacksRef.current.clearAssistantActivityForSession(sessionId)
          return
        }

        if (mountedRef.current && selectedSessionIdRef.current === sessionId) {
          postSendPollTimeoutRef.current = window.setTimeout(poll, POST_SEND_POLL_INTERVAL_MS)
        }
      }

      postSendPollTimeoutRef.current = window.setTimeout(poll, POST_SEND_POLL_INTERVAL_MS)
    },
    [clearPostSendPollTimeout, mountedRef, selectedSessionIdRef],
  )

  const handleSend = async () => {
    const sessionId = selectedSessionId
    if (!sessionId || !draft.trim() || sending) return

    const trimmedDraft = draft.trim()
    const cbs = callbacksRef.current

    if (trimmedDraft.startsWith('//')) {
      const escapedText = trimmedDraft.slice(2)
      setSending(true)
      setSendError(null)
      setUploadErrors([])

      let attachmentIds: string[] | undefined
      let attachmentMetas: LocalAttachmentMeta[] | undefined
      const currentFiles = selectedFilesRef.current

      if (currentFiles.length > 0) {
        setIsUploading(true)
        try {
          const result = await uploadFiles(sessionId, currentFiles)
          attachmentIds = result.attachmentIds
          attachmentMetas = result.metas
        } catch (err) {
          setUploadErrors([err instanceof Error ? err.message : 'Failed to upload file'])
          setSending(false)
          setIsUploading(false)
          return
        } finally {
          setIsUploading(false)
        }
      }

      const localEvent = addLocalMessageEvent(sessionId, escapedText, attachmentMetas)
      const { attemptId: placeholderAttemptId, placeholder } = cbs.createAssistantPlaceholder(sessionId)
      cbs.updatePendingAssistantPlaceholders((prev) => {
        const next = new Map(prev)
        next.set(placeholderAttemptId, placeholder)
        return next
      })

      try {
        const response = await api.sendMessage(sessionId, escapedText, attachmentIds)
        setDraft('')
        setSelectedFiles([])
        setUploadErrors([])
        cbs.resolveAssistantPlaceholder(placeholderAttemptId, response.correlationId)
        startPostSendPoll(sessionId, localEvent)
      } catch (err) {
        removeLocalMessageEvent(sessionId, localEvent.eventId)
        setSendError(err instanceof Error ? err.message : 'Failed to send message')
        cbs.clearAssistantActivity([placeholderAttemptId])
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
          const context = cbs.createCommandContext()
          const result = await executeCommand(parseResult.parsed, context)

          const commandEvent = createCommandEvent(result, sessionId)
          addLocalCommandEvent(sessionId, commandEvent)

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
    setUploadErrors([])

    let attachmentIds: string[] | undefined
    let attachmentMetas: LocalAttachmentMeta[] | undefined
    const currentFiles = selectedFilesRef.current

    if (currentFiles.length > 0) {
      setIsUploading(true)
      try {
        const result = await uploadFiles(sessionId, currentFiles)
        attachmentIds = result.attachmentIds
        attachmentMetas = result.metas
      } catch (err) {
        setUploadErrors([err instanceof Error ? err.message : 'Failed to upload file'])
        setSending(false)
        setIsUploading(false)
        return
      } finally {
        setIsUploading(false)
      }
    }

    const localEvent = addLocalMessageEvent(sessionId, trimmedDraft, attachmentMetas)

    const { attemptId: placeholderAttemptId, placeholder } = cbs.createAssistantPlaceholder(sessionId)
    cbs.updatePendingAssistantPlaceholders((prev) => {
      const next = new Map(prev)
      next.set(placeholderAttemptId, placeholder)
      return next
    })

    try {
      const response = await api.sendMessage(sessionId, trimmedDraft, attachmentIds)
      setDraft('')
      setSelectedFiles([])
      setUploadErrors([])

      cbs.resolveAssistantPlaceholder(placeholderAttemptId, response.correlationId)

      startPostSendPoll(sessionId, localEvent)
    } catch (err) {
      removeLocalMessageEvent(sessionId, localEvent.eventId)
      setSendError(err instanceof Error ? err.message : 'Failed to send message')
      cbs.clearAssistantActivity([placeholderAttemptId])
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (draft.trim() && !sending) {
        handleSend()
      }
    }
  }

  return {
    draft,
    setDraft,
    sending,
    sendError,
    setSendError,
    handleSend,
    handleKeyDown,
    localCommandEvents,
    localMessageEvents,
    clearPostSendPollTimeout,
    selectedFiles,
    setSelectedFiles,
    uploadErrors,
    isUploading,
  }
}
