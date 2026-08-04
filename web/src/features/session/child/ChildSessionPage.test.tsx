import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChildSessionPage from './ChildSessionPage'
import * as client from '../../../api/client'
import type { ConsoleTimelineEvent, ProcessingStatusPayload, TokenStreamPayload } from '../../../api/types'

vi.mock('../../../api/client')

const parentSession = 'parent-session-1'
const childSession = 'child-session-1'
const taskId = 'task-1'

const child = {
  sessionId: childSession,
  userId: 'user-1',
  title: '文档处理任务',
  status: 'active' as const,
  messageCount: 3,
  lastActivityAt: '2026-08-04T10:00:00.000Z',
  createdAt: '2026-08-04T09:00:00.000Z',
  updatedAt: '2026-08-04T10:00:00.000Z',
  sessionKind: 'subagent' as const,
  parentSessionId: parentSession,
  taskId,
  agentProfile: 'document_processor',
  launchMode: 'foreground' as const,
  subagentDepth: 1,
}

const event = (
  eventType: ConsoleTimelineEvent['eventType'],
  content: string,
  metadata: Record<string, unknown> = {},
): ConsoleTimelineEvent => ({
  eventId: `${eventType}-${content}`,
  eventType,
  sessionId: childSession,
  timestamp: '2026-08-04T10:00:00.000Z',
  content,
  metadata,
  actor: eventType === 'user_message' ? 'user' : 'assistant',
})

const renderPage = (path = `/chat/${parentSession}/task/${taskId}`) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chat/:sessionId/task/:taskId" element={<ChildSessionPage />} />
      </Routes>
    </MemoryRouter>,
  )

