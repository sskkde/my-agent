import type { ProviderName } from './types.js'

interface RateLimiterConfig {
  minIntervalMs: number
  maxJitterMs: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
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
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number
  private readonly providerStates: Map<string, ProviderState> = new Map()
  private readonly globalState: ProviderState = { lastAcquireTime: 0, initialized: false }

  constructor(config: RateLimiterConfig) {
    this.minIntervalMs = config.minIntervalMs
    this.maxJitterMs = config.maxJitterMs
    this.now = config.now ?? (() => Date.now())
    this.sleep =
      config.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    this.random = config.random ?? Math.random
  }

  async acquire(provider?: ProviderName): Promise<void> {
    const state = provider ? this.getOrCreateProviderState(provider) : this.globalState
    const currentTime = this.now()

    if (state.initialized) {
      const elapsed = currentTime - state.lastAcquireTime
      const jitter = this.maxJitterMs > 0 ? this.random() * this.maxJitterMs : 0
      const requiredWait = this.minIntervalMs + jitter

      if (elapsed < requiredWait) {
        const waitTime = Math.ceil(requiredWait - elapsed)
        await this.sleep(waitTime)
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
