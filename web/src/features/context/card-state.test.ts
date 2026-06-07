/**
 * Tests for Context Desk Card State Model
 */

import { describe, it, expect } from 'vitest'
import {
  loading,
  ready,
  empty,
  error,
  isLoading,
  isReady,
  isEmpty,
  isError,
} from './card-state'

describe('card-state', () => {
  describe('state factories', () => {
    it('creates loading state', () => {
      const state = loading('Loading data...')
      expect(state.status).toBe('loading')
      expect(state.message).toBe('Loading data...')
    })

    it('creates loading state without message', () => {
      const state = loading()
      expect(state.status).toBe('loading')
      expect(state.message).toBeUndefined()
    })

    it('creates ready state with data', () => {
      const data = { items: [1, 2, 3] }
      const state = ready(data, '2024-01-01T00:00:00Z')
      expect(state.status).toBe('ready')
      expect(state.data).toBe(data)
      expect(state.lastUpdated).toBe('2024-01-01T00:00:00Z')
    })

    it('creates ready state without timestamp', () => {
      const data = { items: [] }
      const state = ready(data)
      expect(state.status).toBe('ready')
      expect(state.data).toBe(data)
      expect(state.lastUpdated).toBeUndefined()
    })

    it('creates empty state', () => {
      const state = empty('No data available', 'Try refreshing')
      expect(state.status).toBe('empty')
      expect(state.message).toBe('No data available')
      expect(state.hint).toBe('Try refreshing')
    })

    it('creates empty state without hint', () => {
      const state = empty('No data available')
      expect(state.status).toBe('empty')
      expect(state.message).toBe('No data available')
      expect(state.hint).toBeUndefined()
    })

    it('creates error state', () => {
      const state = error('Network error', 'ERR_NETWORK', true)
      expect(state.status).toBe('error')
      expect(state.message).toBe('Network error')
      expect(state.code).toBe('ERR_NETWORK')
      expect(state.retryable).toBe(true)
    })

    it('creates error state with defaults', () => {
      const state = error('Unknown error')
      expect(state.status).toBe('error')
      expect(state.message).toBe('Unknown error')
      expect(state.code).toBeUndefined()
      expect(state.retryable).toBe(false)
    })
  })

  describe('type guards', () => {
    it('identifies loading state', () => {
      const state = loading()
      expect(isLoading(state)).toBe(true)
      expect(isReady(state)).toBe(false)
      expect(isEmpty(state)).toBe(false)
      expect(isError(state)).toBe(false)
    })

    it('identifies ready state', () => {
      const state = ready({ data: 'test' })
      expect(isLoading(state)).toBe(false)
      expect(isReady(state)).toBe(true)
      expect(isEmpty(state)).toBe(false)
      expect(isError(state)).toBe(false)
    })

    it('identifies empty state', () => {
      const state = empty('Empty')
      expect(isLoading(state)).toBe(false)
      expect(isReady(state)).toBe(false)
      expect(isEmpty(state)).toBe(true)
      expect(isError(state)).toBe(false)
    })

    it('identifies error state', () => {
      const state = error('Error')
      expect(isLoading(state)).toBe(false)
      expect(isReady(state)).toBe(false)
      expect(isEmpty(state)).toBe(false)
      expect(isError(state)).toBe(true)
    })
  })
})
