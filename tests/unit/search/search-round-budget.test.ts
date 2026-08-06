import { describe, expect, it } from 'vitest'
import {
  computeRoundDeadlines,
  MULTI_ROUND_SEARCH_POLICY,
  ONE_ROUND_SEARCH_POLICY,
  raceWithDeadline,
  type DeadlineClock,
} from '../../../src/search/search-round-budget.js'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

/** A promise whose settlement is controlled by the test - no timers involved. */
function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface FakeClock {
  clock: DeadlineClock
  /** Advance fake time by ms and fire every timer whose deadline has been reached. */
  advanceTime: (ms: number) => void
  pendingTimers: () => number
}

/** Deterministic clock: timers only fire when the test advances time. */
function createFakeClock(): FakeClock {
  let nowMs = 0
  let nextHandle = 1
  const timers = new Map<number, { dueAt: number; fn: () => void }>()

  const clock: DeadlineClock = {
    now: () => nowMs,
    setTimeout: (fn, ms) => {
      const handle = nextHandle++
      timers.set(handle, { dueAt: nowMs + ms, fn })
      return handle
    },
    clearTimeout: (handle) => {
      timers.delete(handle)
    },
  }

  const advanceTime = (ms: number): void => {
    nowMs += ms
    const due = [...timers.entries()]
      .filter(([, timer]) => timer.dueAt <= nowMs)
      .sort((a, b) => a[1].dueAt - b[1].dueAt)
    for (const [handle, timer] of due) {
      if (timers.has(handle)) {
        timers.delete(handle)
        timer.fn()
      }
    }
  }

  return { clock, advanceTime, pendingTimers: () => timers.size }
}

describe('computeRoundDeadlines', () => {
  it('maps a 60s budget to a 45s round deadline and a 59s completion deadline', () => {
    // Given: the production multi-round policy over the default 60s child budget
    // When: deadlines are derived from the total budget
    const deadlines = computeRoundDeadlines(60_000, MULTI_ROUND_SEARCH_POLICY)

    // Then: 14s phase2 reserve + 1s handoff reserve are carved out of the round
    expect(deadlines).toEqual({ roundDeadlineMs: 45_000, completionDeadlineMs: 59_000 })
  })

  it('scales reserves proportionally so a 120ms budget stays reachable', () => {
    // Given: a very short test budget
    // When: deadlines are derived from the 120ms budget
    const deadlines = computeRoundDeadlines(120, MULTI_ROUND_SEARCH_POLICY)

    // Then: reserves shrink to 28ms phase2 / 2ms handoff instead of staying huge
    expect(deadlines.roundDeadlineMs).toBe(90)
    expect(deadlines.completionDeadlineMs).toBe(118)
    expect(deadlines.roundDeadlineMs).toBeGreaterThan(0)
    expect(deadlines.completionDeadlineMs).toBeGreaterThan(0)
  })

  it('caps reserves at their configured size for budgets above the reference', () => {
    // Given: a budget larger than the 60s reference budget
    const deadlines = computeRoundDeadlines(600_000, MULTI_ROUND_SEARCH_POLICY)

    // Then: reserves stay at their configured 14s / 1s values
    expect(deadlines.roundDeadlineMs).toBe(585_000)
    expect(deadlines.completionDeadlineMs).toBe(599_000)
  })

  it('never produces negative deadlines for a 1ms budget', () => {
    const deadlines = computeRoundDeadlines(1, MULTI_ROUND_SEARCH_POLICY)

    expect(deadlines.roundDeadlineMs).toBeGreaterThanOrEqual(0)
    expect(deadlines.completionDeadlineMs).toBeGreaterThanOrEqual(0)
  })

  it('returns zero deadlines for a non-positive budget', () => {
    expect(computeRoundDeadlines(0, MULTI_ROUND_SEARCH_POLICY)).toEqual({ roundDeadlineMs: 0, completionDeadlineMs: 0 })
    expect(computeRoundDeadlines(-100, MULTI_ROUND_SEARCH_POLICY)).toEqual({
      roundDeadlineMs: 0,
      completionDeadlineMs: 0,
    })
  })

  it('keeps the default one-round policy single-shot with no replans', () => {
    // Given: the default policy used by direct/legacy one-round search
    expect(ONE_ROUND_SEARCH_POLICY).toEqual({
      maxRounds: 1,
      maxReplans: 0,
      phase2ReserveMs: 0,
      handoffReserveMs: 1000,
    })

    // Then: a 60s budget yields near-full-budget round and completion deadlines
    const deadlines = computeRoundDeadlines(60_000, ONE_ROUND_SEARCH_POLICY)
    expect(deadlines.roundDeadlineMs).toBe(59_000)
    expect(deadlines.completionDeadlineMs).toBe(59_000)
  })

  it('exposes the production policy as max 3 rounds / max 2 replans', () => {
    expect(MULTI_ROUND_SEARCH_POLICY).toEqual({
      maxRounds: 3,
      maxReplans: 2,
      phase2ReserveMs: 14_000,
      handoffReserveMs: 1_000,
    })
  })
})

