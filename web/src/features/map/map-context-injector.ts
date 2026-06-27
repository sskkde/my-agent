/**
 * Map Context Injector
 *
 * Formats a MapContextSnapshot into a readable text string prefixed with
 * `[Map Context]` for injection into the chat composer. All display strings
 * (POI names, addresses, route labels) are sanitized via DOMPurify before
 * inclusion.
 *
 * The `useMapContextSender` hook wraps formatting + send into a single call
 * suitable for marker-click / context-button handlers. The formatted text is
 * passed to a caller-provided `sendMessage` callback so the user can still
 * edit it in the composer before submission (no hidden auto-send).
 *
 * READ-ONLY POLICY: This module has no side-effects of its own; it delegates
 * network calls to the injected `sendMessage` callback.
 */

import { useCallback } from 'react'
import { sanitizeDisplayText } from './map-coordinates'
import type { MapContextSnapshot } from './types'

// =============================================================================
// Pure Formatter
// =============================================================================

/**
 * Format a MapContextSnapshot into a human-readable string with `[Map Context]`
 * prefix. Handles missing/undefined fields gracefully — never throws.
 *
 * Output example:
 * ```
 * [Map Context] selected point: Starbucks (116.397, 39.909); center: (116.404, 39.915); zoom: 14; route: Beijing Station → Tiananmen, distance: 5.2 km, duration: 15 min
 * ```
 */
export function formatMapContext(snapshot: MapContextSnapshot): string {
  const parts: string[] = []

  // Selected point (optional)
  if (snapshot.selectedPoint) {
    const [lng, lat] = snapshot.selectedPoint.position
    const name = snapshot.selectedPoint.name
      ? sanitizeDisplayText(snapshot.selectedPoint.name)
      : ''
    parts.push(
      name.length > 0
        ? `selected point: ${name} (${lng}, ${lat})`
        : `selected point: (${lng}, ${lat})`,
    )
  }

  // Center and zoom (always present)
  const [centerLng, centerLat] = snapshot.center
  parts.push(`center: (${centerLng}, ${centerLat})`)
  parts.push(`zoom: ${snapshot.zoom}`)

  // Current route (optional)
  if (snapshot.currentRoute) {
    const origin = sanitizeDisplayText(snapshot.currentRoute.origin)
    const destination = sanitizeDisplayText(snapshot.currentRoute.destination)
    const routeLabel =
      origin.length > 0 && destination.length > 0
        ? `${origin} → ${destination}`
        : origin.length > 0
          ? origin
          : destination.length > 0
            ? destination
            : 'unknown'

    const routeParts: string[] = [`route: ${routeLabel}`]

    if (snapshot.currentRoute.distance) {
      const dist = sanitizeDisplayText(snapshot.currentRoute.distance)
      if (dist.length > 0) routeParts.push(`distance: ${dist}`)
    }
    if (snapshot.currentRoute.duration) {
      const dur = sanitizeDisplayText(snapshot.currentRoute.duration)
      if (dur.length > 0) routeParts.push(`duration: ${dur}`)
    }

    parts.push(routeParts.join(', '))
  }

  return `[Map Context] ${parts.join('; ')}`
}

// =============================================================================
// React Hook
// =============================================================================

export interface UseMapContextSenderOptions {
  readonly sessionId: string
  readonly sendMessage: (text: string) => Promise<void>
}

export interface UseMapContextSenderReturn {
  readonly sendMapContext: (snapshot: MapContextSnapshot) => Promise<void>
}

/**
 * React hook that provides a `sendMapContext` function. When called, it
 * formats the snapshot via `formatMapContext` and passes the result to the
 * caller-supplied `sendMessage` callback.
 *
 * The `sendMessage` callback is expected to inject the text into the composer
 * draft or submit it — the hook itself does not auto-submit.
 *
 * Errors from `sendMessage` propagate to the caller; the hook does not
 * swallow them so the caller's existing error-handling (e.g.
 * `useComposerSubmission.sendError`) can surface them.
 */
export function useMapContextSender(
  options: UseMapContextSenderOptions,
): UseMapContextSenderReturn {
  const { sendMessage } = options

  const sendMapContext = useCallback(
    async (snapshot: MapContextSnapshot) => {
      const text = formatMapContext(snapshot)
      await sendMessage(text)
    },
    [sendMessage],
  )

  return { sendMapContext }
}
