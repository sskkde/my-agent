import React, { useMemo } from 'react'
import type { ConsoleSessionInfo } from '../../../api/types'
import { showToast } from './ChatToast'

export interface ChatSessionListProps {
  sessions: ConsoleSessionInfo[]
  selectedSessionId?: string | null
  onSelectSession: (sessionId: string) => void
  onCreateSession: () => void
  loading?: boolean
  error?: string | null
  /** Whether the sidebar is showing archived sessions */
  archiveView?: boolean
  /** Archived sessions to display when archiveView is true */
  archivedSessions?: ConsoleSessionInfo[]
  /** Toggle between active and archive view */
  onToggleArchiveView?: () => void
  /** Archive a specific session (from the active list) */
  onArchiveSession?: (sessionId: string) => void
  /** Restore an archived session back to active */
  onRestoreSession?: (sessionId: string) => void
  /** Whether archive/restore operations are in progress */
  archiveActionLoading?: boolean
}

interface GroupedSessions {
  label: string
  sessions: ConsoleSessionInfo[]
}

function isToday(date: Date): boolean {
  const now = new Date()
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

function isYesterday(date: Date): boolean {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  return (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  )
}

function formatSessionMeta(date: Date): string {
  if (isToday(date)) return '刚刚'
  if (isYesterday(date)) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

const ChatSessionList: React.FC<ChatSessionListProps> = ({
  sessions,
  selectedSessionId,
  onSelectSession,
  onCreateSession,
  loading,
  error,
  archiveView = false,
  archivedSessions = [],
  onToggleArchiveView,
  onArchiveSession,
  onRestoreSession,
  archiveActionLoading = false,
}) => {
  const grouped = useMemo(() => {
    const today: ConsoleSessionInfo[] = []
    const yesterday: ConsoleSessionInfo[] = []
    const earlier: ConsoleSessionInfo[] = []

    for (const session of sessions) {
      const date = new Date(session.updatedAt || session.createdAt)
      if (isToday(date)) today.push(session)
      else if (isYesterday(date)) yesterday.push(session)
      else earlier.push(session)
    }

    const groups: GroupedSessions[] = []
    if (today.length > 0) groups.push({ label: '今天', sessions: today })
    if (yesterday.length > 0) groups.push({ label: '昨天', sessions: yesterday })
    if (earlier.length > 0) groups.push({ label: '7 天内', sessions: earlier })
    return groups
  }, [sessions])

  const groupedArchived = useMemo(() => {
    const sorted = [...archivedSessions].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    return sorted
  }, [archivedSessions])

  const handleArchiveClick = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    onArchiveSession?.(sessionId)
  }

  const handleRestoreClick = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    onRestoreSession?.(sessionId)
  }

  // ----- Archive view -----
  if (archiveView) {
    return (
      <div className="chat-sidebar__inner" data-testid="chat-session-list">
        <div className="chat-sidebar__header">
          <span className="chat-sidebar__title">已归档</span>
          <button
            className="chat-sidebar__action"
            aria-label="搜索会话"
            title="搜索会话"
            onClick={() => showToast('搜索后续接入')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </div>

        <button
          className="chat-new-btn"
          onClick={onToggleArchiveView}
          data-testid="chat-back-to-active"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          返回对话
        </button>

        <div className="chat-session-list">
          {loading && <div className="chat-session-status">加载中…</div>}
          {error && <div className="chat-session-status chat-session-status--error">{error}</div>}
          {!loading && !error && groupedArchived.length === 0 && (
            <div className="chat-session-status">暂无归档会话</div>
          )}
          {groupedArchived.map((session) => {
            const date = new Date(session.updatedAt || session.createdAt)
            return (
              <div
                key={session.sessionId}
                className="chat-session-item-wrapper"
                data-testid={`chat-archived-${session.sessionId}`}
              >
                <div className="chat-session-item__info">
                  <span className="chat-session-item__title">
                    {session.title || `会话 ${session.sessionId.slice(-8)}`}
                  </span>
                  <span className="chat-session-item__meta">{formatSessionMeta(date)}</span>
                </div>
                <button
                  className="chat-session-item__restore"
                  onClick={(e) => handleRestoreClick(e, session.sessionId)}
                  disabled={archiveActionLoading}
                  title="恢复会话"
                  aria-label="恢复会话"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>

        <div className="chat-archive-entry" data-testid="chat-archive-entry">
          <button className="chat-archive-entry__btn" onClick={onToggleArchiveView}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>返回对话</span>
          </button>
        </div>
      </div>
    )
  }

  // ----- Active session view (default) -----
  return (
    <div className="chat-sidebar__inner" data-testid="chat-session-list">
      <div className="chat-sidebar__header">
        <span className="chat-sidebar__title">对话</span>
        <button
          className="chat-sidebar__action"
          aria-label="搜索会话"
          title="搜索会话"
          onClick={() => showToast('搜索后续接入')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>

      <button className="chat-new-btn" onClick={onCreateSession} data-testid="chat-new-button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        新对话
      </button>

      <div className="chat-session-list">
        {loading && <div className="chat-session-status">加载中…</div>}
        {error && <div className="chat-session-status chat-session-status--error">{error}</div>}
        {!loading && !error && grouped.length === 0 && (
          <div className="chat-session-status">暂无会话</div>
        )}
        {grouped.map((group) => (
          <React.Fragment key={group.label}>
            <div className="chat-session-date">{group.label}</div>
            {group.sessions.map((session) => {
              const date = new Date(session.updatedAt || session.createdAt)
              const isActive = session.sessionId === selectedSessionId
              return (
                <div
                  key={session.sessionId}
                  className={`chat-session-item-wrapper ${isActive ? 'active' : ''}`}
                  data-testid={`chat-session-${session.sessionId}`}
                >
                  <button
                    className="chat-session-item__info"
                    onClick={() => onSelectSession(session.sessionId)}
                  >
                    <span className="chat-session-item__title">
                      {session.title || `会话 ${session.sessionId.slice(-8)}`}
                    </span>
                    <span className="chat-session-item__meta">{formatSessionMeta(date)}</span>
                  </button>
                  {onArchiveSession && (
                    <button
                      className="chat-session-item__archive"
                      onClick={(e) => handleArchiveClick(e, session.sessionId)}
                      disabled={archiveActionLoading}
                      title="归档会话"
                      aria-label="归档会话"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            })}
          </React.Fragment>
        ))}
      </div>

      <div className="chat-archive-entry" data-testid="chat-archive-entry">
        <button
          className="chat-archive-entry__btn"
          onClick={onToggleArchiveView}
          disabled={archiveActionLoading}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
          </svg>
          <span>归档</span>
        </button>
      </div>
    </div>
  )
}

export default ChatSessionList