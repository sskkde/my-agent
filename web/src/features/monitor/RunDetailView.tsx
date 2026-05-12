import React, { useEffect, useState, useMemo } from 'react';
import * as api from '../../api/client';
import type { RunInfo, PlannerRunEvent, PlannerRunSummary } from '../../api/types';

interface RunDetailViewProps {
  run: RunInfo;
  onClose?: () => void;
}

const RunDetailView: React.FC<RunDetailViewProps> = ({ run, onClose }) => {
  const [events, setEvents] = useState<PlannerRunEvent[]>([]);
  const [summary, setSummary] = useState<PlannerRunSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const plannerRunId = useMemo(() => {
    return (run as RunInfo & { plannerRunId?: string }).plannerRunId;
  }, [run]);

  useEffect(() => {
    let mounted = true;

    const fetchData = async () => {
      if (!plannerRunId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [eventsResponse, summaryResponse] = await Promise.all([
          api.getPlannerRunEvents(plannerRunId),
          api.getPlannerRunSummary(plannerRunId),
        ]);

        if (mounted) {
          setEvents(eventsResponse.events);
          setSummary(summaryResponse.summary);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : '加载运行详情失败');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      mounted = false;
    };
  }, [plannerRunId]);

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: '等待中',
      running: '运行中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
    };
    return labels[status] || status;
  };

  const getStatusClass = (status: string) => {
    if (status === 'running') return 'status-running';
    if (status === 'completed') return 'status-completed';
    if (status === 'failed') return 'status-failed';
    if (status === 'cancelled') return 'status-cancelled';
    return 'status-pending';
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  const getEventLabel = (eventType: string) => {
    const labels: Record<string, string> = {
      planner_run_started: '计划运行开始',
      planner_run_completed: '计划运行完成',
      planner_run_failed: '计划运行失败',
      planner_run_cancelled: '计划运行取消',
      step_started: '步骤开始',
      step_completed: '步骤完成',
      step_failed: '步骤失败',
      plan_created: '计划创建',
      plan_updated: '计划更新',
    };
    return labels[eventType] || eventType;
  };

  const renderMetadata = () => (
    <div className="run-detail-metadata">
      <div className="metadata-row">
        <span className="metadata-label">运行ID:</span>
        <span className="metadata-value run-id-text">{run.runId}</span>
      </div>
      <div className="metadata-row">
        <span className="metadata-label">状态:</span>
        <span className={`metadata-value status-badge ${getStatusClass(run.status)}`}>
          {getStatusLabel(run.status)}
        </span>
      </div>
      {summary?.goal && (
        <div className="metadata-row">
          <span className="metadata-label">目标:</span>
          <span className="metadata-value">{summary.goal}</span>
        </div>
      )}
      {summary && (
        <>
          <div className="metadata-row">
            <span className="metadata-label">步骤数:</span>
            <span className="metadata-value">{summary.stepCount}</span>
          </div>
          {summary.currentStep && (
            <div className="metadata-row">
              <span className="metadata-label">当前步骤:</span>
              <span className="metadata-value">{summary.currentStep}</span>
            </div>
          )}
          <div className="metadata-row">
            <span className="metadata-label">计划版本:</span>
            <span className="metadata-value">v{summary.planVersion}</span>
          </div>
        </>
      )}
      {run.objective && !summary?.goal && (
        <div className="metadata-row">
          <span className="metadata-label">目标:</span>
          <span className="metadata-value">{run.objective}</span>
        </div>
      )}
      {run.progress !== undefined && (
        <div className="metadata-row">
          <span className="metadata-label">进度:</span>
          <span className="metadata-value">{run.progress}%</span>
        </div>
      )}
      <div className="metadata-row">
        <span className="metadata-label">创建时间:</span>
        <span className="metadata-value">{formatTimestamp(run.createdAt)}</span>
      </div>
      {run.updatedAt && (
        <div className="metadata-row">
          <span className="metadata-label">更新时间:</span>
          <span className="metadata-value">{formatTimestamp(run.updatedAt)}</span>
        </div>
      )}
    </div>
  );

  const renderTimeline = () => {
    if (events.length === 0) {
      return (
        <div className="run-detail-empty">
          <div className="empty-icon">📋</div>
          <p>暂无时间线事件</p>
        </div>
      );
    }

    return (
      <div className="run-detail-timeline">
        {events.map((event) => (
          <div key={event.eventId} className="timeline-event-item">
            <div className="timeline-event-marker" />
            <div className="timeline-event-content">
              <div className="timeline-event-header">
                <span className="timeline-event-label">{getEventLabel(event.eventType)}</span>
                <span className="timeline-event-timestamp">{formatTimestamp(event.timestamp)}</span>
              </div>
              {event.payload && Object.keys(event.payload).length > 0 && (
                <div className="timeline-event-payload">
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="run-detail-view" data-testid="run-detail-view">
      <div className="run-detail-header">
        <h3>运行详情</h3>
        {onClose && (
          <button
            className="run-detail-close"
            onClick={onClose}
            data-testid="run-detail-close"
            aria-label="关闭"
          >
            ✕
          </button>
        )}
      </div>

      {loading && (
        <div className="run-detail-loading" data-testid="run-detail-loading">
          加载中...
        </div>
      )}

      {error && (
        <div className="run-detail-error" data-testid="run-detail-error">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {renderMetadata()}
          {plannerRunId && (
            <div className="run-detail-section">
              <h4>时间线</h4>
              {renderTimeline()}
            </div>
          )}
          {!plannerRunId && (
            <div className="run-detail-no-planner" data-testid="run-detail-no-planner">
              <p>此运行无计划运行详情</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RunDetailView;
