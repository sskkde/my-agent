import React, { useCallback } from 'react'
import type { WorkdirFileContent } from '../../../api/types'

export interface WorkdirFileEditorProps {
  file: WorkdirFileContent | null
  loading: boolean
  error: string | null
  content: string
  dirty: boolean
  saving: boolean
  saveError: string | null
  onContentChange: (content: string) => void
  onSave: () => void
  onClose: () => void
}

export const WorkdirFileEditor: React.FC<WorkdirFileEditorProps> = ({
  file,
  loading,
  error,
  content,
  dirty,
  saving,
  saveError,
  onContentChange,
  onSave,
  onClose,
}) => {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl/Cmd+S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (dirty && !saving) {
          onSave()
        }
      }
    },
    [dirty, saving, onSave],
  )

  if (loading) {
    return (
      <div className="workdir-file-editor workdir-file-editor--loading" data-testid="workdir-file-editor">
        <div className="workdir-file-editor-loading">加载文件中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="workdir-file-editor workdir-file-editor--error" data-testid="workdir-file-editor">
        <div className="workdir-file-editor-error" data-testid="workdir-file-editor-error">
          {error}
        </div>
        <button className="workdir-file-editor-close-btn" onClick={onClose} data-testid="workdir-file-editor-close">
          关闭
        </button>
      </div>
    )
  }

  if (!file) {
    return null
  }

  return (
    <div className="workdir-file-editor" data-testid="workdir-file-editor">
      {/* Header */}
      <div className="workdir-file-editor-header">
        <div className="workdir-file-editor-filename">
          <span className="workdir-file-editor-icon">📄</span>
          <span className="workdir-file-editor-path" data-testid="workdir-file-editor-path">
            {file.path}
          </span>
          {dirty && <span className="workdir-file-editor-dirty" data-testid="workdir-file-editor-dirty">●</span>}
        </div>
        <div className="workdir-file-editor-actions">
          <button
            className="workdir-file-editor-save-btn"
            onClick={onSave}
            disabled={!dirty || saving}
            data-testid="workdir-file-editor-save"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            className="workdir-file-editor-close-btn"
            onClick={onClose}
            data-testid="workdir-file-editor-close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Save error */}
      {saveError && (
        <div className="workdir-file-editor-save-error" data-testid="workdir-file-editor-save-error">
          {saveError}
        </div>
      )}

      {/* Editor textarea */}
      <textarea
        className="workdir-file-editor-textarea"
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        data-testid="workdir-file-editor-textarea"
      />

      {/* Footer info */}
      <div className="workdir-file-editor-footer">
        <span className="workdir-file-editor-size">{file.sizeBytes} 字节</span>
        <span className="workdir-file-editor-modified">修改于 {new Date(file.modifiedAt).toLocaleString()}</span>
      </div>
    </div>
  )
}
