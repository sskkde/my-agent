import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ConsoleTimelineEvent } from '../../../api/types'
import ChatWelcome from './ChatWelcome'
import ChatMessage from './ChatMessage'
import ReasoningBlock from './ReasoningBlock'
import ToolCallCard from '../../../components/ToolCallCard'
import BackgroundTaskCard from '../../../components/BackgroundTaskCard'
import { filterParentTimelineEvents, getChildTaskProfileLabel } from '../session-utils'
import { mergeToolEvents } from './mergeToolEvents'
import * as api from '../../../api/client'
import { showToast } from './ChatToast'

export interface ChatMessageListProps {
  events: ConsoleTimelineEvent[]
  parentSessionId?: string
  loading: boolean
  error?: string
  onPromptSelect: (prompt: string) => void
  onRetryStream: () => void
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  onTaskOpen?: (taskId: string, childSessionId?: string) => void
}

const eventTypeToRole = (eventType?: string): 'user' | 'assistant' | 'error' => {
  if (eventType === 'user_message') return 'user'
  if (eventType === 'error') return 'error'
  return 'assistant'
}

const isStreamingDraft = (event: ConsoleTimelineEvent): boolean =>
  event.metadata?.streamingDraft === true

const isPlaceholder = (event: ConsoleTimelineEvent): boolean =>
  event.metadata?.assistantPlaceholder === true

const ChatMessageList: React.FC<ChatMessageListProps> = ({
  events,
  parentSessionId,
  loading,
  error,
  onPromptSelect,
  onRetryStream,
  hasMore,
  loadingMore,
  onLoadMore,
  onTaskOpen,
}) => {
  const chatAreaRef = useRef<HTMLDivElement>(null)
  const isLoadingMoreRef = useRef(false)
  const prevScrollHeightRef = useRef(0)

  const streamItems = useMemo(() => {
    if (!parentSessionId) return mergeToolEvents(events)
    return mergeToolEvents(filterParentTimelineEvents(events, parentSessionId))
  }, [events, parentSessionId])

  const textMessageEvents = useMemo(
    () =>
      streamItems
        .filter((item) => item.kind === 'message')
        .map((item) => item.event),
    [streamItems],
  )

  const handleScroll = useCallback(() => {
    const el = chatAreaRef.current
    if (!el || !onLoadMore || !hasMore || loadingMore) return
    if (el.scrollTop <= 50) {
      prevScrollHeightRef.current = el.scrollHeight
      isLoadingMoreRef.current = true
      onLoadMore()
    }
  }, [onLoadMore, hasMore, loadingMore])

  useEffect(() => {
    if (isLoadingMoreRef.current && chatAreaRef.current && prevScrollHeightRef.current > 0) {
      const el = chatAreaRef.current
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current
      isLoadingMoreRef.current = false
      prevScrollHeightRef.current = 0
      return
    }
    if (chatAreaRef.current && streamItems.length > 0) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight
    }
  }, [events, streamItems.length])

  const showTypingIndicator =
    loading && textMessageEvents.length > 0 && !textMessageEvents.some(isStreamingDraft)

  return (
    <div className="chat-area" ref={chatAreaRef} data-testid="chat-message-list" onScroll={handleScroll}>
      <div className="chat-column">
        {loadingMore && (
          <div className="chat-loading-more" data-testid="chat-loading-more">
            正在加载更早的消息…
          </div>
        )}
        {streamItems.length === 0 ? (
          <ChatWelcome onPromptSelect={onPromptSelect} />
        ) : (
          <div className="chat-messages">
            {streamItems.map((item) => {
              if (item.kind === 'task') {
                return (
                  <div key={item.key} className="chat-task-event" data-testid="chat-task-event">
                    <BackgroundTaskCard
                      taskId={item.taskId}
                      label={getChildTaskProfileLabel(item.agentProfile)}
                      status={item.status}
                      progress={item.progress}
                      message={item.safeMessage}
                      agentProfile={item.agentProfile}
                      launchMode={item.launchMode}
                      parentSessionId={parentSessionId}
                      childSessionId={item.childSessionId}
                      onCancel={
                        item.childSessionId && parentSessionId
                          ? () => api.cancelChildSession(parentSessionId, item.childSessionId ?? '').then(() => undefined)
                          : undefined
                      }
                      onResume={
                        item.childSessionId && parentSessionId
                          ? () => api.resumeChildSession(parentSessionId, item.childSessionId ?? '').then(() => undefined)
                          : undefined
                      }
                      onActionError={showToast}
                      onOpen={
                        onTaskOpen && item.childSessionId
                          ? () => onTaskOpen(item.taskId, item.childSessionId)
                          : undefined
                      }
                    />
                  </div>
                )
              }

              if (item.kind === 'tool') {
                const taskId = item.taskId
                const childSessionId = item.childSessionId ?? taskId
                const taskActionContext =
                  taskId && parentSessionId && childSessionId
                    ? { taskId, parentSessionId, childSessionId }
                    : undefined
                return (
                  <div key={item.key} className="chat-tool-event" data-testid="chat-tool-event">
                    <ToolCallCard
                      toolName={item.toolName}
                      parameters={item.parameters}
                      result={item.resultText}
                      status={item.status}
                      durationMs={item.durationMs}
                      taskId={taskId}
                      childSessionId={childSessionId}
                      parentSessionId={item.parentSessionId ?? parentSessionId}
                      launchMode={item.launchMode}
                      taskStatus={item.taskStatus}
                      onCancel={
                        taskActionContext
                          ? () => api.cancelChildSession(taskActionContext.parentSessionId, taskActionContext.childSessionId).then(() => undefined)
                          : undefined
                      }
                      onResume={
                        taskActionContext
                          ? () => api.resumeChildSession(taskActionContext.parentSessionId, taskActionContext.childSessionId).then(() => undefined)
                          : undefined
                      }
                      onOpen={
                        taskActionContext && onTaskOpen
                          ? () => onTaskOpen(taskActionContext.taskId, taskActionContext.childSessionId)
                          : undefined
                      }
                      onActionError={showToast}
                    />
                  </div>
                )
              }

              if (item.event.eventType === 'thinking_summary') {
                return (
                  <div key={item.key} className="chat-message-group">
                    <ReasoningBlock content={item.event.content || ''} />
                  </div>
                )
              }

              const streaming = isStreamingDraft(item.event)
              const placeholder = isPlaceholder(item.event)
              return (
                <div key={item.key} className="chat-message-group">
                  <ChatMessage
                    role={eventTypeToRole(item.event.eventType)}
                    content={item.event.content || ''}
                    isStreaming={streaming}
                    isPlaceholder={placeholder}
                  />
                </div>
              )
            })}
          </div>
        )}
        {showTypingIndicator && (
          <div className="chat-message">
            <div className="chat-message__avatar chat-message__avatar--assistant" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
            </div>
            <div className="chat-message__content">
              <div className="chat-message__role">Hana</div>
              <div className="chat-typing" aria-label="正在输入">
                <span className="chat-typing__dot" />
                <span className="chat-typing__dot" />
                <span className="chat-typing__dot" />
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="chat-error" role="alert" data-testid="chat-message-error">
            {error}
            <button onClick={onRetryStream} className="chat-error__retry">
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatMessageList
