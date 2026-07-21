import { describe, it, expect, afterEach } from 'vitest'
import {
  registerRunAbort,
  abortRun,
  unregisterRunAbort,
  isRunRegistered,
} from '../../../src/kernel/run-abort-registry.js'

describe('run-abort-registry', () => {
  afterEach(() => {
    // Clean up any test registrations
    // We iterate known test IDs since registry is module-level
    for (const id of ['test-run-1', 'test-run-2']) {
      unregisterRunAbort(id)
    }
  })

  it('register + abort should trigger abort on the controller', () => {
    const controller = new AbortController()
    registerRunAbort('test-run-1', controller)

    expect(controller.signal.aborted).toBe(false)
    const result = abortRun('test-run-1')
    expect(result).toBe(true)
    expect(controller.signal.aborted).toBe(true)
  })

  it('register + unregister should make abort return false', () => {
    const controller = new AbortController()
    registerRunAbort('test-run-1', controller)
    unregisterRunAbort('test-run-1')

    const result = abortRun('test-run-1')
    expect(result).toBe(false)
    // Controller should NOT have been aborted
    expect(controller.signal.aborted).toBe(false)
  })

  it('abort unknown runId should return false without throwing', () => {
    const result = abortRun('nonexistent-run-id')
    expect(result).toBe(false)
  })

  it('double register same id should overwrite first', () => {
    const controller1 = new AbortController()
    const controller2 = new AbortController()
    registerRunAbort('test-run-1', controller1)
    registerRunAbort('test-run-1', controller2)

    // abort should find the second controller, not the first
    abortRun('test-run-1')
    expect(controller1.signal.aborted).toBe(false)
    expect(controller2.signal.aborted).toBe(true)
  })

  it('isRunRegistered should return true for registered and false after unregister', () => {
    const controller = new AbortController()
    registerRunAbort('test-run-1', controller)
    expect(isRunRegistered('test-run-1')).toBe(true)
    unregisterRunAbort('test-run-1')
    expect(isRunRegistered('test-run-1')).toBe(false)
  })
})
