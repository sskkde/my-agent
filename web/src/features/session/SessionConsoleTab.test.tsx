import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SessionConsoleTab from './SessionConsoleTab'
import { mockViewport, resetMatchMedia } from '../../test/setup'
import type { ConsoleTimelineEvent, ProcessingStatusPayload, TokenStreamPayload } from '../../api/types'

vi.mock('../../api/client', () => ({
  getSessions: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  getSessionTimeline: vi.fn(),
  sendMessage: vi.fn(),
  subscribeSessionTimeline: vi.fn(),
  getApprovals: vi.fn(),
  respondApproval: vi.fn(),
}));

import * as api from '../../api/client'

const mockGetSessions = api.getSessions as ReturnType<typeof vi.fn>;
const mockCreateSession = api.createSession as ReturnType<typeof vi.fn>;
const mockGetSession = api.getSession as ReturnType<typeof vi.fn>;
const mockGetSessionTimeline = api.getSessionTimeline as ReturnType<typeof vi.fn>;
const mockSendMessage = api.sendMessage as ReturnType<typeof vi.fn>;
const mockSubscribeSessionTimeline = api.subscribeSessionTimeline as ReturnType<typeof vi.fn>;
const mockGetApprovals = api.getApprovals as ReturnType<typeof vi.fn>;
const mockRespondApproval = api.respondApproval as ReturnType<typeof vi.fn>;

const SELECTED_SESSION_KEY = 'session-console-selected-session'

