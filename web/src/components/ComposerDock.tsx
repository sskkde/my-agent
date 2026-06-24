import React, { useRef, useEffect, useCallback, useState } from 'react'
import './ComposerDock.css'
import { CLIENT_ACCEPT_STRING } from '../config/upload-constants'

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
  /** Display name of the active model */
  model?: string
  /** Callback when files are selected via attach button or drop */
  onFilesSelected?: (files: File[]) => void
  /** Currently selected files for display */
  selectedFiles?: File[]
  /** Callback to remove a file by index */
  onRemoveFile?: (index: number) => void
  /** Error messages for invalid uploads */
  uploadErrors?: string[]
  /** Whether an upload is in progress */
  isUploading?: boolean
}

/**
 * Format file size to human-readable string
 */
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
 * - File attachment controls: attach button, preview chips, remove, errors
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
  model = 'claude-3.5',
  onFilesSelected,
  selectedFiles = [],
  onRemoveFile,
  uploadErrors = [],
  isUploading = false,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const selectedModel = model
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

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
      if ((value.trim() || selectedFiles.length > 0) && !sending) {
        onSend()
      }
    }
  }

  const handleSendClick = () => {
    if ((value.trim() || selectedFiles.length > 0) && !sending) {
      onSend()
    }
  }

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        onFilesSelected?.(Array.from(files))
      }
      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [onFilesSelected],
  )

  const handleRemoveFile = useCallback(
    (index: number) => {
      onRemoveFile?.(index)
    },
    [onRemoveFile],
  )

  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (!onFilesSelected) return
      dragCounterRef.current += 1
      if (e.dataTransfer.types.includes('Files')) {
        setIsDragOver(true)
      }
    },
    [onFilesSelected],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (!onFilesSelected) return
      e.dataTransfer.dropEffect = 'copy'
    },
    [onFilesSelected],
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (!onFilesSelected) return
      dragCounterRef.current -= 1
      if (dragCounterRef.current === 0) {
        setIsDragOver(false)
      }
    },
    [onFilesSelected],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (!onFilesSelected) return
      dragCounterRef.current = 0
      setIsDragOver(false)
      const files = e.dataTransfer.files
      if (files && files.length > 0) {
        onFilesSelected(Array.from(files))
      }
    },
    [onFilesSelected],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onFilesSelected) return
      const files = Array.from(e.clipboardData.items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null)
      if (files.length > 0) {
        e.preventDefault()
        onFilesSelected(files)
      }
    },
    [onFilesSelected],
  )

  const isSendDisabled = !value.trim() && selectedFiles.length === 0 || sending

  return (
    <div className={`composer-dock ${className}`}>
      <div
        className={`composer-card${isDragOver ? ' composer-card--drag-over' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid="composer-card"
      >
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

        {/* Selected files preview chips */}
        {selectedFiles.length > 0 && (
          <div className="composer-attachment-chips" data-testid="attachment-chips">
            {selectedFiles.map((file, index) => (
              <div key={`${file.name}-${index}`} className="composer-attachment-chip" data-testid="attachment-chip">
                <span className="composer-attachment-chip-icon">📎</span>
                <span className="composer-attachment-chip-name" title={file.name}>
                  {file.name}
                </span>
                <span className="composer-attachment-chip-size">
                  {formatFileSize(file.size)}
                </span>
                <button
                  className="composer-attachment-chip-remove"
                  type="button"
                  title="移除"
                  aria-label={`移除 ${file.name}`}
                  onClick={() => handleRemoveFile(index)}
                  data-testid="attachment-remove-button"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload errors */}
        {uploadErrors.length > 0 && (
          <div className="composer-upload-errors" data-testid="upload-errors">
            {uploadErrors.map((error, index) => (
              <div key={index} className="composer-upload-error" data-testid="upload-error">
                <span className="composer-upload-error-icon">⚠️</span>
                <span className="composer-upload-error-text">{error}</span>
              </div>
            ))}
          </div>
        )}

        {/* Input area with attach button */}
        <div className="composer-input-row">
          <input
            ref={fileInputRef}
            type="file"
            className="composer-file-input"
            data-testid="composer-file-input"
            multiple
            accept={CLIENT_ACCEPT_STRING}
            onChange={handleFileChange}
            tabIndex={-1}
            aria-hidden="true"
          />
          {onFilesSelected && (
            <button
              className="composer-attach-button"
              type="button"
              title="添加附件"
              aria-label="添加附件"
              onClick={handleAttachClick}
              disabled={sending}
              data-testid="composer-attach-button"
            >
              +
            </button>
          )}
          <textarea
            ref={textareaRef}
            className="composer-input"
            data-testid="session-message-input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={sending}
            rows={1}
          />
        </div>

        {/* Uploading indicator */}
        {isUploading && (
          <div className="composer-uploading-indicator" data-testid="uploading-indicator">
            <span className="composer-uploading-spinner">⟳</span>
            <span className="composer-uploading-text">上传中...</span>
          </div>
        )}

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
