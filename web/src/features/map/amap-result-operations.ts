/**
 * AMap Result → Operation Builders
 *
 * Pure functions that convert typed AMap result metadata into MapOperation[].
 * Extracted from map-event-parser.ts to keep files under 250 pure LOC.
 */

import type {
  AmapGeocodeEntry,
  AmapPoiEntry,
  AmapToolResultMetadata,
  LngLat,
  MapOperation,
} from './types'
import { parseLngLat, sanitizeDisplayText } from './map-coordinates'

// =============================================================================
// AmapResult Metadata Extraction
// =============================================================================

/**
 * Extract typed AmapToolResultMetadata from the raw metadata.amapResult field.
 * Returns undefined if the structure doesn't match any known result type.
 */
export function extractAmapResultMetadata(
  raw: Record<string, unknown>,
): AmapToolResultMetadata | undefined {
  const resultType = raw.resultType
  if (typeof resultType !== 'string') return undefined

  switch (resultType) {
    case 'geocode': {
      if (!Array.isArray(raw.geocodes)) return undefined
      const geocodes = raw.geocodes as Array<Record<string, unknown>>
      return {
        resultType: 'geocode',
        geocodes: geocodes.map((g) => ({
          formatted_address: typeof g.formatted_address === 'string' ? g.formatted_address : undefined,
          location: typeof g.location === 'string' ? g.location : undefined,
          level: typeof g.level === 'string' ? g.level : undefined,
          province: typeof g.province === 'string' ? g.province : undefined,
          city: typeof g.city === 'string' ? g.city : undefined,
          district: typeof g.district === 'string' ? g.district : undefined,
        })),
      }
    }

    case 'poi': {
      if (!Array.isArray(raw.pois)) return undefined
      const pois = raw.pois as Array<Record<string, unknown>>
      return {
        resultType: 'poi',
        pois: pois.map((p) => ({
          name: typeof p.name === 'string' ? p.name : undefined,
          location: typeof p.location === 'string' ? p.location : undefined,
          address: typeof p.address === 'string' ? p.address : undefined,
          type: typeof p.type === 'string' ? p.type : undefined,
          typecode: typeof p.typecode === 'string' ? p.typecode : undefined,
        })),
      }
    }

    case 'route': {
      return {
        resultType: 'route',
        origin: typeof raw.origin === 'string' ? raw.origin : undefined,
        destination: typeof raw.destination === 'string' ? raw.destination : undefined,
        paths: Array.isArray(raw.paths)
          ? (raw.paths as Array<Record<string, unknown>>).map((p) => ({
              distance: typeof p.distance === 'string' ? p.distance : undefined,
              duration: typeof p.duration === 'string' ? p.duration : undefined,
            }))
          : undefined,
      }
    }

    case 'weather': {
      if (!Array.isArray(raw.lives)) return undefined
      const lives = raw.lives as Array<Record<string, unknown>>
      return {
        resultType: 'weather',
        lives: lives.map((w) => ({
          city: typeof w.city === 'string' ? w.city : undefined,
          weather: typeof w.weather === 'string' ? w.weather : undefined,
          temperature: typeof w.temperature === 'string' ? w.temperature : undefined,
          winddirection: typeof w.winddirection === 'string' ? w.winddirection : undefined,
          windpower: typeof w.windpower === 'string' ? w.windpower : undefined,
          humidity: typeof w.humidity === 'string' ? w.humidity : undefined,
        })),
      }
    }

    case 'distance': {
      const results = Array.isArray(raw.results)
        ? (raw.results as Array<Record<string, unknown>>).map((r) => ({
            distance: typeof r.distance === 'string' ? r.distance : undefined,
            duration: typeof r.duration === 'string' ? r.duration : undefined,
          }))
        : undefined
      return {
        resultType: 'distance',
        results,
        distances: raw.distances,
      }
    }

    default:
      return undefined
  }
}

// =============================================================================
// Operation Builders (pure)
// =============================================================================