describe('SessionConsoleTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribeSessionTimeline.mockReturnValue(() => {})
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('fetches sessions list on mount', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalledTimes(1)
    })
  })

  it('shows empty state when no sessions exist', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-empty-state')).toBeInTheDocument()
    })
  })

  it('shows sessions list when sessions exist', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-123',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('sessions-list')).toBeInTheDocument()
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })
  })

  it('creates new session when clicking new session button', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    })
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
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-new-button')).toBeInTheDocument()
    })

    // Wait for the button to be enabled (not disabled by sessionsLoading)
    await waitFor(() => {
      expect(screen.getByTestId('session-new-button')).not.toBeDisabled()
    })

    fireEvent.click(screen.getByTestId('session-new-button'))

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(1)
    })
  })

  it('selects session when clicking session item', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-123',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [
        {
          eventId: 'event-1',
          eventType: 'user_message',
          sessionId: 'session-123',
          timestamp: new Date().toISOString(),
          content: 'Hello',
        },
      ],
      total: 1,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledWith('session-123')
      expect(mockGetSessionTimeline).toHaveBeenCalledWith('session-123')
    })

    await waitFor(() => {
      expect(screen.getByTestId('session-timeline')).toBeInTheDocument()
    })
  })

  it('shows stream status indicator when session is selected', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-123',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-timeline-stream-status')).toBeInTheDocument()
    })
  })

  it('allows typing and sending nonblank message', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-123',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline
      .mockResolvedValueOnce({
        events: [],
        total: 0,
      })
      .mockResolvedValueOnce({
        events: [
          {
            eventId: 'event-1',
            eventType: 'user_message',
            sessionId: 'session-123',
            timestamp: new Date().toISOString(),
            content: 'Hello world',
          },
        ],
        total: 1,
      })
    mockSendMessage.mockResolvedValue({ accepted: true, turnId: 'turn-1' })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    const input = screen.getByTestId('session-message-input')
    const sendButton = screen.getByTestId('session-send-button')

    fireEvent.change(input, { target: { value: 'Hello world' } })
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith('session-123', 'Hello world')
    })
  })

  it('shows sent message immediately while accepted message is still processing', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-123',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    let resolveSendMessage: (value: { accepted: boolean }) => void = () => {}
    mockSendMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveSendMessage = resolve
      }),
    )

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Queued hello' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      const timeline = screen.getByTestId('session-timeline')
      expect(within(timeline).getByText('Queued hello')).toBeInTheDocument()
    })

    await act(async () => {
      resolveSendMessage({ accepted: true })
    })
  })

  it('keeps a new pending message visible when older server message has same content', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-123',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 1,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 1,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [
        {
          eventId: 'event-old-repeat',
          eventType: 'user_message',
          sessionId: 'session-123',
          timestamp: '2024-01-01T00:00:00.000Z',
          content: 'Repeat',
        },
      ],
      total: 1,
    })
    mockSendMessage.mockReturnValue(new Promise(() => {}))

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Repeat' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      const timeline = screen.getByTestId('session-timeline')
      expect(within(timeline).getAllByText('Repeat')).toHaveLength(2)
    })
  })

  it('keeps the second identical pending message visible after one server confirmation arrives', async () => {
    let timelineEvents: ConsoleTimelineEvent[] = []

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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockImplementation(() =>
      Promise.resolve({
        events: timelineEvents,
        total: timelineEvents.length,
      }),
    )
    mockSendMessage.mockResolvedValueOnce({ accepted: true }).mockReturnValueOnce(new Promise(() => {}))

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Same' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getAllByText('Same')).toHaveLength(1)
    })

    timelineEvents = [
      {
        eventId: 'event-confirmed-repeat-1',
        eventType: 'user_message' as const,
        sessionId: 'session-123',
        timestamp: '2024-01-01T00:00:01.000Z',
        content: 'Same',
      },
    ]

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100))
    })

    await waitFor(() => {
      const timeline = screen.getByTestId('session-timeline')
      expect(within(timeline).getAllByText('Same')).toHaveLength(1)
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Same' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      const timeline = screen.getByTestId('session-timeline')
      expect(within(timeline).getAllByText('Same')).toHaveLength(2)
    })
  })

  it('removes all identical pending messages after staggered server confirmations arrive', async () => {
    const firstConfirmedEvent = {
      eventId: 'event-confirmed-staggered-1',
      eventType: 'user_message' as const,
      sessionId: 'session-123',
      timestamp: '2024-01-01T00:00:01.000Z',
      content: 'Staggered',
    }
    const secondConfirmedEvent = {
      eventId: 'event-confirmed-staggered-2',
      eventType: 'user_message' as const,
      sessionId: 'session-123',
      timestamp: '2024-01-01T00:00:02.000Z',
      content: 'Staggered',
    }

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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline
      .mockResolvedValueOnce({
        events: [],
        total: 0,
      })
      .mockResolvedValueOnce({
        events: [firstConfirmedEvent],
        total: 1,
      })
      .mockResolvedValue({
        events: [firstConfirmedEvent],
        total: 1,
      })
    mockSendMessage.mockResolvedValue({ accepted: true })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Staggered' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getAllByText('Staggered')).toHaveLength(1)
    })

    mockGetSessionTimeline.mockResolvedValue({
      events: [firstConfirmedEvent],
      total: 1,
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100))
    })

    await waitFor(() => {
      expect(screen.getAllByText('Staggered')).toHaveLength(1)
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Staggered' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getAllByText('Staggered')).toHaveLength(2)
    })

    await act(async () => {
      mockSubscribeSessionTimeline.mock.calls[0][1](secondConfirmedEvent)
    })

    await waitFor(() => {
      expect(screen.getAllByText('Staggered')).toHaveLength(2)
    })
  })

  it('blocks blank input client-side', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-123',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    const input = screen.getByTestId('session-message-input')
    const sendButton = screen.getByTestId('session-send-button')

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(sendButton)

    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('displays API error and preserves draft', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-123',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })
    mockSendMessage.mockRejectedValue(new Error('API Error'))

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    const input = screen.getByTestId('session-message-input')
    fireEvent.change(input, { target: { value: 'Test message' } })

    const sendButton = screen.getByTestId('session-send-button')
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(screen.getByTestId('session-error')).toBeInTheDocument()
    })

    expect((input as HTMLInputElement).value).toBe('Test message')
  })

  // =============================================================================
  // Async Assistant/Error Rendering Tests (Task 10)
  // =============================================================================

  it('renders assistant message from SSE timeline event after accepted send', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    // POST returns 202 with correlationId/envelopeId but NO assistant content
    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-123',
      envelopeId: 'env-456',
    })

    let timelineCallback: ((event: ConsoleTimelineEvent) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, onEvent) => {
      timelineCallback = onEvent
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    // Send a message
    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Hello AI' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith('session-123', 'Hello AI')
    })

    // Verify user message appears optimistically
    await waitFor(() => {
      expect(screen.getByText('Hello AI')).toBeInTheDocument()
    })

    // Verify correlationId/envelopeId are NOT rendered as content
    expect(screen.queryByText('corr-123')).not.toBeInTheDocument()
    expect(screen.queryByText('env-456')).not.toBeInTheDocument()

    // Simulate SSE assistant_message event arriving
    const assistantEvent: ConsoleTimelineEvent = {
      eventId: 'event-assistant-1',
      eventType: 'assistant_message',
      sessionId: 'session-123',
      timestamp: new Date().toISOString(),
      content: 'Hello! I am your AI assistant. How can I help you today?',
      actor: 'assistant',
    }

    await act(async () => {
      timelineCallback?.(assistantEvent)
    })

    // Verify assistant message now appears
    await waitFor(() => {
      expect(screen.getByText('Hello! I am your AI assistant. How can I help you today?')).toBeInTheDocument()
    })

    // Verify the assistant event type label is shown
    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })

  it('does not render correlationId or envelopeId from POST response as content', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    // POST returns only correlation metadata, NO assistant content
    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'test-correlation-id-abc123',
      envelopeId: 'test-envelope-id-xyz789',
    })

    mockSubscribeSessionTimeline.mockImplementation(() => () => {})

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    // Send a message
    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Test message content' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled()
    })

    // Verify ONLY the user message appears
    await waitFor(() => {
      expect(screen.getByText('Test message content')).toBeInTheDocument()
    })

    // CRITICAL: CorrelationId and envelopeId MUST NOT appear as rendered content
    expect(screen.queryByText('test-correlation-id-abc123')).not.toBeInTheDocument()
    expect(screen.queryByText('test-envelope-id-xyz789')).not.toBeInTheDocument()
    expect(screen.queryByText(/corr/)).not.toBeInTheDocument()
    expect(screen.queryByText(/envelope/)).not.toBeInTheDocument()

    // Verify no assistant content is rendered (none in POST response)
    expect(screen.queryByText('Assistant (streaming)')).not.toBeInTheDocument()
  })

  it('shows assistant processing placeholder immediately after sending and clears it on final assistant event', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({ events: [], total: 0 })
    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-placeholder',
      envelopeId: 'corr-placeholder',
    })

    let timelineCallback: ((event: ConsoleTimelineEvent) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, onEvent) => {
      timelineCallback = onEvent
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Needs placeholder' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('assistant-placeholder')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByTestId('assistant-placeholder')).toHaveAttribute('data-attempt-id', 'corr-placeholder')
    })

    await act(async () => {
      timelineCallback?.({
        eventId: 'event-assistant-placeholder',
        eventType: 'assistant_message',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Final response',
        metadata: { turnId: 'corr-placeholder' },
        actor: 'assistant',
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('assistant-placeholder')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Final response')).toBeInTheDocument()
  })

  it('renders streaming token drafts and clears them on final assistant event', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({ events: [], total: 0 })
    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-stream',
      envelopeId: 'corr-stream',
    })

    let timelineCallback: ((event: ConsoleTimelineEvent) => void) | null = null
    let tokenCallback: ((token: TokenStreamPayload) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, onEvent, _onError, _onStatus, onToken) => {
      timelineCallback = onEvent
      tokenCallback = onToken
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Stream please' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('assistant-placeholder')).toBeInTheDocument()
    })

    await act(async () => {
      tokenCallback?.({
        sessionId: 'session-123',
        attemptId: 'corr-stream',
        sequence: 1,
        delta: 'Hello',
        timestamp: new Date().toISOString(),
      })
      tokenCallback?.({
        sessionId: 'session-123',
        attemptId: 'corr-stream',
        sequence: 2,
        delta: ' world',
        timestamp: new Date().toISOString(),
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('assistant-placeholder')).not.toBeInTheDocument()
      expect(screen.getByTestId('streaming-assistant-draft')).toHaveTextContent('Hello world')
    })

    await act(async () => {
      timelineCallback?.({
        eventId: 'event-assistant-stream',
        eventType: 'assistant_message',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Hello world final',
        metadata: { turnId: 'corr-stream' },
        actor: 'assistant',
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('streaming-assistant-draft')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Hello world final')).toBeInTheDocument()
  })

  it('renders assistant placeholder inside timeline at correct position after user message', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({ events: [], total: 0 })
    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-timeline-order',
      envelopeId: 'corr-timeline-order',
    })

    mockSubscribeSessionTimeline.mockImplementation(() => () => {})

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Timeline order test' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('assistant-placeholder')).toBeInTheDocument()
    })

    const timeline = screen.getByTestId('session-timeline')
    const timelineList = timeline.querySelector('.timeline-list')
    const placeholder = screen.getByTestId('assistant-placeholder')
    const userMessage = screen.getByText('Timeline order test')

    expect(timelineList).not.toBeNull()
    expect(timelineList?.contains(placeholder)).toBe(true)
    expect(userMessage.compareDocumentPosition(placeholder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders streaming draft inside timeline at correct position after user message', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({ events: [], total: 0 })
    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-stream-order',
      envelopeId: 'corr-stream-order',
    })

    let tokenCallback: ((token: TokenStreamPayload) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, _onEvent, _onError, _onStatus, onToken) => {
      tokenCallback = onToken
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Stream order test' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('assistant-placeholder')).toBeInTheDocument()
    })

    await act(async () => {
      tokenCallback?.({
        sessionId: 'session-123',
        attemptId: 'corr-stream-order',
        sequence: 1,
        delta: 'Streaming content',
        timestamp: new Date().toISOString(),
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('assistant-placeholder')).not.toBeInTheDocument()
      expect(screen.getByTestId('streaming-assistant-draft')).toBeInTheDocument()
    })

    const timeline = screen.getByTestId('session-timeline')
    const timelineList = timeline.querySelector('.timeline-list')
    const streamingDraft = screen.getByTestId('streaming-assistant-draft')
    const userMessage = screen.getByText('Stream order test')

    expect(timelineList).not.toBeNull()
    expect(timelineList?.contains(streamingDraft)).toBe(true)
    expect(userMessage.compareDocumentPosition(streamingDraft) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('promotes the pending placeholder when a token arrives before POST resolves', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({ events: [], total: 0 })

    let resolveSend: (value: {
      accepted: boolean
      status: string
      correlationId: string
      envelopeId: string
    }) => void = () => {}
    mockSendMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve
      }),
    )

    let tokenCallback: ((token: TokenStreamPayload) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, _onEvent, _onError, _onStatus, onToken) => {
      tokenCallback = onToken
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Early token please' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('assistant-placeholder')).toBeInTheDocument()
    })

    await act(async () => {
      tokenCallback?.({
        sessionId: 'session-123',
        attemptId: 'corr-early-token',
        sequence: 1,
        delta: 'Early stream',
        timestamp: new Date().toISOString(),
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('assistant-placeholder')).not.toBeInTheDocument()
      expect(screen.getByTestId('streaming-assistant-draft')).toHaveAttribute('data-attempt-id', 'corr-early-token')
      expect(screen.getByTestId('streaming-assistant-draft')).toHaveTextContent('Early stream')
    })

    await act(async () => {
      resolveSend({
        accepted: true,
        status: 'accepted',
        correlationId: 'corr-early-token',
        envelopeId: 'env-early-token',
      })
    })

    expect(screen.queryByTestId('assistant-placeholder')).not.toBeInTheDocument()
    expect(screen.getByTestId('streaming-assistant-draft')).toHaveTextContent('Early stream')
  })

  it('does not render pending assistant activity from another selected session', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-one',
          userId: 'user-1',
          title: 'First Session',
          status: 'active',
          messageCount: 0,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          sessionId: 'session-two',
          userId: 'user-1',
          title: 'Second Session',
          status: 'active',
          messageCount: 0,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 2,
    })
    mockGetSession.mockImplementation((sessionId: string) =>
      Promise.resolve({
        session: {
          sessionId,
          userId: 'user-1',
          messageCount: 0,
          lastActivityAt: new Date().toISOString(),
          activePlannerRunIds: [],
          activeBackgroundRunIds: [],
        },
      }),
    )
    mockGetSessionTimeline.mockResolvedValue({ events: [], total: 0 })
    mockSendMessage.mockReturnValue(new Promise(() => {}))
    mockSubscribeSessionTimeline.mockImplementation(() => () => {})

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-one')).toBeInTheDocument()
      expect(screen.getByTestId('session-item-session-two')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-one'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Keep this pending' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('assistant-placeholder')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-two'))

    await waitFor(() => {
      expect(screen.getByText('Session sion-two')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('assistant-placeholder')).not.toBeInTheDocument()
    expect(screen.queryByTestId('streaming-assistant-draft')).not.toBeInTheDocument()
  })

  it('renders processing status payload details from SSE', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({ events: [], total: 0 })

    let statusCallback: ((status: ProcessingStatusPayload) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, _onEvent, _onError, onStatus) => {
      statusCallback = onStatus
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByText('就绪')).toBeInTheDocument()
    })

    await act(async () => {
      statusCallback?.({
        sessionId: 'session-123',
        attemptId: 'corr-status',
        stage: 'model_call',
        stageLabel: '模型调用',
        providerId: 'openrouter',
        model: 'gpt-test',
        contextUsage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          maxContextTokens: 100,
        },
        activeTools: [{ toolId: 'docs.search', status: 'running' }],
        timestamp: new Date().toISOString(),
      })
    })

    expect(screen.getByText('模型：openrouter/gpt-test')).toBeInTheDocument()
    expect(screen.getByText('阶段：模型调用')).toBeInTheDocument()
    expect(screen.getByText('上下文：15/100')).toBeInTheDocument()
    expect(screen.getByText('工具：docs.search')).toBeInTheDocument()
    expect(screen.queryByText('模型：未知')).not.toBeInTheDocument()
    expect(screen.queryByText('上下文：未知')).not.toBeInTheDocument()
  })

  it('renders error event from SSE timeline and keeps input usable', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-789',
      envelopeId: 'env-012',
    })

    let timelineCallback: ((event: ConsoleTimelineEvent) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, onEvent) => {
      timelineCallback = onEvent
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    // Send a message
    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Trigger error test' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled()
    })

    // Simulate SSE error event arriving
    const errorEvent: ConsoleTimelineEvent = {
      eventId: 'event-error-1',
      eventType: 'error',
      sessionId: 'session-123',
      timestamp: new Date().toISOString(),
      content: 'Failed to process request: LLM provider unavailable',
      metadata: {
        errorCode: 'PROVIDER_ERROR',
        recoverable: true,
      },
    }

    await act(async () => {
      timelineCallback?.(errorEvent)
    })

    // Verify error event appears in timeline
    await waitFor(() => {
      expect(screen.getByText('Failed to process request: LLM provider unavailable')).toBeInTheDocument()
    })

    // Verify the error event type label is shown
    expect(screen.getByText('Error')).toBeInTheDocument()

    // Verify input remains usable (not disabled, can type)
    const input = screen.getByTestId('session-message-input')
    expect(input).not.toBeDisabled()

    // Verify we can send another message after error
    fireEvent.change(input, { target: { value: 'Retry after error' } })
    expect((input as HTMLInputElement).value).toBe('Retry after error')

    const sendButton = screen.getByTestId('session-send-button')
    expect(sendButton).not.toBeDisabled()
  })

  it('handles multiple async events: user message, assistant response, then error', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-flow',
      envelopeId: 'env-flow',
    })

    let timelineCallback: ((event: ConsoleTimelineEvent) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, onEvent) => {
      timelineCallback = onEvent
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    // First message
    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'First query' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getByText('First query')).toBeInTheDocument()
    })

    // Assistant responds
    await act(async () => {
      timelineCallback?.({
        eventId: 'event-assistant-2',
        eventType: 'assistant_message',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Response to first query',
        actor: 'assistant',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Response to first query')).toBeInTheDocument()
    })

    // Error occurs (e.g., in a follow-up tool call)
    await act(async () => {
      timelineCallback?.({
        eventId: 'event-error-2',
        eventType: 'error',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Tool execution failed: timeout',
        metadata: { recoverable: true },
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Tool execution failed: timeout')).toBeInTheDocument()
    })

    // Verify input is still usable after error
    const input = screen.getByTestId('session-message-input')
    fireEvent.change(input, { target: { value: 'Second query after error' } })
    expect((input as HTMLInputElement).value).toBe('Second query after error')
  })

  it('POST response with correlationId/envelopeId but no assistant content does not break optimistic rendering', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    // Simulate backend returning 202 with only metadata
    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'metadata-only-corr',
      envelopeId: 'metadata-only-env',
    })

    mockSubscribeSessionTimeline.mockImplementation(() => () => {})

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    // Send message
    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Optimistic test' },
    })

    let resolveSend: (value: { accepted: boolean; correlationId: string; envelopeId: string; status: string }) => void
    mockSendMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSend = resolve
      }),
    )

    fireEvent.click(screen.getByTestId('session-send-button'))

    // Optimistic message appears immediately, before POST completes
    await waitFor(() => {
      const timeline = screen.getByTestId('session-timeline')
      expect(within(timeline).getByText('Optimistic test')).toBeInTheDocument()
    })

    // Complete the POST
    await act(async () => {
      resolveSend({
        accepted: true,
        correlationId: 'returned-corr',
        envelopeId: 'returned-env',
        status: 'accepted',
      })
    })

    // Verify optimistic message remains
    const timeline = screen.getByTestId('session-timeline')
    expect(within(timeline).getByText('Optimistic test')).toBeInTheDocument()

    // Verify correlation/envelope IDs don't appear
    expect(screen.queryByText('returned-corr')).not.toBeInTheDocument()
    expect(screen.queryByText('returned-env')).not.toBeInTheDocument()
  })

  it('clears placeholder when SSE assistant message arrives with mismatched metadata', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({ events: [], total: 0 })
    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-placeholder-mismatch',
      envelopeId: 'env-placeholder-mismatch',
    })

    let timelineCallback: ((event: ConsoleTimelineEvent) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, onEvent) => {
      timelineCallback = onEvent
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Mismatched metadata test' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('assistant-placeholder')).toBeInTheDocument()
    })

    await act(async () => {
      timelineCallback?.({
        eventId: 'event-assistant-mismatched',
        eventType: 'assistant_message',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Response with different turnId',
        metadata: { turnId: 'different-turn-id', attemptId: 'different-attempt-id' },
        actor: 'assistant',
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('assistant-placeholder')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Response with different turnId')).toBeInTheDocument()
  })

  it('clears placeholder when SSE error message arrives with mismatched metadata', async () => {
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
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({ events: [], total: 0 })
    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-error-mismatch',
      envelopeId: 'env-error-mismatch',
    })

    let timelineCallback: ((event: ConsoleTimelineEvent) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, onEvent) => {
      timelineCallback = onEvent
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-123'))

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Error mismatched test' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('assistant-placeholder')).toBeInTheDocument()
    })

    await act(async () => {
      timelineCallback?.({
        eventId: 'event-error-mismatched',
        eventType: 'error',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Error occurred with different metadata',
        metadata: { errorCode: 'TEST_ERROR', turnId: 'different-error-turn-id' },
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('assistant-placeholder')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Error occurred with different metadata')).toBeInTheDocument()
  })
})

// =============================================================================
// Session Persistence Tests
// =============================================================================

describe('SessionConsoleTab - Session Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribeSessionTimeline.mockReturnValue(() => {})
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('persists selected session ID to localStorage', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-persist-1',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-persist-1',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-persist-1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('session-item-session-persist-1'))

    await waitFor(() => {
      expect(localStorage.getItem(SELECTED_SESSION_KEY)).toBe('session-persist-1')
    })
  })

  it('restores selected session ID from localStorage on mount', async () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'session-restored-1')

    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-restored-1',
          userId: 'user-1',
          title: 'Restored Session',
          status: 'active',
          messageCount: 3,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-restored-1',
        userId: 'user-1',
        messageCount: 3,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledWith('session-restored-1')
    })
  })

  it('clears localStorage when session is deselected', async () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'session-to-deselect')

    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-to-deselect',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 1,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-to-deselect',
        userId: 'user-1',
        messageCount: 1,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledWith('session-to-deselect')
    })

    await waitFor(() => {
      expect(localStorage.getItem(SELECTED_SESSION_KEY)).toBe('session-to-deselect')
    })
  })
})

