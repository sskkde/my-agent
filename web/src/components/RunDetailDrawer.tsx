import React, { useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import LoadingSpinner from './LoadingSpinner';
import { getRunConsole, type ConsoleResponse, type TimelineEvent } from '../api/observability';

export interface RunDetailDrawerProps {
  runId: string;
  isOpen: boolean;
  onClose: () => void;
}

const RunDetailDrawer: React.FC<RunDetailDrawerProps> = ({
  runId,
  isOpen,
  onClose,
}) => {
  const fetchConsole = useCallback(() => getRunConsole(runId), [runId]);
  const { data: consoleData, loading, error, execute } = useApi<ConsoleResponse>(fetchConsole);

  useEffect(() => {
    if (isOpen && runId) {
      execute();
    }
  }, [isOpen, runId, execute]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) {
      onClose();
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const formatTimestamp = (timestamp: string): string => {
    try {
      return new Date(timestamp).toLocaleString('zh-CN', {
        year: 'numeric',
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

  const getStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      pending: '等待中',
      running: '运行中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
    };
    return labels[status] || status;
  };

  const renderTimeline = (timeline: TimelineEvent[]) => {
    if (timeline.length === 0) {
      return <div className="drawer-panel__empty-timeline">暂无时间线事件</div>;
    }

    const sortedTimeline = [...timeline].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return (
      <ul className="drawer-panel__timeline" role="list">
        {sortedTimeline.map((event) => (
          <li key={event.eventId} className="drawer-panel__timeline-item">
            <span className="drawer-panel__timeline-time">
              {formatTimestamp(event.timestamp)}
            </span>
            <span className="drawer-panel__timeline-type">{event.eventType}</span>
            <span className="drawer-panel__timeline-summary">{event.summary}</span>
          </li>
        ))}
      </ul>
    );
  };

  if (!isOpen) return null;

  return (
    <div
      className="drawer-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      data-testid="drawer-overlay"
    >
      <div className="drawer-panel" data-testid="drawer-panel">
        <div className="drawer-panel__header">
          <h2 id="drawer-title" className="drawer-panel__title">
            运行详情
          </h2>
          <button
            className="drawer-panel__close"
            onClick={onClose}
            aria-label="关闭"
            type="button"
            data-testid="drawer-close"
          >
            ✕
          </button>
        </div>

        <div className="drawer-panel__body">
          {loading && (
            <div className="drawer-panel__loading" data-testid="drawer-loading">
              <LoadingSpinner label="加载运行详情..." />
            </div>
          )}

          {error && (
            <div className="drawer-panel__error" data-testid="drawer-error">
              {error}
            </div>
          )}

          {consoleData && (
            <>
              <div className="drawer-panel__section">
                <h3 className="drawer-panel__section-title">基本信息</h3>
                <dl className="drawer-panel__info-list">
                  <div className="drawer-panel__info-row">
                    <dt>运行ID</dt>
                    <dd className="drawer-panel__mono">{consoleData.runId}</dd>
                  </div>
                  <div className="drawer-panel__info-row">
                    <dt>状态</dt>
                    <dd>
                      <span className={`drawer-panel__status-badge drawer-panel__status-badge--${consoleData.status}`}>
                        {getStatusLabel(consoleData.status)}
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="drawer-panel__section">
                <h3 className="drawer-panel__section-title">时间线</h3>
                {renderTimeline(consoleData.timeline)}
              </div>

              {consoleData.audit && consoleData.audit.length > 0 && (
                <div className="drawer-panel__section">
                  <h3 className="drawer-panel__section-title">审计记录</h3>
                  <ul className="drawer-panel__audit-list">
                    {consoleData.audit.map((entry) => (
                      <li key={entry.auditId} className="drawer-panel__audit-item">
                        <span className="drawer-panel__audit-action">{entry.action}</span>
                        <span className="drawer-panel__audit-time">
                          {formatTimestamp(entry.timestamp)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default RunDetailDrawer;
