import React, { useEffect, useState, useCallback } from 'react'
import { getSessions, updateSession } from '../../api/client'
import type { ConsoleSessionInfo, SessionsResponse } from '../../api/types'
import ErrorMessage from '../../components/ErrorMessage'
import LoadingSpinner from '../../components/LoadingSpinner'

type SessionStatus = 'active' | 'archived' | 'closed'

interface SessionsState {
  sessions: ConsoleSessionInfo[]
  total: number
  loading: boolean
  error: Error | null
}

const SessionsTab: React.FC = () => {
  const [sessionsState, setSessionsState] = useState<SessionsState>({
    sessions: [],
    total: 0,
    loading: true,
    error: null,
  })
  const [statusFilter, setStatusFilter] = useState<SessionStatus | ''>('')
  const [currentPage, setCurrentPage] = useState(0)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const limit = 10

  const fetchSessions = useCallback(async () => {
    setSessionsState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const result: SessionsResponse = await getSessions(statusFilter || undefined, limit, currentPage * limit)
      setSessionsState({
        sessions: result.sessions,
        total: result.total,
        loading: false,
        error: null,
      })
    } catch (err) {
      setSessionsState({
        sessions: [],
        total: 0,
        loading: false,
        error: err instanceof Error ? err : new Error('Failed to load sessions'),
      })
    }
  }, [statusFilter, currentPage])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setStatusFilter(e.target.value as SessionStatus | '')
    setCurrentPage(0)
  }

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
  }

  const handleArchiveSession = async (sessionId: string) => {
    try {
      await updateSession(sessionId, { status: 'archived' })
      setSessionsState((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) => (s.sessionId === sessionId ? { ...s, status: 'archived' } : s)),
      }))
    } catch (err) {
      setSessionsState((prev) => ({
        ...prev,
        error: err instanceof Error ? err : new Error('Failed to archive session'),
      }))
    }
  }

  const handleCloseSession = async (sessionId: string) => {
    try {
      await updateSession(sessionId, { status: 'closed' })
      setSessionsState((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) => (s.sessionId === sessionId ? { ...s, status: 'closed' } : s)),
      }))
    } catch (err) {
      setSessionsState((prev) => ({
        ...prev,
        error: err instanceof Error ? err : new Error('Failed to close session'),
      }))
    }
  }

  const handleStartEditing = (session: ConsoleSessionInfo) => {
    setEditingSessionId(session.sessionId)
    setEditingTitle(session.title)
  }

  const handleSaveTitle = async () => {
    if (!editingSessionId) return

    try {
      await updateSession(editingSessionId, { title: editingTitle })
      setSessionsState((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) => (s.sessionId === editingSessionId ? { ...s, title: editingTitle } : s)),
      }))
      setEditingSessionId(null)
      setEditingTitle('')
    } catch (err) {
      setSessionsState((prev) => ({
        ...prev,
        error: err instanceof Error ? err : new Error('Failed to update title'),
      }))
    }
  }

  const handleCancelEditing = () => {
    setEditingSessionId(null)
    setEditingTitle('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTitle()
    } else if (e.key === 'Escape') {
      handleCancelEditing()
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getStatusBadgeClass = (status: SessionStatus) => {
    switch (status) {
      case 'active':
        return 'status-badge status-active'
      case 'archived':
        return 'status-badge status-archived'
      case 'closed':
        return 'status-badge status-closed'
      default:
        return 'status-badge'
    }
  }

  const totalPages = Math.ceil(sessionsState.total / limit)

  return (
    <div data-testid="sessions-panel" className="sessions-panel">
      <div className="content-header">
        <h2>会话管理</h2>
      </div>

      <div className="content-body">
        <div className="content-card">
          <div className="sessions-filter-bar">
            <label htmlFor="status-filter" className="filter-label">
              状态筛选:
            </label>
            <select
              id="status-filter"
              data-testid="sessions-filter-status"
              value={statusFilter}
              onChange={handleStatusChange}
              className="filter-select"
            >
              <option value="">全部</option>
              <option value="active">活跃</option>
              <option value="archived">已归档</option>
              <option value="closed">已关闭</option>
            </select>
          </div>

          {sessionsState.error && (
            <ErrorMessage error={sessionsState.error} retry={{ onClick: fetchSessions }} size="small" />
          )}

          {sessionsState.loading ? (
            <div className="sessions-loading">
              <LoadingSpinner label="加载会话列表..." />
            </div>
          ) : sessionsState.sessions.length === 0 ? (
            <div className="sessions-empty-state">
              <p>暂无符合条件的会话</p>
              <p>创建新会话后会显示在这里。</p>
            </div>
          ) : (
            <>
              {/* Desktop Table - hidden on mobile */}
              <table data-testid="sessions-table" className="sessions-table">
                <thead>
                  <tr>
                    <th className="col-title">标题</th>
                    <th className="col-status">状态</th>
                    <th className="col-messages">消息数</th>
                    <th className="col-activity">最后活动</th>
                    <th className="col-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionsState.sessions.map((session) => (
                    <tr
                      key={session.sessionId}
                      data-testid={`session-row-${session.sessionId}`}
                      className="session-row"
                    >
                      <td className="col-title">
                        {editingSessionId === session.sessionId ? (
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={handleSaveTitle}
                            onKeyDown={handleKeyDown}
                            className="title-input"
                            autoFocus
                          />
                        ) : (
                          <span
                            className="session-title editable"
                            onClick={() => handleStartEditing(session)}
                            title="点击编辑标题"
                          >
                            {session.title}
                          </span>
                        )}
                      </td>
                      <td className="col-status">
                        <span className={getStatusBadgeClass(session.status)}>
                          {session.status === 'active' && '活跃'}
                          {session.status === 'archived' && '已归档'}
                          {session.status === 'closed' && '已关闭'}
                        </span>
                      </td>
                      <td className="col-messages">{session.messageCount}</td>
                      <td className="col-activity">{formatDate(session.lastActivityAt)}</td>
                      <td className="col-actions">
                        <div className="action-buttons">
                          {session.status !== 'archived' && (
                            <button
                              data-testid={`session-archive-button-${session.sessionId}`}
                              onClick={() => handleArchiveSession(session.sessionId)}
                              className="action-btn archive-btn"
                              title="归档会话"
                            >
                              归档
                            </button>
                          )}
                          {session.status !== 'closed' && (
                            <button
                              data-testid={`session-close-button-${session.sessionId}`}
                              onClick={() => handleCloseSession(session.sessionId)}
                              className="action-btn close-btn"
                              title="关闭会话"
                            >
                              关闭
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile Card List - visible only on mobile */}
              <div data-testid="sessions-mobile-list" className="sessions-mobile-list">
                {sessionsState.sessions.map((session) => (
                  <div
                    key={session.sessionId}
                    data-testid={`session-card-${session.sessionId}`}
                    className="session-card"
                  >
                    <div className="session-card__header">
                      {editingSessionId === session.sessionId ? (
                        <input
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={handleSaveTitle}
                          onKeyDown={handleKeyDown}
                          className="title-input"
                          autoFocus
                        />
                      ) : (
                        <span
                          className="session-title editable"
                          onClick={() => handleStartEditing(session)}
                          title="点击编辑标题"
                        >
                          {session.title}
                        </span>
                      )}
                      <span className={getStatusBadgeClass(session.status)}>
                        {session.status === 'active' && '活跃'}
                        {session.status === 'archived' && '已归档'}
                        {session.status === 'closed' && '已关闭'}
                      </span>
                    </div>
                    <div className="session-card__meta">
                      <div className="session-card__meta-item">
                        <span className="meta-label">消息数</span>
                        <span className="meta-value">{session.messageCount}</span>
                      </div>
                      <div className="session-card__meta-item">
                        <span className="meta-label">最后活动</span>
                        <span className="meta-value">{formatDate(session.lastActivityAt)}</span>
                      </div>
                    </div>
                    <div className="session-card__actions">
                      {session.status !== 'archived' && (
                        <button
                          data-testid={`session-archive-button-${session.sessionId}`}
                          onClick={() => handleArchiveSession(session.sessionId)}
                          className="action-btn archive-btn"
                          title="归档会话"
                        >
                          归档
                        </button>
                      )}
                      {session.status !== 'closed' && (
                        <button
                          data-testid={`session-close-button-${session.sessionId}`}
                          onClick={() => handleCloseSession(session.sessionId)}
                          className="action-btn close-btn"
                          title="关闭会话"
                        >
                          关闭
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="sessions-pagination">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 0}
                    className="pagination-btn"
                  >
                    上一页
                  </button>
                  <span className="pagination-info">
                    第 {currentPage + 1} / {totalPages} 页 (共 {sessionsState.total} 条)
                  </span>
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage >= totalPages - 1}
                    className="pagination-btn"
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default SessionsTab
