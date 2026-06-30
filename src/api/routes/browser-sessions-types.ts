// API-facing types for the browser-sessions routes.
//
// These types model the wire contract exposed by the `/api/v1/browser-sessions`
// endpoints. They are intentionally narrower than the internal domain types in
// `src/search/browser/browser-session-types.ts`:
//
//   - `BrowserSessionState` collapses the 6 internal `OwnershipState` values
//     into the 4 states the API surface advertises (see `mapOwnershipToState`
//     in `browser-sessions-helpers.ts`).
//   - The SSE event union (`BrowserStreamEvent`) is what the frame stream
//     serializes onto the wire; it is not the same shape as the internal
//     `FrameMeta` + `Buffer` pair the frame stream emits.
//
// Route handlers MUST parse inbound JSON into these types (or into the domain
// `BrowserInputEvent` via `mapRouteInputToEvent`) before touching internal
// services. Unparsed `unknown` never crosses the route boundary.

// ─── API session state ───────────────────────────────────────────────────────

/**
 * The ownership state of a browser session as exposed on the API wire.
 *
 * Mapping from the internal `OwnershipState` (6 states) is performed by
 * `mapOwnershipToState`:
 *   - `agent_controlled`, `resuming` → `agent_controlled`
 *   - `handoff_requested`            → `handoff_requested`
 *   - `human_controlled`             → `user_controlled`
 *   - `closed`, `error`              → `idle`
 */
export type BrowserSessionState =
  | 'idle'
  | 'agent_controlled'
  | 'user_controlled'
  | 'handoff_requested'

// ─── SSE stream events ───────────────────────────────────────────────────────

/**
 * Initial snapshot emitted when a client opens the frame SSE stream.
 */
export interface BrowserSnapshotEvent {
  readonly type: 'snapshot'
  readonly state: BrowserSessionState
  readonly url: string | null
  readonly timestamp: string
}

/**
 * A single captured frame, base64-encoded, with capture metadata.
 */
export interface BrowserFrameEvent {
  readonly type: 'frame'
  readonly data: string
  readonly timestamp: string
  readonly width: number
  readonly height: number
}

/**
 * Keep-alive heartbeat sent periodically on the SSE stream.
 */
export interface BrowserHeartbeatEvent {
  readonly type: 'heartbeat'
  readonly timestamp: string
}

/**
 * Union of all events that may appear on the `/frames` SSE stream.
 */
export type BrowserStreamEvent =
  | BrowserSnapshotEvent
  | BrowserFrameEvent
  | BrowserHeartbeatEvent

// ─── Response bodies ─────────────────────────────────────────────────────────

export interface BrowserStatusResponse {
  readonly sessionId: string
  readonly state: BrowserSessionState
  readonly url: string | null
  readonly lastActivityAt: string | null
  readonly viewport: { readonly width: number; readonly height: number } | null
}

export interface BrowserTakeoverResponse {
  readonly sessionId: string
  readonly state: BrowserSessionState
  readonly previousState: BrowserSessionState
}

/**
 * Release response is structurally identical to the takeover response.
 */
export type BrowserReleaseResponse = BrowserTakeoverResponse

export interface BrowserInputResponse {
  readonly success: boolean
}