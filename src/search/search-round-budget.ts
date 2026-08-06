/**
 * Round budget and deadline policy for the bounded multi-round search controller.
 *
 * `raceWithDeadline` implements PIPELINE-LEVEL abandonment, NOT transport
 * cancellation: LLM/backend requests carry no request-level AbortSignal today
 * (see `src/llm/types.ts` — `LLMRequest` has no signal field), so when a
 * deadline settles the pipeline stops awaiting the in-flight provider promise
 * and proceeds with what it has (final phase2 synthesis, partial success, or a
 * typed timeout). Both fulfillment and rejection handlers are attached to the
 * underlying promise immediately, so a late provider settle is observed but can
 * never surface as an unhandled rejection or schedule later pipeline work.
 */

/**
 * Budget policy for one search execution.
 */
export interface SearchRoundPolicy {
  /** Maximum sequential search rounds (each round runs phase1 -> backend once). */
  maxRounds: number
  /** Maximum phase1 replan calls across all rounds. */
  maxReplans: number
  /** Time reserved for the final phase2 synthesis after the last round. */
  phase2ReserveMs: number
  /** Time reserved for handing the result back to the child runner. */
  handoffReserveMs: number
}

/**
 * Default policy: a single round, no replans, and only the handoff window
 * reserved so direct/legacy one-round search keeps today's near-full-budget
 * behavior.
 */
export const ONE_ROUND_SEARCH_POLICY: SearchRoundPolicy = {
  maxRounds: 1,
  maxReplans: 0,
  phase2ReserveMs: 0,
  handoffReserveMs: 1000,
}

/**
 * Production policy: up to three sequential rounds, at most two replans, 14s
 * reserved for the final phase2 synthesis and 1s for the runner handoff.
 */
export const MULTI_ROUND_SEARCH_POLICY: SearchRoundPolicy = {
  maxRounds: 3,
  maxReplans: 2,
  phase2ReserveMs: 14_000,
  handoffReserveMs: 1_000,
}

/** Absolute deadlines derived from a total budget, in milliseconds. */
export interface RoundDeadlines {
  /** Latest ms by which the current round (phase1 + backend) must settle. */
  roundDeadlineMs: number
  /** Latest ms by which the whole search, including final phase2, must settle. */
  completionDeadlineMs: number
}

/** Budget at which configured reserves apply at their full size (default child wait). */
const REFERENCE_TOTAL_BUDGET_MS = 60_000

/**
 * Scale a configured reserve proportionally for short budgets so a small test
 * budget never becomes instantly impossible (e.g. 120ms stays reachable).
 */
function scaleReserve(reserveMs: number, totalBudgetMs: number): number {
  const proportional = totalBudgetMs * (reserveMs / REFERENCE_TOTAL_BUDGET_MS)
  return Math.max(0, Math.min(reserveMs, Math.floor(proportional)))
}

/**
 * Compute the round and completion deadlines for a total budget and policy.
 *
 * For a 60s budget under `MULTI_ROUND_SEARCH_POLICY` this yields a 45s round
 * deadline (60s - 14s phase2 reserve - 1s handoff reserve) and a 59s completion
 * deadline (60s - 1s handoff reserve). Reserves scale down proportionally for
 * short budgets so deadlines stay positive and reachable.
 */
export function computeRoundDeadlines(totalBudgetMs: number, policy: SearchRoundPolicy): RoundDeadlines {
  if (totalBudgetMs <= 0) {
    return { roundDeadlineMs: 0, completionDeadlineMs: 0 }
  }
  const phase2Reserve = scaleReserve(policy.phase2ReserveMs, totalBudgetMs)
  const handoffReserve = scaleReserve(policy.handoffReserveMs, totalBudgetMs)
  return {
    roundDeadlineMs: Math.max(0, totalBudgetMs - phase2Reserve - handoffReserve),
    completionDeadlineMs: Math.max(0, totalBudgetMs - handoffReserve),
  }
}

/** Exhaustive outcome of `raceWithDeadline`. */
export type DeadlineRaceResult<T> = { kind: 'settled'; value: T } | { kind: 'expired' } | { kind: 'aborted' }

/**
 * Injectable clock for deterministic tests (no wall-clock dependency). Expiry
 * is driven by the scheduled timer; `now()` is part of the clock contract so a
 * fake clock can also advance time and report it.
 */
export interface DeadlineClock {
  now(): number
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(handle: number): void
}

const defaultClock: DeadlineClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => Number(setTimeout(fn, ms)),
  clearTimeout: (handle) => clearTimeout(handle),
}

export interface DeadlineRaceOptions {
  clock?: DeadlineClock
  signal?: AbortSignal
}

/**
 * Race a promise against a deadline and an optional external abort signal.
 *
 * Resolves with `{ kind: 'settled', value }` when the promise settles before
 * the deadline, `{ kind: 'expired' }` when the deadline fires first, or
 * `{ kind: 'aborted' }` when the signal aborts — abort wins over expiry. If the
 * underlying promise REJECTS before deadline/abort, the race rejects with that
 * error so a real pre-deadline failure can still reach the caller.
 *
 * Both handlers are attached to the underlying promise immediately: a late
 * settle after expiry/abort is observed and swallowed, so it can never advance
 * the pipeline or become an unhandled rejection.
 */
export function raceWithDeadline<T>(
  promise: Promise<T>,
  deadlineMs: number,
  options: DeadlineRaceOptions = {},
): Promise<DeadlineRaceResult<T>> {
  const clock = options.clock ?? defaultClock
  const signal = options.signal

  return new Promise<DeadlineRaceResult<T>>((resolve, reject) => {
    let settled = false
    let timer: number | undefined

    const onAbort = (): void => {
      // Abort wins over expiry: a cancelled pipeline must not run further work.
      finish({ kind: 'aborted' })
    }

    const cleanup = (): void => {
      if (timer !== undefined) clock.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    const finish = (result: DeadlineRaceResult<T>): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const onRejected = (error: unknown): void => {
      if (settled) {
        // Late rejection after expiry/abort: observed (handler attached), swallowed.
        return
      }
      settled = true
      cleanup()
      reject(error)
    }

    timer = clock.setTimeout(
      () => {
        if (signal?.aborted) finish({ kind: 'aborted' })
        else finish({ kind: 'expired' })
      },
      Math.max(0, deadlineMs),
    )

    if (signal?.aborted) onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })

    promise.then(
      (value) => finish({ kind: 'settled', value }),
      (error: unknown) => onRejected(error),
    )
  })
}
