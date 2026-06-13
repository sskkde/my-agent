import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readStoredTheme, applyDocumentTheme, THEME_STORAGE_KEY } from './theme-storage'

describe('theme-storage', () => {
  const originalLocalStorage = window.localStorage

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset document theme
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    // Restore localStorage
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    })
  })

  describe('readStoredTheme', () => {
    it('returns "default" when localStorage throws an exception', () => {
      // Mock localStorage to throw an error
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: vi.fn(() => {
            throw new Error('localStorage unavailable')
          }),
          setItem: vi.fn(),
          removeItem: vi.fn(),
          clear: vi.fn(),
          key: vi.fn(),
          length: 0,
        },
        writable: true,
        configurable: true,
      })

      const theme = readStoredTheme()
      expect(theme).toBe('default')
    })

    it('returns "default" when localStorage returns an unknown theme', () => {
      // Mock localStorage to return an invalid theme
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: vi.fn(() => 'invalid-theme'),
          setItem: vi.fn(),
          removeItem: vi.fn(),
          clear: vi.fn(),
          key: vi.fn(),
          length: 0,
        },
        writable: true,
        configurable: true,
      })

      const theme = readStoredTheme()
      expect(theme).toBe('default')
    })

    it('returns "default" when localStorage returns null', () => {
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: vi.fn(() => null),
          setItem: vi.fn(),
          removeItem: vi.fn(),
          clear: vi.fn(),
          key: vi.fn(),
          length: 0,
        },
        writable: true,
        configurable: true,
      })

      const theme = readStoredTheme()
      expect(theme).toBe('default')
    })

    it('returns "default" when stored theme is "default"', () => {
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: vi.fn(() => 'default'),
          setItem: vi.fn(),
          removeItem: vi.fn(),
          clear: vi.fn(),
          key: vi.fn(),
          length: 0,
        },
        writable: true,
        configurable: true,
      })

      const theme = readStoredTheme()
      expect(theme).toBe('default')
    })

    it('returns "warm-paper" when stored theme is "warm-paper"', () => {
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: vi.fn(() => 'warm-paper'),
          setItem: vi.fn(),
          removeItem: vi.fn(),
          clear: vi.fn(),
          key: vi.fn(),
          length: 0,
        },
        writable: true,
        configurable: true,
      })

      const theme = readStoredTheme()
      expect(theme).toBe('warm-paper')
    })

    it('returns "dark" when stored theme is "dark"', () => {
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: vi.fn(() => 'dark'),
          setItem: vi.fn(),
          removeItem: vi.fn(),
          clear: vi.fn(),
          key: vi.fn(),
          length: 0,
        },
        writable: true,
        configurable: true,
      })

      const theme = readStoredTheme()
      expect(theme).toBe('dark')
    })

    it('returns "default" when stored theme is empty string', () => {
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: vi.fn(() => ''),
          setItem: vi.fn(),
          removeItem: vi.fn(),
          clear: vi.fn(),
          key: vi.fn(),
          length: 0,
        },
        writable: true,
        configurable: true,
      })

      const theme = readStoredTheme()
      expect(theme).toBe('default')
    })
  })

  describe('applyDocumentTheme', () => {
    it('applies theme to document.documentElement.dataset.theme', () => {
      applyDocumentTheme('dark')
      expect(document.documentElement.dataset.theme).toBe('dark')
    })

    it('applies "warm-paper" theme correctly', () => {
      applyDocumentTheme('warm-paper')
      expect(document.documentElement.dataset.theme).toBe('warm-paper')
    })

    it('applies "default" theme correctly', () => {
      applyDocumentTheme('default')
      expect(document.documentElement.dataset.theme).toBe('default')
    })
  })

  describe('THEME_STORAGE_KEY', () => {
    it('has correct storage key value', () => {
      expect(THEME_STORAGE_KEY).toBe('agent-platform-theme')
    })
  })
})
