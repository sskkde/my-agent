import React, { useState, useEffect, useCallback } from 'react';
import type { LogEntry, DebugReplayResponse } from '../../api/types';
import { getLogs, getDebugReplay } from '../../api/client';

interface FiltersState {
  sessionId: string;
  sourceModule: string;
  eventType: string;
  runRef: string;
}

const severityIcons: Record<string, string> = {
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
};

const LogsDebugTab: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
const [filters, setFilters] = useState<FiltersState>({
    sessionId: '',
    sourceModule: '',
    eventType: '',
    runRef: '',
  });
  const [debugReplay, setDebugReplay] = useState<DebugReplayResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getLogs(
        filters.sessionId || undefined,
        filters.sourceModule || undefined,
        filters.eventType || undefined,
        50,
        undefined,
        filters.runRef || undefined
      );
      setLogs(result.logs);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  const fetchDebugReplay = useCallback(async () => {
    if (!filters.sessionId) {
      setDebugReplay(null);
      return;
    }
    try {
      const result = await getDebugReplay(filters.sessionId);
      setDebugReplay(result);
    } catch {
      setDebugReplay(null);
    }
  }, [filters.sessionId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchDebugReplay();
  }, [fetchDebugReplay]);

  const handleFilterChange = (key: keyof FiltersState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const renderPayloadPreview = (preview: string | undefined): React.ReactNode => {
    if (!preview) return null;
    if (preview === '[redacted]') {
      return <span className="logs-debug-redacted">[redacted]</span>;
    }
    return <span className="logs-debug-preview">{preview}</span>;
  };

  return (
    <div data-testid="logs-debug-panel" className="logs-debug-panel">
      <div className="logs-debug-header">
        <h3>日志调试</h3>
        <span className="logs-debug-count">共 {total} 条记录</span>
      </div>

      <div className="logs-debug-filters" data-testid="logs-filter-sessionId">
        <div className="logs-filter-group">
          <label htmlFor="sessionId-filter">会话ID</label>
          <input
            id="sessionId-filter"
            type="text"
            value={filters.sessionId}
            onChange={(e) => handleFilterChange('sessionId', e.target.value)}
            placeholder="输入会话ID"
            data-testid="logs-filter-sessionId-input"
          />
        </div>

        <div className="logs-filter-group" data-testid="logs-filter-sourceModule">
          <label htmlFor="sourceModule-filter">来源模块</label>
          <select
            id="sourceModule-filter"
            value={filters.sourceModule}
            onChange={(e) => handleFilterChange('sourceModule', e.target.value)}
            data-testid="logs-filter-sourceModule-select"
          >
            <option value="">全部模块</option>
            <option value="gateway">Gateway</option>
            <option value="foreground">Foreground</option>
            <option value="planner">Planner</option>
            <option value="dispatcher">Dispatcher</option>
            <option value="kernel">Kernel</option>
            <option value="tools">Tools</option>
            <option value="permissions">Permissions</option>
            <option value="context">Context</option>
            <option value="memory">Memory</option>
            <option value="subagents">Subagents</option>
            <option value="workflows">Workflows</option>
            <option value="triggers">Triggers</option>
            <option value="connectors">Connectors</option>
            <option value="observability">Observability</option>
            <option value="storage">Storage</option>
          </select>
        </div>

<div className="logs-filter-group" data-testid="logs-filter-eventType">
          <label htmlFor="eventType-filter">事件类型</label>
          <input
            id="eventType-filter"
            type="text"
            value={filters.eventType}
            onChange={(e) => handleFilterChange('eventType', e.target.value)}
            placeholder="输入事件类型"
            data-testid="logs-filter-eventType-input"
          />
        </div>

        <div className="logs-filter-group" data-testid="logs-filter-runRef">
          <label htmlFor="runRef-filter">运行引用</label>
          <input
            id="runRef-filter"
            type="text"
            value={filters.runRef}
            onChange={(e) => handleFilterChange('runRef', e.target.value)}
            placeholder="输入运行ID"
            data-testid="logs-filter-runRef-input"
          />
        </div>

        <button
          className="logs-filter-refresh"
          onClick={fetchLogs}
          disabled={isLoading}
          data-testid="logs-filter-refresh"
        >
          {isLoading ? '加载中...' : '刷新'}
        </button>
      </div>

      {error && (
        <div className="logs-debug-error" data-testid="logs-debug-error">
          {error}
        </div>
      )}

{debugReplay && (
        <div className="debug-replay-summary" data-testid="debug-replay-summary">
          <h4>调试回放摘要</h4>
          <div className="debug-replay-stats">
            <div className="debug-replay-stat">
              <span className="debug-replay-label">事件数</span>
              <span className="debug-replay-value">{debugReplay.eventCount}</span>
            </div>
            <div className="debug-replay-stat">
              <span className="debug-replay-label">转录数</span>
              <span className="debug-replay-value">{debugReplay.transcriptCount}</span>
            </div>
            <div className="debug-replay-stat">
              <span className="debug-replay-label">最后事件ID</span>
              <span className="debug-replay-value">
                {debugReplay.lastEventId || '无'}
              </span>
            </div>
          </div>
          
          {debugReplay.runRefs.length > 0 && (
            <div className="debug-replay-refs-section">
              <span className="debug-replay-label">运行引用:</span>
              <div className="debug-replay-refs-list">
                {debugReplay.runRefs.map((runId) => (
                  <span
                    key={runId}
                    className="debug-replay-ref-badge"
                    data-testid={`debug-replay-run-ref-${runId}`}
                  >
                    {runId}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {debugReplay.approvalRefs.length > 0 && (
            <div className="debug-replay-refs-section">
              <span className="debug-replay-label">审批引用:</span>
              <div className="debug-replay-refs-list">
                {debugReplay.approvalRefs.map((approvalId) => (
                  <span
                    key={approvalId}
                    className="debug-replay-ref-badge"
                    data-testid={`debug-replay-approval-ref-${approvalId}`}
                  >
                    {approvalId}
                  </span>
                ))}
              </div>
            </div>
          )}

          {debugReplay.redactedPreviews.length > 0 && (
            <div className="debug-replay-previews">
              <h5>事件预览（已脱敏）</h5>
              <ul className="debug-replay-preview-list">
                {debugReplay.redactedPreviews.map((preview) => (
                  <li
                    key={preview.eventId}
                    className="debug-replay-preview-item"
                    data-testid={`debug-replay-preview-${preview.eventId}`}
                  >
                    <span className="debug-replay-preview-type">{preview.eventType}</span>
                    <span className="debug-replay-preview-text">{preview.preview}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="logs-debug-list" data-testid="logs-list">
        {isLoading && logs.length === 0 ? (
          <div className="logs-debug-loading">加载中...</div>
        ) : logs.length === 0 ? (
          <div className="logs-debug-empty">暂无日志记录</div>
        ) : (
          logs.map((log) => (
            <div
              key={log.eventId}
              className={`logs-debug-row logs-debug-row--${log.severity}`}
              data-testid={`log-row-${log.eventId}`}
            >
              <div className="logs-debug-row-header">
                <span
                  className="logs-debug-event-type-badge"
                  data-testid={`log-event-type-${log.eventId}`}
                >
                  {log.eventType}
                </span>
                <span
                  className="logs-debug-source-module"
                  data-testid={`log-source-module-${log.eventId}`}
                >
                  {log.sourceModule}
                </span>
                <span
                  className="logs-debug-severity"
                  data-testid={`log-severity-${log.eventId}`}
                >
                  {severityIcons[log.severity] || 'ℹ️'} {log.severity}
                </span>
                <span
                  className="logs-debug-timestamp"
                  data-testid={`log-timestamp-${log.eventId}`}
                >
                  {formatTimestamp(log.createdAt)}
                </span>
              </div>
              <div
                className="logs-debug-summary"
                data-testid={`log-summary-${log.eventId}`}
              >
                {log.summary}
              </div>
              {log.payloadPreview && (
                <div
                  className="logs-debug-payload-preview"
                  data-testid={`log-payload-${log.eventId}`}
                >
                  {renderPayloadPreview(log.payloadPreview)}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default LogsDebugTab;
