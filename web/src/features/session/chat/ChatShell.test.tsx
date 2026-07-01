import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ChatShell from './ChatShell'

describe('ChatShell', () => {
  it('renders main content and sidebars', () => {
    render(
      <ChatShell
        title="Chat"
        sidebar={<div data-testid="sidebar">sidebar</div>}
        rightPanel={<div data-testid="right">right</div>}
      >
        <div data-testid="main">main</div>
      </ChatShell>
    )
    expect(screen.getByTestId('main')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('right')).toBeInTheDocument()
  })

  it('shows username when user prop is provided', () => {
    const user = { userId: 'u1', username: 'TestUser', createdAt: '2024-01-01' }
    render(
      <ChatShell
        title="Chat"
        sidebar={<div />}
        rightPanel={<div />}
        user={user}
      >
        <div />
      </ChatShell>
    )
    expect(screen.getByTestId('chat-titlebar-user')).toBeInTheDocument()
    expect(screen.getByText('TestUser')).toBeInTheDocument()
  })

  it('does not show user section when user is null', () => {
    render(
      <ChatShell
        title="Chat"
        sidebar={<div />}
        rightPanel={<div />}
        user={null}
      >
        <div />
      </ChatShell>
    )
    expect(screen.queryByTestId('chat-titlebar-user')).not.toBeInTheDocument()
  })

  it('calls onLogout when logout button is clicked', () => {
    const onLogout = vi.fn()
    const user = { userId: 'u1', username: 'TestUser', createdAt: '2024-01-01' }
    render(
      <ChatShell
        title="Chat"
        sidebar={<div />}
        rightPanel={<div />}
        user={user}
        onLogout={onLogout}
      >
        <div />
      </ChatShell>
    )
    const logoutBtn = screen.getByTestId('chat-titlebar-logout')
    fireEvent.click(logoutBtn)
    expect(onLogout).toHaveBeenCalledTimes(1)
  })
})
