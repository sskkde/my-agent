/**
 * Tests for Map Event Parser
 *
 * Covers: coordinate parsing, string sanitization, and all AMap result type
 * conversions to MapOperation discriminated union members.
 */

import { describe, it, expect } from 'vitest'
import type { ConsoleTimelineEvent } from '../../api/types'
import {
  parseLngLat,
  sanitizeDisplayText,
  parseMapOperations,
  parseAllMapOperations,
} from './map-event-parser'
import type { MapOperation } from './types'

// =============================================================================
// Helpers
// =============================================================================

function makeToolResultEvent(
  eventId: string,
  amapResult: Record<string, unknown> | undefined,
): ConsoleTimelineEvent {
  return {
    eventId,
    eventType: 'tool_result',
    sessionId: 'session-1',
    timestamp: '2026-06-27T10:00:00Z',
    content: '{}',
    metadata: amapResult !== undefined ? { amapResult } : undefined,
  }
}

function makeEvent(
  eventType: ConsoleTimelineEvent['eventType'],
  metadata?: Record<string, unknown>,
): ConsoleTimelineEvent {
  return {
    eventId: 'evt-1',
    eventType,
    sessionId: 'session-1',
    timestamp: '2026-06-27T10:00:00Z',
    content: '',
    metadata,
  }
}

// =============================================================================
// parseLngLat
// =============================================================================

describe('parseLngLat', () => {
  it('parses valid coordinate string', () => {
    expect(parseLngLat('116.397428,39.90923')).toEqual([116.397428, 39.90923])
  })

  it('parses negative coordinates', () => {
    expect(parseLngLat('-73.9857,40.7484')).toEqual([-73.9857, 40.7484])
  })

  it('returns undefined for empty string', () => {
    expect(parseLngLat('')).toBeUndefined()
  })

  it('returns undefined for null', () => {
    expect(parseLngLat(null)).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(parseLngLat(undefined)).toBeUndefined()
  })

  it('returns undefined for missing comma', () => {
    expect(parseLngLat('116.397')).toBeUndefined()
  })

  it('returns undefined for extra commas', () => {
    expect(parseLngLat('116.397,39.909,10')).toBeUndefined()
  })

  it('returns undefined for non-numeric values', () => {
    expect(parseLngLat('abc,def')).toBeUndefined()
  })

  it('returns undefined for NaN values', () => {
    expect(parseLngLat('NaN,39.909')).toBeUndefined()
  })

  it('returns undefined for Infinity', () => {
    expect(parseLngLat('Infinity,39.909')).toBeUndefined()
  })

  it('returns undefined for longitude > 180', () => {
    expect(parseLngLat('181,39.909')).toBeUndefined()
  })

  it('returns undefined for longitude < -180', () => {
    expect(parseLngLat('-181,39.909')).toBeUndefined()
  })

  it('returns undefined for latitude > 90', () => {
    expect(parseLngLat('116.397,91')).toBeUndefined()
  })

  it('returns undefined for latitude < -90', () => {
    expect(parseLngLat('116.397,-91')).toBeUndefined()
  })

  it('accepts boundary values: 180, 90', () => {
    expect(parseLngLat('180,90')).toEqual([180, 90])
  })

  it('accepts boundary values: -180, -90', () => {
    expect(parseLngLat('-180,-90')).toEqual([-180, -90])
  })

  it('returns undefined for empty between commas', () => {
    expect(parseLngLat(',39.909')).toBeUndefined()
  })
})

// =============================================================================
// sanitizeDisplayText
// =============================================================================

describe('sanitizeDisplayText', () => {
  it('returns plain text unchanged', () => {
    expect(sanitizeDisplayText('Beijing Railway Station')).toBe('Beijing Railway Station')
  })

  it('trims whitespace', () => {
    expect(sanitizeDisplayText('  hello  ')).toBe('hello')
  })

  it('strips HTML tags', () => {
    expect(sanitizeDisplayText('<b>Bold</b>')).toBe('Bold')
  })

  it('strips script tags', () => {
    expect(sanitizeDisplayText('<script>alert("xss")</script>safe')).toBe('safe')
  })

  it('strips img tags', () => {
    expect(sanitizeDisplayText('<img src=x onerror=alert(1)>text')).toBe('text')
  })

  it('returns empty string for non-string input', () => {
    expect(sanitizeDisplayText(null)).toBe('')
    expect(sanitizeDisplayText(undefined)).toBe('')
    expect(sanitizeDisplayText(42)).toBe('')
    expect(sanitizeDisplayText({})).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(sanitizeDisplayText('')).toBe('')
  })

  it('returns empty string for whitespace-only', () => {
    expect(sanitizeDisplayText('   ')).toBe('')
  })
})

