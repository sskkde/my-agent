import React from 'react'

/**
 * PlainTextContent - Renders content as plain text with XSS protection
 * 
 * Uses React text rendering (not dangerouslySetInnerHTML) to ensure
 * all HTML/XSS payloads are displayed as visible text, not rendered.
 * 
 * Features:
 * - Escapes all HTML tags and entities
 * - Preserves line breaks
 * - No markdown processing
 * - Safe for user input
 */

export interface PlainTextContentProps {
  text: string | null | undefined
  isStreaming?: boolean
  className?: string
}

export const PlainTextContent: React.FC<PlainTextContentProps> = ({
  text,
  isStreaming = false,
  className,
}) => {
  if (!text) {
    return (
      <div 
        data-testid="plaintext-content" 
        className={`plaintext-content${className ? ` ${className}` : ''}`}
      />
    )
  }

  const lines = text.split('\n')

  return (
    <div
      data-testid="plaintext-content"
      className={`plaintext-content${isStreaming ? ' plaintext-content--streaming' : ''}${className ? ` ${className}` : ''}`}
    >
      {lines.map((line, index) => (
        <React.Fragment key={index}>
          {line}
          {index < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </div>
  )
}