describe('ChildSessionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(client.getChildSessions).mockResolvedValue({
      items: [child],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    })
    vi.mocked(client.getSessionTimeline).mockResolvedValue({
      events: [
        event('user_message', '处理这份文档'),
        event('thinking_summary', '正在分析文档结构'),
        event('tool_call', '读取文件', { toolName: 'file_read', parameters: { path: 'README.md' } }),
        event('tool_result', '读取完成', { toolName: 'file_read', result: '内容已读取' }),
        event('assistant_message', '文档已处理完成'),
        { ...event('assistant_message', '父会话内容不应显示'), sessionId: parentSession },
      ],
      total: 6,
      hasMore: false,
    })
    vi.mocked(client.subscribeSessionTimeline).mockImplementation(
      (_sessionId, _onEvent, _onError, _onStatus, _onToken, onOpen) => {
        onOpen?.()
        return vi.fn()
      },
    )
  })

  it('navigates from a parent-scoped task to the correct child and renders the shared chat timeline', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('文档已处理完成')).toBeInTheDocument())
    expect(client.getChildSessions).toHaveBeenCalledWith(parentSession, 50, 0)
    // Child lifecycle events are persisted on the PARENT timeline — the page
    // must fetch the parent session's timeline and filter by child identity.
    expect(client.getSessionTimeline).toHaveBeenCalledWith(parentSession, 50)
    expect(client.subscribeSessionTimeline).toHaveBeenCalledWith(
      parentSession,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    )
    expect(screen.getByText('文档已处理完成')).toBeInTheDocument()
    expect(screen.queryByText('父会话内容不应显示')).not.toBeInTheDocument()
    expect(screen.getAllByText('file_read').length).toBeGreaterThan(0)
    expect(screen.getAllByText('子会话').length).toBeGreaterThan(0)
  })

  it('subscribes to the parent stream (child lifecycle lives there) and cleans it up when returning to the parent', async () => {
    const unsubscribe = vi.fn()
    vi.mocked(client.subscribeSessionTimeline).mockImplementation(
      (_sessionId, _onEvent, _onError, _onStatus, _onToken, onOpen) => {
        onOpen?.()
        return unsubscribe
      },
    )
    const { unmount } = renderPage()

    await waitFor(() =>
      expect(client.subscribeSessionTimeline).toHaveBeenCalledWith(
        parentSession,
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
      ),
    )
    expect(client.subscribeSessionTimeline).not.toHaveBeenCalledWith(
      childSession,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    )

    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('returns to the parent route without adding a child to the primary session list', async () => {
    render(
      <MemoryRouter
        initialEntries={[`/chat/${parentSession}`, `/chat/${parentSession}/task/${taskId}`]}
        initialIndex={1}
      >
        <Routes>
          <Route path="/chat/:sessionId" element={<div data-testid="parent-session-page">父会话</div>} />
          <Route path="/chat/:sessionId/task/:taskId" element={<ChildSessionPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByTestId('child-session-back'))

    fireEvent.click(screen.getByTestId('child-session-back'))

    await waitFor(() => expect(screen.getByTestId('parent-session-page')).toBeInTheDocument())
    expect(screen.queryByText(childSession)).not.toBeInTheDocument()
  })

  it('shows archived status while retaining the child timeline', async () => {
    vi.mocked(client.getChildSessions).mockResolvedValue({
      items: [{ ...child, status: 'archived' }],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    })

    renderPage()

    await waitFor(() => expect(screen.getByTestId('child-session-status')).toHaveTextContent('已归档'))
    expect(screen.getByText('文档已处理完成')).toBeInTheDocument()
  })

  it.each([
    ['404', Object.assign(new Error('Session not found'), { status: 404, code: 'NOT_FOUND' })],
    ['403', Object.assign(new Error('Forbidden'), { status: 403, code: 'FORBIDDEN' })],
  ])('renders the same safe not-found state for foreign or unknown child (%s)', async (_label, error) => {
    vi.mocked(client.getChildSessions).mockRejectedValue(error)

    renderPage('/chat/parent-foreign/task/secret-child-id')

    await waitFor(() => expect(screen.getByTestId('child-session-not-found')).toBeInTheDocument())
    expect(screen.getByTestId('child-session-not-found')).toHaveTextContent('找不到该子任务')
    expect(screen.getByTestId('child-session-not-found')).not.toHaveTextContent('secret-child-id')
    expect(client.getSessionTimeline).not.toHaveBeenCalled()
    expect(client.subscribeSessionTimeline).not.toHaveBeenCalled()
  })

  it('renders the same safe not-found state when the parent-scoped child list does not contain the task', async () => {
    vi.mocked(client.getChildSessions).mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
    })

    renderPage('/chat/parent-1/task/unknown-task-id')

    await waitFor(() => expect(screen.getByTestId('child-session-not-found')).toBeInTheDocument())
    expect(screen.getByTestId('child-session-not-found')).not.toHaveTextContent('unknown-task-id')
    expect(client.getSessionTimeline).not.toHaveBeenCalled()
  })

  it('keeps existing child events visible and exposes a keyboard-accessible retry after SSE disconnect', async () => {
    let errorCallback: ((error: Error) => void) | undefined
    let eventCallback: ((event: ConsoleTimelineEvent) => void) | undefined
    let tokenCallback: ((token: TokenStreamPayload) => void) | undefined
    let statusCallback: ((status: ProcessingStatusPayload) => void) | undefined
    vi.mocked(client.subscribeSessionTimeline).mockImplementation(
      (_sessionId, onEvent, onError, onStatus, onToken, onOpen) => {
        eventCallback = onEvent
        errorCallback = onError
        statusCallback = onStatus
        tokenCallback = onToken
        onOpen?.()
        return vi.fn()
      },
    )

    renderPage()
    await waitFor(() => expect(screen.getByText('文档已处理完成')).toBeInTheDocument())

    act(() => {
      eventCallback?.(event('assistant_message', '实时子任务结果'))
      tokenCallback?.({
        sessionId: childSession,
        attemptId: 'attempt-1',
        sequence: 1,
        delta: '增量文本',
        timestamp: '2026-08-04T10:00:01.000Z',
      })
      statusCallback?.({
        sessionId: childSession,
        attemptId: 'attempt-1',
        stage: 'streaming',
        stageLabel: '流式输出',
        activeTools: [],
        timestamp: '2026-08-04T10:00:01.000Z',
      })
      errorCallback?.(new Error('disconnect'))
    })

    await waitFor(() => expect(screen.getByTestId('child-session-stream-status')).toHaveTextContent('已断开'))
    expect(screen.getByText('实时子任务结果')).toBeInTheDocument()
    expect(screen.getByText('增量文本')).toBeInTheDocument()

    const retry = screen.getByRole('button', { name: '重试子会话连接' })
    retry.focus()
    expect(retry).toHaveFocus()
    fireEvent.click(retry)
    expect(client.subscribeSessionTimeline).toHaveBeenCalledTimes(2)
  })
})
