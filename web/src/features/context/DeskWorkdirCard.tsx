import React, { useEffect, useState, useCallback, useRef } from 'react'
import * as client from '../../api/client'
import type { WorkdirInfo } from '../../api/client'

export interface DeskWorkdirCardProps {
  sessionId?: string | null
  className?: string
  testId?: string
}

const DeskWorkdirCard: React.FC<DeskWorkdirCardProps> = ({
  sessionId,
  className = '',
  testId = 'desk-workdir-card',
}) => {
  const [activeWorkdir, setActiveWorkdir] = useState<WorkdirInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const fetchWorkdir = useCallback(async () => {
    if (!sessionId) {
      setActiveWorkdir(null)
      return
    }
    const currentSessionId = sessionId
    setLoading(true)
    setError(null)
    try {
      const response = await client.getSessionWorkdir(currentSessionId)
      if (currentSessionId === sessionIdRef.current) {
        setActiveWorkdir(response.workdir)
      }
    } catch (err) {
      if (currentSessionId === sessionIdRef.current) {
        setError(err instanceof Error ? err : new Error('Failed to load workdir'))
      }
    } finally {
      if (currentSessionId === sessionIdRef.current) {
        setLoading(false)
      }
    }
  }, [sessionId])

  useEffect(() => {
    fetchWorkdir()
  }, [fetchWorkdir])

  return (
    <div className={`desk-workdir-card ${className}`} data-testid={testId}>
      {loading ? (
        <div className="desk-loading">
          <span className="desk-loading__spinner">⏳</span>
          <span>加载中...</span>
        </div>
      ) : error ? (
        <div className="desk-error">
          <span className="desk-error__icon">⚠️</span>
          <span>加载失败</span>
          <button className="desk-error__retry" onClick={fetchWorkdir}>
            重试
          </button>
        </div>
      ) : !activeWorkdir ? (
        <div className="desk-empty" data-testid="desk-empty">
          <div className="desk-empty__icon">🗂️</div>
          <div className="desk-empty__text">
            <span className="desk-empty__title">暂无书桌内容</span>
            <span className="desk-empty__hint">选择工作目录后显示文件</span>
          </div>
        </div>
      ) : (
        <div className="desk-workdir-card__content" data-testid="desk-workdir-content">
          <div className="desk-workdir-card__workdir-name">{activeWorkdir.name}</div>
        </div>
      )}
    </div>
  )
}

export default DeskWorkdirCard
