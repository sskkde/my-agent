import { describe, expect, it } from 'vitest'
import {
  normalizeDomesticProviderRequest,
  hasProviderQuirks,
} from '../../../src/llm/transform/domestic-provider-compat'

describe('normalizeDomesticProviderRequest', () => {
  const baseBody: Record<string, unknown> = {
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    temperature: 0.7,
  }

  describe('empty tools stripping', () => {
    it('strips empty tools array for any provider', () => {
      const body = { ...baseBody, tools: [] }
      const result = normalizeDomesticProviderRequest('dashscope', body)
      expect(result.tools).toBeUndefined()
    })

    it('preserves non-empty tools array', () => {
      const tools = [{ type: 'function', function: { name: 'test', parameters: {} } }]
      const body = { ...baseBody, tools }
      const result = normalizeDomesticProviderRequest('dashscope', body)
      expect(result.tools).toEqual(tools)
    })

    it('does not add tools key if absent', () => {
      const result = normalizeDomesticProviderRequest('dashscope', { ...baseBody })
      expect('tools' in result).toBe(false)
    })
  })

  describe('OpenAI baseline unchanged', () => {
    it('returns body unchanged for openai provider', () => {
      const body = { ...baseBody, max_tokens: 100, tool_choice: 'required' }
      const result = normalizeDomesticProviderRequest('openai', body)
      expect(result).toEqual(body)
    })
  })

  describe('Moonshot quirks', () => {
    it('normalizes tool_choice from required to auto', () => {
      const body = { ...baseBody, tool_choice: 'required' }
      const result = normalizeDomesticProviderRequest('moonshot', body)
      expect(result.tool_choice).toBe('auto')
    })

    it('preserves other tool_choice values', () => {
      const body = { ...baseBody, tool_choice: 'none' }
      const result = normalizeDomesticProviderRequest('moonshot', body)
      expect(result.tool_choice).toBe('none')
    })

    it('preserves function tool_choice object', () => {
      const toolChoice = { type: 'function', function: { name: 'my_func' } }
      const body = { ...baseBody, tool_choice: toolChoice }
      const result = normalizeDomesticProviderRequest('moonshot', body)
      expect(result.tool_choice).toEqual(toolChoice)
    })
  })

  describe('MiMo quirks', () => {
    it('maps max_tokens to max_completion_tokens', () => {
      const body = { ...baseBody, max_tokens: 4096 }
      const result = normalizeDomesticProviderRequest('mimo', body)
      expect(result.max_completion_tokens).toBe(4096)
      expect(result.max_tokens).toBeUndefined()
    })

    it('does nothing if max_tokens is absent', () => {
      const body = { ...baseBody }
      const result = normalizeDomesticProviderRequest('mimo', body)
      expect('max_tokens' in result).toBe(false)
      expect('max_completion_tokens' in result).toBe(false)
    })
  })

  describe('domestic provider passthrough', () => {
    it('does not mutate body for providers without specific quirks', () => {
      const body = { ...baseBody, max_tokens: 100 }
      const result = normalizeDomesticProviderRequest('dashscope', body)
      expect(result.max_tokens).toBe(100)
    })
  })

  describe('does not mutate original body', () => {
    it('returns a new object', () => {
      const body = { ...baseBody, tools: [] }
      const result = normalizeDomesticProviderRequest('moonshot', body)
      expect(result).not.toBe(body)
    })
  })
})

describe('hasProviderQuirks', () => {
  it('returns true for moonshot', () => {
    expect(hasProviderQuirks('moonshot')).toBe(true)
  })

  it('returns true for mimo', () => {
    expect(hasProviderQuirks('mimo')).toBe(true)
  })

  it('returns false for openai', () => {
    expect(hasProviderQuirks('openai')).toBe(false)
  })

  it('returns false for dashscope', () => {
    expect(hasProviderQuirks('dashscope')).toBe(false)
  })
})
