/**
 * Map Event Parser
 *
 * Pure functions that convert enriched AMap timeline events into MapOperation[].
 * No side effects, no DOM, no network calls.
 *
 * The backend enriches `tool_result` events with `metadata.amapResult` containing
 * safe parsed fields (resultType, geocodes/pois/route/weather/distance).
 * This parser converts those into the discriminated MapOperation union.
 */

import type { ConsoleTimelineEvent } from '../../api/types'
import type { MapOperation } from './types'
import {
  extractAmapResultMetadata,
  buildGeocodeOperations,
  buildPoiOperations,
  buildRouteOperations,
} from './amap-result-operations'

export { parseLngLat, sanitizeDisplayText } from './map-coordinates'

// =============================================================================
// Main Parser
// =============================================================================

/**
 * Parse a ConsoleTimelineEvent with AMap metadata into MapOperation[].
 *
 * Returns an empty array if:
 * - The event is not a tool_result
 * - No metadata.amapResult is present
 * - The result type is weather or distance (no map display)
 * - All coordinates are invalid
 */
export function parseMapOperations(event: ConsoleTimelineEvent): MapOperation[] {
  if (event.eventType !== 'tool_result') return []

  const metadata = event.metadata
  if (metadata === undefined || metadata === null) return []

  const amapResult = metadata.amapResult
  if (amapResult === null || typeof amapResult !== 'object' || Array.isArray(amapResult)) {
    return []
  }

  const typed = extractAmapResultMetadata(amapResult as Record<string, unknown>)
  if (typed === undefined) return []

  const sourceId = event.eventId

  switch (typed.resultType) {
    case 'geocode':
      return buildGeocodeOperations(typed.geocodes, sourceId)

    case 'poi':
      return buildPoiOperations(typed.pois, sourceId)

    case 'route':
      return buildRouteOperations(typed, sourceId)

    // Weather and distance have no map display operations
    case 'weather':
    case 'distance':
      return []

    default:
      return []
  }
}

/**
 * Parse multiple timeline events into a flat list of MapOperation[].
 * Skips events without AMap metadata.
 */
export function parseAllMapOperations(events: readonly ConsoleTimelineEvent[]): MapOperation[] {
  const ops: MapOperation[] = []
  for (const event of events) {
    ops.push(...parseMapOperations(event))
  }
  return ops
}