function buildMarkerId(source: string, index: number): string {
  return `marker-${source}-${index}`
}

/**
 * Build marker + set_view operations from geocode results.
 * Each geocode with a valid location produces an add_marker.
 * The first valid coordinate also produces a set_view to center the map.
 */
export function buildGeocodeOperations(
  geocodes: readonly AmapGeocodeEntry[],
  sourceId: string,
): MapOperation[] {
  const ops: MapOperation[] = []
  const markers: Array<{ position: LngLat; title: string }> = []

  for (let i = 0; i < geocodes.length; i++) {
    const entry = geocodes[i]
    const position = parseLngLat(entry.location)
    if (position === undefined) continue

    const address = sanitizeDisplayText(entry.formatted_address)
    const title = address.length > 0 ? address : 'Geocode result'

    markers.push({ position, title })
    ops.push({
      type: 'add_marker',
      id: buildMarkerId(sourceId, i),
      position,
      title,
      data: {
        province: sanitizeDisplayText(entry.province),
        city: sanitizeDisplayText(entry.city),
        district: sanitizeDisplayText(entry.district),
        level: sanitizeDisplayText(entry.level),
      },
    })
  }

  if (markers.length > 0) {
    ops.unshift({
      type: 'set_view',
      center: markers[0].position,
      zoom: 14,
    })
  }

  return ops
}

/**
 * Build marker + set_view operations from POI results.
 * Each POI with a valid location produces an add_marker.
 */
export function buildPoiOperations(
  pois: readonly AmapPoiEntry[],
  sourceId: string,
): MapOperation[] {
  const ops: MapOperation[] = []
  const markers: Array<{ position: LngLat; title: string }> = []

  for (let i = 0; i < pois.length; i++) {
    const entry = pois[i]
    const position = parseLngLat(entry.location)
    if (position === undefined) continue

    const name = sanitizeDisplayText(entry.name)
    const title = name.length > 0 ? name : 'POI'

    markers.push({ position, title })
    ops.push({
      type: 'add_marker',
      id: buildMarkerId(sourceId, i),
      position,
      title,
      data: {
        address: sanitizeDisplayText(entry.address),
        type: sanitizeDisplayText(entry.type),
        typecode: sanitizeDisplayText(entry.typecode),
      },
    })
  }

  if (markers.length > 0) {
    ops.unshift({
      type: 'set_view',
      center: markers[0].position,
      zoom: 13,
    })
  }

  return ops
}

/**
 * Build show_route operation from route result.
 * The backend provides origin/destination as coordinate strings and
 * path summaries (distance/duration) but not full polyline coordinates.
 */
export function buildRouteOperations(
  metadata: Extract<AmapToolResultMetadata, { resultType: 'route' }>,
  sourceId: string,
): MapOperation[] {
  const origin = parseLngLat(metadata.origin)
  const destination = parseLngLat(metadata.destination)

  if (origin === undefined && destination === undefined) return []

  const firstPath = metadata.paths?.[0]
  const ops: MapOperation[] = []

  if (origin !== undefined) {
    ops.push({
      type: 'add_marker',
      id: `${sourceId}-origin`,
      position: origin,
      title: 'Origin',
    })
  }

  if (destination !== undefined) {
    ops.push({
      type: 'add_marker',
      id: `${sourceId}-destination`,
      position: destination,
      title: 'Destination',
    })
  }

  if (origin !== undefined && destination !== undefined) {
    ops.push({
      type: 'show_route',
      id: `route-${sourceId}`,
      origin,
      destination,
      originName: metadata.origin ?? '',
      destinationName: metadata.destination ?? '',
      distance: sanitizeDisplayText(firstPath?.distance),
      duration: sanitizeDisplayText(firstPath?.duration),
    })

    const centerLng = (origin[0] + destination[0]) / 2
    const centerLat = (origin[1] + destination[1]) / 2
    ops.unshift({
      type: 'set_view',
      center: [centerLng, centerLat] as LngLat,
      zoom: 10,
    })
  }

  return ops
}