// =============================================================================
// parseMapOperations — geocode results
// =============================================================================

describe('parseMapOperations — geocode', () => {
  it('produces set_view + add_marker for single geocode', () => {
    const event = makeToolResultEvent('evt-1', {
      resultType: 'geocode',
      geocodes: [
        {
          formatted_address: 'Beijing, Chaoyang District',
          location: '116.397428,39.90923',
          province: 'Beijing',
          city: 'Beijing',
          district: 'Chaoyang',
        },
      ],
    })

    const ops = parseMapOperations(event)
    expect(ops).toHaveLength(2)
    expect(ops[0]).toMatchObject({ type: 'set_view', center: [116.397428, 39.90923], zoom: 14 })
    expect(ops[1]).toMatchObject({
      type: 'add_marker',
      id: 'marker-evt-1-0',
      position: [116.397428, 39.90923],
      title: 'Beijing, Chaoyang District',
    })
  })

  it('produces set_view + multiple add_markers for multiple geocodes', () => {
    const event = makeToolResultEvent('evt-2', {
      resultType: 'geocode',
      geocodes: [
        { formatted_address: 'Location A', location: '116.397,39.909' },
        { formatted_address: 'Location B', location: '121.473,31.230' },
      ],
    })

    const ops = parseMapOperations(event)
    expect(ops).toHaveLength(3)
    expect(ops[0].type).toBe('set_view')
    expect(ops[1]).toMatchObject({ type: 'add_marker', title: 'Location A' })
    expect(ops[2]).toMatchObject({ type: 'add_marker', title: 'Location B' })
  })

  it('skips geocodes with invalid coordinates', () => {
    const event = makeToolResultEvent('evt-3', {
      resultType: 'geocode',
      geocodes: [
        { formatted_address: 'Invalid', location: '999,999' },
        { formatted_address: 'Valid', location: '116.397,39.909' },
      ],
    })

    const ops = parseMapOperations(event)
    expect(ops).toHaveLength(2)
    expect(ops[0].type).toBe('set_view')
    expect(ops[1]).toMatchObject({ type: 'add_marker', title: 'Valid' })
  })

  it('returns empty array for empty geocodes', () => {
    const event = makeToolResultEvent('evt-4', {
      resultType: 'geocode',
      geocodes: [],
    })

    expect(parseMapOperations(event)).toEqual([])
  })

  it('uses "Geocode result" as fallback title when address is empty', () => {
    const event = makeToolResultEvent('evt-5', {
      resultType: 'geocode',
      geocodes: [{ location: '116.397,39.909' }],
    })

    const ops = parseMapOperations(event)
    expect(ops[1]).toMatchObject({ type: 'add_marker', title: 'Geocode result' })
  })

  it('sanitizes HTML in formatted_address', () => {
    const event = makeToolResultEvent('evt-6', {
      resultType: 'geocode',
      geocodes: [
        { formatted_address: '<script>alert(1)</script>Beijing', location: '116.397,39.909' },
      ],
    })

    const ops = parseMapOperations(event)
    expect((ops[1] as MapOperation & { type: 'add_marker' }).title).toBe('Beijing')
  })
})

// =============================================================================
// parseMapOperations — POI results
// =============================================================================

