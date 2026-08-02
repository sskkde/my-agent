import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import AgentShell from './AgentShell'
import type { TabId } from '../components/TabNav'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: 'u1', username: 'testuser', role: 'admin' },
    logout: vi.fn(),
  }),
  AuthContext: React.createContext(null),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../api/client', () => ({
  getSettings: vi.fn().mockResolvedValue({ settings: { localOnly: true, retentionDays: 30 } }),
  updateSettings: vi.fn().mockResolvedValue({ settings: {} }),
  getMe: vi.fn(),
  getSetupStatus: vi.fn(),
  setupUser: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('../features/context/ContextDeskPanel', () => ({
  default: ({ sessionId, activeTab }: { sessionId?: string; activeTab?: string }) => (
    <div data-testid="context-desk-panel" data-session={sessionId} data-tab={activeTab} />
  ),
}))

vi.mock('../features/session/chat/ChatSessionList', () => ({
  default: () => <div data-testid="chat-session-list" />,
}))

vi.mock('../features/session/chat/ChatContextPanel', () => ({
  default: ({ sessionId }: { sessionId?: string }) => (
    <div data-testid="chat-context-panel" data-session={sessionId} />,
  ),
}))

const renderWithRouter = (ui: React.ReactElement) => {
  return render(<BrowserRouter>{ui}</BrowserRouter>)
}

describe('AgentShell', () => {
  const mockOnTabChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Chat Section (pass-through)', () => {
    it('renders children for chat section', () => {
      renderWithRouter(
        <AgentShell activeTab="session-console" onTabChange={mockOnTabChange}>
          <div data-testid="page-content">Chat Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('page-content')).toBeInTheDocument()
      expect(screen.getByTestId('agent-shell')).toBeInTheDocument()
      expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    })

    it('renders center-stage testId for chat section', () => {
      renderWithRouter(
        <AgentShell activeTab="session-console" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('center-stage')).toBeInTheDocument()
    })
  })

  describe('Non-Chat Section (ChatShell wrapping)', () => {
    it('renders children wrapped in ChatShell for workspace section', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div data-testid="page-content">Dashboard Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('page-content')).toBeInTheDocument()
      expect(screen.getByTestId('agent-shell')).toBeInTheDocument()
      expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    })

    it('renders ContextDeskPanel for non-chat section', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('context-desk-panel')).toBeInTheDocument()
    })

    it('renders ChatShell titlebar for non-chat section', () => {
      renderWithRouter(
        <AgentShell activeTab="agent-monitor" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('chat-shell')).toBeInTheDocument()
    })

    it('passes sessionId to ContextDeskPanel', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange} sessionId="sess-123">
          <div>Content</div>
        </AgentShell>,
      )

      const panel = screen.getByTestId('context-desk-panel')
      expect(panel).toHaveAttribute('data-session', 'sess-123')
      expect(panel).toHaveAttribute('data-tab', 'dashboard')
    })
  })

  describe('TestId Preservation', () => {
    it('preserves agent-shell testId for chat section', () => {
      renderWithRouter(
        <AgentShell activeTab="session-console" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('agent-shell')).toBeInTheDocument()
    })

    it('preserves agent-shell testId for non-chat section', () => {
      renderWithRouter(
        <AgentShell activeTab="settings" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('agent-shell')).toBeInTheDocument()
    })
  })
})
