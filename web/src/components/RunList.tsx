import React, { useState } from 'react';
import LoadingSpinner from './LoadingSpinner';
import EmptyState from './EmptyState';

export interface RunListItem {
  id: string;
  type: 'planner_run' | 'workflow_run' | 'background_run';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  summary: string;
  createdAt: string;
}

export interface RunListProps {
  runs: RunListItem[];
  onRunClick: (runId: string) => void;
  onCancel?: (runId: string) => void;
  onRetry?: (runId: string) => void;
  loading?: boolean;
}

type FilterStatus = 'all' | 'active' | 'completed' | 'failed' | 'cancelled';

const RunList: React.FC<RunListProps> = ({
  runs,
  onRunClick,
  onCancel,
  onRetry,
  loading = false,
}) => {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  const filterOptions: { value: FilterStatus; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'active', label: '进行中' },
    { value: 'completed', label: '已完成' },
    { value: 'failed', label: '失败' },
    { value: 'cancelled', label: '已取消' },
  ];

  const filteredRuns = runs.filter((run) => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'active') return run.status === 'running' || run.status === 'pending';
    return run.status === filterStatus;
  });

  const getTypeIcon = (type: RunListItem['type']): string => {
    switch (type) {
      case 'planner_run':
        return '📋';
      case 'workflow_run':
        return '🔄';
      case 'background_run':
        return '⚙️';
      default:
        return '📝';
    }
  };

  const getTypeLabel = (type: RunListItem['type']): string => {
    switch (type) {
      case 'planner_run':
        return '计划运行';
      case 'workflow_run':
        return '工作流';
      case 'background_run':
        return '后台任务';
      default:
        return type;
    }
  };

  const getStatusLabel = (status: RunListItem['status']): string => {
    const labels: Record<RunListItem['status'], string> = {
      pending: '等待中',
      running: '运行中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
    };
    return labels[status];
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      return new Date(timestamp).toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  const handleActionClick = (e: React.MouseEvent, runId: string, action: 'cancel' | 'retry') => {
    e.stopPropagation();
    if (action === 'cancel' && onCancel) {
      onCancel(runId);
    } else if (action === 'retry' && onRetry) {
      onRetry(runId);
    }
  };

  if (loading) {
    return (
      <div className="run-list" data-testid="run-list">
        <div className="run-list__loading">
          <LoadingSpinner label="加载运行列表..." />
        </div>
      </div>
    );
  }

  return (
    <div className="run-list" data-testid="run-list">
      <div className="run-list__filter-bar" role="tablist" aria-label="状态过滤">
        {filterOptions.map((option) => (
          <button
            key={option.value}
            className={`run-list__filter-chip ${filterStatus === option.value ? 'run-list__filter-chip--active' : ''}`}
            onClick={() => setFilterStatus(option.value)}
            role="tab"
            aria-selected={filterStatus === option.value}
            data-testid={`filter-${option.value}`}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      {filteredRuns.length === 0 ? (
        <EmptyState
          icon="📭"
          title="暂无运行记录"
          description={filterStatus === 'all' ? '当前没有任何运行记录' : '当前筛选条件下没有运行记录'}
        />
      ) : (
        <ul className="run-list__list" role="list">
          {filteredRuns.map((run) => (
            <li
              key={run.id}
              className="run-list__row"
              onClick={() => onRunClick(run.id)}
              role="listitem"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRunClick(run.id);
                }
              }}
              data-testid={`run-row-${run.id}`}
            >
              <span className="run-list__type-icon" aria-hidden="true">
                {getTypeIcon(run.type)}
              </span>
              <div className="run-list__content">
                <span className="run-list__summary">{run.summary}</span>
                <span className="run-list__type-label">{getTypeLabel(run.type)}</span>
              </div>
              <span
                className={`run-list__status-badge run-list__status-badge--${run.status}`}
                data-testid={`status-badge-${run.id}`}
              >
                {getStatusLabel(run.status)}
              </span>
              <span className="run-list__timestamp">{formatTimestamp(run.createdAt)}</span>
              <div className="run-list__actions">
                {(run.status === 'running' || run.status === 'pending') && onCancel && (
                  <button
                    className="run-list__action-btn run-list__action-btn--cancel"
                    onClick={(e) => handleActionClick(e, run.id, 'cancel')}
                    type="button"
                    aria-label="取消运行"
                    data-testid={`cancel-btn-${run.id}`}
                  >
                    取消
                  </button>
                )}
                {run.status === 'failed' && onRetry && (
                  <button
                    className="run-list__action-btn run-list__action-btn--retry"
                    onClick={(e) => handleActionClick(e, run.id, 'retry')}
                    type="button"
                    aria-label="重试运行"
                    data-testid={`retry-btn-${run.id}`}
                  >
                    重试
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default RunList;
