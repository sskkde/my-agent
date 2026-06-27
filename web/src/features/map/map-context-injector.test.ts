/**
 * Tests for Map Context Injector
 *
 * Covers:
 * - formatMapContext: full snapshot, missing fields, malicious strings
 * - useMapContextSender: sendMessage delegation, error propagation
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { formatMapContext, useMapContextSender } from './map-context-injector'
import type { MapContextSnapshot } from './types'

// =============================================================================
// formatMapContext
// =============================================================================

describe('formatMapContext', () => {
  it('formats full snapshot with selected point, center, zoom, and route', () => {
    const snapshot: MapContextSnapshot = {
      center: [116.404, 39.915],
      zoom: 14,
      selectedPoint: {
        position: [116.397428, 39.90923],
        name: 'Starbucks Wangfujing',
      },
      currentRoute: {
        origin: 'Beijing Station',
        destination: 'Tiananmen Square',
        distance: '5.2 km',
        duration: '15 min',
      },
    }

    const result = formatMapContext(snapshot)

    expect(result).toBe(
      '[Map Context] selected point: Starbucks Wangfujing (116.397428, 39.90923); center: (116.404, 39.915); zoom: 14; route: Beijing Station → Tiananmen Square, distance: 5.2 km, duration: 15 min',
    )
  })

  it('formats snapshot with selected point but no name', () => {
    const snapshot: MapContextSnapshot = {
      center: [116.404, 39.915],
      zoom: 12,
      selectedPoint: {
        position: [116.397, 39.909],
      },
    }

    const result = formatMapContext(snapshot)

    expect(result).toBe(
      '[Map Context] selected point: (116.397, 39.909); center: (116.404, 39.915); zoom: 12',
    )
  })

  it('formats minimal snapshot with only center and zoom (no selection, no route)', () => {
    const snapshot: MapContextSnapshot = {
      center: [121.4737, 31.2304],
      zoom: 10,
    }

    const result = formatMapContext(snapshot)

    expect(result).toBe(
      '[Map Context] center: (121.4737, 31.2304); zoom: 10',
    )
  })

  it('formats snapshot with route but no selected point', () => {
    const snapshot: MapContextSnapshot = {
      center: [116.404, 39.915],
      zoom: 13,
      currentRoute: {
        origin: 'Airport',
        destination: 'Hotel',
        distance: '30 km',
        duration: '45 min',
      },
    }

    const result = formatMapContext(snapshot)

    expect(result).toBe(
      '[Map Context] center: (116.404, 39.915); zoom: 13; route: Airport → Hotel, distance: 30 km, duration: 45 min',
    )
  })

  it('omits distance and duration when route has none', () => {
    const snapshot: MapContextSnapshot = {
      center: [0, 0],
      zoom: 1,
      currentRoute: {
        origin: 'A',
        destination: 'B',
      },
    }

    const result = formatMapContext(snapshot)

    expect(result).toBe('[Map Context] center: (0, 0); zoom: 1; route: A → B')
  })

  // ===========================================================================
  // Edge cases — missing/empty fields
  // ===========================================================================

  it('handles selected point with empty name string', () => {
    const snapshot: MapContextSnapshot = {
      center: [100, 50],
      zoom: 5,
      selectedPoint: {
        position: [100, 50],
        name: '',
      },
    }

    const result = formatMapContext(snapshot)

    // Empty name should not produce "selected point:  (100, 50)"
    expect(result).toBe('[Map Context] selected point: (100, 50); center: (100, 50); zoom: 5')
  })

  it('handles route with empty origin and destination', () => {
    const snapshot: MapContextSnapshot = {
      center: [0, 0],
      zoom: 1,
      currentRoute: {
        origin: '',
        destination: '',
      },
    }

    const result = formatMapContext(snapshot)

    expect(result).toContain('route: unknown')
  })

  it('handles route with only origin (empty destination)', () => {
    const snapshot: MapContextSnapshot = {
      center: [0, 0],
      zoom: 1,
      currentRoute: {
        origin: 'Start',
        destination: '',
      },
    }

    const result = formatMapContext(snapshot)

    expect(result).toContain('route: Start')
    expect(result).not.toContain('→')
  })

  it('handles route with empty distance and duration strings', () => {
    const snapshot: MapContextSnapshot = {
      center: [0, 0],
      zoom: 1,
      currentRoute: {
        origin: 'A',
        destination: 'B',
        distance: '',
        duration: '',
      },
    }

    const result = formatMapContext(snapshot)

    // Empty strings should be omitted
    expect(result).not.toContain('distance:')
    expect(result).not.toContain('duration:')
  })

  // ===========================================================================
  // Sanitization — malicious POI names / addresses
  // ===========================================================================

  it('strips HTML tags from POI name', () => {
    const snapshot: MapContextSnapshot = {
      center: [100, 50],
      zoom: 10,
      selectedPoint: {
        position: [100, 50],
        name: '<script>alert("xss")</script>Starbucks',
      },
    }

    const result = formatMapContext(snapshot)

    expect(result).not.toContain('<script>')
    expect(result).not.toContain('</script>')
    expect(result).toContain('Starbucks')
  })

  it('strips event handler attributes from POI name', () => {
    const snapshot: MapContextSnapshot = {
      center: [100, 50],
      zoom: 10,
      selectedPoint: {
        position: [100, 50],
        name: '<img src=x onerror=alert(1)>Cafe',
      },
    }

    const result = formatMapContext(snapshot)

    expect(result).not.toContain('onerror')
    expect(result).not.toContain('<img')
    expect(result).toContain('Cafe')
  })

  it('strips HTML from route origin and destination', () => {
    const snapshot: MapContextSnapshot = {
      center: [0, 0],
      zoom: 1,
      currentRoute: {
        origin: '<b>Bold Origin</b>',
        destination: '<a href="javascript:alert(1)">Dest</a>',
      },
    }

    const result = formatMapContext(snapshot)

    expect(result).not.toContain('<b>')
    expect(result).not.toContain('<a ')
    expect(result).not.toContain('javascript:')
    expect(result).toContain('Bold Origin')
    expect(result).toContain('Dest')
  })

  it('handles non-string name gracefully (returns empty, no crash)', () => {
    // name is typed as string | undefined, but test defensive behavior
    const snapshot: MapContextSnapshot = {
      center: [10, 20],
      zoom: 8,
      selectedPoint: {
        position: [10, 20],
        name: undefined,
      },
    }

    // Should not throw
    const result = formatMapContext(snapshot)

    expect(result).toBe('[Map Context] selected point: (10, 20); center: (10, 20); zoom: 8')
  })

  it('always starts with [Map Context] prefix', () => {
    const snapshot: MapContextSnapshot = {
      center: [0, 0],
      zoom: 1,
    }

    expect(formatMapContext(snapshot)).toMatch(/^\[Map Context\] /)
  })

  it('sanitizes DOMPurify-resistant content in route distance/duration', () => {
    const snapshot: MapContextSnapshot = {
      center: [0, 0],
      zoom: 1,
      currentRoute: {
        origin: 'A',
        destination: 'B',
        distance: '<style>body{display:none}</style>5 km',
        duration: '10 min <iframe src=evil>',
      },
    }

    const result = formatMapContext(snapshot)

    expect(result).not.toContain('<style>')
    expect(result).not.toContain('<iframe')
    expect(result).toContain('5 km')
    expect(result).toContain('10 min')
  })
})

// =============================================================================
// useMapContextSender
// =============================================================================

describe('useMapContextSender', () => {
  it('calls sendMessage with formatted context text', async () => {
    const sendMessage = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useMapContextSender({ sessionId: 'sess-1', sendMessage }),
    )

    const snapshot: MapContextSnapshot = {
      center: [116.404, 39.915],
      zoom: 14,
      selectedPoint: {
        position: [116.397, 39.909],
        name: 'Test POI',
      },
    }

    await act(async () => {
      await result.current.sendMapContext(snapshot)
    })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      '[Map Context] selected point: Test POI (116.397, 39.909); center: (116.404, 39.915); zoom: 14',
    )
  })

  it('sends minimal context when no selected point or route', async () => {
    const sendMessage = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useMapContextSender({ sessionId: 'sess-2', sendMessage }),
    )

    const snapshot: MapContextSnapshot = {
      center: [121.47, 31.23],
      zoom: 10,
    }

    await act(async () => {
      await result.current.sendMapContext(snapshot)
    })

    expect(sendMessage).toHaveBeenCalledWith(
      '[Map Context] center: (121.47, 31.23); zoom: 10',
    )
  })

  it('propagates errors from sendMessage', async () => {
    const error = new Error('Network failure')
    const sendMessage = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(error)
    const { result } = renderHook(() =>
      useMapContextSender({ sessionId: 'sess-3', sendMessage }),
    )

    const snapshot: MapContextSnapshot = {
      center: [0, 0],
      zoom: 1,
    }

    await expect(
      act(async () => {
        await result.current.sendMapContext(snapshot)
      }),
    ).rejects.toThrow('Network failure')
  })

  it('sanitizes malicious POI names before sending', async () => {
    const sendMessage = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useMapContextSender({ sessionId: 'sess-4', sendMessage }),
    )

    const snapshot: MapContextSnapshot = {
      center: [10, 20],
      zoom: 8,
      selectedPoint: {
        position: [10, 20],
        name: '<script>alert("xss")</script>Safe Name',
      },
    }

    await act(async () => {
      await result.current.sendMapContext(snapshot)
    })

    const sentText = sendMessage.mock.calls[0][0]
    expect(sentText).not.toContain('<script>')
    expect(sentText).toContain('Safe Name')
  })

  it('includes route information when available', async () => {
    const sendMessage = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useMapContextSender({ sessionId: 'sess-5', sendMessage }),
    )

    const snapshot: MapContextSnapshot = {
      center: [116.4, 39.9],
      zoom: 12,
      currentRoute: {
        origin: 'Hotel',
        destination: 'Airport',
        distance: '25 km',
        duration: '30 min',
      },
    }

    await act(async () => {
      await result.current.sendMapContext(snapshot)
    })

    const sentText = sendMessage.mock.calls[0][0]
    expect(sentText).toContain('route: Hotel → Airport')
    expect(sentText).toContain('distance: 25 km')
    expect(sentText).toContain('duration: 30 min')
  })
})
