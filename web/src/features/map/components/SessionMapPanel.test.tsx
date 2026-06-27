/**
 * Tests for SessionMapPanel component.
 *
 * Mocks parseAllMapOperations to control the operation output,
 * and mocks AmapSharedMap to avoid real AMap interactions.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../map-event-parser', () => ({
  parseAllMapOperations: vi.fn(),
}))

vi.mock('./AmapSharedMap', () => ({
  default: vi.fn((props: Record<string, unknown>) => (
    <div
      data-testid="mock-amap-shared-map"
      data-operations={JSON.stringify(props.operations)}
      data-has-onclick={String(typeof props.onMapClick === 'function')}
    />
  )),
}))

import SessionMapPanel from './SessionMapPanel'
import type { SessionMapPanelProps } from './SessionMapPanel'
import { parseAllMapOperations } from '../map-event-parser'
import type { ConsoleTimelineEvent } from '../../../api/types'
import type { MapOperation } from '../types'

const mockParseAllMapOperations = vi.mocked(parseAllMapOperations)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<ConsoleTimelineEvent> = {}): ConsoleTimelineEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    eventType: 'user_message',
    sessionId: 'ses-001',
    timestamp: new Date().toISOString(),
    content: 'Hello',
    ...overrides,
  }
}

const sampleMarkerOp: MapOperation = {
  type: 'add_marker',
  id: 'marker-1',
  position: [116.39, 39.9],
  title: 'Test Marker',
}

const sampleViewOp: MapOperation = {
  type: 'set_view',
  center: [116.5, 40.0],
  zoom: 12,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPanel(props: Partial<SessionMapPanelProps> = {}) {
  return render(
    <SessionMapPanel
      sessionId={props.sessionId ?? null}
      events={props.events ?? []}
      onMapClick={props.onMapClick}
    />,
  )
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SessionMapPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParseAllMapOperations.mockReturnValue([])
  })

  // =========================================================================
  // Empty state
  // =========================================================================

  describe('empty state', () => {
    it('shows "Select a session" when sessionId is null', () => {
      renderPanel({ sessionId: null })
      expect(screen.getByTestId('session-map-panel-empty')).toBeInTheDocument()
      expect(screen.getByTestId('session-map-panel-empty-text')).toHaveTextContent('Select a session')
    })

    it('does not render map when sessionId is null', () => {
      renderPanel({ sessionId: null })
      expect(screen.queryByTestId('session-map-panel')).not.toBeInTheDocument()
      expect(screen.queryByTestId('mock-amap-shared-map')).not.toBeInTheDocument()
    })
  })

  // =========================================================================
  // Map rendering
  // =========================================================================

  describe('map rendering', () => {
    it('renders map when sessionId is set', () => {
      renderPanel({ sessionId: 'ses-001' })
      expect(screen.getByTestId('session-map-panel')).toBeInTheDocument()
      expect(screen.getByTestId('mock-amap-shared-map')).toBeInTheDocument()
    })

    it('does not show empty state when sessionId is set', () => {
      renderPanel({ sessionId: 'ses-001' })
      expect(screen.queryByTestId('session-map-panel-empty')).not.toBeInTheDocument()
    })

    it('calls parseAllMapOperations with the events array', () => {
      const events = [makeEvent(), makeEvent()]
      renderPanel({ sessionId: 'ses-001', events })
      expect(mockParseAllMapOperations).toHaveBeenCalledWith(events)
    })

    it('passes derived operations to AmapSharedMap', () => {
      const ops = [sampleMarkerOp, sampleViewOp]
      mockParseAllMapOperations.mockReturnValue(ops)
      renderPanel({ sessionId: 'ses-001' })

      const mapEl = screen.getByTestId('mock-amap-shared-map')
      const opsAttr = mapEl.getAttribute('data-operations')
      expect(opsAttr).toBeTruthy()
      const parsed = JSON.parse(opsAttr!) as MapOperation[]
      expect(parsed).toHaveLength(2)
      expect(parsed[0].type).toBe('add_marker')
      expect(parsed[1].type).toBe('set_view')
    })

    it('passes empty operations when events have no map data', () => {
      mockParseAllMapOperations.mockReturnValue([])
      renderPanel({ sessionId: 'ses-001' })

      const mapEl = screen.getByTestId('mock-amap-shared-map')
      const opsAttr = mapEl.getAttribute('data-operations')
      expect(JSON.parse(opsAttr!)).toEqual([])
    })
  })

  // =========================================================================
  // Route/marker operations
  // =========================================================================

  describe('route and marker operations', () => {
    it('applies marker operations from parsed events', () => {
      const markerOps: MapOperation[] = [
        { type: 'add_marker', id: 'm1', position: [116.39, 39.9], title: 'Beijing' },
        { type: 'add_marker', id: 'm2', position: [121.47, 31.23], title: 'Shanghai' },
      ]
      mockParseAllMapOperations.mockReturnValue(markerOps)
      renderPanel({ sessionId: 'ses-001' })

      const mapEl = screen.getByTestId('mock-amap-shared-map')
      const parsed = JSON.parse(mapEl.getAttribute('data-operations')!) as MapOperation[]
      expect(parsed).toHaveLength(2)
      expect(parsed[0]).toMatchObject({ type: 'add_marker', id: 'm1' })
      expect(parsed[1]).toMatchObject({ type: 'add_marker', id: 'm2' })
    })

    it('applies route operations from parsed events', () => {
      const routeOps: MapOperation[] = [
        {
          type: 'show_route',
          id: 'route-1',
          origin: [116.39, 39.9],
          destination: [121.47, 31.23],
          originName: 'Beijing',
          destinationName: 'Shanghai',
          distance: '1200km',
          duration: '5h',
        },
      ]
      mockParseAllMapOperations.mockReturnValue(routeOps)
      renderPanel({ sessionId: 'ses-001' })

      const mapEl = screen.getByTestId('mock-amap-shared-map')
      const parsed = JSON.parse(mapEl.getAttribute('data-operations')!) as MapOperation[]
      expect(parsed).toHaveLength(1)
      expect(parsed[0]).toMatchObject({ type: 'show_route', id: 'route-1' })
    })

    it('handles mixed operation types', () => {
      const mixedOps: MapOperation[] = [
        { type: 'set_view', center: [116.39, 39.9], zoom: 10 },
        { type: 'add_marker', id: 'm1', position: [116.39, 39.9], title: 'Origin' },
        { type: 'draw_polyline', id: 'p1', path: [[116.39, 39.9], [121.47, 31.23]], color: '#3366FF' },
      ]
      mockParseAllMapOperations.mockReturnValue(mixedOps)
      renderPanel({ sessionId: 'ses-001' })

      const mapEl = screen.getByTestId('mock-amap-shared-map')
      const parsed = JSON.parse(mapEl.getAttribute('data-operations')!) as MapOperation[]
      expect(parsed).toHaveLength(3)
      expect(parsed.map((op) => op.type)).toEqual(['set_view', 'add_marker', 'draw_polyline'])
    })
  })

  // =========================================================================
  // Session switching
  // =========================================================================

  describe('session switching', () => {
    it('renders map for different sessions', () => {
      const { rerender } = render(
        <SessionMapPanel sessionId="ses-001" events={[]} />,
      )
      expect(screen.getByTestId('session-map-panel')).toBeInTheDocument()

      rerender(<SessionMapPanel sessionId="ses-002" events={[]} />)
      expect(screen.getByTestId('session-map-panel')).toBeInTheDocument()
    })

    it('re-derives operations when events change for same session', () => {
      const events1 = [makeEvent({ eventId: 'e1' })]
      const events2 = [makeEvent({ eventId: 'e1' }), makeEvent({ eventId: 'e2' })]

      const ops1: MapOperation[] = [{ type: 'add_marker', id: 'm1', position: [116.39, 39.9], title: 'A' }]
      const ops2: MapOperation[] = [
        { type: 'add_marker', id: 'm1', position: [116.39, 39.9], title: 'A' },
        { type: 'add_marker', id: 'm2', position: [121.47, 31.23], title: 'B' },
      ]

      mockParseAllMapOperations.mockReturnValueOnce(ops1).mockReturnValueOnce(ops2)

      const { rerender } = render(
        <SessionMapPanel sessionId="ses-001" events={events1} />,
      )

      let mapEl = screen.getByTestId('mock-amap-shared-map')
      expect(JSON.parse(mapEl.getAttribute('data-operations')!)).toHaveLength(1)

      rerender(<SessionMapPanel sessionId="ses-001" events={events2} />)

      mapEl = screen.getByTestId('mock-amap-shared-map')
      expect(JSON.parse(mapEl.getAttribute('data-operations')!)).toHaveLength(2)
    })

    it('shows empty state when switching from session to null', () => {
      const { rerender } = render(
        <SessionMapPanel sessionId="ses-001" events={[]} />,
      )
      expect(screen.getByTestId('session-map-panel')).toBeInTheDocument()

      rerender(<SessionMapPanel sessionId={null} events={[]} />)
      expect(screen.getByTestId('session-map-panel-empty')).toBeInTheDocument()
      expect(screen.queryByTestId('session-map-panel')).not.toBeInTheDocument()
    })

    it('shows map when switching from null to session', () => {
      const { rerender } = render(
        <SessionMapPanel sessionId={null} events={[]} />,
      )
      expect(screen.getByTestId('session-map-panel-empty')).toBeInTheDocument()

      rerender(<SessionMapPanel sessionId="ses-001" events={[]} />)
      expect(screen.queryByTestId('session-map-panel-empty')).not.toBeInTheDocument()
      expect(screen.getByTestId('session-map-panel')).toBeInTheDocument()
    })
  })

  // =========================================================================
  // onMapClick callback
  // =========================================================================

  describe('onMapClick', () => {
    it('passes onMapClick to AmapSharedMap when provided', () => {
      const handleClick = vi.fn()
      renderPanel({ sessionId: 'ses-001', onMapClick: handleClick })

      const mapEl = screen.getByTestId('mock-amap-shared-map')
      expect(mapEl.getAttribute('data-has-onclick')).toBe('true')
    })

    it('does not pass onMapClick when not provided', () => {
      renderPanel({ sessionId: 'ses-001' })

      const mapEl = screen.getByTestId('mock-amap-shared-map')
      expect(mapEl.getAttribute('data-has-onclick')).toBe('false')
    })
  })
})
