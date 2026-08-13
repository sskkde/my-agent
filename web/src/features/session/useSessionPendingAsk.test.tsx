import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionPendingAsk } from './useSessionPendingAsk'
import * as client from '../../api/client'
import type { AskInfo } from '../../api/types'

vi.mock('../../api/client', () => ({
  getAsks: vi.fn(),
}))

const createAsk = (overrides: Partial<AskInfo> = {}): AskInfo => ({
  id: 'ask-1',
  sessionId: 'session-1',
  status: 'pending',
  question: 'Which environment should I use?',
  context: null,
  options: null,
  multiSelect: false,
  requestedAt: '2024-01-01T10:00:00Z',
  ...overrides,
})

describe('useSessionPendingAsk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the hook interface after the initial fetch', async () => {
    vi.mocked(client.getAsks).mockResolvedValue({ asks: [], total: 0 })

    const { result } = renderHook(() => useSessionPendingAsk('session-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.pendingAsk).toBeNull()
    expect(result.current.error).toBeNull()
    expect(typeof result.current.refresh).toBe('function')
    expect(client.getAsks).toHaveBeenCalledWith()
  })

  it('selects the earliest pending ask for the selected session', async () => {
    const asks = [
      createAsk({ id: 'ask-later', requestedAt: '2024-01-01T12:00:00Z' }),
      createAsk({ id: 'ask-earlier', requestedAt: '2024-01-01T09:00:00Z' }),
      createAsk({ id: 'ask-answered', status: 'answered', requestedAt: '2024-01-01T08:00:00Z' }),
      createAsk({ id: 'ask-other-session', sessionId: 'session-2', requestedAt: '2024-01-01T07:00:00Z' }),
    ]
    vi.mocked(client.getAsks).mockResolvedValue({ asks, total: asks.length })

    const { result } = renderHook(() => useSessionPendingAsk('session-1'))

    await waitFor(() => expect(result.current.pendingAsk?.id).toBe('ask-earlier'))
  })

  it('returns an error and no ask when the API fails', async () => {
    vi.mocked(client.getAsks).mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useSessionPendingAsk('session-1'))

    await waitFor(() => expect(result.current.error).toBe('Network error'))

    expect(result.current.pendingAsk).toBeNull()
  })

  it('skips fetching when there is no session', () => {
    const { result } = renderHook(() => useSessionPendingAsk(null))

    expect(result.current.pendingAsk).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(client.getAsks).not.toHaveBeenCalled()
  })
})
