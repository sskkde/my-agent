import React, { useEffect, useState, useCallback } from 'react';
import { getRuns, subscribeRuns, RunEventCallback } from '../../api/client';
import type { RunInfo, RunsResponse, SseRunEvent } from '../../api/types';
import RunDetailView from './RunDetailView';
import LoadingSpinner from '../../components/LoadingSpinner';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type GroupedStatus = 'active' | 'waiting' | 'terminal';

function getGroupedStatus(status: RunInfo['status']): GroupedStatus {
  if (status === 'running') return 'active';
  if (status === 'pending') return 'waiting';
  return 'terminal';
}

function updateRunFromEvent(runs: RunInfo[], event: SseRunEvent): RunInfo[] {
  const existing = runs.find((r) => r.runId === event.runId);
  const base = existing || { runId: event.runId, createdAt: event.timestamp };

  switch (event.type) {
    case 'run_started':
      return [...runs.filter((r) => r.runId !== event.runId), { ...base, status: 'running' as const, ...event.data }];
    case 'run_progress':
      if (existing) {
        return runs.map((r) => (r.runId === event.runId ? { ...r, ...event.data } : r));
      }
      return runs;
    case 'run_completed':
      return runs.map((r) => (r.runId === event.runId ? { ...r, status: 'completed' as const, ...event.data } : r));
    case 'run_failed':
      return runs.map((r) => (r.runId === event.runId ? { ...r, status: 'failed' as const, ...event.data } : r));
    case 'run_cancelled':
      return runs.map((r) => (r.runId === event.runId ? { ...r, status: 'cancelled' as const, ...event.data } : r));
    default:
      return runs;
  }
}

const AgentMonitorTab: React.FC = () => {
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [runsError, setRunsError] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [retryKey, setRetryKey] = useState(0);
  const [selectedRun, setSelectedRun] = useState<RunInfo | null>(null);

  const handleEvent: RunEventCallback = useCallback((event) => {
    setRuns((prev) => updateRunFromEvent(prev, event));
  }, []);

  const handleError = useCallback(() => {
    setConnectionStatus('disconnected');
  }, []);

  useEffect(() => {
    let mounted = true;

    getRuns()
      .then((response: RunsResponse) => {
        if (mounted) {
          setRuns(response.runs);
          setInitialLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setRunsError(true);
          setInitialLoading(false);
        }
      });

    const unsubscribe = subscribeRuns(handleEvent, handleError);
    setConnectionStatus('connected');

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [handleEvent, handleError, retryKey]);

  const handleRetry = () => {
    setConnectionStatus('connecting');
    setRetryKey((k) => k + 1);
  };

  const activeRuns = runs.filter((r) => getGroupedStatus(r.status) === 'active');
  const waitingRuns = runs.filter((r) => getGroupedStatus(r.status) === 'waiting');
  const terminalRuns = runs.filter((r) => getGroupedStatus(r.status) === 'terminal');

  const statusText = connectionStatus === 'connected' ? '已连接' : connectionStatus === 'connecting' ? '连接中...' : '已断开';
  const statusClass = connectionStatus === 'connected' ? 'status-connected' : 'status-disconnected';

  if (initialLoading) {
    return (
      <div data-testid="agent-monitor-stream" className="agent-monitor">
        <LoadingSpinner label="加载运行监控..." />
      </div>
    );
  }

  const renderRunList = (runList: RunInfo[], emptyMessage: string) => {
    if (runList.length === 0) {
      return <p className="empty-message">{emptyMessage}</p>;
    }
    return (
      <ul className="run-list">
        {runList.map((run) => (
          <li
            key={run.runId}
            className={`run-card run-status-${run.status} ${selectedRun?.runId === run.runId ? 'run-card--selected' : ''}`}
            onClick={() => setSelectedRun(run)}
            data-testid={`run-card-${run.runId}`}
          >
            <span className="run-id">{run.runId}</span>
            <span className="run-objective">{run.objective || '-'}</span>
            <span className="run-status-badge">{run.status}</span>
            {run.progress !== undefined && <span className="run-progress">{run.progress}%</span>}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div data-testid="agent-monitor-stream" className="agent-monitor">
      <div className="monitor-header">
        <div className="connection-status">
          <span data-testid="sse-status" className={statusClass}>
            {statusText}
          </span>
          {connectionStatus === 'disconnected' && (
            <button data-testid="sse-retry-button" className="retry-button" onClick={handleRetry}>
              重试
            </button>
          )}
        </div>
      </div>
      {runsError && (
        <div className="empty-message" style={{ margin: '16px 24px 0' }}>
          无法加载运行历史
        </div>
      )}
      <div className="monitor-content">
        <div data-testid="runs-list" className="runs-container">
          <section className="run-group">
            <h3>运行中</h3>
            {renderRunList(activeRuns, '暂无运行中的任务')}
          </section>
          <section className="run-group">
            <h3>等待中</h3>
            {renderRunList(waitingRuns, '暂无等待中的任务')}
          </section>
          <section className="run-group">
            <h3>已完成</h3>
            {renderRunList(terminalRuns, '暂无已完成的任务')}
          </section>
        </div>
        {selectedRun && (
          <div className="run-detail-panel">
            <RunDetailView
              run={selectedRun}
              onClose={() => setSelectedRun(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentMonitorTab;