/**
 * AMap E2E Test Harness
 *
 * Standalone React app that renders SessionMapPanel with mock timeline data.
 * Used by Playwright E2E tests to verify the full AMap shared map flow:
 *   session → map render → context capture → send → session switch cleanup
 *
 * No real AMap JSAPI calls (mock mode activates automatically when
 * VITE_AMAP_JSAPI_KEY is not set).
 *
 * @module web/src/amap-e2e-main
 */

import { useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import SessionMapPanel from './features/map/components/SessionMapPanel'
import { formatMapContext } from './features/map/map-context-injector'
import type { ConsoleTimelineEvent } from './api/types'
import type { MapContextSnapshot } from './features/map/types'

// ---------------------------------------------------------------------------
// Mock timeline events with AMap tool result metadata
// ---------------------------------------------------------------------------

/** Session A: geocode + POI + route results */
const SESSION_A_EVENTS: ConsoleTimelineEvent[] = [
  {
    eventId: 'evt-geocode-1',
    eventType: 'tool_result',
    sessionId: 'session-a',
    timestamp: '2026-01-01T00:00:00Z',
    content: 'Geocode result for Beijing Railway Station',
    metadata: {
      toolName: 'mcp.amap-maps.amap_geocode',
      amapToolNames: ['amap_geocode'],
      amapResult: {
        resultType: 'geocode',
        geocodes: [
          {
            formatted_address: 'Beijing Railway Station',
            location: '116.427,39.903',
            level: 'poi',
            province: 'Beijing',
            city: 'Beijing',
            district: 'Dongcheng',
          },
        ],
      },
    },
  },
  {
    eventId: 'evt-poi-1',
    eventType: 'tool_result',
    sessionId: 'session-a',
    timestamp: '2026-01-01T00:01:00Z',
    content: 'POI search results for coffee shops',
    metadata: {
      toolName: 'mcp.amap-maps.amap_poi_search',
      amapToolNames: ['amap_poi_search'],
      amapResult: {
        resultType: 'poi',
        pois: [
          {
            name: 'Starbucks Wangfujing',
            location: '116.407,39.914',
            address: '138 Wangfujing Street',
            type: 'cafe',
            typecode: '050301',
          },
          {
            name: 'Costa Coffee Dongzhimen',
            location: '116.434,39.942',
            address: '28 Dongzhimen Outer Street',
            type: 'cafe',
            typecode: '050301',
          },
        ],
      },
    },
  },
  {
    eventId: 'evt-route-1',
    eventType: 'tool_result',
    sessionId: 'session-a',
    timestamp: '2026-01-01T00:02:00Z',
    content: 'Driving route from Beijing Station to Wangfujing',
    metadata: {
      toolName: 'mcp.amap-maps.amap_direction_driving',
      amapToolNames: ['amap_direction_driving'],
      amapResult: {
        resultType: 'route',
        origin: '116.427,39.903',
        destination: '116.407,39.914',
        paths: [{ distance: '3200', duration: '600' }],
      },
    },
  },
  {
    eventId: 'evt-weather-1',
    eventType: 'tool_result',
    sessionId: 'session-a',
    timestamp: '2026-01-01T00:03:00Z',
    content: 'Weather in Beijing',
    metadata: {
      toolName: 'mcp.amap-maps.amap_weather',
      amapToolNames: ['amap_weather'],
      amapResult: {
        resultType: 'weather',
        lives: [{ city: 'Beijing', weather: 'Clear', temperature: '22' }],
      },
    },
  },
]

/** Session B: only a geocode result (different location) */
const SESSION_B_EVENTS: ConsoleTimelineEvent[] = [
  {
    eventId: 'evt-geocode-2',
    eventType: 'tool_result',
    sessionId: 'session-b',
    timestamp: '2026-01-02T00:00:00Z',
    content: 'Geocode result for Tiananmen Square',
    metadata: {
      toolName: 'mcp.amap-maps.amap_geocode',
      amapToolNames: ['amap_geocode'],
      amapResult: {
        resultType: 'geocode',
        geocodes: [
          {
            formatted_address: 'Tiananmen Square, Beijing',
            location: '116.397,39.908',
            level: 'poi',
          },
        ],
      },
    },
  },
]

/** Session C: empty — no AMap events */
const SESSION_C_EVENTS: ConsoleTimelineEvent[] = [
  {
    eventId: 'evt-user-1',
    eventType: 'user_message',
    sessionId: 'session-c',
    timestamp: '2026-01-03T00:00:00Z',
    content: 'Hello, no map data here.',
  },
]

// ---------------------------------------------------------------------------
// Test Harness Component
// ---------------------------------------------------------------------------

function TestHarness() {
  const [activeSession, setActiveSession] = useState<'a' | 'b' | 'c'>('a')
  const [contextSnapshot, setContextSnapshot] = useState<MapContextSnapshot | null>(null)
  const [sentMessages, setSentMessages] = useState<string[]>([])

  const sessionId =
    activeSession === 'a'
      ? 'session-a'
      : activeSession === 'b'
        ? 'session-b'
        : 'session-c'

  const events =
    activeSession === 'a'
      ? SESSION_A_EVENTS
      : activeSession === 'b'
        ? SESSION_B_EVENTS
        : SESSION_C_EVENTS

  const handleMapClick = useCallback((snapshot: MapContextSnapshot) => {
    setContextSnapshot(snapshot)
  }, [])

  const handleSimulateMapClick = useCallback(() => {
    const snapshot: MapContextSnapshot = {
      center: [116.407, 39.914],
      zoom: 14,
      selectedPoint: {
        position: [116.407, 39.914],
        name: 'Starbucks Wangfujing',
      },
      currentRoute: {
        origin: 'Beijing Railway Station',
        destination: 'Wangfujing',
        distance: '3.2 km',
        duration: '10 min',
      },
    }
    setContextSnapshot(snapshot)
  }, [])

  const handleSendContext = useCallback(() => {
    if (contextSnapshot) {
      const text = formatMapContext(contextSnapshot)
      setSentMessages((prev) => [...prev, text])
      setContextSnapshot(null)
    }
  }, [contextSnapshot])

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 data-testid="harness-title">AMap E2E Test Harness</h1>

      {/* Session switcher */}
      <div data-testid="session-switcher" style={{ marginBottom: 16 }}>
        <button
          data-testid="switch-session-a"
          onClick={() => setActiveSession('a')}
          style={{ fontWeight: activeSession === 'a' ? 'bold' : 'normal', marginRight: 8 }}
        >
          Session A (geocode+POI+route)
        </button>
        <button
          data-testid="switch-session-b"
          onClick={() => setActiveSession('b')}
          style={{ fontWeight: activeSession === 'b' ? 'bold' : 'normal', marginRight: 8 }}
        >
          Session B (geocode only)
        </button>
        <button
          data-testid="switch-session-c"
          onClick={() => setActiveSession('c')}
          style={{ fontWeight: activeSession === 'c' ? 'bold' : 'normal', marginRight: 8 }}
        >
          Session C (no map data)
        </button>
        <span data-testid="active-session-id" style={{ marginLeft: 8 }}>
          {sessionId}
        </span>
      </div>

      {/* Map panel */}
      <div data-testid="map-panel-wrapper" style={{ marginBottom: 16 }}>
        <SessionMapPanel
          sessionId={sessionId}
          events={events}
          onMapClick={handleMapClick}
        />
      </div>

      {/* Context interaction */}
      <div data-testid="context-section" style={{ marginBottom: 16 }}>
        <h2>Context</h2>
        <button
          data-testid="simulate-map-click"
          onClick={handleSimulateMapClick}
          style={{ marginRight: 8 }}
        >
          Simulate Map Click
        </button>
        <button
          data-testid="send-context-btn"
          onClick={handleSendContext}
          disabled={contextSnapshot === null}
        >
          Send Map Context
        </button>
        <pre
          data-testid="context-snapshot"
          style={{ background: '#f5f5f5', padding: 8, marginTop: 8 }}
        >
          {contextSnapshot ? JSON.stringify(contextSnapshot, null, 2) : 'No context captured'}
        </pre>
      </div>

      {/* Sent messages */}
      <div data-testid="messages-section">
        <h2>Sent Messages ({sentMessages.length})</h2>
        <ul data-testid="sent-messages">
          {sentMessages.map((msg, i) => (
            <li key={i} data-testid="sent-message">
              {msg}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<TestHarness />)
}
