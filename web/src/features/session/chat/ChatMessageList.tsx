import React, { useEffect, useRef } from 'react'
import type { ConsoleTimelineEvent } from '../../../api/types'
import ChatWelcome from './ChatWelcome'
import ChatMessage from './ChatMessage'

export interface ChatMessageListProps {
  events: ConsoleTimelineEvent[]
  loading: boolean
  error?: string
  onPromptSelect: (prompt: string) => void
  onRetryStream: () => void
}

const eventTypeToRole = (eventType?: string): 'user' | 'assistant' => {
  return eventType === 'user_message' ? 'user' : 'assistant'
}

const isStreamingDraft = (event: ConsoleTimelineEvent): boolean =>
  event.metadata?.streamingDraft === true

const isPlaceholder = (event: ConsoleTimelineEvent): boolean =>
  event.metadata?.assistantPlaceholder === true

const ChatMessageList: React.FC<ChatMessageListProps> = ({
  events,
  loading,
  error,
  onPromptSelect,
  onRetryStream,
}) => {
  const chatAreaRef = useRef<HTMLDivElement>(null)

  const messageEvents = events.filter(
    (e) => e.eventType === 'user_message' || e.eventType === 'assistant_message',
  )

  useEffect(() => {
    if (chatAreaRef.current && messageEvents.length > 0) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight
    }
  }, [events, messageEvents.length])

  const showTypingIndicator = loading && messageEvents.length > 0 && !messageEvents.some(isStreamingDraft)

  return (
    <div className="chat-area" ref={chatAreaRef} data-testid="chat-message-list">
      <div className="chat-column">
        {messageEvents.length === 0 ? (
          <ChatWelcome onPromptSelect={onPromptSelect} />
        ) : (
          <div className="chat-messages">
            {messageEvents.map((event) => {
              const streaming = isStreamingDraft(event)
              const placeholder = isPlaceholder(event)
              return (
                <div key={event.eventId} className="chat-message-group">
                  <ChatMessage
                    role={eventTypeToRole(event.eventType)}
                    content={streaming ? (event.content || '') : (event.content || '')}
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
            <button onClick={onRetryStream} className="chat-error__retry">重试</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatMessageList
