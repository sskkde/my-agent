import React from 'react'
import LoadingSpinner from './LoadingSpinner'

export interface BackgroundTaskCardProps {
  taskId: string
  label: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: number
  message?: string
  agentProfile?: string
  launchMode?: 'foreground' | 'background'
}

const statusLabels: Record<BackgroundTaskCardProps['status'], string> = {
  queued: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const launchModeLabels: Record<NonNullable<BackgroundTaskCardProps['launchMode']>, string> = {
  foreground: '前台任务',
  background: '后台任务',
}

export const BackgroundTaskCard: React.FC<BackgroundTaskCardProps> = ({
  taskId,
  label,
  status,
  progress,
  message,
  agentProfile,
  launchMode,
}) => {
  const clampedProgress = progress !== undefined ? Math.max(0, Math.min(100, progress)) : undefined

  return (
    <div className="bg-task-card" data-testid="bg-task-card" data-task-id={taskId} data-status={status}>
      <div className="bg-task-card__header">
        <span className="bg-task-card__label">{label}</span>
        {agentProfile && <span className="bg-task-card__profile">{agentProfile}</span>}
        {launchMode && <span className="bg-task-card__launch-mode">{launchModeLabels[launchMode]}</span>}
        <span className={`status-badge status-badge--${status}`}>
          {(status === 'queued' || status === 'running') && <LoadingSpinner size="small" inline label="" />}
          {statusLabels[status]}
        </span>
      </div>

      {(status === 'queued' || status === 'running') && clampedProgress !== undefined && (
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
