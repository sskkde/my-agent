import React, { useState, useMemo } from 'react'
import EmptyState from './EmptyState'
import LoadingSpinner from './LoadingSpinner'

export interface TimelineViewEvent {
  eventId: string
  eventType: string
  timestamp: string
  description: string
  status: string
  module: string
}

export interface TimelineViewProps {
  events: TimelineViewEvent[]
  onEventClick?: (eventId: string) => void
  loading?: boolean
}

const TimelineView: React.FC<TimelineViewProps> = ({ events, onEventClick, loading = false }) => {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [events])

  const formatTime = (timestamp: string): string => {
    try {
      const date = new Date(timestamp)
      return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return timestamp
    }
  }

  const formatDate = (timestamp: string): string => {
    try {
      const date = new Date(timestamp)
      return date.toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return ''
    }
  }

  const getEventTypeClass = (eventType: string): string => {
    const typeMap: Record<string, string> = {
      user_message: 'user',
      assistant_message: 'assistant',
      tool_call: 'tool',
      tool_result: 'tool',
      approval_request: 'approval',
      approval_decision: 'approval',
      run_started: 'run',
      run_progress: 'run',
      run_completed: 'completed',
      run_failed: 'failed',
      run_cancelled: 'cancelled',
      error: 'error',
      system_status: 'system',
    }
    return typeMap[eventType] || 'default'
  }

  const getEventTypeLabel = (eventType: string): string => {
    const labels: Record<string, string> = {
      user_message: '用户消息',
      assistant_message: '助手回复',
      thinking_summary: '思考摘要',
      tool_call: '工具调用',
      tool_result: '工具结果',
      approval_request: '审批请求',
      approval_decision: '审批决策',
      run_started: '运行开始',
      run_progress: '运行进度',
      run_completed: '运行完成',
      run_failed: '运行失败',
      run_cancelled: '运行取消',
      error: '错误',
      system_status: '系统状态',
    }
    return labels[eventType] || eventType
  }

  const handleEventClick = (eventId: string) => {
    if (expandedEventId === eventId) {
      setExpandedEventId(null)
    } else {
      setExpandedEventId(eventId)
    }
    onEventClick?.(eventId)
  }

  if (loading) {
    return (
      <div className="timeline-view" data-testid="timeline-view">
        <div className="timeline-view__loading">
          <LoadingSpinner label="加载时间线..." />
        </div>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="timeline-view" data-testid="timeline-view">
        <EmptyState icon="📅" title="暂无时间线事件" description="当前没有任何事件记录" />
      </div>
    )
  }

  return (
    <div className="timeline-view" data-testid="timeline-view">
      <div className="timeline-view__line" aria-hidden="true" />
      <ul className="timeline-view__list" role="list">
        {sortedEvents.map((event, index) => {
          const isExpanded = expandedEventId === event.eventId
          const prevEvent = sortedEvents[index + 1]
          const showDateHeader = !prevEvent || formatDate(event.timestamp) !== formatDate(prevEvent.timestamp)

          return (
            <li key={event.eventId} className="timeline-view__item">
              {showDateHeader && <div className="timeline-view__date-header">{formatDate(event.timestamp)}</div>}
              <div
                className={`timeline-view__event timeline-view__event--${getEventTypeClass(event.eventType)} ${isExpanded ? 'timeline-view__event--expanded' : ''}`}
                onClick={() => handleEventClick(event.eventId)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleEventClick(event.eventId)
                  }
                }}
                data-testid={`timeline-event-${event.eventId}`}
                aria-expanded={isExpanded}
              >
                <div
                  className={`timeline-view__dot timeline-view__dot--${getEventTypeClass(event.eventType)}`}
                  aria-hidden="true"
                />
                <div className="timeline-view__card">
                  <div className="timeline-view__card-header">
                    <span className="timeline-view__time">{formatTime(event.timestamp)}</span>
                    <span
                      className={`timeline-view__type-badge timeline-view__type-badge--${getEventTypeClass(event.eventType)}`}
                    >
                      {getEventTypeLabel(event.eventType)}
                    </span>
                  </div>
                  <div className="timeline-view__card-body">
                    <p className="timeline-view__description">{event.description}</p>
                    <span className="timeline-view__module">{event.module}</span>
                  </div>
                  {isExpanded && (
                    <div className="timeline-view__card-expanded">
                      <dl className="timeline-view__details">
                        <div className="timeline-view__detail-row">
                          <dt>事件ID</dt>
                          <dd className="timeline-view__mono">{event.eventId}</dd>
                        </div>
                        <div className="timeline-view__detail-row">
                          <dt>状态</dt>
                          <dd>{event.status}</dd>
                        </div>
                        <div className="timeline-view__detail-row">
                          <dt>模块</dt>
                          <dd>{event.module}</dd>
                        </div>
                        <div className="timeline-view__detail-row">
                          <dt>时间戳</dt>
                          <dd>{event.timestamp}</dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default TimelineView
