import React from 'react'
import { PlainTextContent } from './PlainTextContent'
import { MarkdownContent } from './MarkdownContent'

/**
 * MessageContent - Role-aware message content dispatcher
 * 
 * Dispatches to PlainTextContent or MarkdownContent based on:
 * - Role (assistant/user/system/error)
 * - Mode (static/streaming)
 * - Content type override
 * - Markdown permission flag
 * 
 * Default behavior:
 * - assistant role → MarkdownContent
 * - user/system/error roles → PlainTextContent
 * 
 * Override precedence:
 * 1. contentType prop (markdown/text) - highest priority
 * 2. allowMarkdown prop
 * 3. Role-based default
 */

export type MessageRole = 'assistant' | 'user' | 'system' | 'error'
export type MessageMode = 'static' | 'streaming'
export type ContentType = 'markdown' | 'text'

export interface MessageContentProps {
  text: string | null | undefined
  role: MessageRole
  mode: MessageMode
  contentType?: ContentType
  allowMarkdown?: boolean
}

export const MessageContent: React.FC<MessageContentProps> = ({
  text,
  role,
  mode,
  contentType,
  allowMarkdown,
}) => {
  const isStreaming = mode === 'streaming'

  // Determine whether to use markdown rendering
  const shouldUseMarkdown = (): boolean => {
    // 1. contentType override takes highest precedence
    if (contentType === 'markdown') {
      return true
    }
    if (contentType === 'text') {
      return false
    }

    // 2. allowMarkdown override
    if (allowMarkdown === true) {
      return true
    }
    if (allowMarkdown === false) {
      return false
    }

    // 3. Role-based default
    return role === 'assistant'
  }

  const useMarkdown = shouldUseMarkdown()
  
  // Determine if full markdown mode should be used (for assistant role)
  const useFullMarkdown = role === 'assistant'

  // Render appropriate content component
  const content = useMarkdown ? (
    <MarkdownContent 
      text={text} 
      isStreaming={isStreaming} 
      fullMarkdown={useFullMarkdown}
    />
  ) : (
    <PlainTextContent text={text} isStreaming={isStreaming} />
  )

  return (
    <div
      data-testid={`message-content-${role}`}
      className={`message-content message-content--${role} message-content--${mode}`}
    >
      {content}
    </div>
  )
}