describe('raceWithDeadline', () => {
  it('settles with the promise value when work finishes before the deadline', async () => {
    // Given: deferred work whose deadline has not elapsed
    const fake = createFakeClock()
    const deferred = createDeferred<string>()
    const race = raceWithDeadline(deferred.promise, 1_000, { clock: fake.clock })

    // When: the work settles before the deadline timer fires
    deferred.resolve('evidence')

    // Then: the race returns the settled value
    await expect(race).resolves.toEqual({ kind: 'settled', value: 'evidence' })
  })

  it('returns expired when the deadline fires before the promise settles', async () => {
    // Given: deferred work with an elapsed-before-settle deadline
    const fake = createFakeClock()
    const deferred = createDeferred<string>()
    const race = raceWithDeadline(deferred.promise, 1_000, { clock: fake.clock })
    expect(fake.pendingTimers()).toBe(1)

    // When: the deadline timer fires
    fake.advanceTime(1_000)

    // Then: the race resolves with the typed expired outcome and cancels the timer
    await expect(race).resolves.toEqual({ kind: 'expired' })
    expect(fake.pendingTimers()).toBe(0)
  })

  it('observes a late resolve without advancing the already-settled state machine', async () => {
    // Given: the race already expired
    const fake = createFakeClock()
    const deferred = createDeferred<string>()
    let resolutions = 0
    const race = raceWithDeadline(deferred.promise, 1_000, { clock: fake.clock })
    race.then(() => {
      resolutions += 1
    })
    fake.advanceTime(1_000)
    await expect(race).resolves.toEqual({ kind: 'expired' })

    // When: the abandoned work resolves after expiry
    deferred.resolve('late value')
    await Promise.resolve()
    await Promise.resolve()

    // Then: the late value is observed but cannot advance the state machine
    expect(resolutions).toBe(1)
    await expect(race).resolves.toEqual({ kind: 'expired' })
  })

  it('propagates a rejection that wins the race', async () => {
    // Given: deferred work that rejects before the deadline
    const fake = createFakeClock()
    const deferred = createDeferred<string>()
    const race = raceWithDeadline(deferred.promise, 1_000, { clock: fake.clock })

    // When: the work rejects first
    deferred.reject(new Error('backend failed'))

    // Then: the race rejects with the underlying error
    await expect(race).rejects.toThrow('backend failed')
  })

  it('handles a late rejection without an unhandled rejection or state change', async () => {
    // Given: a race that already expired and a listener for unhandled rejections
    const fake = createFakeClock()
    const deferred = createDeferred<string>()
    const race = raceWithDeadline(deferred.promise, 1_000, { clock: fake.clock })
    fake.advanceTime(1_000)
    await expect(race).resolves.toEqual({ kind: 'expired' })

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      // When: the abandoned work rejects after expiry
      deferred.reject(new Error('late provider failure'))
      await Promise.resolve()
      await Promise.resolve()

      // Then: the rejection is handled (no unhandledRejection event) and ignored
      expect(unhandled).toHaveLength(0)
      await expect(race).resolves.toEqual({ kind: 'expired' })
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('lets abort win over expiry', async () => {
    // Given: deferred work racing a deadline with an external abort signal
    const fake = createFakeClock()
    const deferred = createDeferred<string>()
    const controller = new AbortController()
    const race = raceWithDeadline(deferred.promise, 1_000, { clock: fake.clock, signal: controller.signal })

    // When: the signal aborts before the deadline fires
    controller.abort()
    fake.advanceTime(1_000)

    // Then: the race resolves as aborted, never as expired
    await expect(race).resolves.toEqual({ kind: 'aborted' })
  })

  it('resolves as aborted when the signal is already aborted on entry', async () => {
    // Given: an already-aborted signal passed into the race
    const fake = createFakeClock()
    const deferred = createDeferred<string>()
    const controller = new AbortController()
    controller.abort()

    // When: the race starts with that signal
    const race = raceWithDeadline(deferred.promise, 1_000, { clock: fake.clock, signal: controller.signal })

    // Then: the race resolves as aborted without waiting for the deadline
    await expect(race).resolves.toEqual({ kind: 'aborted' })
  })

  it('keeps the race pending until the injected deadline fires', async () => {
    // Given: deferred work and a scheduled deadline timer
    const fake = createFakeClock()
    const deferred = createDeferred<string>()
    const race = raceWithDeadline(deferred.promise, 500, { clock: fake.clock })

    // When: time advances but stays under the deadline
    fake.advanceTime(499)

    // Then: the race has not settled yet
    await expect(Promise.race([race, Promise.resolve('pending')])).resolves.toBe('pending')

    // And: the deadline fires when time reaches it
    fake.advanceTime(1)
    await expect(race).resolves.toEqual({ kind: 'expired' })
  })
})
