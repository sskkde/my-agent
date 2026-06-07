import React from 'react'
import LoadingSpinner from './LoadingSpinner'

export interface BackgroundTaskCardProps {
  taskId: string
  label: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: number
  message?: string
}

const statusLabels: Record<BackgroundTaskCardProps['status'], string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export const BackgroundTaskCard: React.FC<BackgroundTaskCardProps> = ({ taskId, label, status, progress, message }) => {
  const clampedProgress = progress !== undefined ? Math.max(0, Math.min(100, progress)) : undefined

  return (
    <div className="bg-task-card" data-testid="bg-task-card" data-task-id={taskId} data-status={status}>
      <div className="bg-task-card__header">
        <span className="bg-task-card__label">{label}</span>
        <span className={`status-badge status-badge--${status}`}>
          {status === 'running' && <LoadingSpinner size="small" inline label="" />}
          {statusLabels[status]}
        </span>
      </div>

      {status === 'running' && clampedProgress !== undefined && (
        <div className="bg-task-card__progress-wrapper">
          <div className="bg-task-card__progress">
            <div
              className="bg-task-card__progress-bar"
              style={{ width: `${clampedProgress}%` }}
              role="progressbar"
              aria-valuenow={clampedProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <span className="bg-task-card__progress-text">{clampedProgress}%</span>
        </div>
      )}

      {message && <div className="bg-task-card__message">{message}</div>}
    </div>
  )
}

export default BackgroundTaskCard
