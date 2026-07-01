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
                <button
                  key={session.sessionId}
                  className={`chat-session-item ${isActive ? 'active' : ''}`}
                  onClick={() => onSelectSession(session.sessionId)}
                  data-testid={`chat-session-${session.sessionId}`}
                >
                  <span className="chat-session-item__title">{session.title || `会话 ${session.sessionId.slice(-8)}`}</span>
                  <span className="chat-session-item__meta">{formatSessionMeta(date)}</span>
                </button>
              )
            })}
          </React.Fragment>
        ))}
      </div>

      <div className="chat-archive-entry" data-testid="chat-archive-entry">
        <button className="chat-archive-entry__btn" onClick={() => showToast('归档功能后续接入')}>
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