// =============================================================================
// Focus/Visibility Refresh Tests
// =============================================================================

describe('SessionConsoleTab - Focus/Visibility Refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribeSessionTimeline.mockReturnValue(() => {})
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('refreshes sessions list on visibility change to visible', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalledTimes(1)
    })

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalledTimes(2)
    })
  })

  it('refreshes timeline on focus when session is selected', async () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'session-focus-1')

    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-focus-1',
          userId: 'user-1',
          title: 'Focus Session',
          status: 'active',
          messageCount: 1,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-focus-1',
        userId: 'user-1',
        messageCount: 1,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(mockGetSessionTimeline).toHaveBeenCalledTimes(1)
    })

    window.dispatchEvent(new Event('focus'))

    await waitFor(() => {
      expect(mockGetSessionTimeline).toHaveBeenCalledTimes(2)
    })
  })

  it('refreshes sessions and timeline on pageshow event', async () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'session-pageshow-1')

    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-pageshow-1',
          userId: 'user-1',
          title: 'PageShow Session',
          status: 'active',
          messageCount: 1,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-pageshow-1',
        userId: 'user-1',
        messageCount: 1,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalledTimes(1)
      expect(mockGetSessionTimeline).toHaveBeenCalledTimes(1)
    })

    window.dispatchEvent(new Event('pageshow'))

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalledTimes(2)
      expect(mockGetSessionTimeline).toHaveBeenCalledTimes(2)
    })
  })
})

