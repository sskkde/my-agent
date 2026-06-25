import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { WorkdirInfo } from '../../../api/types'

export interface WorkdirSelectorProps {
  workdirs: WorkdirInfo[]
  activeWorkdir: WorkdirInfo | null
  loading: boolean
  onSelect: (workdirId: string) => void
  onCreate: (name: string) => Promise<WorkdirInfo | null>
  onClear: () => void
}

export const WorkdirSelector: React.FC<WorkdirSelectorProps> = ({
  workdirs,
  activeWorkdir,
  loading,
  onSelect,
  onCreate,
  onClear,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setIsCreating(false)
        setNewName('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Focus input when creating
  useEffect(() => {
    if (isCreating) {
      inputRef.current?.focus()
    }
  }, [isCreating])

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    const result = await onCreate(trimmed)
    if (result) {
      setIsOpen(false)
      setIsCreating(false)
      setNewName('')
    }
  }, [newName, onCreate])

  const handleCreateKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleCreate()
      } else if (e.key === 'Escape') {
        setIsCreating(false)
        setNewName('')
      }
    },
    [handleCreate],
  )

  return (
    <div className="workdir-selector" ref={dropdownRef} data-testid="workdir-selector">
      <button
        className="workdir-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
        data-testid="workdir-selector-trigger"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="workdir-selector-icon">📁</span>
        <span className="workdir-selector-name">
          {loading ? '加载中...' : activeWorkdir ? activeWorkdir.name : '未选择工作目录'}
        </span>
        <span className="workdir-selector-chevron">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="workdir-selector-dropdown" role="listbox" data-testid="workdir-selector-dropdown">
          {/* Clear selection option */}
          {activeWorkdir && (
            <button
              className="workdir-selector-option workdir-selector-option--clear"
              onClick={() => {
                onClear()
                setIsOpen(false)
              }}
              data-testid="workdir-selector-clear"
            >
              清除选择
            </button>
          )}

          {/* Workdir list */}
          {workdirs.map((w) => (
            <button
              key={w.id}
              className={`workdir-selector-option ${activeWorkdir?.id === w.id ? 'workdir-selector-option--active' : ''}`}
              onClick={() => {
                onSelect(w.id)
                setIsOpen(false)
              }}
              data-testid={`workdir-option-${w.id}`}
              role="option"
              aria-selected={activeWorkdir?.id === w.id}
            >
              <span className="workdir-selector-option-name">{w.name}</span>
              {activeWorkdir?.id === w.id && <span className="workdir-selector-option-check">✓</span>}
            </button>
          ))}

          {/* Create new */}
          {isCreating ? (
            <div className="workdir-selector-create" data-testid="workdir-selector-create-form">
              <input
                ref={inputRef}
                type="text"
                className="workdir-selector-create-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={handleCreateKeyDown}
                placeholder="输入名称..."
                data-testid="workdir-create-input"
              />
              <div className="workdir-selector-create-actions">
                <button
                  className="workdir-selector-create-confirm"
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  data-testid="workdir-create-confirm"
                >
                  创建
                </button>
                <button
                  className="workdir-selector-create-cancel"
                  onClick={() => {
                    setIsCreating(false)
                    setNewName('')
                  }}
                  data-testid="workdir-create-cancel"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              className="workdir-selector-option workdir-selector-option--create"
              onClick={() => setIsCreating(true)}
              data-testid="workdir-create-new"
            >
              + 新建工作目录
            </button>
          )}
        </div>
      )}
    </div>
  )
}
