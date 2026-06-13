import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import SessionConsoleTab from './SessionConsoleTab'
import * as api from '../../api/client'
import type { ConsoleTimelineEvent, TokenStreamPayload, ProcessingStatusPayload } from '../../api/types'

vi.mock('../../api/client', () => ({
  getSession: vi.fn(),
  getSessionTimeline: vi.fn(),
  sendMessage: vi.fn(),
  getProviders: vi.fn(),
  createSession: vi.fn(),
  getSessions: vi.fn(),
  subscribeSessionTimeline: vi.fn(),
  respondApproval: vi.fn(),
  ApiClientError: class ApiClientError extends Error {
    code: string
    constructor(error: { code: string; message: string }) {
      super(error.message)
      this.code = error.code
    }
  },
}))

const renderWithRouter = (ui: React.ReactElement, initialEntries: string[] = ['/']) => {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>)
}

describe('Streaming Draft UX', () => {
  let unsubscribe: ReturnType<typeof api.subscribeSessionTimeline>
  let onEventCallback: (event: ConsoleTimelineEvent) => void
  let onTokenCallback: (token: TokenStreamPayload) => void
  let onStatusCallback: (status: ProcessingStatusPayload) => void
  let onErrorCallback: (error: Error) => void

  beforeEach(() => {
    vi.clearAllMocks()
    unsubscribe = vi.fn()
    
    // Capture SSE callbacks
    vi.mocked(api.subscribeSessionTimeline).mockImplementation((sessionId, onEvent, onError, onStatus, onToken) => {
      onEventCallback = onEvent
      onTokenCallback = onToken!
      onStatusCallback = onStatus!
      onErrorCallback = onError!
      return unsubscribe
    })

    vi.mocked(api.getSession).mockResolvedValue({
      session: {
        sessionId: 'test-session',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    vi.mocked(api.getSessionTimeline).mockResolvedValue({
      events: [],
      total: 0,
    })

    vi.mocked(api.getSessions).mockResolvedValue({
      sessions: [],
      total: 0,
    })

    vi.mocked(api.createSession).mockResolvedValue({
      session: {
        sessionId: 'new-session',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    vi.mocked(api.getProviders).mockResolvedValue([])

    vi.mocked(api.sendMessage).mockResolvedValue({
      accepted: true,
      turnId: 'turn-1',
      status: 'processing',
      correlationId: 'corr-1',
      envelopeId: 'env-1',
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('accumulates token deltas into streaming draft', async () => {
    renderWithRouter(<SessionConsoleTab initialSessionId="test-session" />)

    // Wait for session to load
    await waitFor(() => {
      expect(api.getSession).toHaveBeenCalledWith('test-session')
    })

    // Simulate token stream
    await act(async () => {
      onTokenCallback({
        sessionId: 'test-session',
        attemptId: 'attempt-1',
        sequence: 1,
        delta: 'Hello',
        timestamp: new Date().toISOString(),
      })
    })

    await act(async () => {
      onTokenCallback({
        sessionId: 'test-session',
        attemptId: 'attempt-1',
        sequence: 2,
        delta: ' world',
        timestamp: new Date().toISOString(),
      })
    })

    // Verify streaming draft appears
    await waitFor(() => {
      const draftCard = screen.queryByText(/Hello world/)
      expect(draftCard).toBeTruthy()
    })

    // Verify it has streaming draft styling
    const draftElement = screen.getByText(/Hello world/).closest('.timeline-event-card')
    expect(draftElement?.classList.contains('timeline-event-card--streaming-draft')).toBe(true)
  })

  it('final assistant_message event replaces streaming draft without duplication', async () => {
    renderWithRouter(<SessionConsoleTab initialSessionId="test-session" />)

    await waitFor(() => {
      expect(api.getSession).toHaveBeenCalledWith('test-session')
    })

    // Stream tokens
    await act(async () => {
      onTokenCallback({
        sessionId: 'test-session',
        attemptId: 'attempt-1',
        sequence: 1,
        delta: 'Hello',
        timestamp: new Date().toISOString(),
      })
    })

    await act(async () => {
      onTokenCallback({
        sessionId: 'test-session',
        attemptId: 'attempt-1',
        sequence: 2,
        delta: ' world',
        timestamp: new Date().toISOString(),
      })
    })

    // Verify draft appears
    await waitFor(() => {
      expect(screen.queryByText(/Hello world/)).toBeTruthy()
    })

    // Send final assistant_message event
    await act(async () => {
      onEventCallback({
        eventId: 'event-1',
        eventType: 'assistant_message',
        sessionId: 'test-session',
        timestamp: new Date().toISOString(),
        content: 'Hello world!',
        metadata: {
          attemptId: 'attempt-1',
        },
        actor: 'assistant',
      })
    })

    // Verify only one message appears (no duplication)
    await waitFor(() => {
      const messages = screen.getAllByText(/Hello world/)
      expect(messages).toHaveLength(1)
    })

    // Verify it has final assistant styling (not streaming draft)
    const finalMessage = screen.getByText(/Hello world!/).closest('.timeline-event-card')
    expect(finalMessage?.classList.contains('timeline-event-card--assistant_message')).toBe(true)
    expect(finalMessage?.classList.contains('timeline-event-card--streaming-draft')).toBe(false)
  })

  it('handles isFinal flag in token stream', async () => {
    renderWithRouter(<SessionConsoleTab initialSessionId="test-session" />)

    await waitFor(() => {
      expect(api.getSession).toHaveBeenCalledWith('test-session')
    })

    // Stream tokens with isFinal on last one
    await act(async () => {
      onTokenCallback({
        sessionId: 'test-session',
        attemptId: 'attempt-1',
        sequence: 1,
        delta: 'Hello',
        timestamp: new Date().toISOString(),
      })
    })

    await act(async () => {
      onTokenCallback({
        sessionId: 'test-session',
        attemptId: 'attempt-1',
        sequence: 2,
        delta: ' world',
        isFinal: true,
        timestamp: new Date().toISOString(),
      })
    })

    // Draft should remain until final event arrives
    await waitFor(() => {
      expect(screen.queryByText(/Hello world/)).toBeTruthy()
    })

    // Then send final event
    await act(async () => {
      onEventCallback({
        eventId: 'event-1',
        eventType: 'assistant_message',
        sessionId: 'test-session',
        timestamp: new Date().toISOString(),
        content: 'Hello world',
        metadata: {
          attemptId: 'attempt-1',
        },
        actor: 'assistant',
      })
    })

    // Verify single final message
    await waitFor(() => {
      const messages = screen.getAllByText(/Hello world/)
      expect(messages).toHaveLength(1)
    })
  })

  it('cleans up orphaned streaming draft on error event', async () => {
    renderWithRouter(<SessionConsoleTab initialSessionId="test-session" />)

    await waitFor(() => {
      expect(api.getSession).toHaveBeenCalledWith('test-session')
    })

    // Stream some tokens
    await act(async () => {
      onTokenCallback({
        sessionId: 'test-session',
        attemptId: 'attempt-1',
        sequence: 1,
        delta: 'Partial response',
        timestamp: new Date().toISOString(),
      })
    })

    // Verify draft appears
    await waitFor(() => {
      expect(screen.queryByText(/Partial response/)).toBeTruthy()
    })

    // Simulate error event
    await act(async () => {
      onEventCallback({
        eventId: 'event-error',
        eventType: 'error',
        sessionId: 'test-session',
        timestamp: new Date().toISOString(),
        content: 'Stream failed',
        metadata: {
          attemptId: 'attempt-1',
        },
        actor: 'system',
      })
    })

    // Verify draft is cleared
    await waitFor(() => {
      expect(screen.queryByText(/Partial response/)).toBeFalsy()
    })

    // Verify error message appears instead
    await waitFor(() => {
      expect(screen.queryByText(/Stream failed/)).toBeTruthy()
    })
  })

  it('handles SSE reconnect during active streaming', async () => {
    renderWithRouter(<SessionConsoleTab initialSessionId="test-session" />)

    await waitFor(() => {
      expect(api.getSession).toHaveBeenCalledWith('test-session')
    })

    // Start streaming
    await act(async () => {
      onTokenCallback({
        sessionId: 'test-session',
        attemptId: 'attempt-1',
        sequence: 1,
        delta: 'Before reconnect',
        timestamp: new Date().toISOString(),
      })
    })

    // Verify draft
    await waitFor(() => {
      expect(screen.queryByText(/Before reconnect/)).toBeTruthy()
    })

    // Simulate SSE disconnect
    await act(async () => {
      onErrorCallback(new Error('SSE connection lost'))
    })

    // Draft should remain visible
    await waitFor(() => {
      expect(screen.queryByText(/Before reconnect/)).toBeTruthy()
    })

    // Simulate reconnect and new stream
    await act(async () => {
      onTokenCallback({
        sessionId: 'test-session',
        attemptId: 'attempt-2', // New attempt
        sequence: 1,
        delta: 'After reconnect',
        timestamp: new Date().toISOString(),
      })
    })

    // New draft should appear
    await waitFor(() => {
      expect(screen.queryByText(/After reconnect/)).toBeTruthy()
    })
  })

  it('shows streaming draft with cursor indicator', async () => {
    renderWithRouter(<SessionConsoleTab initialSessionId="test-session" />)

    await waitFor(() => {
      expect(api.getSession).toHaveBeenCalledWith('test-session')
    })

    // Stream a token
    await act(async () => {
      onTokenCallback({
        sessionId: 'test-session',
        attemptId: 'attempt-1',
        sequence: 1,
        delta: 'Typing',
        timestamp: new Date().toISOString(),
      })
    })

    // Verify streaming draft content
    await waitFor(() => {
      const draftContent = screen.queryByText(/Typing/)
      expect(draftContent).toBeTruthy()
    })

    // Verify cursor element exists
    const draftCard = screen.getByText(/Typing/).closest('.timeline-event-card--streaming-draft')
    expect(draftCard).toBeTruthy()
    
    // Check for cursor class
    const cursorElement = draftCard?.querySelector('.streaming-cursor')
    expect(cursorElement).toBeTruthy()
  })
})