describe('parseMapOperations — POI', () => {
  it('produces set_view + add_marker for single POI', () => {
    const event = makeToolResultEvent('evt-10', {
      resultType: 'poi',
      pois: [
        {
          name: 'Starbucks',
          location: '116.397428,39.90923',
          address: '123 Main St',
          type: 'Coffee Shop',
          typecode: '050301',
        },
      ],
    })

    const ops = parseMapOperations(event)
    expect(ops).toHaveLength(2)
    expect(ops[0]).toMatchObject({ type: 'set_view', zoom: 13 })
    expect(ops[1]).toMatchObject({
      type: 'add_marker',
      id: 'marker-evt-10-0',
      position: [116.397428, 39.90923],
      title: 'Starbucks',
    })
  })

  it('produces multiple markers for multiple POIs', () => {
    const event = makeToolResultEvent('evt-11', {
      resultType: 'poi',
      pois: [
        { name: 'Cafe A', location: '116.397,39.909' },
        { name: 'Cafe B', location: '116.400,39.910' },
        { name: 'Cafe C', location: '116.403,39.911' },
      ],
    })

    const ops = parseMapOperations(event)
    expect(ops).toHaveLength(4) // 1 set_view + 3 add_marker
    expect(ops[0].type).toBe('set_view')
    expect(ops[1]).toMatchObject({ type: 'add_marker', title: 'Cafe A' })
    expect(ops[2]).toMatchObject({ type: 'add_marker', title: 'Cafe B' })
    expect(ops[3]).toMatchObject({ type: 'add_marker', title: 'Cafe C' })
  })

  it('uses "POI" as fallback title when name is missing', () => {
    const event = makeToolResultEvent('evt-12', {
      resultType: 'poi',
      pois: [{ location: '116.397,39.909', address: '123 St' }],
    })

    const ops = parseMapOperations(event)
    expect(ops[1]).toMatchObject({ type: 'add_marker', title: 'POI' })
  })

  it('skips POIs with invalid coordinates', () => {
    const event = makeToolResultEvent('evt-13', {
      resultType: 'poi',
      pois: [
        { name: 'Invalid', location: '999,999' },
        { name: 'Valid', location: '116.397,39.909' },
      ],
    })

    const ops = parseMapOperations(event)
    expect(ops).toHaveLength(2)
    expect(ops[1]).toMatchObject({ type: 'add_marker', title: 'Valid' })
  })

  it('sanitizes POI name with HTML', () => {
    const event = makeToolResultEvent('evt-14', {
      resultType: 'poi',
      pois: [{ name: '<img src=x onerror=alert(1)>Cafe', location: '116.397,39.909' }],
    })

    const ops = parseMapOperations(event)
    expect((ops[1] as MapOperation & { type: 'add_marker' }).title).toBe('Cafe')
  })

  it('includes sanitized address in marker data', () => {
    const event = makeToolResultEvent('evt-15', {
      resultType: 'poi',
      pois: [
        {
          name: 'Test',
          location: '116.397,39.909',
          address: '<b>123 Main St</b>',
        },
      ],
    })

    const ops = parseMapOperations(event)
    const marker = ops[1] as MapOperation & { type: 'add_marker' }
    expect(marker.data).toMatchObject({ address: '123 Main St' })
  })
})

// =============================================================================
// parseMapOperations — route results
// =============================================================================

describe('parseMapOperations — route', () => {
  it('produces set_view + origin/destination markers + show_route', () => {
    const event = makeToolResultEvent('evt-20', {
      resultType: 'route',
      origin: '116.397428,39.90923',
      destination: '121.473701,31.230416',
      paths: [{ distance: '1067000', duration: '37800' }],
    })

    const ops = parseMapOperations(event)
    expect(ops).toHaveLength(4)
    expect(ops[0]).toMatchObject({ type: 'set_view' })
    expect(ops[1]).toMatchObject({ type: 'add_marker', title: 'Origin' })
    expect(ops[2]).toMatchObject({ type: 'add_marker', title: 'Destination' })
    expect(ops[3]).toMatchObject({
      type: 'show_route',
      origin: [116.397428, 39.90923],
      destination: [121.473701, 31.230416],
      distance: '1067000',
      duration: '37800',
    })
  })

  it('centers view between origin and destination', () => {
    const event = makeToolResultEvent('evt-21', {
      resultType: 'route',
      origin: '116.0,40.0',
      destination: '122.0,30.0',
      paths: [],
    })

    const ops = parseMapOperations(event)
    const setView = ops[0] as MapOperation & { type: 'set_view' }
    expect(setView.center).toEqual([119.0, 35.0])
  })

  it('only origin valid → marker only, no show_route', () => {
    const event = makeToolResultEvent('evt-22', {
      resultType: 'route',
      origin: '116.397,39.909',
      destination: '999,999',
      paths: [],
    })

    const ops = parseMapOperations(event)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ type: 'add_marker', title: 'Origin' })
  })

  it('only destination valid → marker only, no show_route', () => {
    const event = makeToolResultEvent('evt-23', {
      resultType: 'route',
      origin: '999,999',
      destination: '121.473,31.230',
      paths: [],
    })

    const ops = parseMapOperations(event)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ type: 'add_marker', title: 'Destination' })
  })

  it('returns empty when both coordinates invalid', () => {
    const event = makeToolResultEvent('evt-24', {
      resultType: 'route',
      origin: '999,999',
      destination: 'abc,def',
      paths: [],
    })

    expect(parseMapOperations(event)).toEqual([])
  })

  it('returns empty when origin/destination missing', () => {
    const event = makeToolResultEvent('evt-25', {
      resultType: 'route',
      paths: [],
    })

    expect(parseMapOperations(event)).toEqual([])
  })

  it('includes first path distance/duration in show_route', () => {
    const event = makeToolResultEvent('evt-26', {
      resultType: 'route',
      origin: '116.397,39.909',
      destination: '121.473,31.230',
      paths: [
        { distance: '50000', duration: '3600' },
        { distance: '55000', duration: '4000' },
      ],
    })

    const ops = parseMapOperations(event)
    const route = ops.find((o) => o.type === 'show_route') as MapOperation & { type: 'show_route' }
    expect(route.distance).toBe('50000')
    expect(route.duration).toBe('3600')
  })
})

