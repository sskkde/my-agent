import React from 'react'
import { detectContentType, ContentMetadata } from './contentType'
import { JsonBlock } from './JsonBlock'
import { DiffBlock } from './DiffBlock'
import { CodeBlock } from './CodeBlock'
import { PlainTextContent } from './PlainTextContent'
import { MarkdownContent } from './MarkdownContent'

/**
 * ToolResultContent - Renders tool output based on content type
 * 
 * Routes content to appropriate renderer:
 * - application/json → JsonBlock (formatted JSON)
 * - text/x-diff → DiffBlock (diff styling)
 * - text/x-shell → CodeBlock (bash language)
 * - text/markdown → MarkdownContent (only when explicit)
 * - text/plain / unknown → PlainTextContent (safe fallback)
 * 
 * Security:
 * - Does NOT render arbitrary unknown tool output as Markdown
 * - Uses React text rendering (not dangerouslySetInnerHTML) for most cases
 * - Only MarkdownContent uses HTML, with DOMPurify sanitization
 */

export interface ToolResultContentProps {
  content: string | null | undefined
  metadata?: ContentMetadata | null
  className?: string
}

export const ToolResultContent: React.FC<ToolResultContentProps> = ({
  content,
  metadata,
  className,
}) => {
  if (!content) {
    return <PlainTextContent text="" className={className} />
  }

  if (metadata?.contentType === 'text/markdown') {
    return <MarkdownContent text={content} className={className} />
  }

  const contentType = detectContentType(content, metadata)

  switch (contentType) {
    case 'application/json':
      return <JsonBlock json={content} className={className} />
    case 'text/x-diff':
      return <DiffBlock diff={content} className={className} />
    case 'text/x-shell':
      return <CodeBlock code={content} language="bash" className={className} />
    case 'text/markdown':
      return <PlainTextContent text={content} className={className} />
    case 'text/plain':
    default:
      return <PlainTextContent text={content} className={className} />
  }
}

export default ToolResultContent
