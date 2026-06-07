import React, { useCallback, useEffect, useState } from 'react'
import * as dlqApi from '../../api/dlq'
import type { DeadLetterEntry } from '../../api/types'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import EmptyState from '../../components/EmptyState'

type FilterStatus = 'all' | 'pending' | 'retrying' | 'discarded' | 'resolved'

const DLQTab: React.FC = () => {
  const [entries, setEntries] = useState<DeadLetterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set())

  const loadEntries = useCallback(async (status?: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await dlqApi.getDlqEntries(status === 'all' ? undefined : status)
      setEntries(data.entries.sort((a, b) => new Date(b.enqueuedAt).getTime() - new Date(a.enqueuedAt).getTime()))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载死信队列失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEntries(filterStatus === 'all' ? undefined : filterStatus)
  }, [filterStatus, loadEntries])

  const handleRetry = async (eventId: string) => {
    setActionLoading(new Set([...actionLoading, eventId]))
    try {
      const result = await dlqApi.retryDlqEntry(eventId)
      if (result.success) {
        setEntries((prev) => prev.filter((e) => e.eventId !== eventId))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '重试失败')
    } finally {
      const next = new Set(actionLoading)
      next.delete(eventId)
      setActionLoading(next)
    }
  }

  const handleDiscard = async (eventId: string) => {
    setActionLoading(new Set([...actionLoading, eventId]))
    try {
      const result = await dlqApi.discardDlqEntry(eventId)
      if (result.success) {
        setEntries((prev) => prev.filter((e) => e.eventId !== eventId))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '丢弃失败')
    } finally {
      const next = new Set(actionLoading)
      next.delete(eventId)
      setActionLoading(next)
    }
  }

  const handleBatchRetry = async () => {
    const ids = Array.from(selectedIds)
    try {
      const result = await dlqApi.batchRetryDlqEntries(ids)
      const succeededIds = new Set(result.results.filter((r) => r.success).map((r) => r.eventId))
      setEntries((prev) => prev.filter((e) => !succeededIds.has(e.eventId)))
      setSelectedIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量重试失败')
    }
  }

  const handleBatchDiscard = async () => {
    const ids = Array.from(selectedIds)
    try {
      const result = await dlqApi.batchDiscardDlqEntries(ids)
      const succeededIds = new Set(result.results.filter((r) => r.success).map((r) => r.eventId))
      setEntries((prev) => prev.filter((e) => !succeededIds.has(e.eventId)))
      setSelectedIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量丢弃失败')
    }
  }

  const toggleSelect = (eventId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) {
        next.delete(eventId)
      } else {
        next.add(eventId)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(entries.map((e) => e.eventId)))
    }
  }

  const toggleExpand = (eventId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) {
        next.delete(eventId)
      } else {
        next.add(eventId)
      }
      return next
    })
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
  }

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return timestamp
    }
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: '待处理',
      retrying: '重试中',
      discarded: '已丢弃',
      resolved: '已解决',
    }
    return labels[status] || status
  }

  const getStatusClass = (status: string) => {
    if (status === 'pending') return 'dlq-status-pending'
    if (status === 'retrying') return 'dlq-status-retrying'
    if (status === 'discarded') return 'dlq-status-discarded'
    if (status === 'resolved') return 'dlq-status-resolved'
    return 'dlq-status-pending'
  }

  if (loading) {
    return (
      <div className="dlq-tab" data-testid="dlq-panel">
        <LoadingSpinner size="large" label="加载死信队列..." />
      </div>
    )
  }

  if (error && entries.length === 0) {
    return (
      <div className="dlq-tab" data-testid="dlq-panel">
        <ErrorMessage
          error={{ code: 'LOAD_ERROR', message: error } as Error & { code: string }}
          retry={{ onClick: () => loadEntries() }}
          size="large"
        />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="dlq-tab" data-testid="dlq-panel">
        <div className="dlq-header">
          <h2>死信队列</h2>
          <div className="dlq-filter">
            <label htmlFor="status-filter">状态过滤:</label>
            <select
              id="status-filter"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
              data-testid="status-filter"
            >
              <option value="all">全部</option>
              <option value="pending">待处理</option>
              <option value="retrying">重试中</option>
              <option value="discarded">已丢弃</option>
              <option value="resolved">已解决</option>
            </select>
          </div>
        </div>
        <EmptyState icon="📭" title="暂无死信事件" description="所有事件处理正常，没有失败的事件" />
      </div>
    )
  }

  return (
    <div className="dlq-tab" data-testid="dlq-panel">
      <div className="dlq-header">
        <h2>死信队列</h2>
        <div className="dlq-filter">
          <label htmlFor="status-filter">状态过滤:</label>
          <select
            id="status-filter"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
            data-testid="status-filter"
          >
            <option value="all">全部</option>
            <option value="pending">待处理</option>
            <option value="retrying">重试中</option>
            <option value="discarded">已丢弃</option>
            <option value="resolved">已解决</option>
          </select>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="dlq-batch-toolbar" data-testid="batch-toolbar">
          <span className="dlq-batch-count">已选择 {selectedIds.size} 项</span>
          <button className="primary-button" onClick={handleBatchRetry} data-testid="batch-retry-btn">
            批量重试
          </button>
          <button
            className="secondary-button dlq-discard-btn"
            onClick={handleBatchDiscard}
            data-testid="batch-discard-btn"
          >
            批量丢弃
          </button>
          <button className="secondary-button" onClick={clearSelection} data-testid="clear-selection">
            取消选择
          </button>
        </div>
      )}

      <div className="dlq-list" data-testid="dlq-list">
        <div className="dlq-list-header">
          <input
            type="checkbox"
            checked={selectedIds.size === entries.length && entries.length > 0}
            onChange={toggleSelectAll}
            data-testid="select-all"
            className="dlq-checkbox"
          />
          <span className="dlq-col-source">来源模块</span>
          <span className="dlq-col-id">来源 ID</span>
          <span className="dlq-col-reason">错误原因</span>
          <span className="dlq-col-status">状态</span>
          <span className="dlq-col-time">入队时间</span>
          <span className="dlq-col-actions">操作</span>
        </div>

        {entries.map((entry) => {
          const isSelected = selectedIds.has(entry.eventId)
          const isExpanded = expandedIds.has(entry.eventId)
          const isActionLoading = actionLoading.has(entry.eventId)

          return (
            <div key={entry.eventId} className="dlq-entry-row" data-testid={`dlq-entry-${entry.eventId}`}>
              <div className="dlq-entry-main">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(entry.eventId)}
                  data-testid={`select-${entry.eventId}`}
                  className="dlq-checkbox"
                />
                <span className="dlq-col-source">{entry.sourceModule}</span>
                <span className="dlq-col-id">{entry.sourceId}</span>
                <span className="dlq-col-reason">{entry.reason}</span>
                <span className={`dlq-col-status ${getStatusClass(entry.status)}`}>{getStatusLabel(entry.status)}</span>
                <span className="dlq-col-time">{formatTimestamp(entry.enqueuedAt)}</span>
                <div className="dlq-col-actions">
                  {entry.status === 'pending' && (
                    <>
                      <button
                        className="dlq-action-btn dlq-retry-btn"
                        onClick={() => handleRetry(entry.eventId)}
                        disabled={isActionLoading}
                        data-testid={`retry-${entry.eventId}`}
                      >
                        {isActionLoading ? '处理中...' : '重试'}
                      </button>
                      <button
                        className="dlq-action-btn dlq-discard-entry-btn"
                        onClick={() => handleDiscard(entry.eventId)}
                        disabled={isActionLoading}
                        data-testid={`discard-${entry.eventId}`}
                      >
                        {isActionLoading ? '处理中...' : '丢弃'}
                      </button>
                    </>
                  )}
                  <button
                    className="dlq-expand-btn"
                    onClick={() => toggleExpand(entry.eventId)}
                    data-testid={`expand-${entry.eventId}`}
                  >
                    {isExpanded ? '收起' : '详情'}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="dlq-detail" data-testid={`dlq-detail-${entry.eventId}`}>
                  <div className="dlq-detail-section">
                    <h4>错误详情</h4>
                    <pre className="dlq-error-stack">{entry.lastError || entry.reason}</pre>
                  </div>
                  <div className="dlq-detail-section">
                    <h4>原始事件数据</h4>
                    <pre className="dlq-payload">{entry.payload ? JSON.stringify(entry.payload, null, 2) : '无'}</pre>
                  </div>
                  <div className="dlq-detail-meta">
                    <span>失败次数: {entry.failureCount}</span>
                    <span>入队时间: {formatTimestamp(entry.enqueuedAt)}</span>
                    <span>更新时间: {formatTimestamp(entry.updatedAt)}</span>
                    {entry.discardedAt && <span>丢弃时间: {formatTimestamp(entry.discardedAt)}</span>}
                    {entry.resolvedAt && <span>解决时间: {formatTimestamp(entry.resolvedAt)}</span>}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default DLQTab
