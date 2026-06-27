import React, { useState, useEffect, useRef, useCallback } from 'react'
import LoadingSpinner from './LoadingSpinner'
import {
  getBrowserStatus,
  acquireTakeover,
  releaseTakeover,
  sendInput,
  subscribeToFrames,
} from '../api/client'
import type {
  BrowserStatusResponse,
  BrowserStreamEvent,
  BrowserSessionState,
} from '../api/types'

export interface BrowserHandoffPanelProps {
  sessionId: string
}

const stateLabels: Record<BrowserSessionState, string> = {
  idle: '空闲',
  agent_controlled: 'Agent 控制中',
  user_controlled: '你已接管',
  handoff_requested: 'Agent 请求接管',
}

const stateBadgeClass: Record<BrowserSessionState, string> = {
  idle: 'browser-handoff__badge--idle',
  agent_controlled: 'browser-handoff__badge--agent',
  user_controlled: 'browser-handoff__badge--user',
  handoff_requested: 'browser-handoff__badge--requested',
}

export const BrowserHandoffPanel: React.FC<BrowserHandoffPanelProps> = ({ sessionId }) => {
  const [status, setStatus] = useState<BrowserStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null)
  const [inputText, setInputText] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const frameImgRef = useRef<HTMLImageElement>(null)
  const frameUrlRef = useRef<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const data = await getBrowserStatus(sessionId)
      setStatus(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch browser status')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  useEffect(() => {
    if (loading) return

    const unsubscribe = subscribeToFrames(
      sessionId,
      (event: BrowserStreamEvent) => {
        if (event.type === 'frame') {
          if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current)
          const binary = atob(event.data)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
          }
          const blob = new Blob([bytes], { type: 'image/jpeg' })
          const url = URL.createObjectURL(blob)
          frameUrlRef.current = url
          setFrameUrl(url)
          setFrameSize({ width: event.width, height: event.height })
        } else if (event.type === 'snapshot') {
          void fetchStatus()
        }
      },
      (err) => {
        setError(err.message)
      },
    )

    return () => {
      unsubscribe()
    }
  }, [loading, sessionId, fetchStatus])

  useEffect(() => {
    return () => {
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current)
    }
  }, [])

  const isUserControlled = status?.state === 'user_controlled'
  const isAgentControlled = status?.state === 'agent_controlled'
  const isHandoffRequested = status?.state === 'handoff_requested'
  const isIdle = status?.state === 'idle'
  const hasLease = isUserControlled

  const handleTakeOver = async () => {
    setActionLoading(true)
    try {
      const result = await acquireTakeover(sessionId)
      setStatus((prev) =>
        prev ? { ...prev, state: result.state } : prev,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Takeover failed')
    } finally {
      setActionLoading(false)
    }
  }

  const handleRelease = async () => {
    setActionLoading(true)
    try {
      const result = await releaseTakeover(sessionId)
      setStatus((prev) =>
        prev ? { ...prev, state: result.state } : prev,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Release failed')
    } finally {
      setActionLoading(false)
    }
  }

  const handleFrameClick = useCallback(
    async (e: React.MouseEvent<HTMLImageElement>) => {
      if (!hasLease || !frameSize || !frameImgRef.current) return

      const img = frameImgRef.current
      const rect = img.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height

      try {
        await sendInput(sessionId, {
          action: 'click',
          payload: { x, y, button: 'left', clickCount: 1 },
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Click failed')
      }
    },
    [hasLease, frameSize, sessionId],
  )

  const handleFrameScroll = useCallback(
    async (e: React.WheelEvent<HTMLImageElement>) => {
      if (!hasLease) return

      e.preventDefault()
      try {
        await sendInput(sessionId, {
          action: 'scroll',
          payload: { deltaX: e.deltaX, deltaY: e.deltaY },
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Scroll failed')
      }
    },
    [hasLease, sessionId],
  )

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      if (!hasLease) return
      if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return

      e.preventDefault()
      const modifiers: Array<'Alt' | 'Control' | 'Meta' | 'Shift'> = []
      if (e.altKey) modifiers.push('Alt')
      if (e.ctrlKey) modifiers.push('Control')
      if (e.metaKey) modifiers.push('Meta')
      if (e.shiftKey) modifiers.push('Shift')

      try {
        await sendInput(sessionId, {
          action: 'keypress',
          payload: { key: e.key, modifiers },
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Key input failed')
      }
    },
    [hasLease, sessionId],
  )

  const handleTextSubmit = async () => {
    if (!hasLease || !inputText.trim()) return

    try {
      await sendInput(sessionId, {
        action: 'type',
        payload: { text: inputText },
      })
      setInputText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Text input failed')
    }
  }

  if (loading) {
    return (
      <div className="browser-handoff browser-handoff--loading" data-testid="browser-handoff">
        <LoadingSpinner size="small" label="加载浏览器状态..." />
      </div>
    )
  }

  if (isIdle && !frameUrl) {
    return (
      <div className="browser-handoff browser-handoff--empty" data-testid="browser-handoff">
        <div className="browser-handoff__empty-icon" aria-hidden="true">
          🖥
        </div>
        <p className="browser-handoff__empty-text">没有活跃的浏览器会话</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`browser-handoff${hasLease ? ' browser-handoff--active' : ''}`}
      data-testid="browser-handoff"
      data-state={status?.state ?? 'unknown'}
    >
      <div className="browser-handoff__header">
        <span className={`browser-handoff__badge ${stateBadgeClass[status?.state ?? 'idle']}`}>
          {stateLabels[status?.state ?? 'idle']}
        </span>

        <div className="browser-handoff__actions">
          {isAgentControlled && (
            <button
              className="browser-handoff__btn browser-handoff__btn--takeover"
              data-testid="takeover-btn"
              onClick={handleTakeOver}
              disabled={actionLoading}
              type="button"
            >
              {actionLoading ? '处理中...' : '接管'}
            </button>
          )}
          {isUserControlled && (
            <button
              className="browser-handoff__btn browser-handoff__btn--release"
              data-testid="release-btn"
              onClick={handleRelease}
              disabled={actionLoading}
              type="button"
            >
              {actionLoading ? '处理中...' : '释放'}
            </button>
          )}
        </div>
      </div>

      {isHandoffRequested && (
        <div className="browser-handoff__banner" data-testid="agent-request-banner">
          Agent 请求接管浏览器，请释放控制权
        </div>
      )}

      {error && (
        <div className="browser-handoff__error" data-testid="browser-error">
          {error}
        </div>
      )}

      <div className="browser-handoff__frame-wrapper">
        {frameUrl ? (
          <img
            ref={frameImgRef}
            className="browser-handoff__frame"
            data-testid="browser-frame"
            src={frameUrl}
            alt="浏览器实时画面"
            onClick={handleFrameClick}
            onWheel={handleFrameScroll}
            tabIndex={hasLease ? 0 : -1}
            onKeyDown={hasLease ? handleKeyDown : undefined}
            onFocus={() => {
              if (hasLease) containerRef.current?.classList.add('browser-handoff--focused')
            }}
            onBlur={() => {
              containerRef.current?.classList.remove('browser-handoff--focused')
            }}
          />
        ) : (
          <div className="browser-handoff__placeholder">
            <LoadingSpinner size="small" label="等待画面..." />
          </div>
        )}
      </div>

      {hasLease && (
        <div className="browser-handoff__input-overlay" data-testid="input-overlay">
          <input
            className="browser-handoff__text-input"
            data-testid="text-input"
            type="text"
            placeholder="输入文字后回车发送..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void handleTextSubmit()
              }
            }}
          />
        </div>
      )}
    </div>
  )
}

export default BrowserHandoffPanel
