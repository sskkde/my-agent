import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SessionConsoleTab from './SessionConsoleTab';
import { mockViewport, resetMatchMedia } from '../../test/setup';
import type { ConsoleTimelineEvent } from '../../api/types';

vi.mock('../../api/client', () => ({
  getSessions: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  getSessionTimeline: vi.fn(),
  sendMessage: vi.fn(),
  subscribeSessionTimeline: vi.fn(),
}));

import * as api from '../../api/client';

const mockGetSessions = api.getSessions as ReturnType<typeof vi.fn>;
const mockCreateSession = api.createSession as ReturnType<typeof vi.fn>;
const mockGetSession = api.getSession as ReturnType<typeof vi.fn>;
const mockGetSessionTimeline = api.getSessionTimeline as ReturnType<typeof vi.fn>;
const mockSendMessage = api.sendMessage as ReturnType<typeof vi.fn>;
const mockSubscribeSessionTimeline = api.subscribeSessionTimeline as ReturnType<typeof vi.fn>;

describe('SessionConsoleTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribeSessionTimeline.mockReturnValue(() => {});
  });

  it('fetches sessions list on mount', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalledTimes(1);
    });
  });

  it('shows empty state when no sessions exist', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-empty-state')).toBeInTheDocument();
    });
  });

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
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('sessions-list')).toBeInTheDocument();
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });
  });

  it('creates new session when clicking new session button', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    });
    mockCreateSession.mockResolvedValue({
      session: {
        sessionId: 'session-new',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-new',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-new-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-new-button'));

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });
  });

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
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
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledWith('session-123');
      expect(mockGetSessionTimeline).toHaveBeenCalledWith('session-123');
    });

    await waitFor(() => {
      expect(screen.getByTestId('session-timeline')).toBeInTheDocument();
    });
  });

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-timeline-stream-status')).toBeInTheDocument();
    });
  });

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
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
      });
    mockSendMessage.mockResolvedValue({ accepted: true, turnId: 'turn-1' });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument();
    });

    const input = screen.getByTestId('session-message-input');
    const sendButton = screen.getByTestId('session-send-button');

    fireEvent.change(input, { target: { value: 'Hello world' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith('session-123', 'Hello world');
    });
  });

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    });

    let resolveSendMessage: (value: { accepted: boolean }) => void = () => {};
    mockSendMessage.mockReturnValue(new Promise((resolve) => {
      resolveSendMessage = resolve;
    }));

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Queued hello' },
    });
    fireEvent.click(screen.getByTestId('session-send-button'));

    await waitFor(() => {
      expect(screen.getByText('Queued hello')).toBeInTheDocument();
    });

    await act(async () => {
      resolveSendMessage({ accepted: true });
    });
  });

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 1,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
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
    });
    mockSendMessage.mockReturnValue(new Promise(() => {}));

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Repeat' },
    });
    fireEvent.click(screen.getByTestId('session-send-button'));

    await waitFor(() => {
      expect(screen.getAllByText('Repeat')).toHaveLength(2);
    });
  });

  it('keeps the second identical pending message visible after one server confirmation arrives', async () => {
    let timelineEvents = [
      {
        eventId: 'event-confirmed-repeat-1',
        eventType: 'user_message' as const,
        sessionId: 'session-123',
        timestamp: '2024-01-01T00:00:00.000Z',
        content: 'Same',
      },
    ];

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSessionTimeline.mockImplementation(() => Promise.resolve({
      events: timelineEvents,
      total: timelineEvents.length,
    }));
    mockSendMessage
      .mockResolvedValueOnce({ accepted: true })
      .mockReturnValueOnce(new Promise(() => {}));

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument();
    });

    timelineEvents = [];
    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Same' },
    });
    fireEvent.click(screen.getByTestId('session-send-button'));

    await waitFor(() => {
      expect(screen.getAllByText('Same')).toHaveLength(1);
    });

    await waitFor(() => {
      expect(mockGetSessionTimeline).toHaveBeenCalledTimes(2);
    });

    timelineEvents = [
      {
        eventId: 'event-confirmed-repeat-1',
        eventType: 'user_message' as const,
        sessionId: 'session-123',
        timestamp: '2024-01-01T00:00:01.000Z',
        content: 'Same',
      },
    ];
    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Same' },
    });
    fireEvent.click(screen.getByTestId('session-send-button'));

    await waitFor(() => {
      expect(screen.getAllByText('Same')).toHaveLength(2);
    });
  });

  it('removes all identical pending messages after staggered server confirmations arrive', async () => {
    const firstConfirmedEvent = {
      eventId: 'event-confirmed-staggered-1',
      eventType: 'user_message' as const,
      sessionId: 'session-123',
      timestamp: '2024-01-01T00:00:01.000Z',
      content: 'Staggered',
    };
    const secondConfirmedEvent = {
      eventId: 'event-confirmed-staggered-2',
      eventType: 'user_message' as const,
      sessionId: 'session-123',
      timestamp: '2024-01-01T00:00:02.000Z',
      content: 'Staggered',
    };

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
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
      });
    mockSendMessage.mockResolvedValue({ accepted: true });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Staggered' },
    });
    fireEvent.click(screen.getByTestId('session-send-button'));

    await waitFor(() => {
      expect(screen.getAllByText('Staggered')).toHaveLength(1);
    });

    await waitFor(() => {
      expect(mockGetSessionTimeline).toHaveBeenCalledTimes(2);
    });

    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Staggered' },
    });
    fireEvent.click(screen.getByTestId('session-send-button'));

    await waitFor(() => {
      expect(screen.getAllByText('Staggered')).toHaveLength(2);
    });

    await act(async () => {
      mockSubscribeSessionTimeline.mock.calls[0][1](secondConfirmedEvent);
    });

    await waitFor(() => {
      expect(screen.getAllByText('Staggered')).toHaveLength(2);
    });
  });

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument();
    });

    const input = screen.getByTestId('session-message-input');
    const sendButton = screen.getByTestId('session-send-button');

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(sendButton);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    });
    mockSendMessage.mockRejectedValue(new Error('API Error'));

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument();
    });

    const input = screen.getByTestId('session-message-input');
    fireEvent.change(input, { target: { value: 'Test message' } });

    const sendButton = screen.getByTestId('session-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByTestId('session-error')).toBeInTheDocument();
    });

    expect((input as HTMLInputElement).value).toBe('Test message');
  });

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    });

    // POST returns 202 with correlationId/envelopeId but NO assistant content
    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-123',
      envelopeId: 'env-456',
    });

    let timelineCallback: ((event: ConsoleTimelineEvent) => void) | null = null;
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, onEvent) => {
      timelineCallback = onEvent;
      return () => {};
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument();
    });

    // Send a message
    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Hello AI' },
    });
    fireEvent.click(screen.getByTestId('session-send-button'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith('session-123', 'Hello AI');
    });

    // Verify user message appears optimistically
    await waitFor(() => {
      expect(screen.getByText('Hello AI')).toBeInTheDocument();
    });

    // Verify correlationId/envelopeId are NOT rendered as content
    expect(screen.queryByText('corr-123')).not.toBeInTheDocument();
    expect(screen.queryByText('env-456')).not.toBeInTheDocument();

    // Simulate SSE assistant_message event arriving
    const assistantEvent: ConsoleTimelineEvent = {
      eventId: 'event-assistant-1',
      eventType: 'assistant_message',
      sessionId: 'session-123',
      timestamp: new Date().toISOString(),
      content: 'Hello! I am your AI assistant. How can I help you today?',
      actor: 'assistant',
    };

    await act(async () => {
      timelineCallback?.(assistantEvent);
    });

    // Verify assistant message now appears
    await waitFor(() => {
      expect(screen.getByText('Hello! I am your AI assistant. How can I help you today?')).toBeInTheDocument();
    });

    // Verify the assistant event type label is shown
    expect(screen.getByText('Assistant')).toBeInTheDocument();
  });

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    });

    // POST returns only correlation metadata, NO assistant content
    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'test-correlation-id-abc123',
      envelopeId: 'test-envelope-id-xyz789',
    });

    mockSubscribeSessionTimeline.mockImplementation(() => () => {});

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument();
    });

    // Send a message
    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Test message content' },
    });
    fireEvent.click(screen.getByTestId('session-send-button'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled();
    });

    // Verify ONLY the user message appears
    await waitFor(() => {
      expect(screen.getByText('Test message content')).toBeInTheDocument();
    });

    // CRITICAL: CorrelationId and envelopeId MUST NOT appear as rendered content
    expect(screen.queryByText('test-correlation-id-abc123')).not.toBeInTheDocument();
    expect(screen.queryByText('test-envelope-id-xyz789')).not.toBeInTheDocument();
    expect(screen.queryByText(/corr/)).not.toBeInTheDocument();
    expect(screen.queryByText(/envelope/)).not.toBeInTheDocument();

    // Verify no assistant content is rendered (none in POST response)
    expect(screen.queryByText('Assistant')).not.toBeInTheDocument();
  });

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    });

    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-789',
      envelopeId: 'env-012',
    });

    let timelineCallback: ((event: ConsoleTimelineEvent) => void) | null = null;
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, onEvent) => {
      timelineCallback = onEvent;
      return () => {};
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument();
    });

    // Send a message
    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Trigger error test' },
    });
    fireEvent.click(screen.getByTestId('session-send-button'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled();
    });

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
    };

    await act(async () => {
      timelineCallback?.(errorEvent);
    });

    // Verify error event appears in timeline
    await waitFor(() => {
      expect(screen.getByText('Failed to process request: LLM provider unavailable')).toBeInTheDocument();
    });

    // Verify the error event type label is shown
    expect(screen.getByText('Error')).toBeInTheDocument();

    // Verify input remains usable (not disabled, can type)
    const input = screen.getByTestId('session-message-input');
    expect(input).not.toBeDisabled();

    // Verify we can send another message after error
    fireEvent.change(input, { target: { value: 'Retry after error' } });
    expect((input as HTMLInputElement).value).toBe('Retry after error');

    const sendButton = screen.getByTestId('session-send-button');
    expect(sendButton).not.toBeDisabled();
  });

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    });

    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-flow',
      envelopeId: 'env-flow',
    });

    let timelineCallback: ((event: ConsoleTimelineEvent) => void) | null = null;
    mockSubscribeSessionTimeline.mockImplementation((_sessionId, onEvent) => {
      timelineCallback = onEvent;
      return () => {};
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument();
    });

    // First message
    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'First query' },
    });
    fireEvent.click(screen.getByTestId('session-send-button'));

    await waitFor(() => {
      expect(screen.getByText('First query')).toBeInTheDocument();
    });

    // Assistant responds
    await act(async () => {
      timelineCallback?.({
        eventId: 'event-assistant-2',
        eventType: 'assistant_message',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Response to first query',
        actor: 'assistant',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Response to first query')).toBeInTheDocument();
    });

    // Error occurs (e.g., in a follow-up tool call)
    await act(async () => {
      timelineCallback?.({
        eventId: 'event-error-2',
        eventType: 'error',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Tool execution failed: timeout',
        metadata: { recoverable: true },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Tool execution failed: timeout')).toBeInTheDocument();
    });

    // Verify input is still usable after error
    const input = screen.getByTestId('session-message-input');
    fireEvent.change(input, { target: { value: 'Second query after error' } });
    expect((input as HTMLInputElement).value).toBe('Second query after error');
  });

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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    });

    // Simulate backend returning 202 with only metadata
    mockSendMessage.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'metadata-only-corr',
      envelopeId: 'metadata-only-env',
    });

    mockSubscribeSessionTimeline.mockImplementation(() => () => {});

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-item-session-123'));

    await waitFor(() => {
      expect(screen.getByTestId('session-message-input')).toBeInTheDocument();
    });

    // Send message
    fireEvent.change(screen.getByTestId('session-message-input'), {
      target: { value: 'Optimistic test' },
    });

    let resolveSend: (value: { accepted: boolean; correlationId: string; envelopeId: string; status: string }) => void;
    mockSendMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSend = resolve;
      })
    );

    fireEvent.click(screen.getByTestId('session-send-button'));

    // Optimistic message appears immediately, before POST completes
    await waitFor(() => {
      expect(screen.getByText('Optimistic test')).toBeInTheDocument();
    });

    // Complete the POST
    await act(async () => {
      resolveSend({
        accepted: true,
        correlationId: 'returned-corr',
        envelopeId: 'returned-env',
        status: 'accepted',
      });
    });

    // Verify optimistic message remains
    expect(screen.getByText('Optimistic test')).toBeInTheDocument();

    // Verify correlation/envelope IDs don't appear
    expect(screen.queryByText('returned-corr')).not.toBeInTheDocument();
    expect(screen.queryByText('returned-env')).not.toBeInTheDocument();
  });
});

