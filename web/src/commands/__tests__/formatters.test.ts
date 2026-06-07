import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createCommandEvent } from '../formatters.js'
import type { FrontendCommandResult } from '../types.js'

describe('createCommandEvent', () => {
  const mockSessionId = 'test-session-123'

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should create a successful command event', () => {
    const result: FrontendCommandResult = {
      success: true,
      output: { type: 'text', content: 'Command executed successfully' },
      commandName: 'help',
    }

    const event = createCommandEvent(result, mockSessionId)

    expect(event.eventId).toMatch(/^local-command-\d+-\d+$/)
    expect(event.eventType).toBe('system_status')
    expect(event.sessionId).toBe(mockSessionId)
    expect(event.timestamp).toBe('2024-01-01T00:00:00.000Z')
    expect(event.content).toBe('Command executed successfully')
    expect(event.actor).toBe('command')
    expect(event.metadata).toEqual({
      commandName: 'help',
      success: true,
    })
  })

  it('should create an error command event', () => {
    const result: FrontendCommandResult = {
      success: false,
      output: { type: 'error', content: 'Command failed with error' },
      error: 'Command failed with error',
      commandName: 'unknown',
    }

    const event = createCommandEvent(result, mockSessionId)

    expect(event.eventType).toBe('error')
    expect(event.content).toBe('Command failed with error')
    expect(event.metadata).toEqual({
      commandName: 'unknown',
      success: false,
    })
  })

  it('should handle missing output', () => {
    const result: FrontendCommandResult = {
      success: true,
      commandName: 'status',
    }

    const event = createCommandEvent(result, mockSessionId)

    expect(event.content).toBe('')
  })

  it('should handle missing error', () => {
    const result: FrontendCommandResult = {
      success: false,
      output: { type: 'error', content: 'Command failed' },
      error: 'Command failed',
      commandName: 'fail',
    }

    const event = createCommandEvent(result, mockSessionId)

    expect(event.eventType).toBe('error')
    expect(event.content).toBe('Command failed')
  })

  it('should strip ANSI escape codes from output', () => {
    const result: FrontendCommandResult = {
      success: true,
      output: { type: 'text', content: '\u001b[32mSuccess\u001b[0m \u001b[1mBold\u001b[22m text' },
      commandName: 'status',
    }

    const event = createCommandEvent(result, mockSessionId)

    expect(event.content).toBe('Success Bold text')
  })

  it('should truncate very long output', () => {
    const longOutput = 'a'.repeat(15000)
    const result: FrontendCommandResult = {
      success: true,
      output: { type: 'text', content: longOutput },
      commandName: 'logs',
    }

    const event = createCommandEvent(result, mockSessionId)

    expect(event.content?.length).toBeLessThan(15000)
    expect(event.content).toContain('... (output truncated)')
  })

  it('should generate unique event IDs with incrementing counter', () => {
    const result1: FrontendCommandResult = {
      success: true,
      output: { type: 'text', content: 'First' },
      commandName: 'cmd1',
    }
    const result2: FrontendCommandResult = {
      success: true,
      output: { type: 'text', content: 'Second' },
      commandName: 'cmd2',
    }

    vi.advanceTimersByTime(1)
    const event1 = createCommandEvent(result1, mockSessionId)

    vi.advanceTimersByTime(1)
    const event2 = createCommandEvent(result2, mockSessionId)

    expect(event1.eventId).not.toBe(event2.eventId)
    expect(event1.eventId).toMatch(/-1$/)
    expect(event2.eventId).toMatch(/-2$/)
  })

  it('should handle localStorage being unavailable gracefully', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage unavailable')
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('localStorage unavailable')
    })

    const result: FrontendCommandResult = {
      success: true,
      output: { type: 'text', content: 'Test' },
      commandName: 'test',
    }

    expect(() => createCommandEvent(result, mockSessionId)).not.toThrow()
    const event = createCommandEvent(result, mockSessionId)
    expect(event.eventId).toMatch(/^local-command-\d+-\d+$/)

    getItemSpy.mockRestore()
    setItemSpy.mockRestore()
  })

  it('should handle empty string output', () => {
    const result: FrontendCommandResult = {
      success: true,
      output: { type: 'text', content: '' },
      commandName: 'empty',
    }

    const event = createCommandEvent(result, mockSessionId)

    expect(event.content).toBe('')
  })

  it('should preserve metadata about the command', () => {
    const result: FrontendCommandResult = {
      success: true,
      output: { type: 'text', content: 'Done' },
      commandName: 'session',
    }

    const event = createCommandEvent(result, mockSessionId)

    expect(event.metadata?.commandName).toBe('session')
    expect(event.metadata?.success).toBe(true)
  })
})
