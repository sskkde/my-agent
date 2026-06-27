/**
 * Tests for SessionMapPage — standalone authenticated route /map/:sessionId.
 *
 * TDD RED phase: the component does not exist yet. All tests should fail
 * on import resolution or render until SessionMapPage is implemented.
 *
 * Mocks:
 *   - ../../api/client (getSessionTimeline, subscribeSessionTimeline, sendMessage)
 *   - ./components/SessionMapPanel (renders props + onMapClick test button)
 */

import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../api/client', () => ({
  getSessionTimeline: vi.fn(),
  subscribeSessionTimeline: vi.fn(),
  sendMessage: vi.fn(),
}))

vi.mock('./components/SessionMapPanel', () => ({
  default: vi.fn((props: Record<string, unknown>) => (
    <div data-testid="mock-session-map-panel">
      <span data-testid="panel-session-id">{String(props.sessionId)}</span>
      <span data-testid="panel-events-count">
        {Array.isArray(props.events) ? props.events.length : 0}
      </span>
      <span data-testid="panel-has-onclick">
        {String(typeof props.onMapClick === 'function')}
      </span>
      {typeof props.onMapClick === 'function' && (
        <button
          data-testid="trigger-onmapclick"
          onClick={() =>
            (props.onMapClick as (s: unknown) => void)({
              center: [116.39, 39.9],
              zoom: 12,
              selectedPoint: { position: [116.39, 39.9], name: 'Beijing' },
            })
          }
        >
          Trigger Map Click
        </button>
      )}
    </div>
  )),
}))

import SessionMapPage from './SessionMapPage'
import * as api from '../../api/client'
import type { ConsoleTimelineEvent } from '../../api/types'
import type { MapContextSnapshot } from './types'

const mockGetSessionTimeline = vi.mocked(api.getSessionTimeline)
const mockSubscribeSessionTimeline = vi.mocked(api.subscribeSessionTimeline)
const mockSendMessage = vi.mocked(api.sendMessage)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_SESSION_ID = 'ses-map-001'

function makeEvent(overrides: Partial<ConsoleTimelineEvent> = {}): ConsoleTimelineEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    eventType: 'tool_call',
    sessionId: SAMPLE_SESSION_ID,
    timestamp: new Date().toISOString(),
    content: 'map_add_marker',
    ...overrides,
  }
}