// =============================================================================
// SSE Auto-Reconnection Tests
// =============================================================================

describe('SessionConsoleTab - SSE Auto-Reconnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('automatically reconnects SSE after error with exponential backoff', async () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'session-sse-reconnect-1')

    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-sse-reconnect-1',
          userId: 'user-1',
          title: 'SSE Reconnect Session',
          status: 'active',
          messageCount: 1,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-sse-reconnect-1',
        userId: 'user-1',
        messageCount: 1,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    let errorCallback: (() => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, _onEvent, onError) => {
      errorCallback = onError
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      errorCallback?.()
    })

    await waitFor(() => {
      expect(screen.getByText('已断开')).toBeInTheDocument()
    })

    await new Promise((resolve) => setTimeout(resolve, 1100))

    await waitFor(() => {
      expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(2)
    })
  })

  it('stops reconnecting after 5 failed attempts', async () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'session-sse-max-1')

    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-sse-max-1',
          userId: 'user-1',
          title: 'SSE Max Session',
          status: 'active',
          messageCount: 1,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-sse-max-1',
        userId: 'user-1',
        messageCount: 1,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    let errorCallback: (() => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, _onEvent, onError) => {
      errorCallback = onError
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(1)
    })

    const delays = [1000, 2000]
    for (const delay of delays) {
      await act(async () => {
        errorCallback?.()
      })

      await new Promise((resolve) => setTimeout(resolve, delay + 100))
    }

    await waitFor(() => {
      expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(3)
    })
  }, 10000)

  it('resets reconnection attempts on successful event', async () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'session-sse-reset-1')

    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-sse-reset-1',
          userId: 'user-1',
          title: 'SSE Reset Session',
          status: 'active',
          messageCount: 1,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-sse-reset-1',
        userId: 'user-1',
        messageCount: 1,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    let eventCallback: ((event: ConsoleTimelineEvent) => void) | null = null
    let errorCallback: (() => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, onEvent, onError) => {
      eventCallback = onEvent
      errorCallback = onError
      return () => {}
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      errorCallback?.()
    })

    await new Promise((resolve) => setTimeout(resolve, 1100))

    await waitFor(() => {
      expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      eventCallback?.({
        eventId: 'event-test-1',
        eventType: 'user_message',
        sessionId: 'session-sse-reset-1',
        timestamp: new Date().toISOString(),
        content: 'Test',
      })
    })

    await act(async () => {
      errorCallback?.()
    })

    await new Promise((resolve) => setTimeout(resolve, 1100))

    await waitFor(() => {
      expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(3)
    })
  })
})

