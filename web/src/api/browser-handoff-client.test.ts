import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getBrowserStatus,
  acquireTakeover,
  releaseTakeover,
  sendInput,
  subscribeToFrames,
} from './client'
import type {
  BrowserStatusResponse,
  BrowserTakeoverResponse,
  BrowserReleaseResponse,
  BrowserInputResponse,
  BrowserStreamEvent,
} from './types'

const API_BASE = '/api/v1'

function makeApiEnvelope<T>(data: T) {
  return { ok: true, data, requestId: 'req-1' }
}

function makeApiError(status: number, code: string, message: string) {
  return {
    ok: false,
    error: { code, message },
    requestId: 'req-1',
  }
}

describe('browser handoff client', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getBrowserStatus', () => {
    it('returns parsed status response', async () => {
      const status: BrowserStatusResponse = {
        sessionId: 'sess-1',
        state: 'agent_controlled',
        url: 'https://example.com',
        lastActivityAt: '2025-01-01T00:00:00Z',
        viewport: { width: 1280, height: 720 },
      }

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeApiEnvelope(status)),
      })

      const result = await getBrowserStatus('sess-1')

      expect(result).toEqual(status)
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_BASE}/sessions/sess-1/browser/status`,
        expect.objectContaining({ credentials: 'include' }),
      )
    })

    it('throws ApiClientError on 404', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve(makeApiError(404, 'NOT_FOUND', 'Session not found')),
      })

      await expect(getBrowserStatus('sess-1')).rejects.toThrow('Session not found')
    })

    it('throws ApiClientError on 403', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve(makeApiError(403, 'FORBIDDEN', 'Access denied')),
      })

      await expect(getBrowserStatus('sess-1')).rejects.toThrow('Access denied')
    })
  })

  describe('acquireTakeover', () => {
    it('returns takeover response with state', async () => {
      const takeover: BrowserTakeoverResponse = {
        sessionId: 'sess-1',
        state: 'user_controlled',
        previousState: 'agent_controlled',
      }

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeApiEnvelope(takeover)),
      })

      const result = await acquireTakeover('sess-1')

      expect(result).toEqual(takeover)
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_BASE}/sessions/sess-1/browser/takeover`,
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      )
    })

    it('throws ApiClientError on 409 conflict', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve(makeApiError(409, 'CONFLICT', 'Already controlled')),
      })

      await expect(acquireTakeover('sess-1')).rejects.toThrow('Already controlled')
    })
  })

  describe('releaseTakeover', () => {
    it('returns release response', async () => {
      const release: BrowserReleaseResponse = {
        sessionId: 'sess-1',
        state: 'agent_controlled',
        previousState: 'user_controlled',
      }

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeApiEnvelope(release)),
      })

      const result = await releaseTakeover('sess-1')

      expect(result).toEqual(release)
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_BASE}/sessions/sess-1/browser/release`,
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      )
    })
  })

  describe('sendInput', () => {
    it('sends correct payload', async () => {
      const inputResponse: BrowserInputResponse = { success: true }

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeApiEnvelope(inputResponse)),
      })

      const result = await sendInput('sess-1', {
        action: 'click',
        payload: { x: 0.5, y: 0.3, button: 'left', clickCount: 1 },
      })

      expect(result).toEqual(inputResponse)
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_BASE}/sessions/sess-1/browser/input`,
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'click',
            payload: { x: 0.5, y: 0.3, button: 'left', clickCount: 1 },
          }),
        }),
      )
    })

    it('throws ApiClientError on 403', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve(makeApiError(403, 'FORBIDDEN', 'Not your session')),
      })

      await expect(
        sendInput('sess-1', { action: 'click', payload: { x: 0, y: 0 } }),
      ).rejects.toThrow('Not your session')
    })
  })

  describe('subscribeToFrames', () => {
    let mockEventSource: {
      onmessage: ((event: { data: string }) => void) | null
      onerror: (() => void) | null
      close: ReturnType<typeof vi.fn>
    }

    beforeEach(() => {
      mockEventSource = {
        onmessage: null,
        onerror: null,
        close: vi.fn(),
      }

      vi.stubGlobal(
        'EventSource',
        vi.fn().mockImplementation(() => mockEventSource),
      )
    })

    it('invokes callback with parsed frame event', () => {
      const onEvent = vi.fn()
      const frameEvent: BrowserStreamEvent = {
        type: 'frame',
        data: 'base64data',
        timestamp: '2025-01-01T00:00:00Z',
        width: 1280,
        height: 720,
      }

      subscribeToFrames('sess-1', onEvent)

      expect(mockEventSource.onmessage).not.toBeNull()
      mockEventSource.onmessage!({ data: JSON.stringify(frameEvent) })

      expect(onEvent).toHaveBeenCalledWith(frameEvent)
    })

    it('invokes callback with parsed snapshot event', () => {
      const onEvent = vi.fn()
      const snapshotEvent: BrowserStreamEvent = {
        type: 'snapshot',
        state: 'agent_controlled',
        url: 'https://example.com',
        timestamp: '2025-01-01T00:00:00Z',
      }

      subscribeToFrames('sess-1', onEvent)

      mockEventSource.onmessage!({ data: JSON.stringify(snapshotEvent) })

      expect(onEvent).toHaveBeenCalledWith(snapshotEvent)
    })

    it('invokes onError on EventSource error', () => {
      const onEvent = vi.fn()
      const onError = vi.fn()

      subscribeToFrames('sess-1', onEvent, onError)

      expect(mockEventSource.onerror).not.toBeNull()
      mockEventSource.onerror!()

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Browser frame stream connection error' }),
      )
    })

    it('invokes onError on malformed JSON', () => {
      const onEvent = vi.fn()
      const onError = vi.fn()

      subscribeToFrames('sess-1', onEvent, onError)

      mockEventSource.onmessage!({ data: 'not json' })

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Failed to parse browser frame SSE event' }),
      )
      expect(onEvent).not.toHaveBeenCalled()
    })

    it('unsubscribe closes EventSource', () => {
      const onEvent = vi.fn()
      const unsubscribe = subscribeToFrames('sess-1', onEvent)

      unsubscribe()

      expect(mockEventSource.close).toHaveBeenCalled()
    })

    it('creates EventSource with correct URL and credentials', () => {
      const onEvent = vi.fn()
      subscribeToFrames('sess-1', onEvent)

      expect(EventSource).toHaveBeenCalledWith(
        `${API_BASE}/sessions/sess-1/browser/frame/stream`,
        { withCredentials: true },
      )
    })

    it('URL-encodes sessionId', () => {
      const onEvent = vi.fn()
      subscribeToFrames('sess/with/slashes', onEvent)

      expect(EventSource).toHaveBeenCalledWith(
        `${API_BASE}/sessions/sess%2Fwith%2Fslashes/browser/frame/stream`,
        { withCredentials: true },
      )
    })
  })
})
