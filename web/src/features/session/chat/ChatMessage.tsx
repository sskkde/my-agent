import React from 'react'
import { MarkdownContent } from '../../../components/message/MarkdownContent'

export interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
}

const copyToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text)
  }
}

const ChatMessage: React.FC<ChatMessageProps> = ({ role, content }) => {
  const isAssistant = role === 'assistant'
  const roleLabel = isAssistant ? 'Hana' : '你'
  const avatar = isAssistant ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  ) : (
    '我'
  )

  return (
    <div className={`chat-message chat-message--${role}`} data-testid={`chat-message-${role}`}>
      <div className="chat-message__avatar-wrapper" aria-hidden="true">
        <div className={`chat-message__avatar chat-message__avatar--${role}`}>{avatar}</div>
      </div>
      <div className="chat-message__content">
        <div className="chat-message__role">{roleLabel}</div>
        <div className="chat-message__body">
          <MarkdownContent text={content} fullMarkdown />
        </div>
        <div className="chat-message__actions">
          <button
            className="chat-message__action"
            aria-label="复制"
            title="复制"
            onClick={() => {
              copyToClipboard(content).catch(() => {})
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChatMessage
