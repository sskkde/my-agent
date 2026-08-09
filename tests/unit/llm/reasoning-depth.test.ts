import { describe, it, expect } from 'vitest'
import {
  isReasoningDepth,
  parseReasoningDepth,
  toReasoningEffort,
  applyReasoningDepthToBody,
  resolveReasoningWireFormat,
  DEFAULT_REASONING_DEPTH,
} from '../../../src/llm/reasoning-depth.js'
import { normalizeDomesticProviderRequest } from '../../../src/llm/transform/domestic-provider-compat.js'
import { buildOpenAIChatRequestBody } from '../../../src/llm/transform/openai-chat-transformer.js'
import type { LLMRequest } from '../../../src/llm/types.js'

describe('reasoning depth parse', () => {
  it('validates known depths', () => {
    expect(isReasoningDepth('off')).toBe(true)
    expect(isReasoningDepth('low')).toBe(true)
    expect(isReasoningDepth('medium')).toBe(true)
    expect(isReasoningDepth('high')).toBe(true)
    expect(isReasoningDepth('extreme')).toBe(false)
  })

  it('parses with fallback', () => {
    expect(parseReasoningDepth(undefined)).toBe(DEFAULT_REASONING_DEPTH)
    expect(parseReasoningDepth('high')).toBe('high')
    expect(parseReasoningDepth('nope')).toBe('off')
  })

  it('toReasoningEffort omits off', () => {
    expect(toReasoningEffort('off')).toBeUndefined()
    expect(toReasoningEffort('low')).toBe('low')
  })
})

describe('resolveReasoningWireFormat', () => {
  it('maps provider types to wire formats', () => {
    expect(resolveReasoningWireFormat('openai')).toBe('openai_effort')
    expect(resolveReasoningWireFormat('openrouter')).toBe('openrouter_reasoning')
    expect(resolveReasoningWireFormat('deepseek')).toBe('deepseek_thinking')
    expect(resolveReasoningWireFormat('dashscope')).toBe('dashscope_thinking')
    expect(resolveReasoningWireFormat('moonshot')).toBe('moonshot_thinking')
    expect(resolveReasoningWireFormat('zhipu')).toBe('zhipu_thinking')
    expect(resolveReasoningWireFormat('volcengine')).toBe('volcengine_thinking')
    expect(resolveReasoningWireFormat('ollama')).toBe('none')
    expect(resolveReasoningWireFormat('minimax')).toBe('none')
  })
})

describe('applyReasoningDepthToBody per provider', () => {
  const base = { model: 'm', messages: [] as unknown[] }

  it('openai: reasoning_effort only when not off', () => {
    expect(applyReasoningDepthToBody('openai', base, 'off')).not.toHaveProperty('reasoning_effort')
    expect(applyReasoningDepthToBody('openai', base, 'medium').reasoning_effort).toBe('medium')
  })

  it('openrouter: reasoning.effort object', () => {
    expect(applyReasoningDepthToBody('openrouter', base, 'off')).toEqual(
      expect.objectContaining({ reasoning: { effort: 'none', enabled: false } }),
    )
    expect(applyReasoningDepthToBody('openrouter', base, 'high')).toEqual(
      expect.objectContaining({ reasoning: { effort: 'high', enabled: true } }),
    )
  })

  it('deepseek: thinking.type + reasoning_effort high|max', () => {
    expect(applyReasoningDepthToBody('deepseek', base, 'off')).toEqual(
      expect.objectContaining({ thinking: { type: 'disabled' } }),
    )
    const med = applyReasoningDepthToBody('deepseek', base, 'medium')
    expect(med.thinking).toEqual({ type: 'enabled' })
    expect(med.reasoning_effort).toBe('high')
    expect(applyReasoningDepthToBody('deepseek', base, 'high').reasoning_effort).toBe('max')
  })

  it('dashscope: enable_thinking + thinking_budget', () => {
    expect(applyReasoningDepthToBody('dashscope', base, 'off').enable_thinking).toBe(false)
    const low = applyReasoningDepthToBody('dashscope', base, 'low')
    expect(low.enable_thinking).toBe(true)
    expect(low.thinking_budget).toBe(1024)
    expect(applyReasoningDepthToBody('dashscope', base, 'high').thinking_budget).toBe(8192)
  })

  it('moonshot: thinking.type enabled|disabled', () => {
    expect(applyReasoningDepthToBody('moonshot', base, 'off').thinking).toEqual({ type: 'disabled' })
    expect(applyReasoningDepthToBody('moonshot', base, 'high').thinking).toEqual({ type: 'enabled' })
  })

  it('zhipu: thinking + enable_thinking + effort', () => {
    const off = applyReasoningDepthToBody('zhipu', base, 'off')
    expect(off.thinking).toEqual({ type: 'disabled' })
    expect(off.enable_thinking).toBe(false)
    const high = applyReasoningDepthToBody('zhipu', base, 'high')
    expect(high.thinking).toEqual({ type: 'enabled' })
    expect(high.reasoning_effort).toBe('max')
  })

  it('volcengine: thinking.type enabled|disabled|auto', () => {
    expect(applyReasoningDepthToBody('volcengine', base, 'off').thinking).toEqual({ type: 'disabled' })
    expect(applyReasoningDepthToBody('volcengine', base, 'low').thinking).toEqual({ type: 'auto' })
    expect(applyReasoningDepthToBody('volcengine', base, 'high').thinking).toEqual({ type: 'enabled' })
  })

  it('unsupported providers strip reasoning fields', () => {
    const withEffort = { ...base, reasoning_effort: 'high' }
    const out = applyReasoningDepthToBody('ollama', withEffort, 'high')
    expect(out.reasoning_effort).toBeUndefined()
    expect(out.thinking).toBeUndefined()
  })
})

describe('domestic normalize includes reasoning mapping', () => {
  it('applies deepseek thinking after quirks', () => {
    const body = normalizeDomesticProviderRequest('deepseek', { model: 'deepseek-v4-flash', tools: [] }, 'high')
    expect(body.tools).toBeUndefined()
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.reasoning_effort).toBe('max')
  })

  it('applies moonshot thinking and tool_choice quirk', () => {
    const body = normalizeDomesticProviderRequest('moonshot', { model: 'kimi', tool_choice: 'required' }, 'off')
    expect(body.tool_choice).toBe('auto')
    expect(body.thinking).toEqual({ type: 'disabled' })
  })
})

describe('buildOpenAIChatRequestBody does not inject reasoning_effort', () => {
  const base: LLMRequest = {
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'hi' }],
    reasoningDepth: 'high',
  }

  it('leaves reasoning to provider-aware layer', () => {
    expect(buildOpenAIChatRequestBody(base).reasoning_effort).toBeUndefined()
  })
})
