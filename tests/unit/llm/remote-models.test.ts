import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { IncomingMessage, ClientRequest } from 'http'

const httpRequestMock = vi.fn()
const httpsRequestMock = vi.fn()
vi.mock('http', () => ({ request: httpRequestMock, default: { request: httpRequestMock } }))
vi.mock('https', () => ({ request: httpsRequestMock, default: { request: httpsRequestMock } }))

const { buildOpenAICompatibleModelsPath, fetchRemoteProviderModels, TEST_TIMEOUT_MS } =
  await import('../../../src/llm/remote-models.js')

describe('remote-models', () => {
  describe('TEST_TIMEOUT_MS', () => {
    it('should be 10000', () => {
      expect(TEST_TIMEOUT_MS).toBe(10000)
    })
  })

  describe('buildOpenAICompatibleModelsPath', () => {
    it('keeps path when already ends with /models', () => {
      expect(buildOpenAICompatibleModelsPath('https://api.openai.com/v1/models')).toBe('/v1/models')
    })

    it('appends /models when path ends with /v1', () => {
      expect(buildOpenAICompatibleModelsPath('https://api.openai.com/v1')).toBe('/v1/models')
    })

    it('appends /models when path ends with /api/v1', () => {
      expect(buildOpenAICompatibleModelsPath('https://openrouter.ai/api/v1')).toBe('/api/v1/models')
    })

    it('appends /models when path ends with /v2', () => {
      expect(buildOpenAICompatibleModelsPath('https://example.com/v2')).toBe('/v2/models')
    })

    it('appends /v1/models when path has no version segment', () => {
      expect(buildOpenAICompatibleModelsPath('https://api.deepseek.com')).toBe('/v1/models')
    })

    it('handles root path', () => {
      expect(buildOpenAICompatibleModelsPath('https://example.com/')).toBe('/v1/models')
    })

    it('handles trailing slashes', () => {
      expect(buildOpenAICompatibleModelsPath('https://api.openai.com/v1/')).toBe('/v1/models')
    })
  })

  describe('fetchRemoteProviderModels', () => {
    const createFakeResponse = (statusCode: number, body: string): IncomingMessage => {
      const res = new EventEmitter() as IncomingMessage
      ;(res as unknown as { statusCode: number }).statusCode = statusCode
      process.nextTick(() => {
        res.emit('data', body)
        res.emit('end')
      })
      return res
    }

    const createFakeRequest = (): ClientRequest => {
      const req = new EventEmitter() as ClientRequest
      ;(req as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy = vi.fn()
      ;(req as unknown as { end: ReturnType<typeof vi.fn> }).end = vi.fn()
      return req
    }

    beforeEach(() => {
      httpRequestMock.mockReset()
      httpsRequestMock.mockReset()
    })

    it('parses OpenAI-shaped body { data: [{id}] } into models array', async () => {
      const req = createFakeRequest()
      httpsRequestMock.mockImplementation((_opts, cb) => {
        cb(createFakeResponse(200, JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] })))
        return req
      })

      const result = await fetchRemoteProviderModels({
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      })

      expect(result.success).toBe(true)
      expect(result.models).toEqual(['m1', 'm2'])
      expect(result.modelCount).toBe(2)
      expect(result.error).toBeUndefined()
    })

    it('skips OpenAI data entries missing id', async () => {
      const req = createFakeRequest()
      httpsRequestMock.mockImplementation((_opts, cb) => {
        cb(
          createFakeResponse(
            200,
            JSON.stringify({ data: [{ id: 'm1' }, { name: 'no-id' }, { id: 'm2' }] }),
          ),
        )
        return req
      })

      const result = await fetchRemoteProviderModels({
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      })

      expect(result.success).toBe(true)
      expect(result.models).toEqual(['m1', 'm2'])
      expect(result.modelCount).toBe(2)
    })

    it('parses Ollama tags body { models: [{name}] } into models array', async () => {
      const req = createFakeRequest()
      httpRequestMock.mockImplementation((_opts, cb) => {
        cb(createFakeResponse(200, JSON.stringify({ models: [{ name: 'llama3' }, { name: 'qwen2' }] })))
        return req
      })

      const result = await fetchRemoteProviderModels({
        providerType: 'ollama',
        apiKey: null,
        baseUrl: 'http://localhost:11434',
      })

      expect(result.success).toBe(true)
      expect(result.models).toEqual(['llama3', 'qwen2'])
      expect(result.modelCount).toBe(2)
    })

    it('requests /api/tags for Ollama (canonical path, not /api/v1/tags)', async () => {
      const req = createFakeRequest()
      let capturedPath = ''
      httpRequestMock.mockImplementation((opts, cb) => {
        capturedPath = (opts as { path: string }).path
        cb(createFakeResponse(200, JSON.stringify({ models: [] })))
        return req
      })

      await fetchRemoteProviderModels({
        providerType: 'ollama',
        apiKey: null,
        baseUrl: 'http://localhost:11434',
      })

      expect(capturedPath).toBe('/api/tags')
    })

    it('returns mock-model without network for mock providerType', async () => {
      const result = await fetchRemoteProviderModels({
        providerType: 'mock',
        apiKey: null,
        baseUrl: null,
      })

      expect(result.success).toBe(true)
      expect(result.latencyMs).toBe(0)
      expect(result.models).toEqual(['mock-model'])
      expect(result.modelCount).toBe(1)
      // No network call should have been made
      expect(httpRequestMock).not.toHaveBeenCalled()
      expect(httpsRequestMock).not.toHaveBeenCalled()
    })

    it('returns failure for invalid baseUrl', async () => {
      const result = await fetchRemoteProviderModels({
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'not-a-valid-url',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('returns failure with target URL in error on connection refused', async () => {
      const req = createFakeRequest()
      httpsRequestMock.mockImplementation(() => {
        process.nextTick(() => {
          req.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
        })
        return req
      })

      const result = await fetchRemoteProviderModels({
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('api.openai.com')
    })

    it('returns failure for unknown providerType', async () => {
      const result = await fetchRemoteProviderModels({
        providerType: 'totally-unknown' as never,
        apiKey: 'sk-test',
        baseUrl: 'https://example.com',
      })

      expect(result.success).toBe(false)
      expect(result.latencyMs).toBe(0)
      expect(result.error).toContain('Unsupported provider type')
      expect(result.error).toContain('totally-unknown')
    })

    it('returns failure with status code on non-200 response', async () => {
      const req = createFakeRequest()
      httpsRequestMock.mockImplementation((_opts, cb) => {
        cb(createFakeResponse(401, ''))
        return req
      })

      const result = await fetchRemoteProviderModels({
        providerType: 'openai',
        apiKey: 'sk-bad',
        baseUrl: 'https://api.openai.com/v1',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Authentication failed')
    })

    it('does not include apiKey or Authorization in the result', async () => {
      const req = createFakeRequest()
      httpsRequestMock.mockImplementation((_opts, cb) => {
        cb(createFakeResponse(200, JSON.stringify({ data: [{ id: 'm1' }] })))
        return req
      })

      const result = await fetchRemoteProviderModels({
        providerType: 'openai',
        apiKey: 'sk-secret-key-12345',
        baseUrl: 'https://api.openai.com/v1',
      })

      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('sk-secret-key-12345')
      expect(serialized).not.toContain('Authorization')
      expect(serialized).not.toContain('Bearer')
    })

    it('handles custom providerType as OpenAI-compatible', async () => {
      const req = createFakeRequest()
      httpsRequestMock.mockImplementation((_opts, cb) => {
        cb(createFakeResponse(200, JSON.stringify({ data: [{ id: 'custom-model' }] })))
        return req
      })

      const result = await fetchRemoteProviderModels({
        providerType: 'custom',
        apiKey: 'custom-key',
        baseUrl: 'https://my-custom-endpoint.example.com/v1',
      })

      expect(result.success).toBe(true)
      expect(result.models).toEqual(['custom-model'])
    })

    it('handles domestic OpenAI-compatible provider (deepseek)', async () => {
      const req = createFakeRequest()
      httpsRequestMock.mockImplementation((_opts, cb) => {
        cb(createFakeResponse(200, JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] })))
        return req
      })

      const result = await fetchRemoteProviderModels({
        providerType: 'deepseek',
        apiKey: 'ds-key',
        baseUrl: 'https://api.deepseek.com',
      })

      expect(result.success).toBe(true)
      expect(result.models).toEqual(['deepseek-v4-flash'])
    })
  })
})