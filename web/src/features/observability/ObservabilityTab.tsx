import React, { useEffect, useState } from 'react'
import {
  getRuns,
  getRunConsole,
  getReplayPreview,
  type RunEntry,
  type TimelineEvent,
  type ConsoleResponse,
  type ReplayPreviewResponse,
} from '../../api/observability'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import EmptyState from '../../components/EmptyState'

type FilterStatus = 'all' | 'running' | 'completed' | 'failed'

interface ExpandedRun {
  id: string
  console: ConsoleResponse | null
  loading: boolean
  error: string | null
}

const ObservabilityTab: React.FC = () => {
  const [runs, setRuns] = useState<RunEntry[]>([])
  const [runsLoading, setRunsLoading] = useState(true)
  const [runsError, setRunsError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [expandedRuns, setExpandedRuns] = useState<Map<string, ExpandedRun>>(new Map())
  const [previewRun, setPreviewRun] = useState<{
    runId: string
    data: ReplayPreviewResponse | null
    loading: boolean
    error: string | null
  } | null>(null)

  useEffect(() => {
    let mounted = true

    const fetchRuns = async () => {
      setRunsLoading(true)
      setRunsError(null)

      try {
        const data = await getRuns(filterStatus === 'all' ? undefined : filterStatus)
        if (mounted) {
          setRuns(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
        }
      } catch (err) {
        if (mounted) {
          setRunsError(err instanceof Error ? err.message : '加载运行列表失败')
        }
      } finally {
        if (mounted) {
          setRunsLoading(false)
        }
      }
    }

    fetchRuns()

    return () => {
      mounted = false
    }
  }, [filterStatus])

  const handleRunClick = async (runId: string) => {
    const existing = expandedRuns.get(runId)
    if (existing) {
      setExpandedRuns(new Map(expandedRuns).delete(runId) ? expandedRuns : new Map())
      return
    }

    setExpandedRuns(
      new Map(expandedRuns).set(runId, {
        id: runId,
        console: null,
        loading: true,
        error: null,
      }),
    )

    try {
      const consoleData = await getRunConsole(runId)
      setExpandedRuns(
        new Map(expandedRuns).set(runId, {
          id: runId,
          console: consoleData,
          loading: false,
          error: null,
        }),
      )
    } catch (err) {
      setExpandedRuns(
        new Map(expandedRuns).set(runId, {
          id: runId,
          console: null,
          loading: false,
          error: err instanceof Error ? err.message : '加载控制台数据失败',
        }),
      )
    }
  }

  const handlePreviewClick = async (runId: string) => {
    setPreviewRun({ runId, data: null, loading: true, error: null })

    try {
      const previewData = await getReplayPreview(runId)
      setPreviewRun({ runId, data: previewData, loading: false, error: null })
    } catch (err) {
      setPreviewRun({
        runId,
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : '加载回放预览失败',
      })
    }
  }

  const closePreview = () => {
    setPreviewRun(null)
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      running: '运行中',
      completed: '已完成',
      failed: '失败',
      pending: '等待中',
      cancelled: '已取消',
    }
    return labels[status] || status
  }

  const getStatusClass = (status: string) => {
    if (status === 'running') return 'status-running'
    if (status === 'completed') return 'status-completed'
    if (status === 'failed') return 'status-failed'
    if (status === 'cancelled') return 'status-cancelled'
    return 'status-pending'
  }

  const getTypeLabel = (type: string) => {
    return type === 'planner_run' ? '计划运行' : '工作流运行'
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

  const canShowReplay = (status: string) => {
    return status === 'completed' || status === 'failed'
  }

  const renderTimeline = (timeline: TimelineEvent[]) => {
    if (timeline.length === 0) {
      return <EmptyState icon="📊" title="暂无时间线事件" description="此运行还没有记录事件" />
    }

    const sortedTimeline = [...timeline].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )

    return (
      <div className="observability-timeline">
        {sortedTimeline.map((event) => (
          <div key={event.eventId} className="observability-timeline-event">
            <div className="observability-timeline-marker" />
            <div className="observability-timeline-content">
              <div className="observability-timeline-header">
                <span className="observability-timeline-type">{event.eventType}</span>
                <span className="observability-timestamp">{formatTimestamp(event.timestamp)}</span>
              </div>
              <div className="observability-timeline-summary">{event.summary}</div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  const renderPreviewModal = () => {
    if (!previewRun) return null

    return (
      <div className="observability-modal-overlay" onClick={closePreview}>
        <div className="observability-modal" onClick={(e) => e.stopPropagation()} data-testid="replay-preview-modal">
          <div className="observability-modal-header">
            <h3>回放预览 - {previewRun.runId}</h3>
            <button
              className="observability-modal-close"
              onClick={closePreview}
              data-testid="replay-preview-close"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
          <div className="observability-modal-body">
            {previewRun.loading && <LoadingSpinner size="small" label="加载回放预览..." />}
            {previewRun.error && (
              <div className="observability-error" data-testid="replay-preview-error">
                {previewRun.error}
              </div>
            )}
            {previewRun.data && (
              <>
                <div className="observability-preview-info">
                  <div className="observability-preview-row">
                    <span className="observability-preview-label">模式:</span>
                    <span className="observability-preview-value">{previewRun.data.mode}</span>
                  </div>
                </div>
                <div className="observability-preview-section">
                  <h4>时间线事件</h4>
                  {renderTimeline(previewRun.data.timeline)}
                </div>
                <div className="observability-preview-section">
                  <h4>阻塞操作检查</h4>
                  {previewRun.data.blockedActions && previewRun.data.blockedActions.length > 0 ? (
                    <div className="observability-blocked-actions">
                      {previewRun.data.blockedActions.map((action) => (
                        <div key={action.eventId} className="observability-blocked-action">
                          <div className="observability-blocked-action-event">{action.eventId}</div>
                          <div className="observability-blocked-action-action">{action.action}</div>
                          <div className="observability-blocked-action-reason">{action.reason}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="observability-no-blocked" data-testid="no-blocked-actions">
                      无阻塞操作
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (runsLoading) {
    return (
      <div className="observability-tab" data-testid="observability-tab">
        <LoadingSpinner size="large" label="加载运行列表..." />
      </div>
    )
  }

  if (runsError) {
    return (
      <div className="observability-tab" data-testid="observability-tab">
        <ErrorMessage
          error={{ code: 'LOAD_ERROR', message: runsError } as Error & { code: string }}
          retry={{
            onClick: () => {
              setRunsLoading(true)
              setRunsError(null)
            },
          }}
          size="large"
        />
      </div>
    )
  }

  return (
    <div className="observability-tab" data-testid="observability-tab">
      <div className="observability-header">
        <h2>可观测控制台</h2>
        <div className="observability-filter">
          <label htmlFor="status-filter">状态过滤:</label>
          <select
            id="status-filter"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
            data-testid="status-filter"
          >
            <option value="all">全部</option>
            <option value="running">运行中</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
          </select>
        </div>
      </div>

      {runs.length === 0 ? (
        <EmptyState icon="📋" title="暂无运行记录" description="还没有任何工作流或计划运行" />
      ) : (
        <div className="observability-runs-list" data-testid="observability-runs-list">
          {runs.map((run) => {
            const expanded = expandedRuns.get(run.id)
            const isExpanded = !!expanded

            return (
              <div key={run.id} className="observability-run-item">
                <div
                  className={`observability-run-header ${isExpanded ? 'observability-run-header--expanded' : ''}`}
                  onClick={() => handleRunClick(run.id)}
                  data-testid={`run-header-${run.id}`}
                >
                  <div className="observability-run-info">
                    <span className="observability-run-id">{run.id}</span>
                    <span className="observability-run-type">{getTypeLabel(run.type)}</span>
                    <span className={`observability-run-status ${getStatusClass(run.status)}`}>
                      {getStatusLabel(run.status)}
                    </span>
                    <span className="observability-run-time">{formatTimestamp(run.createdAt)}</span>
                  </div>
                  {run.summary && <div className="observability-run-summary">{run.summary}</div>}
                </div>

                {isExpanded && (
                  <div className="observability-run-expanded">
                    {expanded.loading && <LoadingSpinner size="small" label="加载控制台数据..." />}
                    {expanded.error && <div className="observability-error">{expanded.error}</div>}
                    {expanded.console && (
                      <>
                        <div className="observability-run-console">
                          <h4>时间线</h4>
                          {renderTimeline(expanded.console.timeline)}
                        </div>
                        {canShowReplay(run.status) && (
                          <div className="observability-run-actions">
                            <button
                              className="observability-replay-button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handlePreviewClick(run.id)
                              }}
                              data-testid={`replay-preview-button-${run.id}`}
                            >
                              回放预览
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {renderPreviewModal()}
    </div>
  )
}

export default ObservabilityTab
