import React, { useEffect, useRef } from 'react'
import type { ReasoningDepth } from '../../../api/types'

export const REASONING_DEPTH_OPTIONS: Array<{ value: ReasoningDepth; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

const LABEL_MAP: Record<ReasoningDepth, string> = {
  off: '推理:关',
  low: '推理:低',
  medium: '推理:中',
  high: '推理:高',
}

export interface ReasoningDepthSelectorProps {
  value: ReasoningDepth
  sessionId: string | null
  disabled?: boolean
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  onSelect: (depth: ReasoningDepth) => void
}

const POPOVER_ID = 'chat-reasoning-depth-popover'

export const ReasoningDepthSelector: React.FC<ReasoningDepthSelectorProps> = ({
  value,
  sessionId,
  disabled = false,
  isOpen,
  onOpen,
  onClose,
  onSelect,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const canOpen = Boolean(sessionId) && !disabled

  const handleToggle = () => {
    if (!canOpen) return
    if (isOpen) onClose()
    else onOpen()
  }

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (wrapperRef.current && !wrapperRef.current.contains(target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) {
      requestAnimationFrame(() => {
        triggerRef.current?.focus()
      })
    }
  }, [isOpen])

  const triggerTitle = !sessionId
    ? '未选择会话'
    : disabled
      ? '处理中无法切换推理深度'
      : '点击切换推理深度'

  return (
    <div className="chat-reasoning-selector" ref={wrapperRef} data-testid="chat-reasoning-depth-selector">
      <button
        ref={triggerRef}
        type="button"
        className={`chat-status-segment chat-status-segment--reasoning chat-reasoning-trigger ${isOpen ? 'chat-reasoning-trigger--open' : ''}`}
        onClick={handleToggle}
        disabled={!canOpen}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={POPOVER_ID}
        title={triggerTitle}
        data-testid="chat-reasoning-depth-trigger"
      >
        <span className="chat-status-sub">{LABEL_MAP[value]}</span>
      </button>

      {isOpen && (
        <div
          id={POPOVER_ID}
          className="chat-reasoning-popover"
          role="listbox"
          aria-label="选择推理深度"
          data-testid="chat-reasoning-depth-popover"
        >
          {REASONING_DEPTH_OPTIONS.map((opt) => {
            const isSelected = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                className={`chat-reasoning-option ${isSelected ? 'chat-reasoning-option--selected' : ''}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelect(opt.value)}
                data-testid={`chat-reasoning-depth-option-${opt.value}`}
              >
                <span className="chat-reasoning-option-label">{opt.label}</span>
                {isSelected && <span className="chat-reasoning-option-check">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ReasoningDepthSelector
