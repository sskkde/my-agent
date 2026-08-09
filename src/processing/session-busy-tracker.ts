/**
 * Per-session concurrency guard.
 *
 * Guarantees that at most one turn runs per session at any moment (symmetric
 * occupancy: user turns and background-notification turns are mutually
 * exclusive) and exposes one-shot "on idle" callbacks that fire once a busy
 * session actually becomes free again.
 *
 * Concurrent `withBusy` calls for the same session serialize through a FIFO
 * queue. Ownership of the busy slot is handed directly from one turn to the
 * next, so a new arrival can never steal the slot while the queue is waiting.
 */
interface SessionBusyEntry {
  running: boolean
  /** One-shot callbacks drained when the session becomes free. */
  idleCallbacks: Array<() => void>
  /** FIFO of waiters blocked on a concurrently running `withBusy`. */
  queue: Array<() => void>
}

export class SessionBusyTracker {
  private readonly entries = new Map<string, SessionBusyEntry>()

  isBusy(sessionId: string): boolean {
    return this.entries.get(sessionId)?.running === true
  }

  markBusy(sessionId: string): void {
    this.getOrCreateEntry(sessionId).running = true
  }

  clearBusy(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return

    const next = entry.queue.shift()
    if (next) {
      // Hand the busy slot to the next queued turn before waking it: the
      // session stays occupied without an idle gap, so onIdle callbacks only
      // fire when the whole queue has drained.
      next()
      return
    }

    entry.running = false
    this.drainIdleCallbacks(entry)
  }

  /**
   * Runs `fn` while holding the per-session busy slot. Concurrent calls for
   * the same session run strictly one after the other. The slot is always
   * released (even when `fn` throws) and, once the session is actually free,
   * registered onIdle callbacks are drained exactly once each.
   */
  async withBusy<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const entry = this.getOrCreateEntry(sessionId)
    if (!entry.running) {
      entry.running = true
    } else {
      // Wait in line. `clearBusy` transfers ownership to us without an idle
      // gap, so `running` is already true when we resume.
      await new Promise<void>((resolve) => entry.queue.push(resolve))
    }

    try {
      return await fn()
    } finally {
      this.clearBusy(sessionId)
    }
  }

  /**
   * Registers a one-shot callback to run once when the session becomes idle.
   * If the session is not busy at registration time the callback fires once
   * via a microtask (deterministic, never synchronously, and without real
   * timers). A callback may register another onIdle callback — each is drained
   * from the list before invocation, so re-registrations cannot recurse inside
   * the drain itself.
   */
  onIdle(sessionId: string, cb: () => void): void {
    const entry = this.getOrCreateEntry(sessionId)
    if (!entry.running) {
      queueMicrotask(cb)
      return
    }
    entry.idleCallbacks.push(cb)
  }

  private drainIdleCallbacks(entry: SessionBusyEntry): void {
    // Snapshot before draining: a callback that re-registers via onIdle appends
    // to the fresh list and runs later instead of recursing inside this loop.
    const callbacks = entry.idleCallbacks
    entry.idleCallbacks = []
    for (const cb of callbacks) {
      try {
        cb()
      } catch {
        // A failing callback must not stop the remaining callbacks nor break
        // the turn that just completed (the slot was already released).
      }
    }
  }

  private getOrCreateEntry(sessionId: string): SessionBusyEntry {
    let entry = this.entries.get(sessionId)
    if (!entry) {
      entry = { running: false, idleCallbacks: [], queue: [] }
      this.entries.set(sessionId, entry)
    }
    return entry
  }
}
