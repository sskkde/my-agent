import React from 'react'
import { formatMessageContent } from '../timeline/formatMessageContent'
import { repairIncompleteMarkdown } from './markdownStream'
import { applyLinkPolicy } from './linkPolicy'

/**
 * StreamingMarkdownContent - Renders streaming markdown with repair and XSS protection
 *
 * During token-by-token streaming, accumulated text often contains incomplete
 * Markdown constructs (unclosed code fences, incomplete links, orphaned emphasis).
 * This component repairs those constructs before passing to the Markdown parser,
 * ensuring stable and safe rendering at every streaming tick.
 *
 * Pipeline:
 * 1. Repair incomplete Markdown (markdownStream.ts)
 * 2. Format with marked + DOMPurify (formatMessageContent)
 * 3. Apply external link policy (linkPolicy.ts)
 * 4. Append streaming cursor indicator
 *
 * Security:
 * - DOMPurify sanitizes all HTML output
 * - Incomplete links are neutralized before parsing
 * - Streaming cursor is appended to HTML string (not as React child)
 */

export interface StreamingMarkdownContentProps {
  text: string | null | undefined
  isStreaming?: boolean
}

export const StreamingMarkdownContent: React.FC<StreamingMarkdownContentProps> = ({
  text,
  isStreaming = false,
}) => {
  // Handle null/undefined/empty
  if (!text) {
    const emptyHtml = isStreaming ? '<span class="streaming-cursor"></span>' : ''
    return (
      <div
        data-testid="streaming-markdown-content"
        className={`streaming-markdown-content${isStreaming ? ' streaming-markdown-content--streaming' : ''}`}
        dangerouslySetInnerHTML={{ __html: emptyHtml }}
      />
    )
  }

  // Step 1: Repair incomplete Markdown constructs
  const repairedText = repairIncompleteMarkdown(text)

  // Step 2: Format through the standard markdown pipeline (marked + DOMPurify)
  let formattedContent = formatMessageContent(repairedText)

  // Step 3: Apply link policy for external links
  formattedContent = applyLinkPolicy(formattedContent)

  // Step 4: Append streaming cursor if streaming
  if (isStreaming) {
    formattedContent += '<span class="streaming-cursor"></span>'
  }

  return (
    <div
      data-testid="streaming-markdown-content"
      className={`streaming-markdown-content${isStreaming ? ' streaming-markdown-content--streaming' : ''}`}
      dangerouslySetInnerHTML={{ __html: formattedContent }}
    />
  )
}
