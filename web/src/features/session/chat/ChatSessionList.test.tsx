import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import ChatSessionList from './ChatSessionList'
import type { ConsoleSessionInfo } from '../../api/types'

function makeSession(overrides: Partial<ConsoleSessionInfo> = {}): ConsoleSessionInfo {
  return {
    sessionId: 's1',
    userId: 'u1',
    title: 'Session 1234',
    status: 'active',
    messageCount: 1,
    lastActivityAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('ChatSessionList', () => {
  it('renders new chat button', () => {
    render(<ChatSessionList sessions={[]} onSelectSession={() => {}} onCreateSession={() => {}} />)
    expect(screen.getByText('新对话')).toBeInTheDocument()
  })

  it('renders session titles', () => {
    const sessions = [makeSession()]
    render(<ChatSessionList sessions={sessions} onSelectSession={() => {}} onCreateSession={() => {}} />)
    expect(screen.getByText('Session 1234')).toBeInTheDocument()
  })

  it('renders archive entry button in default view', () => {
    render(<ChatSessionList sessions={[]} onSelectSession={() => {}} onCreateSession={() => {}} />)
    expect(screen.getByTestId('chat-archive-entry')).toBeInTheDocument()
  })

  it('calls onToggleArchiveView when archive button clicked', () => {
    const onToggle = vi.fn()
    render(
      <ChatSessionList
        sessions={[]}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        onToggleArchiveView={onToggle}
      />,
    )
    fireEvent.click(screen.getByTestId('chat-archive-entry').querySelector('button')!)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('shows archived sessions in archive view', () => {
    const archivedSessions = [
      makeSession({ sessionId: 'arch1', title: 'Archived Session', status: 'archived' }),
    ]
    render(
      <ChatSessionList
        sessions={[]}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        archiveView={true}
        archivedSessions={archivedSessions}
      />,
    )
    expect(screen.getByText('已归档')).toBeInTheDocument()
    expect(screen.getByText('Archived Session')).toBeInTheDocument()
  })

  it('shows empty state when no archived sessions', () => {
    render(
      <ChatSessionList
        sessions={[]}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        archiveView={true}
        archivedSessions={[]}
      />,
    )
    expect(screen.getByText('暂无归档会话')).toBeInTheDocument()
  })

  it('calls onArchiveSession when archive button on session item clicked', () => {
    const onArchive = vi.fn()
    const sessions = [makeSession({ sessionId: 's1' })]
    render(
      <ChatSessionList
        sessions={sessions}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        onArchiveSession={onArchive}
      />,
    )
    const archiveBtn = screen.getByTestId('chat-session-s1').querySelector('.chat-session-item__archive')!
    fireEvent.click(archiveBtn)
    expect(onArchive).toHaveBeenCalledWith('s1')
  })

  it('calls onRestoreSession when restore button on archived session clicked', () => {
    const onRestore = vi.fn()
    const archivedSessions = [makeSession({ sessionId: 'arch1', status: 'archived' })]
    render(
      <ChatSessionList
        sessions={[]}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        archiveView={true}
        archivedSessions={archivedSessions}
        onRestoreSession={onRestore}
      />,
    )
    const restoreBtn = screen.getByTestId('chat-archived-arch1').querySelector('.chat-session-item__restore')!
    fireEvent.click(restoreBtn)
    expect(onRestore).toHaveBeenCalledWith('arch1')
  })

  it('calls onToggleArchiveView when back button clicked in archive view', () => {
    const onToggle = vi.fn()
    render(
      <ChatSessionList
        sessions={[]}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        archiveView={true}
        archivedSessions={[]}
        onToggleArchiveView={onToggle}
      />,
    )
    fireEvent.click(screen.getByTestId('chat-back-to-active'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})