describe('SessionConsoleTab - Mobile Responsive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribeSessionTimeline.mockReturnValue(() => {});
    resetMatchMedia();
  });

  it('shows sidebar toggle button on mobile viewport', async () => {
    mockViewport(390); // iPhone width
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-sidebar-toggle')).toBeInTheDocument();
    });
  });

  it('opens drawer when toggle button is clicked', async () => {
    mockViewport(390);
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
    });

    const { container } = render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-sidebar-toggle')).toBeInTheDocument();
    });

    const toggleButton = screen.getByTestId('session-sidebar-toggle');
    fireEvent.click(toggleButton);

    // Drawer should be open (has drawer-open class)
    expect(container.querySelector('.session-console-rich--drawer-open')).toBeInTheDocument();
  });

  it('closes drawer when close button is clicked', async () => {
    mockViewport(390);
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
    });

    const { container } = render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-sidebar-toggle')).toBeInTheDocument();
    });

    // Open drawer
    fireEvent.click(screen.getByTestId('session-sidebar-toggle'));
    expect(container.querySelector('.session-console-rich--drawer-open')).toBeInTheDocument();

    // Close drawer
    fireEvent.click(screen.getByTestId('session-sidebar-close'));
    expect(container.querySelector('.session-console-rich--drawer-open')).not.toBeInTheDocument();
  });

  it('closes drawer when selecting a session', async () => {
    mockViewport(390);
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
    });
    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    });

    const { container } = render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-sidebar-toggle')).toBeInTheDocument();
    });

    // Open drawer
    fireEvent.click(screen.getByTestId('session-sidebar-toggle'));
    expect(container.querySelector('.session-console-rich--drawer-open')).toBeInTheDocument();

    // Select session
    fireEvent.click(screen.getByTestId('session-item-session-123'));

    // Drawer should close
    await waitFor(() => {
      expect(container.querySelector('.session-console-rich--drawer-open')).not.toBeInTheDocument();
    });
  });

  it('has accessible ARIA attributes on toggle button', async () => {
    mockViewport(390);
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-sidebar-toggle')).toBeInTheDocument();
    });

    const toggleButton = screen.getByTestId('session-sidebar-toggle');
    expect(toggleButton).toHaveAttribute('aria-controls', 'sessions-sidebar');
    expect(toggleButton).toHaveAttribute('aria-label', '打开会话列表');
    expect(toggleButton).toHaveAttribute('aria-expanded');
  });

  it('sidebar has data-testid attribute', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('sessions-sidebar')).toBeInTheDocument();
    });
  });

  it('renders loading state in sidebar on mobile', async () => {
    mockViewport(390);
    mockGetSessions.mockImplementation(() => new Promise(() => {})); // Never resolves

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByText('加载中...')).toBeInTheDocument();
    });
  });

  it('renders error state in sidebar on mobile', async () => {
    mockViewport(390);
    mockGetSessions.mockRejectedValue(new Error('Network error'));

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
