import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SessionWorkspace from './SessionWorkspace'

vi.mock('../../api/client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>

  class MockApiClientError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
      this.name = 'ApiClientError'
    }
  }

  return {
    ...actual,
    getSessions: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    getSessionTimeline: vi.fn(),
    sendMessage: vi.fn(),
    subscribeSessionTimeline: vi.fn(),
    ApiClientError: MockApiClientError,
  }
})

import * as api from '../../api/client'

const mockGetSessions = api.getSessions as ReturnType<typeof vi.fn>
const mockSubscribeSessionTimeline = api.subscribeSessionTimeline as ReturnType<typeof vi.fn>

const renderWithRouter = (ui: React.ReactElement, initialEntries: string[] = ['/']) => {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>)
}

describe('SessionWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribeSessionTimeline.mockReturnValue(() => {})
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  // =============================================================================
  // Wrapper Structure Tests (Round 1)
  // =============================================================================

  describe('Wrapper Structure', () => {
    it('has data-testid="session-workspace" on root container', () => {
      mockGetSessions.mockResolvedValue({
        sessions: [],
        total: 0,
      })

      renderWithRouter(<SessionWorkspace />)

      expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
    })

    it('marks the root as a flex workspace for chat height containment', () => {
      mockGetSessions.mockResolvedValue({
        sessions: [],
        total: 0,
      })

      renderWithRouter(<SessionWorkspace />)

      expect(screen.getByTestId('session-workspace')).toHaveClass('session-workspace')
    })

    it('renders SessionConsoleTab as child', async () => {
      mockGetSessions.mockResolvedValue({
        sessions: [],
        total: 0,
      })

      renderWithRouter(<SessionWorkspace />)

      // SessionConsoleTab renders session-empty-state when no sessions
      await waitFor(() => {
        expect(screen.getByTestId('session-empty-state')).toBeInTheDocument()
      })
    })

    it('preserves session-message-input selector from SessionConsoleTab', async () => {
      mockGetSessions.mockResolvedValue({
        sessions: [
          {
            sessionId: 'session-123',
            userId: 'user-1',
            title: 'Test Session',
            status: 'active',
            messageCount: 0,
            lastActivityAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      })

      renderWithRouter(<SessionWorkspace />)

      await waitFor(() => {
        expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
      })

      // Select the session to see the input
      screen.getByTestId('session-item-session-123').click()

      await waitFor(() => {
        expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
      })
    })

    it('preserves session-send-button selector from SessionConsoleTab', async () => {
      mockGetSessions.mockResolvedValue({
        sessions: [
          {
            sessionId: 'session-123',
            userId: 'user-1',
            title: 'Test Session',
            status: 'active',
            messageCount: 0,
            lastActivityAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      })

      renderWithRouter(<SessionWorkspace />)

      await waitFor(() => {
        expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
      })

      // Select the session to see the send button
      screen.getByTestId('session-item-session-123').click()

      await waitFor(() => {
        expect(screen.getByTestId('session-send-button')).toBeInTheDocument()
      })
    })
  })

  // =============================================================================
  // Props Passthrough Tests
  // =============================================================================

  describe('Props Passthrough', () => {
    it('passes setActiveTab to SessionConsoleTab', async () => {
      mockGetSessions.mockResolvedValue({
        sessions: [],
        total: 0,
      })

      const mockSetActiveTab = vi.fn()
      renderWithRouter(<SessionWorkspace setActiveTab={mockSetActiveTab} />)

      // Component should render without errors
      await waitFor(() => {
        expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
      })
    })

    it('passes auth to SessionConsoleTab', async () => {
      mockGetSessions.mockResolvedValue({
        sessions: [],
        total: 0,
      })

      const mockAuth = {
        userId: 'user-1',
        username: 'testuser',
      }
      renderWithRouter(<SessionWorkspace auth={mockAuth} />)

      // Component should render without errors
      await waitFor(() => {
        expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
      })
    })
  })

  // =============================================================================
  // SessionConsoleTab Behavior Preserved Tests
  // =============================================================================

  describe('SessionConsoleTab Behavior Preserved', () => {
    it('shows empty state when no sessions exist', async () => {
      mockGetSessions.mockResolvedValue({
        sessions: [],
        total: 0,
      })

      renderWithRouter(<SessionWorkspace />)

      await waitFor(() => {
        expect(screen.getByTestId('session-empty-state')).toBeInTheDocument()
      })
    })

    it('shows sessions list when sessions exist', async () => {
      mockGetSessions.mockResolvedValue({
        sessions: [
          {
            sessionId: 'session-456',
            userId: 'user-1',
            title: 'Workspace Session',
            status: 'active',
            messageCount: 3,
            lastActivityAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      })

      renderWithRouter(<SessionWorkspace />)

      await waitFor(() => {
        expect(screen.getByTestId('sessions-list')).toBeInTheDocument()
        expect(screen.getByTestId('session-item-session-456')).toBeInTheDocument()
      })
    })

    it('creates new session when clicking new session button', async () => {
      mockGetSessions.mockResolvedValue({
        sessions: [],
        total: 0,
      })

      const mockCreateSession = api.createSession as ReturnType<typeof vi.fn>
      mockCreateSession.mockResolvedValue({
        session: {
          sessionId: 'session-new',
          userId: 'user-1',
          messageCount: 0,
          lastActivityAt: new Date().toISOString(),
          activePlannerRunIds: [],
          activeBackgroundRunIds: [],
        },
      })

      const mockGetSession = api.getSession as ReturnType<typeof vi.fn>
      mockGetSession.mockResolvedValue({
        session: {
          sessionId: 'session-new',
          userId: 'user-1',
          messageCount: 0,
          lastActivityAt: new Date().toISOString(),
          activePlannerRunIds: [],
          activeBackgroundRunIds: [],
        },
      })

      const mockGetSessionTimeline = api.getSessionTimeline as ReturnType<typeof vi.fn>
      mockGetSessionTimeline.mockResolvedValue({
        events: [],
        total: 0,
      })

      renderWithRouter(<SessionWorkspace />)

      await waitFor(() => {
        expect(screen.getByTestId('session-new-button')).toBeInTheDocument()
      })

      // Wait for the button to be enabled
      await waitFor(() => {
        expect(screen.getByTestId('session-new-button')).not.toBeDisabled()
      })

      screen.getByTestId('session-new-button').click()

      await waitFor(() => {
        expect(mockCreateSession).toHaveBeenCalledTimes(1)
      })
    })
  })
})
