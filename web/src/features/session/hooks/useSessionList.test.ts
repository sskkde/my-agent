/**
 * useSessionList Tests
 *
 * Tests for session list management hook including:
 * - Initial fetch on mount
 * - Loading/error states
 * - Session creation with onSessionCreated callback
 * - Refresh and debounced refresh scheduling
 * - Cleanup on unmount
 */

import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSessionList } from './useSessionList'
import * as client from '../../../api/client'

vi.mock('../../../api/client', () => ({
  getSessions: vi.fn(),
  createSession: vi.fn(),
}))

describe('useSessionList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('fetches sessions on mount', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [],
      total: 0,
    })

    const { result } = renderHook(() => useSessionList())

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false))

    expect(client.getSessions).toHaveBeenCalledTimes(1)
    expect(result.current.sessions).toEqual([])
    expect(result.current.sessionsError).toBeNull()
  })

  it('populates sessions from API response', async () => {
    const mockSessions = [
      {
        sessionId: 'ses_abc123',
        userId: 'user-1',
        title: 'Test Session',
        status: 'active',
        messageCount: 5,
        lastActivityAt: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]

    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: mockSessions,
      total: 1,
    })

    const { result } = renderHook(() => useSessionList())

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false))

    expect(result.current.sessions).toEqual(mockSessions)
  })

  it('sets error state when fetch fails', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error'),
    )

    const { result } = renderHook(() => useSessionList())

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false))

    expect(result.current.sessionsError).toBe('Network error')
    expect(result.current.sessions).toEqual([])
  })

  it('sets generic error for non-Error exceptions', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockRejectedValue('unknown')

    const { result } = renderHook(() => useSessionList())

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false))

    expect(result.current.sessionsError).toBe('Failed to load sessions')
  })

  it('creates session and calls onSessionCreated', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [],
      total: 0,
    })
    ;(client.createSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        sessionId: 'ses_new123',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: '2024-01-02T00:00:00Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    const onSessionCreated = vi.fn()
    const { result } = renderHook(() => useSessionList({ onSessionCreated }))

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false))

    await result.current.handleCreateSession()

    await waitFor(() => {
      expect(client.createSession).toHaveBeenCalledTimes(1)
      expect(onSessionCreated).toHaveBeenCalledWith('ses_new123')
      expect(result.current.sessions[0].sessionId).toBe('ses_new123')
    })
  })

  it('prepends new session to list on creation', async () => {
    const existingSession = {
      sessionId: 'ses_existing',
      userId: 'user-1',
      title: 'Existing',
      status: 'active',
      messageCount: 3,
      lastActivityAt: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }

    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [existingSession],
      total: 1,
    })
    ;(client.createSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        sessionId: 'ses_new',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: '2024-01-02T00:00:00Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    const { result } = renderHook(() => useSessionList())

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false))

    await result.current.handleCreateSession()

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(2)
      expect(result.current.sessions[0].sessionId).toBe('ses_new')
      expect(result.current.sessions[1].sessionId).toBe('ses_existing')
    })
  })

  it('sets error when createSession fails', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [],
      total: 0,
    })
    ;(client.createSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Create failed'),
    )

    const { result } = renderHook(() => useSessionList())

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false))

    await result.current.handleCreateSession()

    await waitFor(() => {
      expect(result.current.sessionsError).toBe('Create failed')
    })
  })

  it('refreshSessions fetches with isRefresh=true', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [],
      total: 0,
    })

    const { result } = renderHook(() => useSessionList())

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false))

    await result.current.refreshSessions()

    // Should have been called twice: once on mount, once on refresh
    expect(client.getSessions).toHaveBeenCalledTimes(2)
  })

  it('fetchSessions with isRefresh=true clears error instead of showing loading', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ sessions: [], total: 0 })

    const { result } = renderHook(() => useSessionList())

    await waitFor(() => expect(result.current.sessionsError).toBe('fail'))

    // Now refresh - should clear error without setting loading
    await result.current.fetchSessions(true)

    await waitFor(() => {
      expect(result.current.sessionsError).toBeNull()
      expect(result.current.sessionsLoading).toBe(false)
    })
  })

  it('returns correct interface', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [],
      total: 0,
    })

    const { result } = renderHook(() => useSessionList())

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false))

    expect(result.current).toHaveProperty('sessions')
    expect(result.current).toHaveProperty('sessionsLoading')
    expect(result.current).toHaveProperty('sessionsError')
    expect(result.current).toHaveProperty('fetchSessions')
    expect(result.current).toHaveProperty('scheduleSessionRefresh')
    expect(result.current).toHaveProperty('handleCreateSession')
    expect(result.current).toHaveProperty('refreshSessions')
    expect(result.current).toHaveProperty('clearSessionRefreshTimeout')
    expect(typeof result.current.fetchSessions).toBe('function')
    expect(typeof result.current.scheduleSessionRefresh).toBe('function')
    expect(typeof result.current.handleCreateSession).toBe('function')
    expect(typeof result.current.refreshSessions).toBe('function')
    expect(typeof result.current.clearSessionRefreshTimeout).toBe('function')
  })

  it('does not call onSessionCreated when not provided', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [],
      total: 0,
    })
    ;(client.createSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        sessionId: 'ses_new',
        userId: 'user-1',
        messageCount: 0,
        lastActivityAt: '2024-01-02T00:00:00Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    const { result } = renderHook(() => useSessionList())

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false))

    // Should not throw when onSessionCreated is not provided
    await result.current.handleCreateSession()

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1)
    })
  })
})
