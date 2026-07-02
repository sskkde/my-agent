import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ChatShell from './ChatShell'

function mockMatchMedia(matchesMap: Record<string, boolean>) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: matchesMap[query] ?? false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

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

  it('hides both sidebars by default on mobile', () => {
    mockMatchMedia({ '(max-width: 768px)': true, '(max-width: 1024px)': true })
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
    expect(screen.queryByTestId('chat-sidebar')).toHaveClass('collapsed')
    expect(screen.queryByTestId('chat-right-sidebar')).toHaveClass('collapsed')
  })

  it('shows left sidebar and hides right sidebar by default on tablet', () => {
    mockMatchMedia({ '(max-width: 768px)': false, '(max-width: 1024px)': true })
    render(
      <ChatShell
        title="Chat"
        sidebar={<div data-testid="sidebar">sidebar</div>}
        rightPanel={<div data-testid="right">right</div>}
      >
        <div data-testid="main">main</div>
      </ChatShell>
    )
    expect(screen.queryByTestId('chat-sidebar')).not.toHaveClass('collapsed')
    expect(screen.queryByTestId('chat-right-sidebar')).toHaveClass('collapsed')
  })

  it('opens left sidebar when toggle button clicked on mobile', () => {
    mockMatchMedia({ '(max-width: 768px)': true, '(max-width: 1024px)': true })
    render(
      <ChatShell
        title="Chat"
        sidebar={<div data-testid="sidebar">sidebar</div>}
        rightPanel={<div data-testid="right">right</div>}
      >
        <div data-testid="main">main</div>
      </ChatShell>
    )
    fireEvent.click(screen.getByTestId('chat-sidebar-toggle'))
    expect(screen.queryByTestId('chat-sidebar')).not.toHaveClass('collapsed')
    expect(screen.getByTestId('chat-left-backdrop')).toBeInTheDocument()
  })

  it('closes left sidebar when backdrop clicked', () => {
    mockMatchMedia({ '(max-width: 768px)': true, '(max-width: 1024px)': true })
    render(
      <ChatShell
        title="Chat"
        sidebar={<div data-testid="sidebar">sidebar</div>}
        rightPanel={<div data-testid="right">right</div>}
      >
        <div data-testid="main">main</div>
      </ChatShell>
    )
    fireEvent.click(screen.getByTestId('chat-sidebar-toggle'))
    fireEvent.click(screen.getByTestId('chat-left-backdrop'))
    expect(screen.queryByTestId('chat-sidebar')).toHaveClass('collapsed')
  })
})
