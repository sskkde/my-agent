/**
 * Tests for AmapSharedMap component.
 *
 * All AMap interactions are fully mocked — no live network calls.
 * Uses mockAmapInstances / resetMockAmapInstances from the loader hook for cleanup.
 */

import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../hooks/useAmapLoader', () => ({
  default: vi.fn(),
}))

import useAmapLoader from '../hooks/useAmapLoader'
import AmapSharedMap from './AmapSharedMap'
import type { AmapSharedMapProps } from './AmapSharedMap'
import type { MapOperation } from '../types'

const mockUseAmapLoader = vi.mocked(useAmapLoader)

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockMapInstance {
  setCenter: ReturnType<typeof vi.fn>
  setZoom: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  getCenter: ReturnType<typeof vi.fn>
  getZoom: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
}

function createMockMapInstance(): MockMapInstance {
  return {
    setCenter: vi.fn(),
    setZoom: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    getCenter: vi.fn().mockReturnValue({
      getLng: vi.fn().mockReturnValue(116.39),
      getLat: vi.fn().mockReturnValue(39.9),
    }),
    getZoom: vi.fn().mockReturnValue(10),
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
    resize: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// ResizeObserver mock (jsdom does not provide it)
// ---------------------------------------------------------------------------

let mockObserve: ReturnType<typeof vi.fn>
let mockDisconnect: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockObserve = vi.fn()
  mockDisconnect = vi.fn()
  window.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: mockObserve,
    disconnect: mockDisconnect,
    unobserve: vi.fn(),
  }))
})

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).ResizeObserver
})

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AmapSharedMap', () => {
  let mockMap: MockMapInstance
  let mockMapConstructor: ReturnType<typeof vi.fn>
  let mockMarkerConstructor: ReturnType<typeof vi.fn>
  let mockPolylineConstructor: ReturnType<typeof vi.fn>
  let mockInfoWindowConstructor: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    mockMap = createMockMapInstance()
    mockMapConstructor = vi.fn().mockReturnValue(mockMap)

    mockMarkerConstructor = vi.fn().mockImplementation((opts) => ({
      ...opts,
      on: vi.fn(),
      off: vi.fn(),
    }))

    mockPolylineConstructor = vi.fn().mockImplementation((opts) => ({
      ...opts,
    }))

    mockInfoWindowConstructor = vi.fn().mockImplementation((opts) => ({
      ...opts,
      open: vi.fn(),
      close: vi.fn(),
    }))

    mockUseAmapLoader.mockReturnValue({
      amap: {
        Map: mockMapConstructor,
        Marker: mockMarkerConstructor,
        Polyline: mockPolylineConstructor,
        InfoWindow: mockInfoWindowConstructor,
      },
      loading: false,
      error: null,
    })
  })

  function renderMap(props: Partial<AmapSharedMapProps> = {}) {
    return render(
      <AmapSharedMap
        operations={props.operations ?? []}
        onMapClick={props.onMapClick}
        onMarkerClick={props.onMarkerClick}
      />,
    )
  }

  // =========================================================================
  // Rendering states
  // =========================================================================

  describe('rendering states', () => {
    it('shows loading skeleton while loading', () => {
      mockUseAmapLoader.mockReturnValue({ amap: null, loading: true, error: null })
      render(<AmapSharedMap operations={[]} />)
      expect(screen.getByTestId('amap-loading-skeleton')).toBeInTheDocument()
    })

    it('shows error panel on error', () => {
      mockUseAmapLoader.mockReturnValue({ amap: null, loading: false, error: 'Failed to load AMap' })
      render(<AmapSharedMap operations={[]} />)
      expect(screen.getByTestId('amap-error-message')).toHaveTextContent('Failed to load AMap')
    })

    it('shows "Map not configured" when amap is null and not loading', () => {
      mockUseAmapLoader.mockReturnValue({ amap: null, loading: false, error: null })
      render(<AmapSharedMap operations={[]} />)
      expect(screen.getByTestId('amap-not-configured')).toHaveTextContent('Map not configured')
    })

    it('renders map container when amap is available', () => {
      renderMap()
      expect(screen.getByTestId('amap-map-container')).toBeInTheDocument()
    })
  })

  // =========================================================================
  // Map creation
  // =========================================================================

  describe('map creation', () => {
    it('creates map constructor once', () => {
      renderMap()
      expect(mockMapConstructor).toHaveBeenCalledTimes(1)
    })

    it('creates map with default center and zoom', () => {
      renderMap()
      expect(mockMapConstructor).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        expect.objectContaining({ zoom: 10, center: [116.397428, 39.90923] }),
      )
    })
  })

  // =========================================================================
  // Operations
  // =========================================================================

  describe('operations', () => {
    it('set_view calls setCenter and setZoom', () => {
      renderMap({
        operations: [
          { type: 'set_view', center: [116.5, 40.0], zoom: 12 },
        ],
      })
      expect(mockMap.setCenter).toHaveBeenCalledWith([116.5, 40.0])
      expect(mockMap.setZoom).toHaveBeenCalledWith(12)
    })

    it('add_marker creates marker and adds to map', () => {
      renderMap({
        operations: [
          { type: 'add_marker', id: 'm1', position: [116.39, 39.9], title: 'Test Marker' },
        ],
      })
      expect(mockMarkerConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ position: [116.39, 39.9], title: 'Test Marker' }),
      )
      expect(mockMap.add).toHaveBeenCalledTimes(1)
    })

    it('add_marker with onMarkerClick binds click handler', () => {
      const onMarkerClick = vi.fn()
      renderMap({
        operations: [
          { type: 'add_marker', id: 'm1', position: [116.39, 39.9], title: 'M1', data: 'marker-data' },
        ],
        onMarkerClick,
      })

      const markerInstance = mockMarkerConstructor.mock.results[0].value
      expect(markerInstance.on).toHaveBeenCalledWith('click', expect.any(Function))

      // Fire the click handler
      const clickHandler = markerInstance.on.mock.calls.find(
        ([event]: [string]) => event === 'click',
      )?.[1]
      clickHandler()

      expect(onMarkerClick).toHaveBeenCalledWith('marker-data')
    })

    it('clear_markers removes all tracked markers', () => {
      const { rerender } = renderMap({
        operations: [
          { type: 'add_marker', id: 'm1', position: [116.39, 39.9], title: 'M1' },
          { type: 'add_marker', id: 'm2', position: [116.40, 39.91], title: 'M2' },
        ],
      })
      expect(mockMap.add).toHaveBeenCalledTimes(2)

      rerender(
        <AmapSharedMap
          operations={[
            { type: 'add_marker', id: 'm1', position: [116.39, 39.9], title: 'M1' },
            { type: 'add_marker', id: 'm2', position: [116.40, 39.91], title: 'M2' },
            { type: 'clear_markers' },
          ]}
        />,
      )

      expect(mockMap.remove).toHaveBeenCalledTimes(2)
    })

    it('clear_markers with markerIds removes only specified markers', () => {
      const { rerender } = renderMap({
        operations: [
          { type: 'add_marker', id: 'm1', position: [116.39, 39.9], title: 'M1' },
          { type: 'add_marker', id: 'm2', position: [116.40, 39.91], title: 'M2' },
        ],
      })

      rerender(
        <AmapSharedMap
          operations={[
            { type: 'add_marker', id: 'm1', position: [116.39, 39.9], title: 'M1' },
            { type: 'add_marker', id: 'm2', position: [116.40, 39.91], title: 'M2' },
            { type: 'clear_markers', markerIds: ['m1'] },
          ]}
        />,
      )

      expect(mockMap.remove).toHaveBeenCalledTimes(1)
    })

    it('show_info_window creates info window and opens on map', () => {
      renderMap({
        operations: [
          { type: 'show_info_window', position: [116.39, 39.9], content: '<p>Hello</p>', title: 'Info' },
        ],
      })

      expect(mockInfoWindowConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ content: '<p>Hello</p>', title: 'Info' }),
      )

      const iwInstance = mockInfoWindowConstructor.mock.results[0].value
      expect(iwInstance.open).toHaveBeenCalled()
    })

    it('show_info_window closes previous info window before opening new one', () => {
      const { rerender } = renderMap({
        operations: [
          { type: 'show_info_window', position: [116.39, 39.9], content: 'First' },
        ],
      })

      const firstIw = mockInfoWindowConstructor.mock.results[0].value

      rerender(
        <AmapSharedMap
          operations={[
            { type: 'show_info_window', position: [116.39, 39.9], content: 'First' },
            { type: 'show_info_window', position: [116.40, 39.91], content: 'Second' },
          ]}
        />,
      )

      expect(firstIw.close).toHaveBeenCalled()
      expect(mockInfoWindowConstructor).toHaveBeenCalledTimes(2)
    })

    it('draw_polyline creates polyline and adds to map', () => {
      renderMap({
        operations: [
          {
            type: 'draw_polyline',
            id: 'p1',
            path: [[116.39, 39.9], [116.40, 39.91]],
            color: '#FF0000',
          },
        ],
      })

      expect(mockPolylineConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          path: [[116.39, 39.9], [116.40, 39.91]],
          strokeColor: '#FF0000',
        }),
      )
      expect(mockMap.add).toHaveBeenCalledTimes(1)
    })

    it('draw_polyline uses default color when none specified', () => {
      renderMap({
        operations: [
          {
            type: 'draw_polyline',
            id: 'p1',
            path: [[116.39, 39.9], [116.40, 39.91]],
          },
        ],
      })

      expect(mockPolylineConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ strokeColor: '#3366FF' }),
      )
    })

    it('show_route creates origin and destination markers', () => {
      renderMap({
        operations: [
          {
            type: 'show_route',
            id: 'r1',
            origin: [116.39, 39.9],
            destination: [116.40, 39.91],
            originName: 'Beijing',
            destinationName: 'Shanghai',
          },
        ],
      })

      expect(mockMarkerConstructor).toHaveBeenCalledTimes(2)
      expect(mockMarkerConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ position: [116.39, 39.9], title: 'Beijing' }),
      )
      expect(mockMarkerConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ position: [116.40, 39.91], title: 'Shanghai' }),
      )
      expect(mockMap.add).toHaveBeenCalledTimes(2)
    })

    it('clear_routes removes route markers', () => {
      const { rerender } = renderMap({
        operations: [
          {
            type: 'show_route',
            id: 'r1',
            origin: [116.39, 39.9],
            destination: [116.40, 39.91],
            originName: 'A',
            destinationName: 'B',
          },
        ],
      })
      expect(mockMap.add).toHaveBeenCalledTimes(2)

      rerender(
        <AmapSharedMap
          operations={[
            {
              type: 'show_route',
              id: 'r1',
              origin: [116.39, 39.9],
              destination: [116.40, 39.91],
              originName: 'A',
              destinationName: 'B',
            },
            { type: 'clear_routes' },
          ]}
        />,
      )

      expect(mockMap.remove).toHaveBeenCalledTimes(2)
    })

    it('clear_routes with routeIds removes only specified routes', () => {
      const { rerender } = renderMap({
        operations: [
          {
            type: 'show_route',
            id: 'r1',
            origin: [116.39, 39.9],
            destination: [116.40, 39.91],
            originName: 'A',
            destinationName: 'B',
          },
          {
            type: 'show_route',
            id: 'r2',
            origin: [116.41, 39.92],
            destination: [116.42, 39.93],
            originName: 'C',
            destinationName: 'D',
          },
        ],
      })

      rerender(
        <AmapSharedMap
          operations={[
            {
              type: 'show_route',
              id: 'r1',
              origin: [116.39, 39.9],
              destination: [116.40, 39.91],
              originName: 'A',
              destinationName: 'B',
            },
            {
              type: 'show_route',
              id: 'r2',
              origin: [116.41, 39.92],
              destination: [116.42, 39.93],
              originName: 'C',
              destinationName: 'D',
            },
            { type: 'clear_routes', routeIds: ['r1'] },
          ]}
        />,
      )

      // Only r1 markers removed (origin + dest = 2)
      expect(mockMap.remove).toHaveBeenCalledTimes(2)
    })

    it('highlight_point creates a marker at the position', () => {
      renderMap({
        operations: [
          { type: 'highlight_point', position: [116.39, 39.9], label: 'Highlighted' },
        ],
      })

      expect(mockMarkerConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ position: [116.39, 39.9], title: 'Highlighted' }),
      )
      expect(mockMap.add).toHaveBeenCalledTimes(1)
    })

    it('set_selected_point stores selected point data', () => {
      const onMapClick = vi.fn()
      renderMap({
        operations: [
          { type: 'set_selected_point', position: [116.39, 39.9], data: 'point-data' },
        ],
        onMapClick,
      })

      // Get the click handler registered on the map
      const clickCall = mockMap.on.mock.calls.find(
        ([event]: [string]) => event === 'click',
      )
      expect(clickCall).toBeDefined()

      const handler = clickCall![1]

      // Fire click without lnglat — should use stored selected point
      act(() => {
        handler({})
      })

      expect(onMapClick).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedPoint: { position: [116.39, 39.9] },
        }),
      )
    })
  })

  // =========================================================================
  // Click callback
  // =========================================================================

  describe('click callback', () => {
    it('returns coordinate context with click position', () => {
      const onMapClick = vi.fn()
      renderMap({ onMapClick })

      // Find the click handler registered on the map
      const clickCall = mockMap.on.mock.calls.find(
        ([event]: [string]) => event === 'click',
      )
      expect(clickCall).toBeDefined()

      const handler = clickCall![1]

      // Fire the click handler with a mock AMap event
      act(() => {
        handler({
          lnglat: {
            getLng: vi.fn().mockReturnValue(116.5),
            getLat: vi.fn().mockReturnValue(40.0),
          },
        })
      })

      expect(onMapClick).toHaveBeenCalledWith({
        center: [116.39, 39.9],
        zoom: 10,
        selectedPoint: {
          position: [116.5, 40.0],
        },
      })
    })

    it('returns context without selectedPoint when no lnglat and no stored point', () => {
      const onMapClick = vi.fn()
      renderMap({ onMapClick })

      const clickCall = mockMap.on.mock.calls.find(
        ([event]: [string]) => event === 'click',
      )
      const handler = clickCall![1]

      act(() => {
        handler({})
      })

      expect(onMapClick).toHaveBeenCalledWith({
        center: [116.39, 39.9],
        zoom: 10,
      })
    })

    it('does not register click handler when onMapClick is not provided', () => {
      renderMap()
      expect(mockMap.on).not.toHaveBeenCalledWith('click', expect.any(Function))
    })
  })

  // =========================================================================
  // Cleanup
  // =========================================================================

  describe('cleanup', () => {
    it('calls destroy() exactly once on unmount', () => {
      const { unmount } = renderMap()
      unmount()
      expect(mockMap.destroy).toHaveBeenCalledTimes(1)
    })

    it('disconnects ResizeObserver on unmount', () => {
      const { unmount } = renderMap()
      unmount()
      expect(mockDisconnect).toHaveBeenCalled()
    })

    it('removes click handler on unmount', () => {
      const onMapClick = vi.fn()
      const { unmount } = renderMap({ onMapClick })

      // Verify click handler was registered
      expect(mockMap.on).toHaveBeenCalledWith('click', expect.any(Function))

      unmount()

      // Verify off was called (cleanup removes the handler)
      expect(mockMap.off).toHaveBeenCalledWith('click', expect.any(Function))
    })
  })

  // =========================================================================
  // ResizeObserver
  // =========================================================================

  describe('ResizeObserver', () => {
    it('observes the map container', () => {
      renderMap()
      expect(mockObserve).toHaveBeenCalledWith(expect.any(HTMLElement))
    })

    it('calls map.resize on resize', () => {
      renderMap()

      // Get the ResizeObserver callback
      const resizeCallback = (window.ResizeObserver as ReturnType<typeof vi.fn>).mock.calls[0][0]

      // Simulate resize
      resizeCallback()

      expect(mockMap.resize).toHaveBeenCalled()
    })
  })
})
