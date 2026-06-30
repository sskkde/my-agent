import type { Page } from 'playwright-core'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { BrowserSessionId, OwnershipState, FrameMeta } from '../../search/browser/browser-session-types.js'
import type { BrowserFrameStream } from '../../search/browser/browser-frame-stream.js'
import type { BrowserSessionManager } from '../../search/browser/browser-session-manager.js'
import type {
  BrowserSessionState,
  BrowserSnapshotEvent,
  BrowserHeartbeatEvent,
  BrowserFrameEvent,
} from './browser-sessions-types.js'
import type { BrowserInputEvent } from '../../search/browser/browser-session-types.js'

// ─── Exhaustive-switch helper ────────────────────────────────────────────────

function assertNever(x: never): never {
  throw new Error(`Unexpected: ${String(x)}`)
}

// ─── Module-level logger ─────────────────────────────────────────────────────

type HelpersLogger = {
  warn(message: string, fields?: Record<string, unknown>): void
}

let helpersLogger: HelpersLogger = {
  warn(message, fields) {
    // eslint-disable-next-line no-console
    console.warn(`[browser-sessions-helpers] ${message}`, fields ?? {})
  },
}

/** Inject a platform logger (e.g. pino). When unset, falls back to console. */
export function setBrowserSessionsHelpersLogger(logger: HelpersLogger): void {
  helpersLogger = logger
}

// ─── Boundary parse errors ───────────────────────────────────────────────────
//
// Route handlers catch `BrowserInputParseError` and convert it to HTTP 400.
// Any other thrown error propagates as a 500. Keeping the error typed (rather
// than throwing a bare `Error`) lets the route layer discriminate reliably.

export class BrowserInputParseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`[${code}] ${message}`)
    this.name = 'BrowserInputParseError'
  }
}

// ─── Boundary parsing helpers ────────────────────────────────────────────────

function parseNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BrowserInputParseError(
      'INVALID_NUMBER',
      `Field "${field}" must be a finite number, got ${typeof value}`,
    )
  }
  return value
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BrowserInputParseError(
      'INVALID_STRING',
      `Field "${field}" must be a non-empty string, got ${typeof value}`,
    )
  }
  return value
}

function parseNormalizedUnit(value: unknown, field: string): number {
  const n = parseNumber(value, field)
  if (n < 0 || n > 1) {
    throw new BrowserInputParseError(
      'OUT_OF_RANGE',
      `Field "${field}" must be in [0, 1], got ${n}`,
    )
  }
  return n
}

function parseButton(value: unknown): 'left' | 'middle' | 'right' {
  if (value === undefined || value === null) return 'left'
  if (value === 'left' || value === 'middle' || value === 'right') return value
  throw new BrowserInputParseError(
    'INVALID_BUTTON',
    `Field "button" must be one of "left" | "middle" | "right", got ${String(value)}`,
  )
}

function parseClickCount(value: unknown): number {
  if (value === undefined || value === null) return 1
  const n = parseNumber(value, 'clickCount')
  if (!Number.isInteger(n) || n < 1) {
    throw new BrowserInputParseError(
      'INVALID_CLICK_COUNT',
      `Field "clickCount" must be a positive integer, got ${n}`,
    )
  }
  return n
}

function parseModifiers(value: unknown): readonly string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new BrowserInputParseError(
      'INVALID_MODIFIERS',
      'Field "modifiers" must be an array of strings',
    )
  }
  return value as readonly string[]
}

export function mapOwnershipToState(ownership: OwnershipState): BrowserSessionState {
  switch (ownership) {
    case 'agent_controlled':
    case 'resuming':
      return 'agent_controlled'
    case 'handoff_requested':
      return 'handoff_requested'
    case 'human_controlled':
      return 'user_controlled'
    case 'closed':
    case 'error':
      return 'idle'
    default:
      return assertNever(ownership)
  }
}

