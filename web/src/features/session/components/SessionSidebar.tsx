import React from 'react'
import LoadingSpinner from '../../../components/LoadingSpinner'
import type { ConsoleSessionInfo } from '../../../api/types'
import { formatDate } from '../session-utils'
import { CHAT_TERMINOLOGY } from '../../../constants/chat-terminology'

export interface SessionSidebarProps {
  sessions: ConsoleSessionInfo[]
  loading: boolean
  error: string | null
  selectedSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onCreateSession: () => void
  onCloseDrawer: () => void
}

export const SessionSidebar: React.FC<SessionSidebarProps> = ({
  sessions,
  loading,
  error,
  selectedSessionId,
  onSelectSession,
  onCreateSession,
  onCloseDrawer,
}) => {
  return (
    <aside className="sessions-sidebar" data-testid="sessions-sidebar">
      {/* Session List Header */}
      <div className="sessions-sidebar-header">
        <h3>{CHAT_TERMINOLOGY.sessionHistory}</h3>
        {/* Mobile close button */}
        <button
          className="session-sidebar-close"
          data-testid="session-sidebar-close"
          onClick={onCloseDrawer}
          aria-label="关闭会话列表"
        >
          ✕
        </button>
      </div>

      {/* Session List - Scrollable */}
      {loading && <LoadingSpinner size="small" label="加载会话列表..." />}

      {error && <div className="sessions-error">{error}</div>}

      {!loading && !error && (
        <div className="sessions-list" data-testid="sessions-list">
          {sessions.length === 0 ? (
            <div className="sessions-empty">
              <p>暂无会话</p>
              <p>点击下方按钮创建新会话</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.sessionId}
                className={`session-item ${selectedSessionId === session.sessionId ? 'session-item--selected' : ''}`}
                data-testid={`session-item-${session.sessionId}`}
                onClick={() => onSelectSession(session.sessionId)}
              >
                <div className="session-item-title">{session.title || `${CHAT_TERMINOLOGY.session} ${session.sessionId.slice(-8)}`}</div>
                <div className="session-item-meta">
                  <span className="session-item-count">{session.messageCount} 消息</span>
                  <span className="session-item-time">{formatDate(session.lastActivityAt)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Footer: New Session + Trash */}
      <div className="sessions-sidebar-footer">
        <button
          className="session-new-button--coral"
          data-testid="session-new-button"
          onClick={onCreateSession}
          disabled={loading}
        >
          + {CHAT_TERMINOLOGY.newSession}
        </button>
        <button className="sessions-trash-button" data-testid="sessions-trash-button">
          <span className="sessions-trash-icon">🗑️</span>
          <span className="sessions-trash-text">回收站</span>
        </button>
      </div>
    </aside>
  )
}
