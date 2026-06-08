import React from 'react'

export interface SessionEmptyStateProps {
  onToggleSidebar: () => void
  isDrawerOpen: boolean
}

export const SessionEmptyState: React.FC<SessionEmptyStateProps> = ({ onToggleSidebar, isDrawerOpen }) => {
  return (
    <>
      {/* Mobile session sidebar toggle for empty state */}
      <div className="timeline-header timeline-header--empty">
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
        <h3>会话控制台</h3>
      </div>
      <div className="session-empty-state" data-testid="session-empty-state">
        <div className="empty-icon">💬</div>
        <p>从左侧选择一个会话</p>
        <p>或创建一个新会话开始对话</p>
      </div>
    </>
  )
}
