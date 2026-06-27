/**
 * Shared Map Operation Types
 *
 * Pure data types for map operations derived from AMap tool timeline events.
 * These types are consumed by the map view layer to drive AMap JSAPI calls.
 *
 * READ-ONLY POLICY: These types are data contracts only. No DOM or network calls.
 */

// =============================================================================
// Coordinate Types
// =============================================================================

/** [longitude, latitude] tuple — WGS-84 / GCJ-02 depending on source */
export type LngLat = readonly [lng: number, lat: number]

// =============================================================================
// Map Operation Discriminated Union
// =============================================================================

export type MapOperationType =
  | 'set_view'
  | 'add_marker'
  | 'clear_markers'
  | 'show_info_window'
  | 'draw_polyline'
  | 'show_route'
  | 'clear_routes'
  | 'highlight_point'
  | 'set_selected_point'

export interface SetViewOperation {
  readonly type: 'set_view'
  readonly center: LngLat
  readonly zoom: number
}

export interface AddMarkerOperation {
  readonly type: 'add_marker'
  readonly id: string
  readonly position: LngLat
  readonly title: string
  readonly data?: unknown
}

export interface ClearMarkersOperation {
  readonly type: 'clear_markers'
  /** If provided, clear only these marker IDs. Otherwise clear all. */
  readonly markerIds?: readonly string[]
}

export interface ShowInfoWindowOperation {
  readonly type: 'show_info_window'
  readonly position: LngLat
  readonly content: string
  readonly title?: string
}

export interface DrawPolylineOperation {
  readonly type: 'draw_polyline'
  readonly id: string
  readonly path: readonly LngLat[]
  readonly color?: string
}

export interface ShowRouteOperation {
  readonly type: 'show_route'
  readonly id: string
  readonly origin: LngLat
  readonly destination: LngLat
  readonly originName: string
  readonly destinationName: string
  readonly distance?: string
  readonly duration?: string
}

export interface ClearRoutesOperation {
  readonly type: 'clear_routes'
  /** If provided, clear only these route IDs. Otherwise clear all. */
  readonly routeIds?: readonly string[]
}

export interface HighlightPointOperation {
  readonly type: 'highlight_point'
  readonly position: LngLat
  readonly label?: string
}

export interface SetSelectedPointOperation {
  readonly type: 'set_selected_point'
  readonly position: LngLat
  readonly data?: unknown
}

export type MapOperation =
  | SetViewOperation
  | AddMarkerOperation
  | ClearMarkersOperation
  | ShowInfoWindowOperation
  | DrawPolylineOperation
  | ShowRouteOperation
  | ClearRoutesOperation
  | HighlightPointOperation
  | SetSelectedPointOperation

// =============================================================================
// Map Context Snapshot
// =============================================================================

/** Captures the current map viewport state for context display */
export interface MapContextSnapshot {
  readonly center: LngLat
  readonly zoom: number
  readonly selectedPoint?: {
    readonly position: LngLat
    readonly name?: string
  }
  readonly currentRoute?: {
    readonly origin: string
    readonly destination: string
    readonly distance?: string
    readonly duration?: string
  }
}

// =============================================================================
// AMap Tool Result Metadata (mirrors backend safe structure)
// =============================================================================

export type AmapResultType = 'geocode' | 'poi' | 'route' | 'weather' | 'distance'

export interface AmapGeocodeEntry {
  readonly formatted_address?: string
  readonly location?: string
  readonly level?: string
  readonly province?: string
  readonly city?: string
  readonly district?: string
}

export interface AmapPoiEntry {
  readonly name?: string
  readonly location?: string
  readonly address?: string
  readonly type?: string
  readonly typecode?: string
}

export interface AmapRoutePath {
  readonly distance?: string
  readonly duration?: string
}

export interface AmapRouteData {
  readonly origin?: string
  readonly destination?: string
  readonly paths?: readonly AmapRoutePath[]
}

export interface AmapWeatherEntry {
  readonly city?: string
  readonly weather?: string
  readonly temperature?: string
  readonly winddirection?: string
  readonly windpower?: string
  readonly humidity?: string
}

export interface AmapDistanceEntry {
  readonly distance?: string
  readonly duration?: string
}

/** Discriminated union matching the backend's safe amapResult structure */
export type AmapToolResultMetadata =
  | { readonly resultType: 'geocode'; readonly geocodes: readonly AmapGeocodeEntry[] }
  | { readonly resultType: 'poi'; readonly pois: readonly AmapPoiEntry[] }
  | { readonly resultType: 'route'; readonly origin?: string; readonly destination?: string; readonly paths?: readonly AmapRoutePath[] }
  | { readonly resultType: 'weather'; readonly lives: readonly AmapWeatherEntry[] }
  | { readonly resultType: 'distance'; readonly results?: readonly AmapDistanceEntry[]; readonly distances?: unknown }

// =============================================================================
// Assertion Helper
// =============================================================================

/** Exhaustive match helper — throws at runtime if a variant is missed */
export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated union member: ${JSON.stringify(value)}`)
}
