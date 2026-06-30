import type { Page } from 'playwright-core'
import type { BrowserSessionId, FrameMeta } from './browser-session-types.js'
import type { BrowserSessionManager } from './browser-session-manager.js'

// ─── Module-level logger ─────────────────────────────────────────────────────
// Best-effort structured logging for capture/subscriber errors. Falls back to
// console when no platform logger is wired in. Errors are accounted here so
// the surrounding control flow does not need to swallow them silently.

type FrameStreamLogger = {
  warn(message: string, fields?: Record<string, unknown>): void
}

let frameStreamLogger: FrameStreamLogger = {
  warn(message, fields) {
    // eslint-disable-next-line no-console
    console.warn(`[BrowserFrameStream] ${message}`, fields ?? {})
  },
}

/** Inject a platform logger (e.g. pino). When unset, falls back to console. */
export function setFrameStreamLogger(logger: FrameStreamLogger): void {
  frameStreamLogger = logger
}

// ─── Configuration ───────────────────────────────────────────────────────────

export interface FrameStreamConfig {
  /** JPEG quality (0-100). Default 50. */
  readonly quality: number
  /** Screenshot format. Default 'jpeg'. */
  readonly format: 'jpeg' | 'png'
  /** Minimum interval between captures in milliseconds. Default 100. */
  readonly minIntervalMs: number
}

function createDefaultFrameStreamConfig(): FrameStreamConfig {
  return { quality: 50, format: 'jpeg', minIntervalMs: 100 }
}

// ─── Subscriber callback ──────────────────────────────────────────────────────

export type FrameCallback = (meta: FrameMeta, frameData: Buffer) => void

// ─── Internal capture state ──────────────────────────────────────────────────

interface CaptureEntry {
  readonly intervalId: ReturnType<typeof setInterval>
  readonly subscribers: Set<FrameCallback>
}

// ─── BrowserFrameStream ───────────────────────────────────────────────────────

/**
 * Captures JPEG screenshots from a `BrowserSessionManager`-owned `Page` at a
 * minimum interval and emits each frame as `{ meta: FrameMeta, data: Buffer }`
 * to every subscriber registered for that session.
 *
 * The stream is purely in-memory: it never writes frames to disk, DB, logs,
 * or evidence files. When the last subscriber for a
 * session unsubscribes, the capture interval is cleared. If `page.screenshot()`
 * rejects, the capture for that session is stopped silently — the SSE handler
 * detects the stop when no more frames arrive.
 */
export class BrowserFrameStream {
  private readonly manager: BrowserSessionManager
  private readonly config: FrameStreamConfig
  private readonly captures: Map<BrowserSessionId, CaptureEntry> = new Map()

  constructor(manager: BrowserSessionManager, config: FrameStreamConfig = createDefaultFrameStreamConfig()) {
    this.manager = manager
    this.config = config
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Subscribe to frames for a session. Starts the capture interval if the
   * session does not already have one. If the session has no live `Page`, the
   * callback is registered but no capture starts until a page becomes
   * available — in practice the SSE handler only subscribes when a session
   * exists, so this is a defensive no-op.
   *
   * Returns a per-subscriber cleanup function. Calling it removes only this
   * callback from the subscriber set; when the last subscriber is removed the
   * capture interval is cleared. The cleanup function is idempotent.
   */
  subscribe(sessionId: BrowserSessionId, callback: FrameCallback): () => void {
    const existing = this.captures.get(sessionId)
    if (existing) {
      existing.subscribers.add(callback)
      return () => this.removeSubscriber(sessionId, callback)
    }
    this.startCapture(sessionId, callback)
    return () => this.removeSubscriber(sessionId, callback)
  }

  /**
   * Remove all subscribers for a session and stop its capture interval.
   * Retained for backward compatibility; new callers should prefer the
   * per-subscriber cleanup function returned by {@link subscribe}.
   */
  unsubscribe(sessionId: BrowserSessionId): void {
    this.stopCapture(sessionId)
  }

  /**
   * Stop all active captures and clear all subscribers.
   */
  stopAll(): void {
    for (const [, entry] of this.captures) {
      clearInterval(entry.intervalId)
      entry.subscribers.clear()
    }
    this.captures.clear()
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Start the capture interval for a session with the initial subscriber.
   * If the page is unavailable, no interval is created and the subscriber
   * is dropped (the SSE handler treats this as snapshot-only).
   */
  private startCapture(sessionId: BrowserSessionId, initial: FrameCallback): void {
    const page = this.manager.getPage(sessionId)
    if (!page) {
      // No live page — nothing to capture. The subscriber is not registered;
      // the SSE handler will detect no frames and stay snapshot-only.
      return
    }

    const subscribers = new Set<FrameCallback>([initial])
    const intervalId = setInterval(() => {
      void this.captureTick(sessionId, page)
    }, this.config.minIntervalMs)

    this.captures.set(sessionId, { intervalId, subscribers })
  }

  /**
   * Clear the capture interval and remove the session entry.
   */
  private stopCapture(sessionId: BrowserSessionId): void {
    const entry = this.captures.get(sessionId)
    if (!entry) return
    clearInterval(entry.intervalId)
    entry.subscribers.clear()
    this.captures.delete(sessionId)
  }

  /**
   * Remove a single subscriber. When the last subscriber is removed, stop the
   * capture interval for the session. Idempotent: a second call for an
   * already-removed callback is a no-op.
   */
  private removeSubscriber(sessionId: BrowserSessionId, callback: FrameCallback): void {
    const entry = this.captures.get(sessionId)
    if (!entry) return
    entry.subscribers.delete(callback)
    if (entry.subscribers.size === 0) {
      this.stopCapture(sessionId)
    }
  }

  /**
   * One capture tick: take a screenshot, build `FrameMeta`, and emit to every
   * subscriber. If `page.screenshot()` rejects, stop the capture for this
   * session silently — subscribers will simply receive no more frames.
   */
  private async captureTick(sessionId: BrowserSessionId, page: Page): Promise<void> {
    const entry = this.captures.get(sessionId)
    if (!entry || entry.subscribers.size === 0) return

    let buffer: Buffer
    try {
      buffer = await page.screenshot({ type: this.config.format, quality: this.config.quality })
    } catch (err) {
      // Screenshot failed (page closed, crashed, navigated away, etc.).
      // Stop the capture; the SSE handler will detect the stop. The error is
      // accounted here so callers do not need to swallow it themselves.
      frameStreamLogger.warn('screenshot capture failed; stopping capture', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
      this.stopCapture(sessionId)
      return
    }

    // The capture may have been stopped while awaiting the screenshot.
    if (!this.captures.has(sessionId)) return

    const viewport = page.viewportSize()
    const meta: FrameMeta = {
      width: viewport?.width ?? 0,
      height: viewport?.height ?? 0,
      capturedAt: new Date().toISOString(),
      format: this.config.format,
      quality: this.config.quality,
    }

    // Snapshot subscribers into an array before invoking, so a callback that
    // calls `unsubscribe` mid-iteration does not mutate the set under us.
    const snapshot = [...entry.subscribers]
    for (const cb of snapshot) {
      try {
        cb(meta, buffer)
      } catch (err) {
        // A subscriber throwing must not break the stream for others. Log the
        // error so it is accounted, then continue delivering to the rest.
        frameStreamLogger.warn('frame subscriber threw; continuing', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
}