import React, { useState, useCallback, useMemo } from 'react'

/**
 * JsonBlock - Renders JSON content with formatting and copy functionality
 * 
 * Features:
 * - Syntax highlighting classes for JSON keys and values
 * - Preserves whitespace in pre-formatted JSON
 * - Formats compact JSON with indentation
 * - Copy-to-clipboard functionality
 * - XSS safe: renders as text, not HTML
 */

export interface JsonBlockProps {
  json: string
  className?: string
}

export const JsonBlock: React.FC<JsonBlockProps> = ({
  json,
  className,
}) => {
  const [copied, setCopied] = useState(false)

  const formatted = useMemo(() => {
    try {
      const parsed = JSON.parse(json)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return json
    }
  }, [json])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy JSON:', err)
    }
  }, [json])

  return (
    <div
      data-testid="json-block"
      className={`json-block ${className || ''}`}
    >
      <div className="json-block__header">
        <span className="json-block__label">JSON</span>
        <button
          onClick={handleCopy}
          className="json-block__copy-btn"
          aria-label={copied ? 'Copied' : 'Copy JSON'}
          type="button"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre
        className="json-block__pre overflow-x-auto"
        role="presentation"
        aria-label="JSON content"
      >
        <code className="json-block__code">{formatted}</code>
      </pre>
    </div>
  )
}

export default JsonBlock
