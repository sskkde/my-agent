import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSSEStream } from './useSSEStream'
import type { ConsoleTimelineEvent, ProcessingStatusPayload, TokenStreamPayload } from '../../../api/types'

vi.mock('../../../api/client', () => ({
  subscribeSessionTimeline: vi.fn(),
}))

import * as api from '../../../api/client'

const mockSubscribeSessionTimeline = api.subscribeSessionTimeline as ReturnType<typeof vi.fn>

describe('useSSEStream', () => {
  let mountedRef: React.MutableRefObject<boolean>
  let selectedSessionIdRef: React.MutableRefObject<string | null>
  let onEvent: ReturnType<typeof vi.fn>
  let onToken: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mountedRef = { current: true }
    selectedSessionIdRef = { current: 'session-1' }
    onEvent = vi.fn()
    onToken = vi.fn()
    mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, _onError, _onStatus, _onToken, onOpen) => {
      onOpen?.()
      return () => {}
    })
  })

  function renderSSEHook() {
    return renderHook(() =>
      useSSEStream({ mountedRef, selectedSessionIdRef, onEvent, onToken }),
    )
  }

  it('starts with disconnected status', () => {
    const { result } = renderSSEHook()
    expect(result.current.streamStatus).toBe('disconnected')
    expect(result.current.processingStatus).toBeNull()
  })

  it('sets status to connecting immediately after connectSse, before onopen', () => {
    mockSubscribeSessionTimeline.mockReturnValue(() => {})

    const { result } = renderSSEHook()

    act(() => {
      result.current.connectSse('session-1')
    })

    expect(result.current.streamStatus).toBe('connecting')
    expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(1)
    expect(mockSubscribeSessionTimeline).toHaveBeenCalledWith(
      'session-1',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    )
  })

  it('sets status to connected only after EventSource onopen fires', () => {
    let onOpenCallback: (() => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, _onError, _onStatus, _onToken, onOpen) => {
      onOpenCallback = onOpen
      return () => {}
    })

    const { result } = renderSSEHook()

    act(() => {
      result.current.connectSse('session-1')
    })

    expect(result.current.streamStatus).toBe('connecting')

    act(() => {
      onOpenCallback?.()
    })

    expect(result.current.streamStatus).toBe('connected')
  })

  it('sets status to disconnected on error callback', () => {
    let errorCallback: ((error: Error) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, onError, _onStatus, _onToken, onOpen) => {
      errorCallback = onError
      onOpen?.()
      return () => {}
    })

    const { result } = renderSSEHook()

    act(() => {
      result.current.connectSse('session-1')
    })

    expect(result.current.streamStatus).toBe('connected')

    act(() => {
      errorCallback?.(new Error('SSE failed'))
    })

    expect(result.current.streamStatus).toBe('disconnected')
  })

  it('calls onEvent callback when timeline event arrives', () => {
    let eventCallback: ((event: ConsoleTimelineEvent) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sid, onEventCb, _onError, _onStatus, _onToken, onOpen) => {
      eventCallback = onEventCb
      onOpen?.()
      return () => {}
    })

    const { result } = renderSSEHook()

    act(() => {
      result.current.connectSse('session-1')
    })

    const event: ConsoleTimelineEvent = {
      eventId: 'evt-1',
      eventType: 'user_message',
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
      content: 'Hello',
    }

    act(() => {
      eventCallback?.(event)
    })

    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it('calls onToken callback when token arrives', () => {
    let tokenCallback: ((token: TokenStreamPayload) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, _onError, _onStatus, onTokenCb, onOpen) => {
      tokenCallback = onTokenCb
      onOpen?.()
      return () => {}
    })

    const { result } = renderSSEHook()

    act(() => {
      result.current.connectSse('session-1')
    })

    const token: TokenStreamPayload = {
      sessionId: 'session-1',
      attemptId: 'att-1',
      sequence: 1,
      delta: 'Hello',
      timestamp: new Date().toISOString(),
    }

    act(() => {
      tokenCallback?.(token)
    })

    expect(onToken).toHaveBeenCalledWith(token)
  })

  it('updates processingStatus when status callback fires', () => {
    let statusCallback: ((status: ProcessingStatusPayload) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, _onError, onStatusCb, _onToken, onOpen) => {
      statusCallback = onStatusCb
      onOpen?.()
      return () => {}
    })

    const { result } = renderSSEHook()

    act(() => {
      result.current.connectSse('session-1')
    })

    const status: ProcessingStatusPayload = {
      sessionId: 'session-1',
      attemptId: 'att-1',
      stage: 'model_call',
      stageLabel: 'Model calling',
      activeTools: [],
      timestamp: new Date().toISOString(),
    }

    act(() => {
      statusCallback?.(status)
    })

    expect(result.current.processingStatus).toEqual(status)
  })

  it('reconnects automatically after error with exponential backoff', async () => {
    let callCount = 0
    mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, onError, _onStatus, _onToken, onOpen) => {
      callCount++
      const currentCall = callCount
      if (currentCall === 1) {
        onOpen?.()
        setTimeout(() => {
          onError?.(new Error('disconnect'))
        }, 10)
      }
      return () => {}
    })

    const { result } = renderSSEHook()

    act(() => {
      result.current.connectSse('session-1')
    })

    expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(1)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    expect(result.current.streamStatus).toBe('disconnected')

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100))
    })

    expect(mockSubscribeSessionTimeline.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('handleRetryStream resets attempts and reconnects', () => {
    let errorCallback: ((error: Error) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, onError, _onStatus, _onToken, onOpen) => {
      errorCallback = onError
      onOpen?.()
      return () => {}
    })

    const { result } = renderSSEHook()

    act(() => {
      result.current.connectSse('session-1')
    })

    act(() => {
      errorCallback?.(new Error('disconnect'))
    })

    expect(result.current.streamStatus).toBe('disconnected')

    act(() => {
      result.current.handleRetryStream()
    })

    expect(result.current.streamStatus).toBe('connected')
    expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(2)
  })

  it('disconnectSse cleans up subscription', () => {
    const unsubscribe = vi.fn()
    mockSubscribeSessionTimeline.mockReturnValue(unsubscribe)

    const { result } = renderSSEHook()

    act(() => {
      result.current.connectSse('session-1')
    })

    act(() => {
      result.current.disconnectSse()
    })

    expect(unsubscribe).toHaveBeenCalled()
  })

  it('ignores events when component is unmounted', () => {
    let eventCallback: ((event: ConsoleTimelineEvent) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sid, onEventCb, _onError, _onStatus, _onToken, onOpen) => {
      eventCallback = onEventCb
      onOpen?.()
      return () => {}
    })

    const { result } = renderSSEHook()

    act(() => {
      result.current.connectSse('session-1')
    })

    mountedRef.current = false

    act(() => {
      eventCallback?.({
        eventId: 'evt-1',
        eventType: 'user_message',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
      })
    })

    expect(onEvent).not.toHaveBeenCalled()
  })

  it('ignores events for a different session', () => {
    let eventCallback: ((event: ConsoleTimelineEvent) => void) | null = null
    mockSubscribeSessionTimeline.mockImplementation((_sid, onEventCb, _onError, _onStatus, _onToken, onOpen) => {
      eventCallback = onEventCb
      onOpen?.()
      return () => {}
    })

    const { result } = renderSSEHook()

    act(() => {
      result.current.connectSse('session-1')
    })

    selectedSessionIdRef.current = 'session-2'

    act(() => {
      eventCallback?.({
        eventId: 'evt-1',
        eventType: 'user_message',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
      })
    })

    expect(onEvent).not.toHaveBeenCalled()
  })

  it('resetStreamStatus sets status to disconnected', () => {
    const { result } = renderSSEHook()

    act(() => {
      result.current.connectSse('session-1')
    })

    expect(result.current.streamStatus).toBe('connected')

    act(() => {
      result.current.resetStreamStatus()
    })

    expect(result.current.streamStatus).toBe('disconnected')
  })

  describe('SSE Degradation Behavior', () => {
    it('shows disconnected status without crashing when SSE fails', () => {
      let errorCallback: ((error: Error) => void) | null = null
      mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, onError, _onStatus, _onToken, onOpen) => {
        errorCallback = onError
        onOpen?.()
        return () => {}
      })

      const { result } = renderSSEHook()

      act(() => {
        result.current.connectSse('session-1')
      })

      expect(result.current.streamStatus).toBe('connected')

      act(() => {
        errorCallback?.(new Error('Connection lost'))
      })

      expect(result.current.streamStatus).toBe('disconnected')
      expect(result.current.processingStatus).toBeNull()
    })

    it('existing events remain visible after SSE disconnect', () => {
      let eventCallback: ((event: ConsoleTimelineEvent) => void) | null = null
      let errorCallback: ((error: Error) => void) | null = null

      mockSubscribeSessionTimeline.mockImplementation((_sid, onEventCb, onErrorCb, _onStatus, _onToken, onOpen) => {
        eventCallback = onEventCb
        errorCallback = onErrorCb
        onOpen
        return () => {}
      })

      const { result } = renderSSEHook()

      act(() => {
        result.current.connectSse('session-1')
      })

      const event1: ConsoleTimelineEvent = {
        eventId: 'evt-1',
        eventType: 'user_message',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        content: 'First message',
      }

      act(() => {
        eventCallback?.(event1)
      })

      expect(onEvent).toHaveBeenCalledWith(event1)

      act(() => {
        errorCallback?.(new Error('SSE disconnected'))
      })

      expect(result.current.streamStatus).toBe('disconnected')
      expect(onEvent).toHaveBeenCalledTimes(1)
    })

    it('reconnect behavior matches baseline with exponential backoff', async () => {
      vi.useFakeTimers()

      const reconnectDelays: number[] = []
      let callCount = 0

      mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, onError, _onStatus, _onToken, onOpen) => {
        callCount++
        const currentCall = callCount

        if (currentCall <= 3) {
          onOpen?.()
          setTimeout(() => {
            onError?.(new Error('disconnect'))
          }, 10)
        }

        return () => {}
      })

      const { result } = renderSSEHook()

      act(() => {
        result.current.connectSse('session-1')
      })

      expect(result.current.streamStatus).toBe('connected')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(result.current.streamStatus).toBe('disconnected')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      expect(mockSubscribeSessionTimeline.mock.calls.length).toBeGreaterThanOrEqual(2)

      vi.useRealTimers()
    })

    it('manual retry resets reconnect attempts and reconnects immediately', () => {
      let errorCallback: ((error: Error) => void) | null = null
      mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, onError, _onStatus, _onToken, onOpen) => {
        errorCallback = onError
        onOpen?.()
        return () => {}
      })

      const { result } = renderSSEHook()

      act(() => {
        result.current.connectSse('session-1')
      })

      act(() => {
        errorCallback?.(new Error('disconnect'))
      })

      expect(result.current.streamStatus).toBe('disconnected')

      act(() => {
        result.current.handleRetryStream()
      })

      expect(result.current.streamStatus).toBe('connected')
      expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(2)
    })

    it('stops reconnecting after 5 failed attempts', async () => {
      vi.useFakeTimers()

      let callCount = 0
      mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, onError, _onStatus, _onToken, onOpen) => {
        callCount++
        onOpen?.()
        setTimeout(() => {
          onError?.(new Error('disconnect'))
        }, 10)
        return () => {}
      })

      const { result } = renderSSEHook()

      act(() => {
        result.current.connectSse('session-1')
      })

      for (let i = 0; i < 10; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10000)
        })
      }

      expect(mockSubscribeSessionTimeline.mock.calls.length).toBeLessThanOrEqual(6)

      vi.useRealTimers()
    })

    it('graceful disconnect clears subscription without error', () => {
      const unsubscribe = vi.fn()
      mockSubscribeSessionTimeline.mockReturnValue(unsubscribe)

      const { result } = renderSSEHook()

      act(() => {
        result.current.connectSse('session-1')
      })

      expect(result.current.streamStatus).toBe('connecting')

      act(() => {
        result.current.disconnectSse()
      })

      expect(unsubscribe).toHaveBeenCalled()
      expect(result.current.streamStatus).toBe('connecting')
    })

    it('processing status persists during temporary disconnect', () => {
      let statusCallback: ((status: ProcessingStatusPayload) => void) | null = null
      let errorCallback: ((error: Error) => void) | null = null

      mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, onErrorCb, onStatusCb, _onToken, onOpen) => {
        errorCallback = onErrorCb
        statusCallback = onStatusCb
        onOpen?.()
        return () => {}
      })

      const { result } = renderSSEHook()

      act(() => {
        result.current.connectSse('session-1')
      })

      const status: ProcessingStatusPayload = {
        sessionId: 'session-1',
        attemptId: 'att-1',
        stage: 'model_call',
        stageLabel: 'Model calling',
        activeTools: [],
        timestamp: new Date().toISOString(),
      }

      act(() => {
        statusCallback?.(status)
      })

      expect(result.current.processingStatus).toEqual(status)

      act(() => {
        errorCallback?.(new Error('temporary disconnect'))
      })

      expect(result.current.streamStatus).toBe('disconnected')
      expect(result.current.processingStatus).toEqual(status)
    })
  })

  describe('Reconnect Timer Cleanup', () => {
    it('clears pending reconnect timer on unmount', async () => {
      vi.useFakeTimers()

      let errorCallback: ((error: Error) => void) | null = null
      mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, onError, _onStatus, _onToken, onOpen) => {
        errorCallback = onError
        onOpen?.()
        return () => {}
      })

      const { result, unmount } = renderSSEHook()

      act(() => {
        result.current.connectSse('session-1')
      })

      act(() => {
        errorCallback?.(new Error('disconnect'))
      })

      expect(result.current.streamStatus).toBe('disconnected')

      unmount()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(mockSubscribeSessionTimeline.mock.calls.length).toBe(1)

      vi.useRealTimers()
    })

    it('clears pending reconnect timer when session changes', async () => {
      vi.useFakeTimers()

      let errorCallback: ((error: Error) => void) | null = null
      mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, onError, _onStatus, _onToken, onOpen) => {
        errorCallback = onError
        onOpen?.()
        return () => {}
      })

      const { result } = renderSSEHook()

      act(() => {
        result.current.connectSse('session-1')
      })

      act(() => {
        errorCallback?.(new Error('disconnect'))
      })

      expect(result.current.streamStatus).toBe('disconnected')

      selectedSessionIdRef.current = 'session-2'

      act(() => {
        result.current.connectSse('session-2')
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(mockSubscribeSessionTimeline).toHaveBeenCalledWith('session-2', expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function))

      vi.useRealTimers()
    })

    it('clears reconnect timeout when manually retrying', async () => {
      vi.useFakeTimers()

      let errorCallback: ((error: Error) => void) | null = null
      mockSubscribeSessionTimeline.mockImplementation((_sid, _onEvent, onError, _onStatus, _onToken, onOpen) => {
        errorCallback = onError
        onOpen?.()
        return () => {}
      })

      const { result } = renderSSEHook()

      act(() => {
        result.current.connectSse('session-1')
      })

      act(() => {
        errorCallback?.(new Error('disconnect'))
      })

      expect(result.current.streamStatus).toBe('disconnected')

      act(() => {
        result.current.handleRetryStream()
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(mockSubscribeSessionTimeline).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })
  })
})
