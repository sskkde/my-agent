/**
 * SessionMapPanel — Binds timeline events to the shared AMap surface.
 *
 * Accepts a sessionId and the session's timeline events, derives MapOperation[]
 * via parseAllMapOperations(), and renders AmapSharedMap with those operations.
 *
 * On session change, the map remounts (via React key) to clear stale overlays
 * and replay the new session's operations from scratch.
 *
 * @module web/src/features/map/components/SessionMapPanel
 */

import { useMemo } from 'react'
import type { ConsoleTimelineEvent } from '../../../api/types'
import type { MapContextSnapshot } from '../types'
import { parseAllMapOperations } from '../map-event-parser'
import AmapSharedMap from './AmapSharedMap'
import './SessionMapPanel.css'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SessionMapPanelProps {
  sessionId: string | null
  events: ConsoleTimelineEvent[]
  onMapClick?: (snapshot: MapContextSnapshot) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SessionMapPanel({
  sessionId,
  events,
  onMapClick,
}: SessionMapPanelProps) {
  const operations = useMemo(() => parseAllMapOperations(events), [events])

  // Null session — show empty state
  if (sessionId === null) {
    return (
      <div
        data-testid="session-map-panel-empty"
        className="session-map-panel--empty"
      >
        <svg
          className="session-map-panel__empty-icon"
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
          data-testid="session-map-panel-empty-text"
          className="session-map-panel__empty-text"
        >
          Select a session
        </p>
      </div>
    )
  }

  // Session selected — render map with derived operations.
  // The key forces a full remount when sessionId changes, which destroys
  // the old AMap instance and replays all operations for the new session.
  return (
    <div
      data-testid="session-map-panel"
      className="session-map-panel"
    >
      <AmapSharedMap
        key={sessionId}
        operations={operations}
        onMapClick={onMapClick}
      />
    </div>
  )
}
