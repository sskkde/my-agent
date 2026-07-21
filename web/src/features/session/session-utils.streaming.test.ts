import { describe, it, expect } from 'vitest'
import { clearStreamingActivityMaps } from './session-utils'

describe('clearStreamingActivityMaps', () => {
  it('removes entries matching attempt ids', () => {
    const map = new Map([
      ['a1', { sessionId: 's1', content: 'old' }],
      ['a2', { sessionId: 's1', content: 'new' }],
    ])
    const next = clearStreamingActivityMaps(map, ['a2'], { sessionId: 's1' })
    expect(next.has('a1')).toBe(true)
    expect(next.has('a2')).toBe(false)
  })

  it('clears oldest session draft when ids do not match and clearOldestIfUnmatched', () => {
    const map = new Map([
      ['a1', { sessionId: 's1', content: 'previous' }],
      ['a2', { sessionId: 's1', content: 'current' }],
    ])
    const next = clearStreamingActivityMaps(map, [undefined, undefined], {
      clearOldestIfUnmatched: true,
      sessionId: 's1',
    })
    expect(next.has('a1')).toBe(false)
    expect(next.has('a2')).toBe(true)
  })

  it('does nothing when no ids and clearOldestIfUnmatched is false', () => {
    const map = new Map([['a1', { sessionId: 's1', content: 'x' }]])
    const next = clearStreamingActivityMaps(map, [], { clearOldestIfUnmatched: false })
    expect(next).toBe(map)
  })
})
