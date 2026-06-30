import { describe, it, expect, vi } from 'vitest'
import type { Page, Mouse, Keyboard } from 'playwright-core'
import {
  mapOwnershipToState,
  mapRouteInputToEvent,
  dispatchInputToPage,
  BrowserInputParseError,
} from '../../../src/api/routes/browser-sessions-helpers.js'
import type { OwnershipState } from '../../../src/search/browser/browser-session-types.js'

// ─── Test doubles ────────────────────────────────────────────────────────────
//
// A minimal typed fake for the Playwright `Page` surface exercised by
// `dispatchInputToPage`. We only implement `mouse`, `keyboard`, and `goto`;
// each method is a `vi.fn()` so tests can assert call args.

function createPageFake(): Page {
  const mouse = {
    click: vi.fn().mockResolvedValue(undefined),
    wheel: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mouse & { click: ReturnType<typeof vi.fn>; wheel: ReturnType<typeof vi.fn> }

  const keyboard = {
    press: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
  } as unknown as Keyboard & { press: ReturnType<typeof vi.fn>; type: ReturnType<typeof vi.fn> }

  const goto = vi.fn().mockResolvedValue(undefined)
  const viewportSize = vi.fn().mockReturnValue({ width: 1280, height: 720 })

  return {
    mouse,
    keyboard,
    goto,
    viewportSize,
  } as unknown as Page & { goto: ReturnType<typeof vi.fn>; viewportSize: ReturnType<typeof vi.fn> }
}

// ─── mapOwnershipToState ─────────────────────────────────────────────────────

describe('mapOwnershipToState', () => {
  it.each<[OwnershipState, 'idle' | 'agent_controlled' | 'user_controlled' | 'handoff_requested']>([
    ['agent_controlled', 'agent_controlled'],
    ['resuming', 'agent_controlled'],
    ['handoff_requested', 'handoff_requested'],
    ['human_controlled', 'user_controlled'],
    ['closed', 'idle'],
    ['error', 'idle'],
  ])('maps %s -> %s', (ownership, expected) => {
    expect(mapOwnershipToState(ownership)).toBe(expected)
  })
})

// ─── mapRouteInputToEvent ────────────────────────────────────────────────────

describe('mapRouteInputToEvent', () => {
  describe('click', () => {
    it('parses a valid normalized click into a click event', () => {
      // Given: a valid click payload with normalized x/y in [0,1]
      // When: mapRouteInputToEvent parses it
      // Then: the resulting event has the same coordinates and defaults
      const event = mapRouteInputToEvent('click', { x: 0.5, y: 0.3 })
      expect(event).toEqual({
        kind: 'click',
        x: 0.5,
        y: 0.3,
        button: 'left',
        clickCount: 1,
      })
    })

    it('rejects an out-of-range x coordinate', () => {
      // Given: x = 2 (outside [0,1])
      // When: mapRouteInputToEvent parses it
      // Then: it throws a BrowserInputParseError with OUT_OF_RANGE code
      expect(() => mapRouteInputToEvent('click', { x: 2, y: 0.3 })).toThrow(BrowserInputParseError)
      expect(() => mapRouteInputToEvent('click', { x: 2, y: 0.3 })).toThrow(/OUT_OF_RANGE/)
    })

    it('rejects a non-number x coordinate', () => {
      expect(() => mapRouteInputToEvent('click', { x: 'a', y: 0.3 })).toThrow(BrowserInputParseError)
      expect(() => mapRouteInputToEvent('click', { x: 'a', y: 0.3 })).toThrow(/INVALID_NUMBER/)
    })

    it('rejects an invalid button value', () => {
      expect(() =>
        mapRouteInputToEvent('click', { x: 0.5, y: 0.3, button: 'sideways' }),
      ).toThrow(BrowserInputParseError)
      expect(() =>
        mapRouteInputToEvent('click', { x: 0.5, y: 0.3, button: 'sideways' }),
      ).toThrow(/INVALID_BUTTON/)
    })
  })

  describe('keypress', () => {
    it('parses a valid keypress into a key event', () => {
      const event = mapRouteInputToEvent('keypress', { key: 'Enter', modifiers: ['Shift'] })
      expect(event).toEqual({ kind: 'key', key: 'Enter', modifiers: ['Shift'] })
    })

    it('defaults modifiers to an empty array', () => {
      const event = mapRouteInputToEvent('keypress', { key: 'Enter' })
      expect(event).toEqual({ kind: 'key', key: 'Enter', modifiers: [] })
    })

    it('rejects a missing key', () => {
      expect(() => mapRouteInputToEvent('keypress', {})).toThrow(BrowserInputParseError)
      expect(() => mapRouteInputToEvent('keypress', {})).toThrow(/INVALID_STRING/)
    })
  })

  describe('type', () => {
    it('parses valid text into a text event', () => {
      const event = mapRouteInputToEvent('type', { text: 'hello' })
      expect(event).toEqual({ kind: 'text', text: 'hello' })
    })

    it('rejects an empty string', () => {
      expect(() => mapRouteInputToEvent('type', { text: '' })).toThrow(BrowserInputParseError)
      expect(() => mapRouteInputToEvent('type', { text: '' })).toThrow(/INVALID_STRING/)
    })
  })

  describe('scroll', () => {
    it('parses a valid scroll into a scroll event', () => {
      const event = mapRouteInputToEvent('scroll', { deltaX: 10, deltaY: -20 })
      expect(event).toEqual({ kind: 'scroll', x: 0, y: 0, deltaX: 10, deltaY: -20 })
    })

    it('accepts explicit x/y scroll origin', () => {
      const event = mapRouteInputToEvent('scroll', { x: 100, y: 200, deltaX: 0, deltaY: 5 })
      expect(event).toEqual({ kind: 'scroll', x: 100, y: 200, deltaX: 0, deltaY: 5 })
    })

    it('rejects a non-numeric deltaX', () => {
      expect(() => mapRouteInputToEvent('scroll', { deltaX: 'fast', deltaY: 0 })).toThrow(
        BrowserInputParseError,
      )
      expect(() => mapRouteInputToEvent('scroll', { deltaX: 'fast', deltaY: 0 })).toThrow(
        /INVALID_NUMBER/,
      )
    })
  })

  describe('navigate', () => {
    it('parses a valid navigate into a navigate event', () => {
      const event = mapRouteInputToEvent('navigate', { url: 'https://example.com' })
      expect(event).toEqual({ kind: 'navigate', url: 'https://example.com' })
    })

    it('rejects a missing url', () => {
      expect(() => mapRouteInputToEvent('navigate', {})).toThrow(BrowserInputParseError)
      expect(() => mapRouteInputToEvent('navigate', {})).toThrow(/INVALID_STRING/)
    })
  })

  describe('unknown action', () => {
    it('throws a BrowserInputParseError with UNKNOWN_ACTION code', () => {
      expect(() => mapRouteInputToEvent('drag', { x: 0 })).toThrow(BrowserInputParseError)
      expect(() => mapRouteInputToEvent('drag', { x: 0 })).toThrow(/UNKNOWN_ACTION/)
    })
  })
})

// ─── dispatchInputToPage ─────────────────────────────────────────────────────

describe('dispatchInputToPage', () => {
  it('calls page.mouse.click with viewport-scaled coordinates and options', async () => {
    // Given: a click event with normalized x/y in [0,1] and a fake page with a
    //   1280x720 viewport
    // When: dispatchInputToPage runs
    // Then: page.mouse.click is called once with pixel coordinates
    //   (x*1280, y*720) and the button/clickCount options
    const page = createPageFake()
    const event = mapRouteInputToEvent('click', { x: 0.5, y: 0.3, button: 'right', clickCount: 2 })
    await dispatchInputToPage(page, event)
    expect(page.mouse.click).toHaveBeenCalledTimes(1)
    expect(page.mouse.click).toHaveBeenCalledWith(640, 216, { button: 'right', clickCount: 2 })
  })

  it('falls back to raw coordinates when viewportSize is null', async () => {
    // Given: a click event and a page whose viewportSize() returns null
    // When: dispatchInputToPage runs
    // Then: page.mouse.click is called with the raw normalized coordinates
    const page = createPageFake()
    ;(page.viewportSize as ReturnType<typeof vi.fn>).mockReturnValue(null)
    const event = mapRouteInputToEvent('click', { x: 0.5, y: 0.3 })
    await dispatchInputToPage(page, event)
    expect(page.mouse.click).toHaveBeenCalledWith(0.5, 0.3, { button: 'left', clickCount: 1 })
  })

  it('calls page.keyboard.press with the key event key', async () => {
    const page = createPageFake()
    const event = mapRouteInputToEvent('keypress', { key: 'Enter' })
    await dispatchInputToPage(page, event)
    expect(page.keyboard.press).toHaveBeenCalledTimes(1)
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter')
  })

  it('calls page.keyboard.type with the text event text', async () => {
    const page = createPageFake()
    const event = mapRouteInputToEvent('type', { text: 'hello world' })
    await dispatchInputToPage(page, event)
    expect(page.keyboard.type).toHaveBeenCalledTimes(1)
    expect(page.keyboard.type).toHaveBeenCalledWith('hello world')
  })

  it('calls page.mouse.wheel with the scroll event deltas', async () => {
    const page = createPageFake()
    const event = mapRouteInputToEvent('scroll', { deltaX: 10, deltaY: -20 })
    await dispatchInputToPage(page, event)
    expect(page.mouse.wheel).toHaveBeenCalledTimes(1)
    expect(page.mouse.wheel).toHaveBeenCalledWith(10, -20)
  })

  it('calls page.goto with the navigate event url', async () => {
    const page = createPageFake()
    const event = mapRouteInputToEvent('navigate', { url: 'https://example.com' })
    await dispatchInputToPage(page, event)
    expect(page.goto).toHaveBeenCalledTimes(1)
    expect(page.goto).toHaveBeenCalledWith('https://example.com')
  })
})