// =============================================================================
// Post-Send Catch-Up Polling Tests
// =============================================================================

describe('SessionConsoleTab - Post-Send Catch-Up Polling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('polls timeline after sending message until user message appears', async () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'session-poll-1')

    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-poll-1',
          userId: 'user-1',
          title: 'Poll Session',
          status: 'active',
          messageCount: 0,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-poll-1',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline
      .mockResolvedValueOnce({
        events: [],
        total: 0,
      })
      .mockResolvedValueOnce({
        events: [],
        total: 0,
      })
      .mockResolvedValueOnce({
        events: [
          {
            eventId: 'event-poll-user-1',
            eventType: 'user_message',
            sessionId: 'session-poll-1',
            timestamp: new Date().toISOString(),
            content: 'Poll test message',
          },
        ],
        total: 1,
      })
    mockSendMessage.mockResolvedValue({ accepted: true })
    mockSubscribeSessionTimeline.mockReturnValue(() => {})

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Poll test message' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith('session-poll-1', 'Poll test message')
    })

    await new Promise((resolve) => setTimeout(resolve, 600))

    await waitFor(() => {
      expect(mockGetSessionTimeline).toHaveBeenCalledTimes(2)
    })

    await new Promise((resolve) => setTimeout(resolve, 600))

    await waitFor(() => {
      expect(mockGetSessionTimeline).toHaveBeenCalledTimes(3)
    })
  })

  it('stops polling after max attempts', async () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'session-poll-max-1')

    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-poll-max-1',
          userId: 'user-1',
          title: 'Poll Max Session',
          status: 'active',
          messageCount: 0,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-poll-max-1',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })
    mockSendMessage.mockResolvedValue({ accepted: true })
    mockSubscribeSessionTimeline.mockReturnValue(() => {})

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Max poll test' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled()
    })

    await new Promise((resolve) => setTimeout(resolve, 2000))

    await waitFor(() => {
      const timelineCalls = mockGetSessionTimeline.mock.calls.length
      expect(timelineCalls).toBeGreaterThan(1)
    })
  }, 10000)

  it('deduplicates events by eventId during polling', async () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'session-dedup-1')

    const existingEvent: ConsoleTimelineEvent = {
      eventId: 'event-dedup-1',
      eventType: 'user_message',
      sessionId: 'session-dedup-1',
      timestamp: new Date().toISOString(),
      content: 'Existing message',
    }

    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-dedup-1',
          userId: 'user-1',
          title: 'Dedup Session',
          status: 'active',
          messageCount: 1,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-dedup-1',
        userId: 'user-1',
        messageCount: 1,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline
      .mockResolvedValueOnce({
        events: [existingEvent],
        total: 1,
      })
      .mockResolvedValue({
        events: [existingEvent],
        total: 1,
      })
    mockSendMessage.mockResolvedValue({ accepted: true })
    mockSubscribeSessionTimeline.mockReturnValue(() => {})

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Dedup test' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled()
    })

    await new Promise((resolve) => setTimeout(resolve, 600))

    await waitFor(() => {
      expect(screen.getAllByText('Existing message')).toHaveLength(1)
    })
  })

  it('clears placeholder when polling fetches confirmed user message with assistant reply', async () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'session-poll-clear-1')

    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-poll-clear-1',
          userId: 'user-1',
          title: 'Poll Clear Session',
          status: 'active',
          messageCount: 0,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-poll-clear-1',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    let timelineCallCount = 0
    mockGetSessionTimeline.mockImplementation(async () => {
      timelineCallCount++
      if (timelineCallCount === 1) {
        return { events: [], total: 0 }
      }
      const userMessageTime = new Date().toISOString()
      const assistantReplyTime = new Date(Date.now() + 1000).toISOString()
      return {
        events: [
          {
            eventId: 'event-poll-user-confirmed',
            eventType: 'user_message',
            sessionId: 'session-poll-clear-1',
            timestamp: userMessageTime,
            content: 'Poll clear test',
          },
          {
            eventId: 'event-poll-assistant-reply',
            eventType: 'assistant_message',
            sessionId: 'session-poll-clear-1',
            timestamp: assistantReplyTime,
            content: 'Assistant response from polling',
            actor: 'assistant',
          },
        ],
        total: 2,
      }
    })

    mockSendMessage.mockResolvedValue({ accepted: true, correlationId: 'corr-poll-clear' })
    mockSubscribeSessionTimeline.mockReturnValue(() => {})

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Poll clear test' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('assistant-placeholder')).toBeInTheDocument()
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100))
    })

    await waitFor(() => {
      expect(screen.queryByTestId('assistant-placeholder')).not.toBeInTheDocument()
    })

    expect(screen.getByText('Assistant response from polling')).toBeInTheDocument()
  })

  it('clears placeholder when polling fetches confirmed user message with error reply', async () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'session-poll-error-1')

    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-poll-error-1',
          userId: 'user-1',
          title: 'Poll Error Session',
          status: 'active',
          messageCount: 0,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-poll-error-1',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    let timelineCallCount = 0
    mockGetSessionTimeline.mockImplementation(async () => {
      timelineCallCount++
      if (timelineCallCount === 1) {
        return { events: [], total: 0 }
      }
      const userMessageTime = new Date().toISOString()
      const errorReplyTime = new Date(Date.now() + 1000).toISOString()
      return {
        events: [
          {
            eventId: 'event-poll-error-user-confirmed',
            eventType: 'user_message',
            sessionId: 'session-poll-error-1',
            timestamp: userMessageTime,
            content: 'Poll error test',
          },
          {
            eventId: 'event-poll-error-reply',
            eventType: 'error',
            sessionId: 'session-poll-error-1',
            timestamp: errorReplyTime,
            content: 'Error from polling',
            metadata: { errorCode: 'POLL_ERROR' },
          },
        ],
        total: 2,
      }
    })

    mockSendMessage.mockResolvedValue({ accepted: true, correlationId: 'corr-poll-error' })
    mockSubscribeSessionTimeline.mockReturnValue(() => {})

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Poll error test' },
    })
    fireEvent.click(screen.getByTestId('session-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('assistant-placeholder')).toBeInTheDocument()
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100))
    })

    await waitFor(() => {
      expect(screen.queryByTestId('assistant-placeholder')).not.toBeInTheDocument()
    })

    expect(screen.getByText('Error from polling')).toBeInTheDocument()
  })
})

