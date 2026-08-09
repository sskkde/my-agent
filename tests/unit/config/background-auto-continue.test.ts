/**
 * Background auto-continue configuration tests.
 *
 * Covers the AUTO_CONTINUE_ON_BACKGROUND_COMPLETE env switch: default-on,
 * 'false'/'0' disable, case-insensitive truthy variants stay on.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getBackgroundAutoContinueEnabled } from '../../../src/config/background-auto-continue.js'

const ENV_KEY = 'AUTO_CONTINUE_ON_BACKGROUND_COMPLETE'

describe('Background auto-continue configuration', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env[ENV_KEY]
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY]
    } else {
      process.env[ENV_KEY] = original
    }
  })

  it('returns true when env is absent (default ON)', () => {
    expect(getBackgroundAutoContinueEnabled()).toBe(true)
  })

  it("returns false when env is 'false'", () => {
    process.env[ENV_KEY] = 'false'
    expect(getBackgroundAutoContinueEnabled()).toBe(false)
  })

  it("returns false when env is '0'", () => {
    process.env[ENV_KEY] = '0'
    expect(getBackgroundAutoContinueEnabled()).toBe(false)
  })

  it("returns true when env is 'TRUE' (case-insensitive truthy)", () => {
    process.env[ENV_KEY] = 'TRUE'
    expect(getBackgroundAutoContinueEnabled()).toBe(true)
  })
})
