import React, { useState, useCallback } from 'react'

export interface CodeBlockProps {
  code: string
  language?: string | null
  className?: string
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language,
  className,
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy code:', err)
    }
  }, [code])

  const displayLanguage = language === '' ? 'code' : language
  const showLanguageLabel = displayLanguage !== undefined && displayLanguage !== null

  return (
    <div
      data-testid="code-block-container"
      className={`code-block ${className || ''}`}
    >
      <div className="code-block__header">
        {showLanguageLabel && (
          <span data-testid="code-language-label" className="code-block__language">
            {displayLanguage}
          </span>
        )}
        <button
          onClick={handleCopy}
          className="code-block__copy-btn"
          aria-label={copied ? 'Copied' : 'Copy code'}
          type="button"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre
        className="code-block__pre overflow-x-auto"
        role="presentation"
        aria-label="Code block"
      >
        <code className="code-block__code">{code}</code>
      </pre>
    </div>
  )
}

export default CodeBlock