export function mapRouteInputToEvent(
  action: string,
  payload: Record<string, unknown>,
): BrowserInputEvent {
  switch (action) {
    case 'click':
      return {
        kind: 'click',
        x: parseNormalizedUnit(payload.x, 'x'),
        y: parseNormalizedUnit(payload.y, 'y'),
        button: parseButton(payload.button),
        clickCount: parseClickCount(payload.clickCount),
      }
    case 'keypress':
      return {
        kind: 'key',
        key: parseString(payload.key, 'key'),
        modifiers: parseModifiers(payload.modifiers),
      }
    case 'type':
      return { kind: 'text', text: parseString(payload.text, 'text') }
    case 'scroll':
      return {
        kind: 'scroll',
        x: payload.x === undefined ? 0 : parseNumber(payload.x, 'x'),
        y: payload.y === undefined ? 0 : parseNumber(payload.y, 'y'),
        deltaX: parseNumber(payload.deltaX, 'deltaX'),
        deltaY: parseNumber(payload.deltaY, 'deltaY'),
      }
    case 'navigate':
      return { kind: 'navigate', url: parseString(payload.url, 'url') }
    default:
      throw new BrowserInputParseError(
        'UNKNOWN_ACTION',
        `Unknown input action: ${action}`,
      )
  }
}

export async function dispatchInputToPage(page: Page, event: BrowserInputEvent): Promise<void> {
  switch (event.kind) {
    case 'click': {
      // The frontend sends normalized coordinates in [0, 1]; Playwright's
      // `page.mouse.click` expects pixel coordinates. Scale by the current
      // viewport so the click lands where the user pointed.
      const viewport = page.viewportSize()
      const pixelX = viewport ? event.x * viewport.width : event.x
      const pixelY = viewport ? event.y * viewport.height : event.y
      await page.mouse.click(pixelX, pixelY, { button: event.button, clickCount: event.clickCount })
      break
    }
    case 'key':
      await page.keyboard.press(event.key)
      break
    case 'text':
      await page.keyboard.type(event.text)
      break
    case 'scroll':
      await page.mouse.wheel(event.deltaX, event.deltaY)
      break
    case 'navigate':
      await page.goto(event.url)
      break
    default:
      assertNever(event)
  }
}

export function writeFrameSseStream(
  reply: FastifyReply,
  request: FastifyRequest,
  bsId: BrowserSessionId,
  manager: BrowserSessionManager,
  frameStream: BrowserFrameStream,
): void {
  const status = manager.getSession(bsId)
  const state: BrowserSessionState = status ? mapOwnershipToState(status.ownership) : 'idle'

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const snapshot: BrowserSnapshotEvent = {
    type: 'snapshot',
    state,
    url: status ? (manager.getPage(bsId)?.url() ?? null) : null,
    timestamp: new Date().toISOString(),
  }
  reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`)

  let unsubscribe: (() => void) | null = null
  let unsubscribed = false
  if (status) {
    try {
      unsubscribe = frameStream.subscribe(bsId, (meta: FrameMeta, frameData: Buffer) => {
        if (unsubscribed) return
        try {
          const frame: BrowserFrameEvent = {
            type: 'frame',
            data: frameData.toString('base64'),
            timestamp: new Date(meta.capturedAt).toISOString(),
            width: meta.width,
            height: meta.height,
          }
          reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`)
        } catch (err) {
          // The reply stream is no longer writable (client disconnected or
          // the connection errored). Unsubscribe this SSE connection's frame
          // callback and stop attempting to write. The error is accounted so
          // it is not silently swallowed.
          helpersLogger.warn('frame SSE write failed; unsubscribing', {
            sessionId: bsId,
            error: err instanceof Error ? err.message : String(err),
          })
          unsubscribed = true
          unsubscribe?.()
        }
      })
    } catch (err) {
      // Page not available — stream stays snapshot-only. Accounted so the
      // failure is observable.
      helpersLogger.warn('frame stream subscribe failed; snapshot-only', {
        sessionId: bsId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const heartbeatInterval = setInterval(() => {
    try {
      const heartbeat: BrowserHeartbeatEvent = { type: 'heartbeat', timestamp: new Date().toISOString() }
      reply.raw.write(`data: ${JSON.stringify(heartbeat)}\n\n`)
    } catch (err) {
      // The reply stream is no longer writable; stop the heartbeat interval.
      // Accounted so the failure is observable.
      helpersLogger.warn('heartbeat SSE write failed; stopping heartbeat', {
        sessionId: bsId,
        error: err instanceof Error ? err.message : String(err),
      })
      clearInterval(heartbeatInterval)
    }
  }, 5000)

  request.raw.once('close', () => {
    unsubscribed = true
    clearInterval(heartbeatInterval)
    unsubscribe?.()
  })
}
