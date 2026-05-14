import React, { useState } from 'react';
import LoadingSpinner from './LoadingSpinner';

export interface ToolCallCardProps {
  toolName: string;
  parameters: Record<string, unknown>;
  result?: string;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
  onExpand?: () => void;
}

const statusLabels: Record<ToolCallCardProps['status'], string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
};

export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  toolName,
  parameters,
  result,
  status,
  durationMs,
  onExpand,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = () => {
    const newState = !isExpanded;
    setIsExpanded(newState);
    if (newState && onExpand) {
      onExpand();
    }
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatJson = (obj: Record<string, unknown>): string => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return '[无法序列化]';
    }
  };

  return (
    <div
      className="tool-call-card"
      data-testid="tool-call-card"
      data-status={status}
    >
      <div
        className="tool-call-card__header"
        onClick={handleToggle}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggle();
          }
        }}
      >
        <span className="tool-call-card__expand-icon" aria-hidden="true">
          {isExpanded ? '▼' : '▶'}
        </span>
        <span className="tool-call-card__tool-name">{toolName}</span>
        <span className={`status-badge status-badge--${status}`}>
          {status === 'running' && (
            <LoadingSpinner size="small" inline label="" />
          )}
          {statusLabels[status]}
        </span>
        {durationMs !== undefined && status !== 'running' && (
          <span className="tool-call-card__duration">
            {formatDuration(durationMs)}
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="tool-call-card__body">
          <div className="tool-call-card__section">
            <div className="tool-call-card__section-label">参数</div>
            <div className="tool-call-card__json">
              <pre>
                <code>{formatJson(parameters)}</code>
              </pre>
            </div>
          </div>

          {result !== undefined && (
            <div className="tool-call-card__section">
              <div className="tool-call-card__section-label">结果</div>
              <div className="tool-call-card__json tool-call-card__json--result">
                <pre>
                  <code>{result}</code>
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCallCard;