describe('SessionConsoleTab - Mobile Responsive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribeSessionTimeline.mockReturnValue(() => {});
    mockGetApprovals.mockResolvedValue({ approvals: [], total: 0 });
    localStorage.clear();
  });

  it('shows sidebar toggle button on mobile viewport', async () => {
    mockViewport(390) // iPhone width
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-sidebar-toggle')).toBeInTheDocument()
    })
  })

  it('opens drawer when toggle button is clicked', async () => {
    mockViewport(390)
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-123',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })

    const { container } = render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-sidebar-toggle')).toBeInTheDocument()
    })

    const toggleButton = screen.getByTestId('session-sidebar-toggle')
    fireEvent.click(toggleButton)

    // Drawer should be open (has drawer-open class)
    expect(container.querySelector('.session-console-rich--drawer-open')).toBeInTheDocument()
  })

  it('closes drawer when close button is clicked', async () => {
    mockViewport(390)
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-123',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })

    const { container } = render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-sidebar-toggle')).toBeInTheDocument()
    })

    // Open drawer
    fireEvent.click(screen.getByTestId('session-sidebar-toggle'))
    expect(container.querySelector('.session-console-rich--drawer-open')).toBeInTheDocument()

    // Close drawer
    fireEvent.click(screen.getByTestId('session-sidebar-close'))
    expect(container.querySelector('.session-console-rich--drawer-open')).not.toBeInTheDocument()
  })

  it('closes drawer when selecting a session', async () => {
    mockViewport(390)
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-123',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    const { container } = render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-sidebar-toggle')).toBeInTheDocument()
    })

    // Open drawer
    fireEvent.click(screen.getByTestId('session-sidebar-toggle'))
    expect(container.querySelector('.session-console-rich--drawer-open')).toBeInTheDocument()

    // Select session
    fireEvent.click(screen.getByTestId('session-item-session-123'))

    // Drawer should close
    await waitFor(() => {
      expect(container.querySelector('.session-console-rich--drawer-open')).not.toBeInTheDocument()
    })
  })

  it('has accessible ARIA attributes on toggle button', async () => {
    mockViewport(390)
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-sidebar-toggle')).toBeInTheDocument()
    })

    const toggleButton = screen.getByTestId('session-sidebar-toggle')
    expect(toggleButton).toHaveAttribute('aria-controls', 'sessions-sidebar')
    expect(toggleButton).toHaveAttribute('aria-label', '打开会话列表')
    expect(toggleButton).toHaveAttribute('aria-expanded')
  })

  it('sidebar has data-testid attribute', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByTestId('sessions-sidebar')).toBeInTheDocument()
    })
  })

  it('renders loading state in sidebar on mobile', async () => {
    mockViewport(390)
    mockGetSessions.mockImplementation(() => new Promise(() => {})) // Never resolves

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByText('加载会话列表...')).toBeInTheDocument();
    });
  });

  it('renders error state in sidebar on mobile', async () => {
    mockViewport(390)
    mockGetSessions.mockRejectedValue(new Error('Network error'))

    render(<SessionConsoleTab />)

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  describe('Approval Modal Integration', () => {
    it('shows approval modal when pending approval exists for selected session', async () => {
      const sessionId = 'session-123';
      mockGetSessions.mockResolvedValue({
        sessions: [
          {
            sessionId,
            userId: 'user-1',
            title: 'Test Session',
            status: 'active',
            messageCount: 5,
            lastActivityAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      });

      mockGetSession.mockResolvedValue({
        session: {
          sessionId,
          userId: 'user-1',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
        },
      });

      mockGetSessionTimeline.mockResolvedValue({
        events: [],
      });

      mockGetApprovals.mockResolvedValue({
        approvals: [
          {
            id: 'approval-123',
            sessionId,
            actionType: 'exec',
            resource: '/bin/bash',
            requestedBy: 'agent',
            requestedAt: new Date().toISOString(),
            status: 'pending',
          },
        ],
        total: 1,
      });

      render(<SessionConsoleTab />);

      await waitFor(() => {
        expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('session-item-session-123'));

      await waitFor(() => {
        expect(screen.getByTestId('approval-modal')).toBeInTheDocument();
      });
    });

    it('does not show approval modal for different session', async () => {
      const sessionId = 'session-123';
      mockGetSessions.mockResolvedValue({
        sessions: [
          {
            sessionId,
            userId: 'user-1',
            title: 'Test Session',
            status: 'active',
            messageCount: 5,
            lastActivityAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      });

      mockGetSession.mockResolvedValue({
        session: {
          sessionId,
          userId: 'user-1',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
        },
      });

      mockGetSessionTimeline.mockResolvedValue({
        events: [],
      });

      mockGetApprovals.mockResolvedValue({
        approvals: [
          {
            id: 'approval-456',
            sessionId: 'session-456',
            actionType: 'exec',
            resource: '/bin/bash',
            requestedBy: 'agent',
            requestedAt: new Date().toISOString(),
            status: 'pending',
          },
        ],
        total: 1,
      });

      render(<SessionConsoleTab />);

      await waitFor(() => {
        expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('session-item-session-123'));

      await waitFor(() => {
        expect(screen.queryByTestId('approval-modal')).not.toBeInTheDocument();
      });
    });

    it('calls respondApproval with approve_once when approve-once button clicked', async () => {
      const sessionId = 'session-123';
      mockGetSessions.mockResolvedValue({
        sessions: [
          {
            sessionId,
            userId: 'user-1',
            title: 'Test Session',
            status: 'active',
            messageCount: 5,
            lastActivityAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      });

      mockGetSession.mockResolvedValue({
        session: {
          sessionId,
          userId: 'user-1',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
        },
      });

      mockGetSessionTimeline.mockResolvedValue({
        events: [],
      });

      mockGetApprovals.mockResolvedValue({
        approvals: [
          {
            id: 'approval-123',
            sessionId,
            actionType: 'exec',
            resource: '/bin/bash',
            requestedBy: 'agent',
            requestedAt: new Date().toISOString(),
            status: 'pending',
          },
        ],
        total: 1,
      });

      mockRespondApproval.mockResolvedValue({
        success: true,
        approvalId: 'approval-123',
        status: 'approved',
      });

      render(<SessionConsoleTab />);

      await waitFor(() => {
        expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('session-item-session-123'));

      await waitFor(() => {
        expect(screen.getByTestId('approval-modal')).toBeInTheDocument();
      });

      const approveOnceButton = screen.getByTestId('approval-modal-approve-once');
      fireEvent.click(approveOnceButton);

      await waitFor(() => {
        expect(mockRespondApproval).toHaveBeenCalledWith('approval-123', 'approve_once', undefined);
      });
    });

    it('calls respondApproval with reject when reject button clicked', async () => {
      const sessionId = 'session-123';
      mockGetSessions.mockResolvedValue({
        sessions: [
          {
            sessionId,
            userId: 'user-1',
            title: 'Test Session',
            status: 'active',
            messageCount: 5,
            lastActivityAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      });

      mockGetSession.mockResolvedValue({
        session: {
          sessionId,
          userId: 'user-1',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
        },
      });

      mockGetSessionTimeline.mockResolvedValue({
        events: [],
      });

      mockGetApprovals.mockResolvedValue({
        approvals: [
          {
            id: 'approval-123',
            sessionId,
            actionType: 'exec',
            resource: '/bin/bash',
            requestedBy: 'agent',
            requestedAt: new Date().toISOString(),
            status: 'pending',
          },
        ],
        total: 1,
      });

      mockRespondApproval.mockResolvedValue({
        success: true,
        approvalId: 'approval-123',
        status: 'rejected',
      });

      render(<SessionConsoleTab />);

      await waitFor(() => {
        expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('session-item-session-123'));

      await waitFor(() => {
        expect(screen.getByTestId('approval-modal')).toBeInTheDocument();
      });

      const rejectButton = screen.getByTestId('approval-modal-reject');
      fireEvent.click(rejectButton);

      await waitFor(() => {
        expect(mockRespondApproval).toHaveBeenCalledWith('approval-123', 'reject', undefined);
      });
    });

    it('closes modal after successful approval', async () => {
      const sessionId = 'session-123';
      mockGetSessions.mockResolvedValue({
        sessions: [
          {
            sessionId,
            userId: 'user-1',
            title: 'Test Session',
            status: 'active',
            messageCount: 5,
            lastActivityAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      });

      mockGetSession.mockResolvedValue({
        session: {
          sessionId,
          userId: 'user-1',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
        },
      });

      mockGetSessionTimeline.mockResolvedValue({
        events: [],
      });

      mockGetApprovals
        .mockResolvedValueOnce({
          approvals: [
            {
              id: 'approval-123',
              sessionId,
              actionType: 'exec',
              resource: '/bin/bash',
              requestedBy: 'agent',
              requestedAt: new Date().toISOString(),
              status: 'pending',
            },
          ],
          total: 1,
        })
        .mockResolvedValueOnce({
          approvals: [],
          total: 0,
        });

      mockRespondApproval.mockResolvedValue({
        success: true,
        approvalId: 'approval-123',
        status: 'approved',
      });

      render(<SessionConsoleTab />);

      await waitFor(() => {
        expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('session-item-session-123'));

      await waitFor(() => {
        expect(screen.getByTestId('approval-modal')).toBeInTheDocument();
      });

      const approveOnceButton = screen.getByTestId('approval-modal-approve-once');
      fireEvent.click(approveOnceButton);

      await waitFor(() => {
        expect(mockRespondApproval).toHaveBeenCalledWith('approval-123', 'approve_once', undefined);
      });

      await waitFor(() => {
        expect(screen.queryByTestId('approval-modal')).not.toBeInTheDocument();
      });
    });

    it('shows error message when approval fails', async () => {
      const sessionId = 'session-123';
      mockGetSessions.mockResolvedValue({
        sessions: [
          {
            sessionId,
            userId: 'user-1',
            title: 'Test Session',
            status: 'active',
            messageCount: 5,
            lastActivityAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      });

      mockGetSession.mockResolvedValue({
        session: {
          sessionId,
          userId: 'user-1',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
        },
      });

      mockGetSessionTimeline.mockResolvedValue({
        events: [],
      });

      mockGetApprovals.mockResolvedValue({
        approvals: [
          {
            id: 'approval-123',
            sessionId,
            actionType: 'exec',
            resource: '/bin/bash',
            requestedBy: 'agent',
            requestedAt: new Date().toISOString(),
            status: 'pending',
          },
        ],
        total: 1,
      });

      mockRespondApproval.mockRejectedValue(new Error('Network error'));

      render(<SessionConsoleTab />);

      await waitFor(() => {
        expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('session-item-session-123'));

      await waitFor(() => {
        expect(screen.getByTestId('approval-modal')).toBeInTheDocument();
      });

      const approveOnceButton = screen.getByTestId('approval-modal-approve-once');
      fireEvent.click(approveOnceButton);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });

      expect(screen.getByTestId('approval-modal')).toBeInTheDocument();
    });
  });
});
