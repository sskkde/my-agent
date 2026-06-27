/**
 * Map Coordinate & Sanitization Utilities
 *
 * Pure helper functions shared across the map feature module.
 * No side effects, no DOM, no network calls.
 */

import DOMPurify from 'dompurify'
import type { LngLat } from './types'

// =============================================================================
// Coordinate Parsing & Validation
// =============================================================================

/** Valid longitude range: -180..180 */
const LNG_MIN = -180
const LNG_MAX = 180

/** Valid latitude range: -90..90 */
const LAT_MIN = -90
const LAT_MAX = 90

/**
 * Parse a "lng,lat" string into a validated LngLat tuple.
 * Returns undefined if the string is malformed or coordinates are out of range.
 */
export function parseLngLat(raw: string | undefined | null): LngLat | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined

  const parts = raw.split(',')
  if (parts.length !== 2) return undefined

  const lngStr = parts[0].trim()
  const latStr = parts[1].trim()
  if (lngStr.length === 0 || latStr.length === 0) return undefined

  const lng = Number(lngStr)
  const lat = Number(latStr)

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined
  if (lng < LNG_MIN || lng > LNG_MAX) return undefined
  if (lat < LAT_MIN || lat > LAT_MAX) return undefined

  return [lng, lat] as const
}

// =============================================================================
// String Sanitization
// =============================================================================

/**
 * Sanitize a display string (POI name, address, etc.) for safe rendering.
 * Strips HTML tags and dangerous content via DOMPurify.
 * Returns empty string for non-string or empty input.
 */
export function sanitizeDisplayText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (trimmed.length === 0) return ''
  return DOMPurify.sanitize(trimmed, { ALLOWED_TAGS: [] })
}
