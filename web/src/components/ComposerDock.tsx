import React, { useRef, useEffect } from 'react'
import './ComposerDock.css'

interface ComposerDockProps {
  /** Current draft text value */
  value: string
  /** Callback when draft value changes */
  onChange: (value: string) => void
  /** Callback to send the message */
  onSend: () => void
  /** Whether a send operation is in progress */
  sending?: boolean
  /** Placeholder text for the input */
  placeholder?: string
  /** Optional additional CSS class */
  className?: string
}

/**
 * ComposerDock - A visual wrapper/surface for message input with textarea support.
 *
 * Features:
 * - Textarea input for multi-line messages
 * - Enter to send, Shift+Enter for newline
 * - Blocks empty/whitespace-only messages
 * - Styled with warm-paper tokens
 *
 * Preserves test IDs:
 * - data-testid="session-message-input" on the textarea
 * - data-testid="session-send-button" on the send button
 */
const ComposerDock: React.FC<ComposerDockProps> = ({
  value,
  onChange,
  onSend,
  sending = false,
  placeholder = '输入消息...',
  className = '',
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea to fit content
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      const newHeight = Math.min(textarea.scrollHeight, 200)
      textarea.style.height = `${newHeight}px`
    }
  }, [value])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter creates newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !sending) {
        onSend()
      }
    }
  }

  const handleSendClick = () => {
    if (value.trim() && !sending) {
      onSend()
    }
  }

  const isSendDisabled = !value.trim() || sending

  return (
    <div className={`composer-dock ${className}`}>
      <textarea
        ref={textareaRef}
        className="composer-input"
        data-testid="session-message-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={sending}
        rows={1}
      />
      <div className="composer-actions-row">
        <div className="composer-toolbar" aria-hidden="true" />
        <button
          className="composer-send-button"
          data-testid="session-send-button"
          onClick={handleSendClick}
          disabled={isSendDisabled}
          type="button"
        >
          {sending ? '发送中...' : '发送'}
        </button>
      </div>
    </div>
  )
}

export default ComposerDock
