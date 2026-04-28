import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SessionConsoleTab from './SessionConsoleTab';

vi.mock('../../api/client', () => ({
  createSession: vi.fn(),
  getTranscripts: vi.fn(),
  sendMessage: vi.fn(),
}));

import * as api from '../../api/client';

const mockCreateSession = api.createSession as ReturnType<typeof vi.fn>;
const mockGetTranscripts = api.getTranscripts as ReturnType<typeof vi.fn>;
const mockSendMessage = api.sendMessage as ReturnType<typeof vi.fn>;

describe('SessionConsoleTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates session on first render', async () => {
    mockCreateSession.mockResolvedValue({
      session: {
        sessionId: 'session-123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    });
    mockGetTranscripts.mockResolvedValue({ transcripts: [], total: 0 });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });
  });

  it('shows empty state when no transcripts', async () => {
    mockCreateSession.mockResolvedValue({
      session: { sessionId: 'session-123', userId: 'user-1', messageCount: 0, lastActivityAt: '', activePlannerRunIds: [], activeBackgroundRunIds: [] },
    });
    mockGetTranscripts.mockResolvedValue({ transcripts: [], total: 0 });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-empty-state')).toBeInTheDocument();
    });
  });

  it('allows typing and sending nonblank message', async () => {
    mockCreateSession.mockResolvedValue({
      session: { sessionId: 'session-123', userId: 'user-1', messageCount: 0, lastActivityAt: '', activePlannerRunIds: [], activeBackgroundRunIds: [] },
    });
    mockGetTranscripts
      .mockResolvedValueOnce({ transcripts: [], total: 0 })
      .mockResolvedValueOnce({
        transcripts: [{
          turnId: 'turn-1',
          sessionId: 'session-123',
          userId: 'user-1',
          input: { userMessageSummary: 'Hello' },
          output: { visibleMessages: [] },
          visibility: 'public',
          createdAt: new Date().toISOString(),
        }],
        total: 1,
      });
    mockSendMessage.mockResolvedValue({ accepted: true, turnId: 'turn-1' });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.queryByTestId('session-empty-state')).not.toBeInTheDocument();
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
    mockCreateSession.mockResolvedValue({
      session: { sessionId: 'session-123', userId: 'user-1', messageCount: 0, lastActivityAt: '', activePlannerRunIds: [], activeBackgroundRunIds: [] },
    });
    mockGetTranscripts.mockResolvedValue({ transcripts: [], total: 0 });

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.getByTestId('session-empty-state')).toBeInTheDocument();
    });

    const input = screen.getByTestId('session-message-input');
    const sendButton = screen.getByTestId('session-send-button');

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(sendButton);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('displays API error and preserves draft', async () => {
    mockCreateSession.mockResolvedValue({
      session: { sessionId: 'session-123', userId: 'user-1', messageCount: 0, lastActivityAt: '', activePlannerRunIds: [], activeBackgroundRunIds: [] },
    });
    mockGetTranscripts.mockResolvedValue({ transcripts: [], total: 0 });
    mockSendMessage.mockRejectedValue(new Error('API Error'));

    render(<SessionConsoleTab />);

    await waitFor(() => {
      expect(screen.queryByTestId('session-empty-state')).not.toBeInTheDocument();
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