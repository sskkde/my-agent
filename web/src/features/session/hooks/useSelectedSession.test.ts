/**
 * useSelectedSession Tests
 *
 * Tests for selected session management hook including:
 * - localStorage fallback via safeReadLocalStorage
 * - selectedSessionIdRef sync
 * - localStorage persistence on change
 * - handleSelectSession convenience wrapper
 * - Malformed localStorage value handling
 */

import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSelectedSession } from './useSelectedSession'
import { SELECTED_SESSION_KEY } from '../session-constants'

describe('useSelectedSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('returns correct interface', () => {
    const { result } = renderHook(() => useSelectedSession())

    expect(result.current).toHaveProperty('selectedSessionId')
    expect(result.current).toHaveProperty('setSelectedSessionId')
    expect(result.current).toHaveProperty('selectedSession')
    expect(result.current).toHaveProperty('setSelectedSession')
    expect(result.current).toHaveProperty('selectedSessionIdRef')
    expect(result.current).toHaveProperty('handleSelectSession')
    expect(typeof result.current.handleSelectSession).toBe('function')
  })

  it('initializes with null when localStorage is empty', () => {
    const { result } = renderHook(() => useSelectedSession())

    expect(result.current.selectedSessionId).toBeNull()
    expect(result.current.selectedSession).toBeNull()
  })

  it('reads session ID from localStorage on init', () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'ses_abc123')

    const { result } = renderHook(() => useSelectedSession())

    expect(result.current.selectedSessionId).toBe('ses_abc123')
  })

  it('ignores empty localStorage value (malformed)', () => {
    localStorage.setItem(SELECTED_SESSION_KEY, '')

    const { result } = renderHook(() => useSelectedSession())

    expect(result.current.selectedSessionId).toBeNull()
  })

  it('ignores whitespace-only localStorage value (malformed)', () => {
    localStorage.setItem(SELECTED_SESSION_KEY, '   ')

    const { result } = renderHook(() => useSelectedSession())

    expect(result.current.selectedSessionId).toBeNull()
  })

  it('persists selected session ID to localStorage', () => {
    const { result } = renderHook(() => useSelectedSession())

    act(() => {
      result.current.setSelectedSessionId('ses_new123')
    })

    expect(localStorage.getItem(SELECTED_SESSION_KEY)).toBe('ses_new123')
  })

  it('removes localStorage key when session is deselected', () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'ses_abc123')

    const { result } = renderHook(() => useSelectedSession())

    expect(result.current.selectedSessionId).toBe('ses_abc123')

    act(() => {
      result.current.setSelectedSessionId(null)
    })

    expect(localStorage.getItem(SELECTED_SESSION_KEY)).toBeNull()
  })

  it('keeps selectedSessionIdRef in sync with state', () => {
    const { result } = renderHook(() => useSelectedSession())

    expect(result.current.selectedSessionIdRef.current).toBeNull()

    act(() => {
      result.current.setSelectedSessionId('ses_abc123')
    })

    expect(result.current.selectedSessionIdRef.current).toBe('ses_abc123')

    act(() => {
      result.current.setSelectedSessionId(null)
    })

    expect(result.current.selectedSessionIdRef.current).toBeNull()
  })

  it('handleSelectSession sets the session ID', () => {
    const { result } = renderHook(() => useSelectedSession())

    act(() => {
      result.current.handleSelectSession('ses_xyz789')
    })

    expect(result.current.selectedSessionId).toBe('ses_xyz789')
    expect(localStorage.getItem(SELECTED_SESSION_KEY)).toBe('ses_xyz789')
  })

  it('setSelectedSession updates selectedSession state', () => {
    const { result } = renderHook(() => useSelectedSession())

    const mockSession = {
      sessionId: 'ses_abc123',
      userId: 'user-1',
      title: 'Test Session',
      status: 'active' as const,
      messageCount: 5,
      lastActivityAt: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }

    act(() => {
      result.current.setSelectedSession(mockSession)
    })

    expect(result.current.selectedSession).toEqual(mockSession)
  })

  it('handles multiple rapid session changes', () => {
    const { result } = renderHook(() => useSelectedSession())

    act(() => {
      result.current.setSelectedSessionId('ses_1')
    })
    act(() => {
      result.current.setSelectedSessionId('ses_2')
    })
    act(() => {
      result.current.setSelectedSessionId('ses_3')
    })

    expect(result.current.selectedSessionId).toBe('ses_3')
    expect(result.current.selectedSessionIdRef.current).toBe('ses_3')
    expect(localStorage.getItem(SELECTED_SESSION_KEY)).toBe('ses_3')
  })

  it('preserves valid session ID format from localStorage', () => {
    localStorage.setItem(SELECTED_SESSION_KEY, 'ses_valid-session_id')

    const { result } = renderHook(() => useSelectedSession())

    expect(result.current.selectedSessionId).toBe('ses_valid-session_id')
  })
})
