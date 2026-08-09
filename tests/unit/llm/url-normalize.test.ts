import { describe, it, expect } from 'vitest'
import { normalizeOpenAICompatibleBaseUrl, stripVersionSegment } from '../../../src/llm/url-normalize.js'

describe('normalizeOpenAICompatibleBaseUrl', () => {
  it('appends /v1 when the base URL has no version segment', () => {
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1')
  })

  it('appends /v1 after stripping a trailing slash', () => {
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434/v1')
  })

  it('keeps an existing /v1 suffix without doubling it', () => {
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
  })

  it('strips a trailing slash after /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1')
  })

  it('appends /v1 to a bare https origin', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.example.com')).toBe('https://api.example.com/v1')
  })

  it('keeps an existing /v2 suffix without appending /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.example.com/v2')).toBe('https://api.example.com/v2')
  })

  it('does not produce /v1/v1 for an already-normalized url', () => {
    const once = normalizeOpenAICompatibleBaseUrl('http://localhost:11434')
    const twice = normalizeOpenAICompatibleBaseUrl(once)
    expect(twice).toBe('http://localhost:11434/v1')
  })
})

describe('stripVersionSegment', () => {
  it('strips a trailing /v1', () => {
    expect(stripVersionSegment('http://localhost:11434/v1')).toBe('http://localhost:11434')
  })

  it('leaves a bare origin unchanged', () => {
    expect(stripVersionSegment('http://localhost:11434')).toBe('http://localhost:11434')
  })

  it('strips trailing slashes before stripping the version', () => {
    expect(stripVersionSegment('http://localhost:11434/v1/')).toBe('http://localhost:11434')
  })
})
