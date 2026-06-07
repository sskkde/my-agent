import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  writable: true,
  value: vi.fn(),
})

afterEach(() => {
  cleanup()
})

/* ==========================================================================
   Responsive Test Helpers
   ==========================================================================
   Breakpoint conventions:
   - Phone: <480px
   - Tablet: 480px-768px
   - Compact shell drawer: <=1100px
   - Desktop: >1100px
   ========================================================================== */

/**
 * Breakpoint values for responsive testing
 */
export const BREAKPOINTS = {
  PHONE: 480,
  TABLET: 768,
  COMPACT: 1100,
} as const

/**
 * Media query strings for responsive breakpoints
 */
export const MEDIA_QUERIES = {
  PHONE: `(max-width: ${BREAKPOINTS.PHONE - 1}px)`,
  TABLET: `(min-width: ${BREAKPOINTS.PHONE}px) and (max-width: ${BREAKPOINTS.TABLET}px)`,
  TABLET_AND_BELOW: `(max-width: ${BREAKPOINTS.TABLET}px)`,
  COMPACT: `(max-width: ${BREAKPOINTS.COMPACT}px)`,
  DESKTOP: `(min-width: ${BREAKPOINTS.COMPACT + 1}px)`,
} as const

/**
 * Mock matchMedia for responsive testing
 * @param matches - Whether the media query should match
 * @param query - The media query string (optional, defaults to COMPACT breakpoint)
 */
export function mockMatchMedia(matches: boolean, query: string = MEDIA_QUERIES.COMPACT) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: q === query ? matches : false,
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

/**
 * Mock matchMedia for specific viewport widths
 * @param width - Viewport width in pixels
 */
export function mockViewport(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      let matches = false
      if (query.includes('max-width')) {
        const maxWidth = parseInt(query.match(/max-width:\s*(\d+)px/)?.[1] || '0', 10)
        matches = width <= maxWidth
      } else if (query.includes('min-width')) {
        const minWidth = parseInt(query.match(/min-width:\s*(\d+)px/)?.[1] || '0', 10)
        matches = width >= minWidth
      }

      return {
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }
    }),
  })
}

/**
 * Reset matchMedia mock to default state
 */
export function resetMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(),
  })
}
