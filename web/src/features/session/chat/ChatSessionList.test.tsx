import { render, screen, fireEvent } from '@testing-library/react'
import ChatSessionList from './ChatSessionList'
import type { ConsoleSessionInfo } from '../../api/types'

describe('ChatSessionList', () => {
  it('renders new chat button', () => {
    render(<ChatSessionList sessions={[]} onSelectSession={() => {}} onCreateSession={() => {}} />)
    expect(screen.getByText('新对话')).toBeInTheDocument()
  })

  it('renders session titles', () => {
    const sessions: ConsoleSessionInfo[] = [
      {
        sessionId: 's1',
        userId: 'u1',
        title: 'Session 1234',
        status: 'active',
        messageCount: 1,
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]
    render(<ChatSessionList sessions={sessions} onSelectSession={() => {}} onCreateSession={() => {}} />)
    expect(screen.getByText('Session 1234')).toBeInTheDocument()
  })
})
