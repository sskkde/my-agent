import React from 'react'
import { formatMessageContent } from '../timeline/formatMessageContent'
import { MarkdownCodeRenderer } from './MarkdownCodeRenderer'

/**
 * MarkdownContent - Renders content with markdown formatting and XSS protection
 * 
 * Uses the existing formatMessageContent function which:
 * - Parses markdown with marked
 * - Sanitizes HTML with DOMPurify
 * - Supports [md] blocks for full markdown (when fullMarkdown=false)
 * - Applies full markdown parsing when fullMarkdown=true
 * 
 * Features:
 * - Full XSS protection
 * - Markdown processing
 * - [md] block support (legacy mode)
 * - Streaming mode with cursor
 */

export interface MarkdownContentProps {
  text: string | null | undefined
  isStreaming?: boolean
  className?: string
  fullMarkdown?: boolean
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  text,
  isStreaming = false,
  className,
  fullMarkdown = false,
}) => {
  if (!text) {
    return (
      <div
        data-testid="markdown-content"
        className={`markdown-content${className ? ` ${className}` : ''}`}
      />
    )
  }

  let formattedContent = formatMessageContent(text, fullMarkdown)

  if (isStreaming) {
    formattedContent += '<span class="streaming-cursor"></span>'
  }

  return (
    <MarkdownCodeRenderer
      data-testid="markdown-content"
      html={formattedContent}
      className={`markdown-content${isStreaming ? ' markdown-content--streaming' : ''}${className ? ` ${className}` : ''}`}
    />
  )
}
