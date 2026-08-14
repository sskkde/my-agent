import { describe, it, expect } from 'vitest'
import { buildOpenAIChatRequestBody } from '../../../src/llm/transform/openai-chat-transformer.js'
import type { LLMRequest } from '../../../src/llm/types.js'

const REASONING_FIXTURE = 'REASONING_PASSBACK_FIXTURE'

function makeToolCallMessage(overrides?: { reasoningContent?: string }) {
  return {
    role: 'assistant' as const,
    content: '',
    toolCalls: [
      {
        id: 'call_123',
        type: 'function' as const,
        function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
      },
    ],
    ...overrides,
  }
}

describe('buildOpenAIChatRequestBody reasoning_content passback (Fix-P0-3)', () => {
  it('emits reasoning_content for assistant tool-call turns when the deepseek gate is on', () => {
    const request: LLMRequest = {
      model: 'deepseek-reasoner',
      reasoningContentPassback: true,
      messages: [makeToolCallMessage({ reasoningContent: REASONING_FIXTURE })],
    }

    const body = buildOpenAIChatRequestBody(request)

    const message = body.messages as Array<Record<string, unknown>>
    expect(message[0].reasoning_content).toBe(REASONING_FIXTURE)
    // reasoning stays a separate sibling field — content remains untouched
    expect(message[0].content).toBe('')
    expect(message[0].tool_calls).toBeDefined()
  })

  it('omits reasoning_content when the tool-call turn has empty reasoning', () => {
    const request: LLMRequest = {
      model: 'deepseek-reasoner',
      reasoningContentPassback: true,
      messages: [makeToolCallMessage({ reasoningContent: '' })],
    }

    const body = buildOpenAIChatRequestBody(request)

    const message = body.messages as Array<Record<string, unknown>>
    expect(message[0].reasoning_content).toBeUndefined()
  })

  it('omits reasoning_content when the tool-call turn has no reasoning field', () => {
    const request: LLMRequest = {
      model: 'deepseek-reasoner',
      reasoningContentPassback: true,
      messages: [makeToolCallMessage()],
    }

    const body = buildOpenAIChatRequestBody(request)

    const message = body.messages as Array<Record<string, unknown>>
    expect(message[0].reasoning_content).toBeUndefined()
  })

  it('omits reasoning_content on plain assistant turns (no tool calls) even with reasoning present', () => {
    const request: LLMRequest = {
      model: 'deepseek-reasoner',
      reasoningContentPassback: true,
      messages: [{ role: 'assistant', content: 'plain answer', reasoningContent: REASONING_FIXTURE }],
    }

    const body = buildOpenAIChatRequestBody(request)

    const message = body.messages as Array<Record<string, unknown>>
    expect(message[0].reasoning_content).toBeUndefined()
    expect(message[0].content).toBe('plain answer')
  })

  it('omits reasoning_content on user/tool messages even with the gate on', () => {
    const request: LLMRequest = {
      model: 'deepseek-reasoner',
      reasoningContentPassback: true,
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'tool', content: '{"ok":true}', toolCallId: 'call_123' },
      ],
    }

    const body = buildOpenAIChatRequestBody(request)

    const messages = body.messages as Array<Record<string, unknown>>
    for (const message of messages) {
      expect(message.reasoning_content).toBeUndefined()
    }
  })

  it('omits reasoning_content for non-deepseek providers (gate off) — OpenAI request unchanged', () => {
    const request: LLMRequest = {
      model: 'gpt-4',
      messages: [makeToolCallMessage({ reasoningContent: REASONING_FIXTURE })],
    }

    const body = buildOpenAIChatRequestBody(request)

    const message = body.messages as Array<Record<string, unknown>>
    expect(message[0].reasoning_content).toBeUndefined()
    expect(message[0].tool_calls).toBeDefined()
  })

  it('omits reasoning_content when the gate is explicitly false', () => {
    const request: LLMRequest = {
      model: 'deepseek-chat',
      reasoningContentPassback: false,
      messages: [makeToolCallMessage({ reasoningContent: REASONING_FIXTURE })],
    }

    const body = buildOpenAIChatRequestBody(request)

    const message = body.messages as Array<Record<string, unknown>>
    expect(message[0].reasoning_content).toBeUndefined()
  })
})