const SAMPLE_SNAPSHOT: MapContextSnapshot = {
  center: [116.39, 39.9],
  zoom: 12,
  selectedPoint: { position: [116.39, 39.9], name: 'Beijing' },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage(sessionId = SAMPLE_SESSION_ID) {
  return render(
    <MemoryRouter initialEntries={[`/map/${sessionId}`]}>
      <Routes>
        <Route path="/map/:sessionId" element={<SessionMapPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SessionMapPage', () => {
  const originalError = console.error

  beforeEach(() => {
    vi.clearAllMocks()

    // Default: timeline resolves with empty events
    mockGetSessionTimeline.mockResolvedValue({ events: [], total: 0 })

    // Default: SSE subscription returns an unsubscribe function
    mockSubscribeSessionTimeline.mockReturnValue(vi.fn())

    // Suppress React act() warnings from async state updates in tests
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return
      originalError(...args)
    }
  })

  afterEach(() => {
    console.error = originalError
  })

  // =========================================================================
  // Timeline fetch
  // =========================================================================

  describe('timeline fetch', () => {
    it('fetches session timeline on mount', async () => {
      renderPage()

      await waitFor(() => {
        expect(mockGetSessionTimeline).toHaveBeenCalledTimes(1)
      })
      expect(mockGetSessionTimeline).toHaveBeenCalledWith(SAMPLE_SESSION_ID)
    })

    it('passes fetched events to SessionMapPanel', async () => {
      const events = [makeEvent(), makeEvent()]
      mockGetSessionTimeline.mockResolvedValue({ events, total: events.length })

      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('panel-events-count')).toHaveTextContent('2')
      })
    })

    it('passes sessionId to SessionMapPanel', async () => {
      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('panel-session-id')).toHaveTextContent(SAMPLE_SESSION_ID)
      })
    })

    it('passes empty events array before fetch resolves', () => {
      mockGetSessionTimeline.mockImplementation(() => new Promise(() => {}))

      renderPage()

      expect(screen.getByTestId('panel-events-count')).toHaveTextContent('0')
    })
  })

  // =========================================================================
  // SSE subscription / unsubscription
  // =========================================================================

  describe('SSE subscription', () => {
    it('subscribes to session timeline on mount', async () => {
      renderPage()

      await waitFor(() => {
        expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(1)
      })
      expect(mockSubscribeSessionTimeline).toHaveBeenCalledWith(
        SAMPLE_SESSION_ID,
        expect.any(Function), // onEvent
        expect.any(Function), // onError
      )
    })

    it('unsubscribes on unmount', async () => {
      const unsubscribe = vi.fn()
      mockSubscribeSessionTimeline.mockReturnValue(unsubscribe)

      const { unmount } = renderPage()

      await waitFor(() => {
        expect(mockSubscribeSessionTimeline).toHaveBeenCalled()
      })

      unmount()

      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('appends SSE events to the events list', async () => {
      let sseCallback: ((event: ConsoleTimelineEvent) => void) | undefined

      mockSubscribeSessionTimeline.mockImplementation(
        (_sessionId: string, onEvent: (event: ConsoleTimelineEvent) => void) => {
          sseCallback = onEvent
          return vi.fn()
        },
      )

      renderPage()

      await waitFor(() => {
        expect(mockSubscribeSessionTimeline).toHaveBeenCalled()
      })

      // Initially empty
      expect(screen.getByTestId('panel-events-count')).toHaveTextContent('0')

      // Simulate incoming SSE event
      const sseEvent = makeEvent({ eventId: 'sse-1', content: 'live marker' })
      act(() => {
        sseCallback?.(sseEvent)
      })

      expect(screen.getByTestId('panel-events-count')).toHaveTextContent('1')
    })

    it('does not subscribe when sessionId is missing', () => {
      render(
        <MemoryRouter initialEntries={['/map/']}>
          <Routes>
            <Route path="/map/:sessionId?" element={<SessionMapPage />} />
          </Routes>
        </MemoryRouter>,
      )

      expect(mockSubscribeSessionTimeline).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // SessionMapPanel props
  // =========================================================================

  describe('SessionMapPanel props', () => {
    it('renders SessionMapPanel', async () => {
      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('mock-session-map-panel')).toBeInTheDocument()
      })
    })

    it('passes onMapClick callback to SessionMapPanel', async () => {
      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('panel-has-onclick')).toHaveTextContent('true')
      })
    })
  })

  // =========================================================================
  // Snapshot capture
  // =========================================================================

  describe('snapshot capture', () => {
    it('captures snapshot when onMapClick fires', async () => {
      const user = userEvent.setup()
      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('mock-session-map-panel')).toBeInTheDocument()
      })

      // Trigger the onMapClick callback via the mock panel's button
      await user.click(screen.getByTestId('trigger-onmapclick'))

      // The page should have captured the snapshot — verify via any
      // observable side effect. The captured snapshot is used for sending.
      // We verify this through the send behavior test below.
    })
  })

  // =========================================================================
  // Send button gating — disabled before snapshot capture
  // =========================================================================

  describe('send button disabled before snapshot capture', () => {
    it('disables Send button on initial render (no snapshot)', async () => {
      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('mock-session-map-panel')).toBeInTheDocument()
      })

      const sendButton = screen.getByRole('button', { name: /send/i })
      expect(sendButton).toBeDisabled()
    })

    it('does not call sendMessage when Send is clicked before snapshot capture', async () => {
      const user = userEvent.setup()
      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('mock-session-map-panel')).toBeInTheDocument()
      })

      const sendButton = screen.getByRole('button', { name: /send/i })
      await user.click(sendButton)

      // sendMessage should NOT have been called — button is disabled
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('enables Send button after onMapClick captures a snapshot', async () => {
      const user = userEvent.setup()
      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('mock-session-map-panel')).toBeInTheDocument()
      })

      const sendButton = screen.getByRole('button', { name: /send/i })
      expect(sendButton).toBeDisabled()

      // Trigger onMapClick to capture a snapshot
      await user.click(screen.getByTestId('trigger-onmapclick'))

      expect(sendButton).toBeEnabled()
    })
  })

  // =========================================================================
  // Explicit send via sendMessage (requires snapshot capture first)
  // =========================================================================

  describe('explicit send', () => {
    it('calls sendMessage with sessionId and formatted snapshot after map click', async () => {
      mockSendMessage.mockResolvedValue({
        accepted: true,
        status: 'accepted',
        correlationId: 'corr-1',
        envelopeId: 'env-1',
      })

      const user = userEvent.setup()
      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('mock-session-map-panel')).toBeInTheDocument()
      })

      // Capture snapshot first
      await user.click(screen.getByTestId('trigger-onmapclick'))

      // Now Send is enabled — click it
      const sendButton = screen.getByRole('button', { name: /send/i })
      expect(sendButton).toBeEnabled()
      await user.click(sendButton)

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          SAMPLE_SESSION_ID,
          expect.stringContaining('116.39'),
        )
      })
    })

    it('shows send error state when sendMessage rejects after snapshot capture', async () => {
      mockSendMessage.mockRejectedValue(new Error('Network failure'))

      const user = userEvent.setup()
      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('mock-session-map-panel')).toBeInTheDocument()
      })

      // Capture snapshot first
      await user.click(screen.getByTestId('trigger-onmapclick'))

      const sendButton = screen.getByRole('button', { name: /send/i })
      await user.click(sendButton)

      await waitFor(() => {
        expect(screen.getByTestId('send-error')).toBeInTheDocument()
      })
    })

    it('clears send error on next successful send', async () => {
      mockSendMessage
        .mockRejectedValueOnce(new Error('Network failure'))
        .mockResolvedValueOnce({
          accepted: true,
          status: 'accepted',
          correlationId: 'corr-2',
          envelopeId: 'env-2',
        })

      const user = userEvent.setup()
      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('mock-session-map-panel')).toBeInTheDocument()
      })

      // Capture snapshot first
      await user.click(screen.getByTestId('trigger-onmapclick'))

      const sendButton = screen.getByRole('button', { name: /send/i })

      // First send fails
      await user.click(sendButton)
      await waitFor(() => {
        expect(screen.getByTestId('send-error')).toBeInTheDocument()
      })

      // Second send succeeds — error clears
      await user.click(sendButton)
      await waitFor(() => {
        expect(screen.queryByTestId('send-error')).not.toBeInTheDocument()
      })
    })
  })

  // =========================================================================
  // Missing session id state
  // =========================================================================

  describe('missing session id', () => {
    it('shows missing-session state when sessionId is absent from URL', () => {
      render(
        <MemoryRouter initialEntries={['/map/']}>
          <Routes>
            <Route path="/map/:sessionId?" element={<SessionMapPage />} />
          </Routes>
        </MemoryRouter>,
      )

      expect(screen.getByTestId('missing-session-id')).toBeInTheDocument()
    })

    it('does not fetch timeline when sessionId is missing', () => {
      render(
        <MemoryRouter initialEntries={['/map/']}>
          <Routes>
            <Route path="/map/:sessionId?" element={<SessionMapPage />} />
          </Routes>
        </MemoryRouter>,
      )

      expect(mockGetSessionTimeline).not.toHaveBeenCalled()
    })

    it('does not render SessionMapPanel when sessionId is missing', () => {
      render(
        <MemoryRouter initialEntries={['/map/']}>
          <Routes>
            <Route path="/map/:sessionId?" element={<SessionMapPage />} />
          </Routes>
        </MemoryRouter>,
      )

      expect(screen.queryByTestId('mock-session-map-panel')).not.toBeInTheDocument()
    })
  })

  // =========================================================================
  // Fetch error state
  // =========================================================================

  describe('fetch error state', () => {
    it('shows error state when getSessionTimeline rejects', async () => {
      mockGetSessionTimeline.mockRejectedValue(new Error('Timeline fetch failed'))

      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('fetch-error')).toBeInTheDocument()
      })
    })

    it('does not render SessionMapPanel when fetch fails', async () => {
      mockGetSessionTimeline.mockRejectedValue(new Error('Timeline fetch failed'))

      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('fetch-error')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('mock-session-map-panel')).not.toBeInTheDocument()
    })

    it('displays error message from fetch failure', async () => {
      mockGetSessionTimeline.mockRejectedValue(new Error('Timeline fetch failed'))

      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('fetch-error')).toHaveTextContent(/Timeline fetch failed/i)
      })
    })
  })

  // =========================================================================
  // Send error state
  // =========================================================================

  describe('send error state', () => {
    it('shows send error when sendMessage rejects after snapshot capture', async () => {
      mockSendMessage.mockRejectedValue(new Error('Send failed'))

      const user = userEvent.setup()
      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('mock-session-map-panel')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('trigger-onmapclick'))
      await user.click(screen.getByRole('button', { name: /send/i }))

      await waitFor(() => {
        expect(screen.getByTestId('send-error')).toBeInTheDocument()
      })
    })

    it('does not show send error initially', async () => {
      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('mock-session-map-panel')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('send-error')).not.toBeInTheDocument()
    })
  })
})
