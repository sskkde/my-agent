import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SessionConsoleTab from './SessionConsoleTab';
import { mockViewport, resetMatchMedia } from '../../test/setup';

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
