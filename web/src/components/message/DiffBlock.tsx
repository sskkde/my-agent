import React, { useState, useCallback } from 'react'

/**
 * DiffBlock - Renders diff content with diff-specific styling
 * 
 * Features:
 * - Line-by-line diff display with color coding
 * - - (red) for removed lines
 * - + (green) for added lines
 * - @@ hunk headers with special styling
 * - Copy-to-clipboard functionality
 * - XSS safe: renders as text, not HTML
 */

export interface DiffBlockProps {
  diff: string
  className?: string
}

export const DiffBlock: React.FC<DiffBlockProps> = ({
  diff,
  className,
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(diff)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy diff:', err)
    }
  }, [diff])

  // Split diff into lines and render each with appropriate class
  const lines = diff.split('\n')

  const getLineClass = (line: string): string => {
    if (line.startsWith('@@')) return 'diff-block__line--hunk'
    if (line.startsWith('---')) return 'diff-block__line--header'
    if (line.startsWith('+++')) return 'diff-block__line--header'
    if (line.startsWith('diff --git')) return 'diff-block__line--header'
    if (line.startsWith('index ')) return 'diff-block__line--header'
    if (line.startsWith('-')) return 'diff-block__line--removed'
    if (line.startsWith('+')) return 'diff-block__line--added'
    return 'diff-block__line--context'
  }

  return (
    <div
      data-testid="diff-block"
      className={`diff-block ${className || ''}`}
    >
      <div className="diff-block__header">
        <span className="diff-block__label">Diff</span>
        <button
          onClick={handleCopy}
          className="diff-block__copy-btn"
          aria-label={copied ? 'Copied' : 'Copy diff'}
          type="button"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div
        className="diff-block__content overflow-x-auto"
        role="presentation"
        aria-label="Diff content"
      >
        {lines.map((line, index) => (
          <div key={index} className={`diff-block__line ${getLineClass(line)}`}>
            <span className="diff-block__line-number">{index + 1}</span>
            <span className="diff-block__line-content">{line || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default DiffBlock
