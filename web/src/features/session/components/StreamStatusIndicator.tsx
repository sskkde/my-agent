import React from 'react'

export interface StreamStatusIndicatorProps {
  streamStatus: 'connected' | 'connecting' | 'disconnected'
  onRetry: () => void
}

export const StreamStatusIndicator: React.FC<StreamStatusIndicatorProps> = ({ streamStatus, onRetry }) => {
  const statusText = streamStatus === 'connected' ? '已连接' : streamStatus === 'connecting' ? '连接中...' : '已断开'
  const statusClass =
    streamStatus === 'connected'
      ? 'stream-status-connected'
      : streamStatus === 'connecting'
        ? 'stream-status-connecting'
        : 'stream-status-disconnected'

  return (
    <div className="stream-status-indicator" data-testid="session-timeline-stream-status">
      <span className={`stream-status-badge ${statusClass}`}>{statusText}</span>
      {streamStatus === 'disconnected' && (
        <button className="stream-retry-button" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  )
}
