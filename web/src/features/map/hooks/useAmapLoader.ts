/**
 * AMap JSAPI loader hook.
 *
 * Wraps `@amap/amap-jsapi-loader` with:
 * - Automatic `window._AMapSecurityConfig` setup (AMap requirement)
 * - Mock mode: returns a lightweight mock AMap namespace with constructor tracking
 * - Unmount-safe cleanup (no state updates after unmount)
 *
 * Does NOT instantiate a map — map instance lifecycle belongs in the component.
 *
 * @module web/src/features/map/hooks/useAmapLoader
 */

import { useState, useEffect, useRef } from 'react'
import { getAmapConfig, isAmapMockMode } from '../../../config/amap'
import { load as loadAmap } from '@amap/amap-jsapi-loader'

/**
 * Minimal AMap namespace type covering the constructor surface we use.
 * Matches what `@amap/amap-jsapi-loader` resolves with.
 */
export interface AmapNamespace {
  Map: new (container: string | HTMLElement, options?: Record<string, unknown>) => unknown
  Marker: new (options?: Record<string, unknown>) => unknown
  Polyline: new (options?: Record<string, unknown>) => unknown
  InfoWindow: new (options?: Record<string, unknown>) => unknown
  [key: string]: unknown
}

export interface UseAmapLoaderOptions {
  plugins?: string[]
}

export interface UseAmapLoaderReturn {
  amap: AmapNamespace | null
  loading: boolean
  error: string | null
}

/* ==========================================================================
   Mock AMap namespace — used when isAmapMockMode() is true.
   Constructors track every call for test assertions.
   ========================================================================== */

/** Mock instance tracking — exported for test assertions. */
export const mockAmapInstances: Record<string, unknown[][]> = {
  Map: [],
  Marker: [],
  Polyline: [],
  InfoWindow: [],
}

/** Reset all mock instance trackers. Call in test `beforeEach`. */
export function resetMockAmapInstances(): void {
  mockAmapInstances.Map.length = 0
  mockAmapInstances.Marker.length = 0
  mockAmapInstances.Polyline.length = 0
  mockAmapInstances.InfoWindow.length = 0
}

function createMockMapConstructor() {
  return class MockMap {
    constructor(container: string | HTMLElement, options?: Record<string, unknown>) {
      mockAmapInstances.Map.push([container, options])
    }
    setCenter(_center: unknown): void {}
    setZoom(_zoom: number): void {}
    add(_overlay: unknown): void {}
    remove(_overlay: unknown): void {}
    getCenter(): { getLng(): number; getLat(): number } {
      return { getLng: () => 116.397, getLat: () => 39.909 }
    }
    getZoom(): number {
      return 10
    }
    on(_event: string, _handler: unknown): void {}
    off(_event: string, _handler: unknown): void {}
    destroy(): void {}
    resize(): void {}
  }
}

function createMockOptionsConstructor(name: 'Marker' | 'Polyline' | 'InfoWindow') {
  return class {
    constructor(options?: Record<string, unknown>) {
      mockAmapInstances[name].push([options])
    }
    on(_event: string, _handler: unknown): void {}
    open(_map: unknown, _position: unknown): void {}
    close(): void {}
  }
}

function createMockAmap(): AmapNamespace {
  return {
    Map: createMockMapConstructor(),
    Marker: createMockOptionsConstructor('Marker'),
    Polyline: createMockOptionsConstructor('Polyline'),
    InfoWindow: createMockOptionsConstructor('InfoWindow'),
  } as AmapNamespace
}

/* ==========================================================================
   Hook
   ========================================================================== */

/**
 * Loads the AMap JSAPI and exposes loading/error/AMap states.
 *
 * In mock mode (`isAmapMockMode()` returns true), returns a mock AMap
 * namespace without any network calls.
 *
 * @param options.plugins - AMap plugins to load (e.g. `['AMap.Scale']`)
 * @returns `{ amap, loading, error }`
 */
export default function useAmapLoader(options: UseAmapLoaderOptions = {}): UseAmapLoaderReturn {
  const [amap, setAmap] = useState<AmapNamespace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Stable ref so the effect reads the latest plugins without re-running on
  // reference changes; `pluginsKey` (stringified) drives re-runs.
  const pluginsRef = useRef(options.plugins)
  pluginsRef.current = options.plugins
  const pluginsKey = JSON.stringify(options.plugins ?? null)

  useEffect(() => {
    let cancelled = false

    // --- Mock mode: no network, return mock AMap namespace ---
    if (isAmapMockMode()) {
      setAmap(createMockAmap())
      setLoading(false)
      setError(null)
      return () => {
        cancelled = true
      }
    }

    // --- Real mode ---
    const config = getAmapConfig()
    if (!config) {
      setAmap(null)
      setLoading(false)
      setError('AMap JSAPI key not configured')
      return () => {
        cancelled = true
      }
    }

    // Set security config BEFORE loading (AMap JSAPI requirement).
    if (config.securityJsCode) {
      ;(window as unknown as Record<string, unknown>)._AMapSecurityConfig = {
        securityJsCode: config.securityJsCode,
      }
    }

    setLoading(true)
    setError(null)

    const loadOptions: Parameters<typeof loadAmap>[0] = {
      key: config.key,
      version: config.version,
    }
    if (pluginsRef.current && pluginsRef.current.length > 0) {
      loadOptions.plugins = pluginsRef.current
    }

    loadAmap(loadOptions).then(
      (loadedAmap) => {
        if (!cancelled) {
          setAmap(loadedAmap)
          setLoading(false)
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load AMap JSAPI'
          setError(message)
          setAmap(null)
          setLoading(false)
        }
      },
    )

    return () => {
      cancelled = true
    }
    // `pluginsKey` is a stable string representation of the plugins array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginsKey])

  return { amap, loading, error }
}
