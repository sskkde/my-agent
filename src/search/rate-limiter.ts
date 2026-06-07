import type { ProviderName } from './types.js'

interface RateLimiterConfig {
  minIntervalMs: number
  maxJitterMs: number
  now?: () => number
  sleep?: (ms: number) => void
  random?: () => number
}

interface ProviderState {
  lastAcquireTime: number
  initialized: boolean
}

export class SearchRateLimiter {
  private readonly minIntervalMs: number
  private readonly maxJitterMs: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => void
  private readonly random: () => number
  private readonly providerStates: Map<string, ProviderState> = new Map()
  private readonly globalState: ProviderState = { lastAcquireTime: 0, initialized: false }

  constructor(config: RateLimiterConfig) {
    this.minIntervalMs = config.minIntervalMs
    this.maxJitterMs = config.maxJitterMs
    this.now = config.now ?? (() => Date.now())
    this.sleep =
      config.sleep ??
      ((ms: number) => {
        const start = this.now()
        while (this.now() - start < ms) {
          // Busy wait
        }
      })
    this.random = config.random ?? Math.random
  }

  acquire(provider?: ProviderName): void {
    const state = provider ? this.getOrCreateProviderState(provider) : this.globalState
    const currentTime = this.now()

    if (state.initialized) {
      const elapsed = currentTime - state.lastAcquireTime
      const jitter = this.maxJitterMs > 0 ? this.random() * this.maxJitterMs : 0
      const requiredWait = this.minIntervalMs + jitter

      if (elapsed < requiredWait) {
        const waitTime = Math.ceil(requiredWait - elapsed)
        this.sleep(waitTime)
      }
    }

    state.lastAcquireTime = this.now()
    state.initialized = true
  }

  private getOrCreateProviderState(provider: ProviderName): ProviderState {
    const key = String(provider)
    let state = this.providerStates.get(key)
    if (!state) {
      state = { lastAcquireTime: 0, initialized: false }
      this.providerStates.set(key, state)
    }
    return state
  }
}
