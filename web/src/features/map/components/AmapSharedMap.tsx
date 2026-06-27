/**
 * AmapSharedMap — Shared AMap component with explicit container sizing,
 * lazy loader usage, operation application, overlay tracking, and cleanup.
 *
 * Supports markers, info windows, view changes, polyline/route overlays,
 * clear operations, and selected point/marker callbacks.
 *
 * @module web/src/features/map/components/AmapSharedMap
 */

import { useEffect, useRef } from 'react'
import useAmapLoader from '../hooks/useAmapLoader'
import type { MapOperation, MapContextSnapshot, LngLat } from '../types'
import { assertNever } from '../types'
import './AmapSharedMap.css'

// ---------------------------------------------------------------------------
// Minimal AMap types covering the API surface we use
// ---------------------------------------------------------------------------

/** Minimal AMap map instance interface. */
interface AmapMapInstance {
  setCenter(center: LngLat): void
  setZoom(zoom: number): void
  add(overlay: unknown): void
  remove(overlay: unknown): void
  getCenter(): { getLng(): number; getLat(): number }
  getZoom(): number
  on(event: string, handler: (e: unknown) => void): void
  off(event: string, handler: (e: unknown) => void): void
  destroy(): void
  resize(): void
}

/** Minimal overlay with event binding. */
interface AmapOverlay {
  on?(event: string, handler: () => void): void
}

/** Minimal InfoWindow interface. */
interface AmapInfoWindow {
  open(map: unknown, position: LngLat): void
  close(): void
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AmapSharedMapProps {
  operations: MapOperation[]
  onMapClick?: (snapshot: MapContextSnapshot) => void
  onMarkerClick?: (data: unknown) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AmapSharedMap({
  operations,
  onMapClick,
  onMarkerClick,
}: AmapSharedMapProps) {
  const { amap, loading, error } = useAmapLoader()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AmapMapInstance | null>(null)
  const lastAppliedCountRef = useRef(0)

  // Overlay tracking
  const markersRef = useRef<Map<string, unknown>>(new Map())
  const polylinesRef = useRef<Map<string, unknown>>(new Map())
  const infoWindowsRef = useRef<unknown[]>([])
  const selectedPointRef = useRef<{ position: LngLat; data?: unknown } | null>(null)

  // Stable callback ref (avoids stale closures in operation handler)
  const onMarkerClickRef = useRef(onMarkerClick)
  onMarkerClickRef.current = onMarkerClick

  // --- Operation application (ref-based to avoid stale closures) ----------
  const applyOpRef = useRef<(op: MapOperation) => void>(() => {})
  applyOpRef.current = (op: MapOperation) => {
    const map = mapRef.current
    if (!map || !amap) return

    switch (op.type) {
      case 'set_view': {
        map.setCenter(op.center)
        map.setZoom(op.zoom)
        break
      }

      case 'add_marker': {
        const marker = new amap.Marker({
          position: op.position,
          title: op.title,
        })
        if (onMarkerClickRef.current) {
          const overlay = marker as unknown as AmapOverlay
          if (typeof overlay.on === 'function') {
            overlay.on('click', () => onMarkerClickRef.current!(op.data))
          }
        }
        map.add(marker)
        markersRef.current.set(op.id, marker)
        break
      }

      case 'clear_markers': {
        if (op.markerIds) {
          for (const id of op.markerIds) {
            const marker = markersRef.current.get(id)
            if (marker) {
              map.remove(marker)
              markersRef.current.delete(id)
            }
          }
        } else {
          for (const marker of markersRef.current.values()) {
            map.remove(marker)
          }
          markersRef.current.clear()
        }
        break
      }

      case 'show_info_window': {
        // Close existing info windows
        for (const iw of infoWindowsRef.current) {
          ;(iw as unknown as AmapInfoWindow).close()
        }
        infoWindowsRef.current.length = 0

        const iw = new amap.InfoWindow({
          content: op.content,
          title: op.title,
        }) as unknown as AmapInfoWindow

        iw.open(map as unknown, op.position)
        infoWindowsRef.current.push(iw)
        break
      }

      case 'draw_polyline': {
        const polyline = new amap.Polyline({
          path: op.path,
          strokeColor: op.color ?? '#3366FF',
        })
        map.add(polyline)
        polylinesRef.current.set(op.id, polyline)
        break
      }

      case 'show_route': {
        const originMarker = new amap.Marker({
          position: op.origin,
          title: op.originName,
        })
        map.add(originMarker)
        markersRef.current.set(`${op.id}-origin`, originMarker)

        const destMarker = new amap.Marker({
          position: op.destination,
          title: op.destinationName,
        })
        map.add(destMarker)
        markersRef.current.set(`${op.id}-dest`, destMarker)
        break
      }

      case 'clear_routes': {
        if (op.routeIds) {
          for (const id of op.routeIds) {
            for (const suffix of ['-origin', '-dest'] as const) {
              const marker = markersRef.current.get(`${id}${suffix}`)
              if (marker) {
                map.remove(marker)
                markersRef.current.delete(`${id}${suffix}`)
              }
            }
            const polyline = polylinesRef.current.get(id)
            if (polyline) {
              map.remove(polyline)
              polylinesRef.current.delete(id)
            }
          }
        } else {
          for (const [id, marker] of markersRef.current) {
            if (id.endsWith('-origin') || id.endsWith('-dest')) {
              map.remove(marker)
              markersRef.current.delete(id)
            }
          }
          for (const [id, polyline] of polylinesRef.current) {
            map.remove(polyline)
            polylinesRef.current.delete(id)
          }
        }
        break
      }

      case 'highlight_point': {
        const marker = new amap.Marker({
          position: op.position,
          title: op.label,
        })
        map.add(marker)
        markersRef.current.set(
          `highlight-${String(op.position[0])}_${String(op.position[1])}`,
          marker,
        )
        break
      }

      case 'set_selected_point': {
        selectedPointRef.current = { position: op.position, data: op.data }
        break
      }

      default:
        assertNever(op)
    }
  }

  // --- Map creation -------------------------------------------------------
  useEffect(() => {
    if (!amap || !containerRef.current || mapRef.current) return

    const mapInstance = new amap.Map(containerRef.current, {
      zoom: 10,
      center: [116.397428, 39.90923],
    }) as unknown as AmapMapInstance

    mapRef.current = mapInstance
    lastAppliedCountRef.current = 0

    return () => {
      mapInstance.destroy()
      mapRef.current = null
      markersRef.current.clear()
      polylinesRef.current.clear()
      infoWindowsRef.current.length = 0
      selectedPointRef.current = null
      lastAppliedCountRef.current = 0
    }
  }, [amap])

  // --- Click handler ------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !onMapClick) return

    const handler = (e: unknown) => {
      const event = e as { lnglat?: { getLng(): number; getLat(): number } }
      const center = map.getCenter()
      const zoom = map.getZoom()

      const selectedPoint =
        event?.lnglat
          ? { position: [event.lnglat.getLng(), event.lnglat.getLat()] as const }
          : selectedPointRef.current
            ? { position: selectedPointRef.current.position }
            : undefined

      const snapshot: MapContextSnapshot = {
        center: [center.getLng(), center.getLat()],
        zoom,
        ...(selectedPoint != null ? { selectedPoint } : {}),
      }

      onMapClick(snapshot)
    }

    map.on('click', handler)

    return () => {
      map.off('click', handler)
    }
  }, [onMapClick, amap])

  // --- Operation application -----------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !amap) return

    const newOps = operations.slice(lastAppliedCountRef.current)
    for (const op of newOps) {
      applyOpRef.current(op)
    }
    lastAppliedCountRef.current = operations.length
  }, [operations, amap])

  // --- ResizeObserver -----------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    const map = mapRef.current
    if (!container || !map) return

    const observer = new ResizeObserver(() => {
      map.resize()
    })

    observer.observe(container)

    return () => observer.disconnect()
  }, [amap])

  // --- Render: loading ----------------------------------------------------
  if (loading) {
    return (
      <div
        data-testid="amap-shared-map"
        className="amap-shared-map--loading"
      >
        <div
          data-testid="amap-loading-skeleton"
          className="amap-shared-map__skeleton"
        />
      </div>
    )
  }

  // --- Render: error ------------------------------------------------------
  if (error) {
    return (
      <div
        data-testid="amap-shared-map"
        className="amap-shared-map--error"
      >
        <svg
          className="amap-shared-map__error-icon"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--warm-paper-danger, #8b2c1f)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p
          data-testid="amap-error-message"
          className="amap-shared-map__error-message"
        >
          {error}
        </p>
      </div>
    )
  }

  // --- Render: not configured ---------------------------------------------
  if (!amap) {
    return (
      <div
        data-testid="amap-shared-map"
        className="amap-shared-map--empty"
      >
        <svg
          className="amap-shared-map__empty-icon"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--warm-paper-text-muted, #6b6158)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
        <p
          data-testid="amap-not-configured"
          className="amap-shared-map__empty-text"
        >
          Map not configured
        </p>
      </div>
    )
  }

  // --- Render: map container ----------------------------------------------
  return (
    <div
      data-testid="amap-shared-map"
      className="amap-shared-map"
      tabIndex={0}
    >
      <div
        ref={containerRef}
        data-testid="amap-map-container"
        className="amap-shared-map__container"
      />
    </div>
  )
}
