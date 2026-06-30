import React, { useEffect, useRef } from 'react'
import { showToast } from './ChatToast'

export type ChatComposerStatus = 'idle' | 'thinking' | 'tool' | 'generating'

export interface ChatComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  sending?: boolean
  model?: string
  status?: ChatComposerStatus
  ctxUsage?: number
}

const STATUS_LABELS: Record<ChatComposerStatus, string> = {
  idle: '空闲',
  thinking: '思考中…',
  tool: '调用工具…',
  generating: '生成回复…',
}

const ChatComposer: React.FC<ChatComposerProps> = ({
  value,
  onChange,
  onSend,
  sending = false,
  model = 'GLM-4.6',
  status = 'idle',
  ctxUsage = 12,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const newHeight = Math.min(textarea.scrollHeight, 200)
    textarea.style.height = `${newHeight}px`
  }, [value])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !sending) {
        onSend()
      }
    }
  }

  const isSendDisabled = !value.trim() || sending

  const ctxClass = ctxUsage > 80 ? 'chat-ctx-fill--danger' : ctxUsage > 60 ? 'chat-ctx-fill--warn' : ''

  return (
    <div className="chat-input-wrapper" data-testid="chat-composer">
      <div className="chat-input-surface">
        <textarea
          ref={textareaRef}
          className="chat-input"
          data-testid="chat-input"
          placeholder="输入消息，或按 Enter 发送…"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          aria-label="聊天输入框"
        />
        <div className="chat-input-toolbar">
          <div className="chat-input-tools">
            <button
              className="chat-tool-btn"
              aria-label="附件"
              title="附件"
              onClick={() => showToast('附件上传后续接入')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              className="chat-tool-btn"
              aria-label="代码块"
              title="代码块"
              onClick={() => showToast('代码插入后续接入')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </button>
          </div>

          <div className="chat-status-bar" data-testid="chat-status-bar">
            <div className="chat-status-segment" title="当前模型">
              <span className={`chat-status-dot chat-status-dot--${status}`} />
              <span className="chat-status-label">{model}</span>
            </div>
            <div className="chat-status-segment" title="工作阶段">
              <span className="chat-status-sub">{STATUS_LABELS[status]}</span>
            </div>
            <div className="chat-status-segment" title="上下文窗口占用">
              <div className="chat-ctx-bar">
                <div
                  className={`chat-ctx-fill ${ctxClass}`}
                  style={{ width: `${Math.min(100, Math.max(0, ctxUsage))}%` }}
                  data-testid="chat-ctx-fill"
                />
              </div>
              <span className="chat-ctx-pct" data-testid="chat-ctx-pct">{Math.round(ctxUsage)}%</span>
            </div>
          </div>

          <button
            className="chat-send-btn"
            data-testid="chat-send-button"
            aria-label="发送"
            onClick={() => {
              if (!isSendDisabled) onSend()
            }}
            disabled={isSendDisabled}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChatComposer
