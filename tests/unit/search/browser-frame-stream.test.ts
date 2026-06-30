import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BrowserFrameStream } from '../../../src/search/browser/browser-frame-stream.js'
import type { FrameStreamConfig } from '../../../src/search/browser/browser-frame-stream.js'
import { BrowserSessionManager, toBrowserSessionId } from '../../../src/search/browser/browser-session-manager.js'
import type { CloakBrowserProvider } from '../../../src/search/browser/cloakbrowser-launcher.js'
import type { BrowserSessionId, FrameMeta } from '../../../src/search/browser/browser-session-types.js'

// ─── Typed mock builders ─────────────────────────────────────────────────────
// Minimal typed fakes for the Playwright surfaces the frame stream touches.
// Injected through the CloakBrowserProvider seam into BrowserSessionManager,
// which exposes the live Page via getPage().

interface PageFake {
  readonly on: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
  readonly url: ReturnType<typeof vi.fn>
  readonly viewportSize: ReturnType<typeof vi.fn>
  readonly screenshot: ReturnType<typeof vi.fn>
}

interface ContextFake {
  readonly newPage: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
}

interface BrowserFake {
  readonly newContext: ReturnType<typeof vi.fn>
}

function createPageFake(screenshotImpl?: () => Promise<Buffer>): PageFake {
  const defaultShot = (): Promise<Buffer> =>
    Promise.resolve(Buffer.from('fake-jpeg-bytes'))
  return {
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue('https://example.com'),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    screenshot: vi.fn(screenshotImpl ?? defaultShot),
  }
}

