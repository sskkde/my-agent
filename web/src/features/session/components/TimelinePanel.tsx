import React from 'react'
import { TimelineList } from '../../../components/timeline/TimelineList'
import type { ConsoleTimelineEvent } from '../../../api/types'
import { StreamStatusIndicator } from './StreamStatusIndicator'

export interface TimelinePanelProps {
  sessionTitle: string
  streamStatus: 'connected' | 'connecting' | 'disconnected'
  events: ConsoleTimelineEvent[]
  loading: boolean
  error?: string
  onRetryStream: () => void
  onToggleSidebar: () => void
  isDrawerOpen: boolean
}

export const TimelinePanel: React.FC<TimelinePanelProps> = ({
  sessionTitle,
  streamStatus,
  events,
  loading,
  error,
  onRetryStream,
  onToggleSidebar,
  isDrawerOpen,
}) => {
  return (
    <>
      {/* Timeline Header */}
      <div className="timeline-toolbar-stage">
        <div className="timeline-header">
          {/* Mobile session sidebar toggle */}
          <button
            className="session-sidebar-toggle"
            data-testid="session-sidebar-toggle"
            onClick={onToggleSidebar}
            aria-controls="sessions-sidebar"
            aria-label="打开会话列表"
            aria-expanded={isDrawerOpen}
          >
            ☰
          </button>
          <h3>{sessionTitle}</h3>
          <StreamStatusIndicator streamStatus={streamStatus} onRetry={onRetryStream} />
        </div>
      </div>

      {/* Timeline */}
      <div className="session-timeline-container" data-testid="session-timeline">
        <div className="timeline-stage">
          <div className="timeline-column">
            <TimelineList events={events} loading={loading} error={error} />
          </div>
        </div>
      </div>
    </>
  )
}
