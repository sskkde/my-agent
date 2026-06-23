import { describe, it, expect } from 'vitest'
import { resolveProviderFamily } from '../../../src/kernel/model-input/model-input-types.js'

describe('resolveProviderFamily', () => {
  it('returns deepseek for deepseek provider', () => {
    expect(resolveProviderFamily('deepseek')).toBe('deepseek')
  })

  it('returns deepseek for deepseek-chat', () => {
    expect(resolveProviderFamily('deepseek-chat')).toBe('deepseek')
  })

  it('returns deepseek for deepseek-reasoner', () => {
    expect(resolveProviderFamily('deepseek-reasoner')).toBe('deepseek')
  })

  it('returns deepseek when provider contains deepseek', () => {
    expect(resolveProviderFamily('my-deepseek-custom')).toBe('deepseek')
  })

  it('returns ollama for ollama provider', () => {
    expect(resolveProviderFamily('ollama')).toBe('ollama')
  })

  it('returns ollama for ollama:llama3', () => {
    expect(resolveProviderFamily('ollama:llama3')).toBe('ollama')
  })

  it('returns openai for openai provider', () => {
    expect(resolveProviderFamily('openai')).toBe('openai')
  })

  it('returns openai for openrouter', () => {
    expect(resolveProviderFamily('openrouter')).toBe('openai')
  })

  it('returns anthropic for anthropic provider', () => {
    expect(resolveProviderFamily('anthropic')).toBe('anthropic')
  })

  it('returns anthropic for claude model strings', () => {
    expect(resolveProviderFamily('claude-3-5-sonnet')).toBe('anthropic')
  })

  it('returns gemini for gemini provider', () => {
    expect(resolveProviderFamily('gemini')).toBe('gemini')
  })

  it('returns gemini for google provider strings', () => {
    expect(resolveProviderFamily('google/gemini-1.5-pro')).toBe('gemini')
  })

  it('returns openai for gpt-4o-mini (model string)', () => {
    expect(resolveProviderFamily('gpt-4o-mini')).toBe('openai')
  })

  it('returns openai for undefined provider', () => {
    expect(resolveProviderFamily(undefined)).toBe('openai')
  })

  it('returns openai for empty string', () => {
    expect(resolveProviderFamily('')).toBe('openai')
  })

  it('is case-insensitive: DeepSeek → deepseek', () => {
    expect(resolveProviderFamily('DeepSeek')).toBe('deepseek')
  })

  it('is case-insensitive: OLLAMA → ollama', () => {
    expect(resolveProviderFamily('OLLAMA')).toBe('ollama')
  })
})