// =============================================================================
// parseMapOperations — no-op cases
// =============================================================================

describe('parseMapOperations — no-ops', () => {
  it('returns empty for non-tool_result events', () => {
    const event = makeEvent('assistant_message', { amapResult: { resultType: 'geocode', geocodes: [] } })
    expect(parseMapOperations(event)).toEqual([])
  })

  it('returns empty when metadata is undefined', () => {
    const event = makeEvent('tool_result')
    expect(parseMapOperations(event)).toEqual([])
  })

  it('returns empty when metadata has no amapResult', () => {
    const event = makeEvent('tool_result', { someOther: 'data' })
    expect(parseMapOperations(event)).toEqual([])
  })

  it('returns empty when amapResult is null', () => {
    const event = makeToolResultEvent('evt-30', undefined)
    if (event.metadata) event.metadata.amapResult = null
    expect(parseMapOperations(event)).toEqual([])
  })

  it('returns empty when amapResult is an array', () => {
    const event = makeEvent('tool_result', { amapResult: [1, 2, 3] })
    expect(parseMapOperations(event)).toEqual([])
  })

  it('returns empty for weather results', () => {
    const event = makeToolResultEvent('evt-31', {
      resultType: 'weather',
      lives: [{ city: 'Beijing', weather: 'Sunny', temperature: '25' }],
    })
    expect(parseMapOperations(event)).toEqual([])
  })

  it('returns empty for distance results', () => {
    const event = makeToolResultEvent('evt-32', {
      resultType: 'distance',
      results: [{ distance: '1000', duration: '600' }],
    })
    expect(parseMapOperations(event)).toEqual([])
  })

  it('returns empty for unknown resultType', () => {
    const event = makeToolResultEvent('evt-33', {
      resultType: 'unknown_future_type',
      data: 'something',
    })
    expect(parseMapOperations(event)).toEqual([])
  })

  it('returns empty when amapResult lacks resultType', () => {
    const event = makeToolResultEvent('evt-34', { geocodes: [] })
    expect(parseMapOperations(event)).toEqual([])
  })
})

// =============================================================================
// parseAllMapOperations
// =============================================================================

describe('parseAllMapOperations', () => {
  it('parses multiple events into flat operation list', () => {
    const events: ConsoleTimelineEvent[] = [
      makeToolResultEvent('evt-g', {
        resultType: 'geocode',
        geocodes: [{ formatted_address: 'A', location: '116.397,39.909' }],
      }),
      makeToolResultEvent('evt-p', {
        resultType: 'poi',
        pois: [{ name: 'B', location: '121.473,31.230' }],
      }),
    ]

    const ops = parseAllMapOperations(events)
    // geocode: set_view + marker, poi: set_view + marker
    expect(ops).toHaveLength(4)
    expect(ops.filter((o) => o.type === 'set_view')).toHaveLength(2)
    expect(ops.filter((o) => o.type === 'add_marker')).toHaveLength(2)
  })

  it('skips events without amapResult', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent('assistant_message', undefined),
      makeToolResultEvent('evt-ok', {
        resultType: 'geocode',
        geocodes: [{ formatted_address: 'X', location: '116.397,39.909' }],
      }),
      makeEvent('tool_result', { notAmap: true }),
    ]

    const ops = parseAllMapOperations(events)
    expect(ops).toHaveLength(2)
  })

  it('returns empty array for empty input', () => {
    expect(parseAllMapOperations([])).toEqual([])
  })
})
