import { describe, it, expect } from 'vitest'
import { buildOllamaChatRequestBody, mapOllamaChatResponse } from '../../../src/llm/transform/ollama-transformer'
import type { LLMRequest } from '../../../src/llm/types'

describe('ollama-transformer', () => {
  describe('buildOllamaChatRequestBody', () => {
    it('includes model and messages', () => {
      const request: LLMRequest = {
        model: 'llama2',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
      }

      const body = buildOllamaChatRequestBody(request)

      expect(body.model).toBe('llama2')
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ])
    })

    it('sets stream: false', () => {
      const request: LLMRequest = {
        model: 'llama2',
        messages: [{ role: 'user', content: 'Hello' }],
      }

      const body = buildOllamaChatRequestBody(request)

      expect(body.stream).toBe(false)
    })

    it('maps temperature to options.temperature', () => {
      const request: LLMRequest = {
        model: 'llama2',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
      }

      const body = buildOllamaChatRequestBody(request)

      expect(body.options).toEqual({ temperature: 0.7 })
    })

    it('omits options when temperature not provided', () => {
      const request: LLMRequest = {
        model: 'llama2',
        messages: [{ role: 'user', content: 'Hello' }],
      }

      const body = buildOllamaChatRequestBody(request)

      expect(body.options).toBeUndefined()
    })
  })

  describe('mapOllamaChatResponse', () => {
    it('maps content and model', () => {
      const data = {
        model: 'llama2',
        message: {
          role: 'assistant',
          content: 'Hello! How can I help?',
        },
      }

      const response = mapOllamaChatResponse(data)

      expect(response.model).toBe('llama2')
      expect(response.content).toBe('Hello! How can I help?')
    })

    it('returns stop finish reason', () => {
      const data = {
        model: 'llama2',
        message: {
          role: 'assistant',
          content: 'Done',
        },
      }

      const response = mapOllamaChatResponse(data)

      expect(response.finishReason).toBe('stop')
    })

    it('returns assistant role', () => {
      const data = {
        model: 'llama2',
        message: {
          role: 'assistant',
          content: 'Response',
        },
      }

      const response = mapOllamaChatResponse(data)

      expect(response.role).toBe('assistant')
    })

    it('generates id when not present', () => {
      const data = {
        model: 'llama2',
        message: {
          role: 'assistant',
          content: 'Response',
        },
      }

      const response = mapOllamaChatResponse(data)

      expect(response.id).toMatch(/^resp_\d+$/)
    })

    it('handles missing message gracefully', () => {
      const data = {
        model: 'llama2',
      }

      const response = mapOllamaChatResponse(data)

      expect(response.content).toBe('')
    })

    it('handles missing model gracefully', () => {
      const data = {
        message: {
          role: 'assistant',
          content: 'Response',
        },
      }

      const response = mapOllamaChatResponse(data)

      expect(response.model).toBe('unknown')
    })
  })
})
