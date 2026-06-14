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
 * ComposerDock - A floating centered composer card for desktop, docked for mobile.
 *
 * Features:
 * - Desktop: Centered floating card with max-width constraint
 * - Mobile: Full-width docked at bottom
 * - Textarea input for multi-line messages
 * - Enter to send, Shift+Enter for newline
 * - Blocks empty/whitespace-only messages
 * - Tool buttons: 操作电脑, 看看书桌说
 * - Model selector display
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
  // TODO: Make model configurable via props in future
  const selectedModel = 'claude-3.5'

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
      <div className="composer-card">
        {/* Toolbar with tool buttons */}
        <div className="composer-toolbar">
          <button
            className="composer-tool-btn"
            type="button"
            title="操作电脑"
            aria-label="操作电脑"
          >
            <span className="composer-tool-icon">🖥️</span>
            <span className="composer-tool-label">操作电脑</span>
          </button>
          <button
            className="composer-tool-btn"
            type="button"
            title="看看书桌说"
            aria-label="看看书桌说"
          >
            <span className="composer-tool-icon">📖</span>
            <span className="composer-tool-label">看看书桌说</span>
          </button>
          <div className="composer-spacer" />
          <div className="composer-model-badge">
            <span className="composer-model-label">模型</span>
            <span className="composer-model-value">{selectedModel}</span>
          </div>
        </div>

        {/* Input area */}
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

        {/* Actions row */}
        <div className="composer-actions-row">
          <div className="composer-hint">
            <kbd>Enter</kbd> 发送 · <kbd>Shift+Enter</kbd> 换行
          </div>
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
    </div>
  )
}

export default ComposerDock
