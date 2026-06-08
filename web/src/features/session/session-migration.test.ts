import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isValidSessionId,
  safeReadLocalStorage,
  resolveSessionId,
  getSessionIdFromUrl,
  isPreservedKey,
  PRESERVED_LOCAL_STORAGE_KEYS,
} from './session-migration'

describe('session-migration', () => {
  describe('isValidSessionId', () => {
    it('should return true for valid session IDs', () => {
      expect(isValidSessionId('ses_abc123')).toBe(true)
      expect(isValidSessionId('ses_test-session-id')).toBe(true)
      expect(isValidSessionId('ses_1234567890')).toBe(true)
      expect(isValidSessionId('ses_ABCdefGHI')).toBe(true)
    })

    it('should return false for invalid session IDs', () => {
      expect(isValidSessionId('')).toBe(false)
      expect(isValidSessionId('   ')).toBe(false)
      expect(isValidSessionId('invalid')).toBe(false)
      expect(isValidSessionId('ses_')).toBe(false)
      expect(isValidSessionId('ses_abc!@#')).toBe(false)
      expect(isValidSessionId(null)).toBe(false)
      expect(isValidSessionId(undefined)).toBe(false)
      expect(isValidSessionId(123)).toBe(false)
      expect(isValidSessionId({})).toBe(false)
    })

    it('should handle edge cases', () => {
      expect(isValidSessionId('ses_a')).toBe(true)
      expect(isValidSessionId('ses_1')).toBe(true)
      expect(isValidSessionId('ses_-')).toBe(true)
    })
  })

  describe('safeReadLocalStorage', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    it('should return value for valid localStorage entries', () => {
      localStorage.setItem('test-key', 'ses_abc123')
      expect(safeReadLocalStorage('test-key')).toBe('ses_abc123')
    })

    it('should return null for missing keys', () => {
      expect(safeReadLocalStorage('nonexistent-key')).toBe(null)
    })

    it('should return null for empty strings (malformed)', () => {
      localStorage.setItem('test-key', '')
      expect(safeReadLocalStorage('test-key')).toBe(null)
    })

    it('should return null for whitespace-only strings (malformed)', () => {
      localStorage.setItem('test-key', '   ')
      expect(safeReadLocalStorage('test-key')).toBe(null)
    })

    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw an error
      const originalGetItem = localStorage.getItem
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('localStorage unavailable')
      })

      expect(safeReadLocalStorage('test-key')).toBe(null)

      localStorage.getItem = originalGetItem
    })
  })

  describe('resolveSessionId', () => {
    it('should prefer valid URL session ID over localStorage', () => {
      const urlSessionId = 'ses_url123'
      const localStorageValue = 'ses_local456'
      expect(resolveSessionId(urlSessionId, localStorageValue)).toBe('ses_url123')
    })

    it('should use localStorage as fallback when URL has no session', () => {
      const urlSessionId = null
      const localStorageValue = 'ses_local456'
      expect(resolveSessionId(urlSessionId, localStorageValue)).toBe('ses_local456')
    })

    it('should use localStorage when URL session ID is invalid', () => {
      const urlSessionId = 'invalid'
      const localStorageValue = 'ses_local456'
      expect(resolveSessionId(urlSessionId, localStorageValue)).toBe('ses_local456')
    })

    it('should return null when both are null', () => {
      expect(resolveSessionId(null, null)).toBe(null)
    })

    it('should return null when both are invalid', () => {
      expect(resolveSessionId('invalid', 'also-invalid')).toBe(null)
    })

    it('should return null when URL is invalid and localStorage is null', () => {
      expect(resolveSessionId('invalid', null)).toBe(null)
    })

    it('should return null when URL is null and localStorage is invalid', () => {
      expect(resolveSessionId(null, 'invalid')).toBe(null)
    })

    it('should handle empty strings as invalid', () => {
      expect(resolveSessionId('', 'ses_local456')).toBe('ses_local456')
      expect(resolveSessionId('ses_url123', '')).toBe('ses_url123')
      expect(resolveSessionId('', '')).toBe(null)
    })

    it('should handle whitespace strings as invalid', () => {
      expect(resolveSessionId('   ', 'ses_local456')).toBe('ses_local456')
      expect(resolveSessionId('ses_url123', '   ')).toBe('ses_url123')
    })
  })

  describe('getSessionIdFromUrl', () => {
    it('should extract valid session ID from URL params', () => {
      const searchParams = new URLSearchParams('?session=ses_abc123')
      expect(getSessionIdFromUrl(searchParams)).toBe('ses_abc123')
    })

    it('should return null for missing session param', () => {
      const searchParams = new URLSearchParams('?other=value')
      expect(getSessionIdFromUrl(searchParams)).toBe(null)
    })

    it('should return null for invalid session ID in URL', () => {
      const searchParams = new URLSearchParams('?session=invalid')
      expect(getSessionIdFromUrl(searchParams)).toBe(null)
    })

    it('should return null for empty session param', () => {
      const searchParams = new URLSearchParams('?session=')
      expect(getSessionIdFromUrl(searchParams)).toBe(null)
    })

    it('should handle multiple URL params', () => {
      const searchParams = new URLSearchParams('?foo=bar&session=ses_test123&baz=qux')
      expect(getSessionIdFromUrl(searchParams)).toBe('ses_test123')
    })
  })

  describe('isPreservedKey', () => {
    it('should identify preserved keys', () => {
      expect(isPreservedKey('session-console-selected-session')).toBe(true)
      expect(isPreservedKey('event-counter')).toBe(true)
      expect(isPreservedKey('opencode-prefs')).toBe(true)
    })

    it('should reject non-preserved keys', () => {
      expect(isPreservedKey('random-key')).toBe(false)
      expect(isPreservedKey('session-console')).toBe(false)
      expect(isPreservedKey('')).toBe(false)
    })
  })

  describe('PRESERVED_LOCAL_STORAGE_KEYS', () => {
    it('should contain all expected preserved keys', () => {
      expect(PRESERVED_LOCAL_STORAGE_KEYS).toContain('session-console-selected-session')
      expect(PRESERVED_LOCAL_STORAGE_KEYS).toContain('event-counter')
      expect(PRESERVED_LOCAL_STORAGE_KEYS).toContain('opencode-prefs')
      expect(PRESERVED_LOCAL_STORAGE_KEYS).toHaveLength(3)
    })
  })

  describe('Integration: URL precedence over localStorage', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    it('should demonstrate URL wins over localStorage', () => {
      // Setup: localStorage has a session
      localStorage.setItem('session-console-selected-session', 'ses_local123')

      // URL also has a session
      const searchParams = new URLSearchParams('?session=ses_url456')
      const urlSessionId = getSessionIdFromUrl(searchParams)
      const localStorageValue = safeReadLocalStorage('session-console-selected-session')

      // URL should win
      const resolvedSessionId = resolveSessionId(urlSessionId, localStorageValue)
      expect(resolvedSessionId).toBe('ses_url456')
    })

    it('should demonstrate localStorage fallback when URL lacks session', () => {
      // Setup: localStorage has a session
      localStorage.setItem('session-console-selected-session', 'ses_local123')

      // URL has no session
      const searchParams = new URLSearchParams('?other=value')
      const urlSessionId = getSessionIdFromUrl(searchParams)
      const localStorageValue = safeReadLocalStorage('session-console-selected-session')

      // localStorage should be used
      const resolvedSessionId = resolveSessionId(urlSessionId, localStorageValue)
      expect(resolvedSessionId).toBe('ses_local123')
    })

    it('should demonstrate malformed localStorage is ignored safely', () => {
      // Setup: localStorage has malformed value
      localStorage.setItem('session-console-selected-session', '')

      // URL has no session
      const searchParams = new URLSearchParams('?other=value')
      const urlSessionId = getSessionIdFromUrl(searchParams)
      const localStorageValue = safeReadLocalStorage('session-console-selected-session')

      // Should return null (no crash, no valid session)
      const resolvedSessionId = resolveSessionId(urlSessionId, localStorageValue)
      expect(resolvedSessionId).toBe(null)
    })

    it('should preserve existing localStorage keys', () => {
      // Setup: all preserved keys exist
      localStorage.setItem('session-console-selected-session', 'ses_test123')
      localStorage.setItem('event-counter', '42')
      localStorage.setItem('opencode-prefs', '{"theme":"dark"}')

      // Verify all keys are preserved
      PRESERVED_LOCAL_STORAGE_KEYS.forEach((key) => {
        expect(isPreservedKey(key)).toBe(true)
        const value = localStorage.getItem(key)
        expect(value).not.toBe(null)
      })

      // Verify keys still exist after reading
      expect(localStorage.getItem('session-console-selected-session')).toBe('ses_test123')
      expect(localStorage.getItem('event-counter')).toBe('42')
      expect(localStorage.getItem('opencode-prefs')).toBe('{"theme":"dark"}')
    })
  })

  describe('Edge Cases', () => {
    it('should handle concurrent URL and localStorage with same session', () => {
      const sessionId = 'ses_same123'
      expect(resolveSessionId(sessionId, sessionId)).toBe(sessionId)
    })

    it('should handle very long session IDs', () => {
      const longId = 'ses_' + 'a'.repeat(1000)
      expect(isValidSessionId(longId)).toBe(true)
    })

    it('should handle session IDs with special characters (allowed)', () => {
      expect(isValidSessionId('ses_test-session_id')).toBe(true)
      expect(isValidSessionId('ses_ABC-123_XYZ')).toBe(true)
    })

    it('should reject session IDs with disallowed special characters', () => {
      expect(isValidSessionId('ses_test@id')).toBe(false)
      expect(isValidSessionId('ses_test#id')).toBe(false)
      expect(isValidSessionId('ses_test$id')).toBe(false)
      expect(isValidSessionId('ses_test%id')).toBe(false)
    })
  })
})
