import React, { useEffect, useRef } from 'react'
import { showToast } from './ChatToast'
import { CLIENT_ACCEPT_STRING } from '../../../config/upload-constants'

export type ChatComposerStatus = 'idle' | 'thinking' | 'tool' | 'generating'

export interface ChatComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  sending?: boolean
  model?: string
  status?: ChatComposerStatus
  statusLabel?: string
  ctxUsage?: number
  onFilesSelected?: (files: File[]) => void
  selectedFiles?: File[]
  onRemoveFile?: (index: number) => void
  uploadErrors?: string[]
  isUploading?: boolean
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
  statusLabel,
  ctxUsage = 12,
  onFilesSelected,
  selectedFiles = [],
  onRemoveFile,
  uploadErrors = [],
  isUploading = false,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const newHeight = Math.min(textarea.scrollHeight, 200)
    textarea.style.height = `${newHeight}px`
  }, [value])

  const isSendDisabled = (!value.trim() && selectedFiles.length === 0) || sending || isUploading

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isSendDisabled) {
        onSend()
      }
    }
  }

  const handleAttachClick = () => {
    if (onFilesSelected) {
      fileInputRef.current?.click()
      return
    }
    showToast('附件上传后续接入')
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      onFilesSelected?.(Array.from(files))
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const ctxClass = ctxUsage > 80 ? 'chat-ctx-fill--danger' : ctxUsage > 60 ? 'chat-ctx-fill--warn' : ''
  const displayStatusLabel = statusLabel || STATUS_LABELS[status]

  return (
    <div className="chat-input-wrapper" data-testid="chat-composer">
      <div className="chat-input-surface">
        <input
          ref={fileInputRef}
          type="file"
          className="chat-file-input"
          data-testid="chat-file-input"
          multiple
          accept={CLIENT_ACCEPT_STRING}
          onChange={handleFileChange}
          tabIndex={-1}
          aria-hidden="true"
        />
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
        {selectedFiles.length > 0 && (
          <div className="chat-attachment-list" data-testid="chat-attachment-list">
            {selectedFiles.map((file, index) => (
              <div key={`${file.name}-${index}`} className="chat-attachment-chip" data-testid="chat-attachment-chip">
                <span className="chat-attachment-name" title={file.name}>{file.name}</span>
                <span className="chat-attachment-size">{Math.max(1, Math.ceil(file.size / 1024))} KB</span>
                {onRemoveFile && (
                  <button
                    type="button"
                    className="chat-attachment-remove"
                    aria-label={`移除 ${file.name}`}
                    title="移除"
                    onClick={() => onRemoveFile(index)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {uploadErrors.length > 0 && (
          <div className="chat-upload-errors" data-testid="chat-upload-errors">
            {uploadErrors.map((error, index) => (
              <div key={`${error}-${index}`} className="chat-upload-error" data-testid="chat-upload-error">
                {error}
              </div>
            ))}
          </div>
        )}
        {isUploading && (
          <div className="chat-uploading" data-testid="chat-uploading">
            上传中...
          </div>
        )}
        <div className="chat-input-toolbar">
          <div className="chat-input-tools">
            <button
              type="button"
              className="chat-tool-btn"
              aria-label="附件"
              title="附件"
              onClick={handleAttachClick}
              disabled={sending || isUploading}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              type="button"
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
            <div className="chat-status-segment chat-status-segment--model" title="当前模型">
              <span className={`chat-status-dot chat-status-dot--${status}`} />
              <span className="chat-status-label">{model}</span>
            </div>
            <div className="chat-status-segment chat-status-segment--stage" title="工作阶段">
              <span className="chat-status-sub">{displayStatusLabel}</span>
            </div>
            <div className="chat-status-segment chat-status-segment--ctx" title="上下文窗口占用">
              <span className="chat-ctx-label">上下文</span>
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
            type="button"
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