function createContextFake(page: PageFake): ContextFake {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function createBrowserFake(context: ContextFake): BrowserFake {
  return { newContext: vi.fn().mockResolvedValue(context) }
}

function createProviderFake(browser: BrowserFake): CloakBrowserProvider {
  return {
    getBrowser: vi.fn().mockResolvedValue(browser),
    closeBrowser: vi.fn().mockResolvedValue(undefined),
  }
}

interface Stack {
  readonly page: PageFake
  readonly context: ContextFake
  readonly browser: BrowserFake
  readonly provider: CloakBrowserProvider
  readonly manager: BrowserSessionManager
}

function buildStack(screenshotImpl?: () => Promise<Buffer>): Stack {
  const page = createPageFake(screenshotImpl)
  const context = createContextFake(page)
  const browser = createBrowserFake(context)
  const provider = createProviderFake(browser)
  const manager = new BrowserSessionManager(provider)
  return { page, context, browser, provider, manager }
}

function sid(n: number): BrowserSessionId {
  return toBrowserSessionId(`sess-${n}`)
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('BrowserFrameStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // 1. subscribe: subscribing starts capture, callback receives FrameMeta + Buffer
  it('subscribe: starts capture and callback receives FrameMeta + Buffer', async () => {
    const { manager } = buildStack()
    await manager.createSession(sid(1))
    const stream = new BrowserFrameStream(manager)

    const received: Array<{ meta: FrameMeta; data: Buffer }> = []
    stream.subscribe(sid(1), (meta, data) => {
      received.push({ meta, data })
    })

    // Advance one interval tick (default 100ms) and flush the async screenshot.
    await vi.advanceTimersByTimeAsync(100)

    expect(received).toHaveLength(1)
    expect(received[0]?.meta.format).toBe('jpeg')
    expect(received[0]?.meta.quality).toBe(50)
    expect(Buffer.isBuffer(received[0]?.data)).toBe(true)

    stream.stopAll()
  })

  // 2. unsubscribe: unsubscribing stops capture, no more frames emitted
  it('unsubscribe: stops capture and no more frames are emitted', async () => {
    const { manager } = buildStack()
    await manager.createSession(sid(1))
    const stream = new BrowserFrameStream(manager)

    let count = 0
    stream.subscribe(sid(1), () => {
      count++
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(count).toBe(1)

    stream.unsubscribe(sid(1))

    await vi.advanceTimersByTimeAsync(300)
    expect(count).toBe(1) // no new frames after unsubscribe

    stream.stopAll()
  })

  // 3. multi-subscriber: multiple subscribers to same session all receive frames
  it('multi-subscriber: all subscribers to the same session receive frames', async () => {
    const { manager } = buildStack()
    await manager.createSession(sid(1))
    const stream = new BrowserFrameStream(manager)

    let aCount = 0
    let bCount = 0
    stream.subscribe(sid(1), () => {
      aCount++
    })
    stream.subscribe(sid(1), () => {
      bCount++
    })

    await vi.advanceTimersByTimeAsync(100)

    expect(aCount).toBe(1)
    expect(bCount).toBe(1)

    stream.stopAll()
  })

  // 4. min interval: frames emitted no faster than 100ms
  it('min interval: frames are emitted no faster than the configured minIntervalMs', async () => {
    const { manager } = buildStack()
    await manager.createSession(sid(1))
    const stream = new BrowserFrameStream(manager)

    const timestamps: number[] = []
    stream.subscribe(sid(1), () => {
      timestamps.push(Date.now())
    })

    // Advance 95ms — should NOT tick yet (interval is 100ms).
    await vi.advanceTimersByTimeAsync(95)
    expect(timestamps).toHaveLength(0)

    // Advance the remaining 5ms to reach 100ms — should tick once.
    await vi.advanceTimersByTimeAsync(5)
    expect(timestamps).toHaveLength(1)

    // Advance another 100ms — second tick.
    await vi.advanceTimersByTimeAsync(100)
    expect(timestamps).toHaveLength(2)

    // The two ticks should be 100ms apart.
    expect(timestamps[1]! - timestamps[0]!).toBe(100)

    stream.stopAll()
  })

  // 5. cleanup: when last subscriber unsubscribes, interval is cleared
  it('cleanup: when last subscriber unsubscribes, the interval is cleared', async () => {
    const { manager } = buildStack()
    await manager.createSession(sid(1))
    const stream = new BrowserFrameStream(manager)

    const cb = vi.fn()
    stream.subscribe(sid(1), cb)

    await vi.advanceTimersByTimeAsync(100)
    expect(cb).toHaveBeenCalledTimes(1)

    stream.unsubscribe(sid(1))

    // Advance well past several more intervals — no more calls.
    await vi.advanceTimersByTimeAsync(500)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  // 5b. per-subscriber cleanup: subscribe returns a cleanup function that
  // removes only that subscriber; other subscribers to the same session keep
  // receiving frames.
  it('per-subscriber cleanup: returned cleanup removes only that subscriber', async () => {
    const { manager } = buildStack()
    await manager.createSession(sid(1))
    const stream = new BrowserFrameStream(manager)

    const aCount = { n: 0 }
    const bCount = { n: 0 }
    const cleanupA = stream.subscribe(sid(1), () => {
      aCount.n++
    })
    stream.subscribe(sid(1), () => {
      bCount.n++
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(aCount.n).toBe(1)
    expect(bCount.n).toBe(1)

    cleanupA()

    await vi.advanceTimersByTimeAsync(100)
    expect(aCount.n).toBe(1)
    expect(bCount.n).toBe(2)

    // Idempotent: a second call is a no-op.
    cleanupA()
    await vi.advanceTimersByTimeAsync(100)
    expect(aCount.n).toBe(1)
    expect(bCount.n).toBe(3)

    stream.stopAll()
  })

  // 6. error stop: when page.screenshot() rejects, capture stops and no more frames emitted
  it('error stop: when page.screenshot() rejects, capture stops and no more frames are emitted', async () => {
    let callCount = 0
    const failingShot = (): Promise<Buffer> => {
      callCount++
      return Promise.reject(new Error('page closed'))
    }
    const { manager } = buildStack(failingShot)
    await manager.createSession(sid(1))
    const stream = new BrowserFrameStream(manager)

    const cb = vi.fn()
    stream.subscribe(sid(1), cb)

    // First tick triggers the failing screenshot.
    await vi.advanceTimersByTimeAsync(100)
    // Flush the rejected promise.
    await Promise.resolve()
    await Promise.resolve()

    expect(callCount).toBe(1)
    expect(cb).not.toHaveBeenCalled()

    // Advance more — no more screenshot attempts because capture stopped.
    await vi.advanceTimersByTimeAsync(300)
    expect(callCount).toBe(1)
    expect(cb).not.toHaveBeenCalled()

    stream.stopAll()
  })

  // 7. no persistence dependency: verify no file system or DB calls are made
  it('no persistence dependency: does not import fs or storage modules', async () => {
    // Read the implementation source and assert it does not reference fs or storage.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const source = fs.readFileSync(
      path.resolve('src/search/browser/browser-frame-stream.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/\bfrom\s+['"]node:fs['"]\b/)
    expect(source).not.toMatch(/\bfrom\s+['"].*storage['"]\b/)
    expect(source).not.toMatch(/\bwriteFile\b/)
    expect(source).not.toMatch(/\bappendFile\b/)
    expect(source).not.toMatch(/\bDatabase\b/)
    expect(source).not.toMatch(/\btranscript\b/)
    expect(source).not.toMatch(/\btimeline\b/)
  })

  // 8. stopAll: all sessions stopped, all intervals cleared
  it('stopAll: stops all active captures and clears all subscribers', async () => {
    const { manager } = buildStack()
    await manager.createSession(sid(1))
    await manager.createSession(sid(2))
    const stream = new BrowserFrameStream(manager)

    const cb1 = vi.fn()
    const cb2 = vi.fn()
    stream.subscribe(sid(1), cb1)
    stream.subscribe(sid(2), cb2)

    await vi.advanceTimersByTimeAsync(100)
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)

    stream.stopAll()

    await vi.advanceTimersByTimeAsync(300)
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
  })

  // 9. frame content: emitted FrameMeta has correct width/height from screenshot, format='jpeg', quality=50
  it('frame content: FrameMeta carries width/height from page.viewportSize, format=jpeg, quality=50', async () => {
    const { manager, page } = buildStack()
    page.viewportSize.mockReturnValue({ width: 1024, height: 768 })
    await manager.createSession(sid(1))
    const stream = new BrowserFrameStream(manager)

    let received: { meta: FrameMeta; data: Buffer } | null = null
    stream.subscribe(sid(1), (meta, data) => {
      received = { meta, data }
    })

    await vi.advanceTimersByTimeAsync(100)

    expect(received).not.toBeNull()
    const meta = received!.meta
    expect(meta.width).toBe(1024)
    expect(meta.height).toBe(768)
    expect(meta.format).toBe('jpeg')
    expect(meta.quality).toBe(50)
    expect(meta.capturedAt).toBe('2026-06-29T12:00:00.100Z')

    stream.stopAll()
  })

  // 10. base64-convertible: emitted Buffer can be converted to base64 string (for SSE transport)
  it('base64-convertible: emitted Buffer converts to a base64 string for SSE transport', async () => {
    const { manager } = buildStack()
    await manager.createSession(sid(1))
    const stream = new BrowserFrameStream(manager)

    let receivedData: Buffer | null = null
    stream.subscribe(sid(1), (_meta, data) => {
      receivedData = data
    })

    await vi.advanceTimersByTimeAsync(100)

    expect(receivedData).not.toBeNull()
    expect(Buffer.isBuffer(receivedData)).toBe(true)
    const base64 = receivedData!.toString('base64')
    expect(typeof base64).toBe('string')
    expect(base64.length).toBeGreaterThan(0)

    stream.stopAll()
  })

  // ─── Additional edge cases ─────────────────────────────────────────────────

  it('custom config: honors quality, format, and minIntervalMs overrides', async () => {
    const { manager } = buildStack()
    await manager.createSession(sid(1))
    const config: FrameStreamConfig = { quality: 80, format: 'jpeg', minIntervalMs: 200 }
    const stream = new BrowserFrameStream(manager, config)

    const received: FrameMeta[] = []
    stream.subscribe(sid(1), (meta) => {
      received.push(meta)
    })

    await vi.advanceTimersByTimeAsync(199)
    expect(received).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(received).toHaveLength(1)
    expect(received[0]?.quality).toBe(80)

    stream.stopAll()
  })

  it('subscribe to non-existent session: no capture starts, no frames emitted', async () => {
    const { manager } = buildStack()
    const stream = new BrowserFrameStream(manager)

    const cb = vi.fn()
    stream.subscribe(sid(999), cb)

    await vi.advanceTimersByTimeAsync(300)
    expect(cb).not.toHaveBeenCalled()

    stream.stopAll()
  })

  it('screenshot called with type=jpeg and quality=50 by default', async () => {
    const { manager, page } = buildStack()
    await manager.createSession(sid(1))
    const stream = new BrowserFrameStream(manager)

    stream.subscribe(sid(1), () => {})

    await vi.advanceTimersByTimeAsync(100)

    expect(page.screenshot).toHaveBeenCalledWith({ type: 'jpeg', quality: 50 })

    stream.stopAll()
  })
})