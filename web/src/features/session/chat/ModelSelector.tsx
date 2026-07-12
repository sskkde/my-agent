import React, { useEffect, useRef } from 'react'
import type { ModelsResponse } from '../../../api/types'

export interface ModelSelectorProps {
  model: string
  status: string
  sessionId: string | null
  disabled?: boolean
  modelsData?: ModelsResponse
  modelsLoading?: boolean
  modelsError?: string | null
  selectedSessionModel?: string
  onOpen: () => void
  onSelect: (providerId: string, model: string) => void
  onClose: () => void
  isOpen: boolean
}

const POPOVER_ID = 'chat-model-popover'

const getCandidateModel = (provider: ModelsResponse['providers'][number]): string | null => {
  return provider.selectedModel ?? provider.defaultModel ?? null
}

const isProviderSelectable = (provider: ModelsResponse['providers'][number]): boolean => {
  return Boolean(provider.enabled && provider.configured)
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  model,
  status,
  sessionId,
  disabled = false,
  modelsData,
  modelsLoading = false,
  modelsError = null,
  selectedSessionModel,
  onOpen,
  onSelect,
  onClose,
  isOpen,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const canOpen = Boolean(sessionId) && !disabled

  const handleToggle = () => {
    if (!canOpen) return
    if (isOpen) {
      onClose()
    } else {
      onOpen()
    }
  }

  // Close on Escape
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

  // Close on outside click
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

  // Return focus to trigger when closing
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
      ? '处理中无法切换模型'
      : '点击切换模型'

  const selectedProviderId = modelsData?.selectedProviderId
  const selectedModel = selectedSessionModel ?? modelsData?.selectedModel

  const providers = modelsData?.providers ?? []
  const hasProviders = providers.length > 0

  return (
    <div className="chat-model-selector" ref={wrapperRef} data-testid="chat-model-selector">
      <button
        ref={triggerRef}
        type="button"
        className={`chat-status-segment chat-status-segment--model chat-model-trigger ${isOpen ? 'chat-model-trigger--open' : ''}`}
        onClick={handleToggle}
        disabled={!canOpen}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={POPOVER_ID}
        title={triggerTitle}
        data-testid="chat-model-selector-trigger"
      >
        <span className={`chat-status-dot chat-status-dot--${status}`} />
        <span className="chat-status-label">{model}</span>
      </button>

      {isOpen && (
        <div
          id={POPOVER_ID}
          className="chat-model-popover"
          role="listbox"
          aria-label="选择模型"
          data-testid="chat-model-popover"
        >
          {modelsLoading && (
            <div className="chat-model-state" data-testid="chat-model-loading">
              <span>加载模型列表…</span>
            </div>
          )}

          {!modelsLoading && modelsError && (
            <div className="chat-model-state chat-model-state--error" data-testid="chat-model-error">
              <span>{modelsError}</span>
              <button
                type="button"
                className="chat-model-state__retry"
                onClick={onOpen}
                data-testid="chat-model-retry"
              >
                重试
              </button>
            </div>
          )}

          {!modelsLoading && !modelsError && !hasProviders && (
            <div className="chat-model-state" data-testid="chat-model-empty">
              <span>无可用模型</span>
            </div>
          )}

          {!modelsLoading && !modelsError && hasProviders && (
            <div className="chat-model-provider-list" data-testid="chat-model-provider-list">
              {providers.map((provider) => {
                const candidate = getCandidateModel(provider)
                const selectable = isProviderSelectable(provider) && candidate !== null
                const isSelected =
                  candidate !== null &&
                  candidate === selectedModel &&
                  (selectedProviderId === undefined || provider.providerId === selectedProviderId)

                return (
                  <div key={provider.providerId} className="chat-model-provider" data-testid={`chat-model-provider-${provider.providerId}`}>
                    <div className="chat-model-provider-header">
                      <span className="chat-model-provider-name">{provider.displayName}</span>
                      <span className="chat-model-provider-meta">
                        {provider.source}
                        {!provider.enabled && ' · 已禁用'}
                        {provider.enabled && !provider.configured && ' · 未配置'}
                      </span>
                    </div>
                    {candidate ? (
                      <button
                        type="button"
                        className={`chat-model-option ${isSelected ? 'chat-model-option--selected' : ''}`}
                        role="option"
                        aria-selected={isSelected}
                        disabled={!selectable}
                        onClick={() => {
                          if (selectable && candidate) {
                            onSelect(provider.providerId, candidate)
                          }
                        }}
                        data-testid={`chat-model-option-${provider.providerId}`}
                      >
                        <span className="chat-model-option-label">{candidate}</span>
                        {isSelected && <span className="chat-model-option-check">✓</span>}
                      </button>
                    ) : (
                      <div className="chat-model-option chat-model-option--disabled" data-testid={`chat-model-option-${provider.providerId}`}>
                        <span className="chat-model-option-label">未配置模型</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ModelSelector
