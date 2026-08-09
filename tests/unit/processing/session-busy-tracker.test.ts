import { describe, it, expect, vi } from 'vitest'
import { SessionBusyTracker } from '../../../src/processing/session-busy-tracker.js'

describe('SessionBusyTracker', () => {
  it('reports busy during withBusy and idle afterwards', async () => {
    const tracker = new SessionBusyTracker()
    let seenWhileRunning: boolean | undefined

    await tracker.withBusy('sess-1', async () => {
      seenWhileRunning = tracker.isBusy('sess-1')
      expect(tracker.isBusy('sess-1')).toBe(true)
    })

    expect(seenWhileRunning).toBe(true)
    expect(tracker.isBusy('sess-1')).toBe(false)
  })

  it('clears busy in finally when fn throws and still fires onIdle callbacks', async () => {
    const tracker = new SessionBusyTracker()
    const onIdle = vi.fn()

    await expect(
      tracker.withBusy('sess-1', async () => {
        tracker.onIdle('sess-1', onIdle)
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(tracker.isBusy('sess-1')).toBe(false)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('fires onIdle exactly once after the session clears', async () => {
    const tracker = new SessionBusyTracker()
    const onIdle = vi.fn()

    await tracker.withBusy('sess-1', async () => {
      tracker.onIdle('sess-1', onIdle)
      tracker.onIdle('sess-1', onIdle)
    })

    expect(onIdle).toHaveBeenCalledTimes(2)
  })

  it('fires onIdle registered while busy once the session clears', async () => {
    const tracker = new SessionBusyTracker()
    const onIdle = vi.fn()

    const first = tracker.withBusy('sess-1', async () => {
      tracker.onIdle('sess-1', onIdle)
      // keep the session busy until released
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })

    expect(tracker.isBusy('sess-1')).toBe(true)
    expect(onIdle).not.toHaveBeenCalled()

    await first
    expect(onIdle).toHaveBeenCalledTimes(1)
    expect(tracker.isBusy('sess-1')).toBe(false)
  })

  it('fires onIdle registered while idle once via microtask', async () => {
    const tracker = new SessionBusyTracker()
    const onIdle = vi.fn()

    tracker.onIdle('sess-1', onIdle)
    expect(onIdle).not.toHaveBeenCalled()

    await Promise.resolve()
    await Promise.resolve()

    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('does not re-trigger onIdle callbacks on repeated clears', async () => {
    const tracker = new SessionBusyTracker()
    const onIdle = vi.fn()

    await tracker.withBusy('sess-1', async () => {
      tracker.onIdle('sess-1', onIdle)
    })
    expect(onIdle).toHaveBeenCalledTimes(1)

    tracker.clearBusy('sess-1')
    tracker.clearBusy('sess-1')
    tracker.clearBusy('sess-1')

    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent withBusy calls for the same session (second waits)', async () => {
    const tracker = new SessionBusyTracker()
    const order: string[] = []
    let releaseFirst: () => void = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = tracker.withBusy('sess-1', async () => {
      order.push('first-start')
      expect(tracker.isBusy('sess-1')).toBe(true)
      await firstGate
      order.push('first-end')
    })

    // Give the first call a chance to acquire the busy slot.
    await Promise.resolve()

    const second = tracker.withBusy('sess-1', async () => {
      order.push('second-start')
      expect(tracker.isBusy('sess-1')).toBe(true)
      order.push('second-end')
    })

    // The second call must wait: it must not have started yet.
    await Promise.resolve()
    expect(order).toEqual(['first-start'])
    expect(tracker.isBusy('sess-1')).toBe(true)

    releaseFirst()
    await first
    await second

    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
    expect(tracker.isBusy('sess-1')).toBe(false)
  })

  it('keeps the busy slot continuously held across a waiting chain', async () => {
    const tracker = new SessionBusyTracker()
    const order: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = tracker.withBusy('sess-1', async () => {
      order.push('first')
      await gate
    })
    await Promise.resolve()

    const second = tracker.withBusy('sess-1', async () => {
      order.push('second')
    })
    await Promise.resolve()
    expect(order).toEqual(['first'])

    release()
    await first
    await second

    expect(order).toEqual(['first', 'second'])
  })

  it('allows a callback to re-register onIdle without infinite recursion', async () => {
    const tracker = new SessionBusyTracker()
    const order: string[] = []

    const second = () => {
      order.push('second')
    }
    const first = () => {
      order.push('first')
      tracker.onIdle('sess-1', second)
    }
    const third = () => {
      order.push('third')
      // A re-registration must NOT run synchronously inside the drain
      // (that would recurse); it fires once via a microtask instead.
      expect(order).toEqual(['first', 'third'])
    }

    await tracker.withBusy('sess-1', async () => {
      tracker.onIdle('sess-1', first)
      tracker.onIdle('sess-1', third)
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['first', 'third', 'second'])
    await Promise.resolve()
    expect(order).toEqual(['first', 'third', 'second'])
  })

  it('runs each onIdle callback at most once even if it throws', async () => {
    const tracker = new SessionBusyTracker()
    const good = vi.fn()
    const bad = vi.fn(() => {
      throw new Error('callback failure')
    })

    await tracker.withBusy('sess-1', async () => {
      tracker.onIdle('sess-1', bad)
      tracker.onIdle('sess-1', good)
    })

    expect(bad).toHaveBeenCalledTimes(1)
    expect(good).toHaveBeenCalledTimes(1)
    expect(tracker.isBusy('sess-1')).toBe(false)
  })
})
