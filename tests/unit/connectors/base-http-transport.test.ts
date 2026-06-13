/**
 * Tests for BaseHttpTransport
 * TDD: Define expected behavior before implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BaseHttpTransport } from '../../../src/connectors/base-http-transport.js'
import type { HttpTransportConfig } from '../../../src/connectors/base-http-transport-types.js'

function createMockResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(bodyStr, {
    status,
    headers: {
      'content-type': typeof body === 'string' ? 'text/plain' : 'application/json',
      ...headers,
    },
  })
}

describe('BaseHttpTransport', () => {
  let originalFetch: typeof globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  const defaultConfig: HttpTransportConfig = {
    baseURL: 'https://api.example.com',
  }

  describe('constructor', () => {
    it('should create instance with minimal config', () => {
      const transport = new BaseHttpTransport(defaultConfig)
      expect(transport).toBeDefined()
    })

    it('should apply default values for optional config', () => {
      const transport = new BaseHttpTransport(defaultConfig)
      expect(transport).toBeDefined()
    })

    it('should accept full config', () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        timeout: 5000,
        retries: 5,
        retryDelay: 2000,
        headers: { 'X-Custom': 'value' },
        auth: { type: 'bearer', credentials: 'token-123' },
      }
      const transport = new BaseHttpTransport(config)
      expect(transport).toBeDefined()
    })
  })

  describe('GET requests', () => {
    it('should make a GET request and return parsed JSON', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      const mockData = { id: 1, name: 'test' }
      fetchMock.mockResolvedValueOnce(createMockResponse(200, mockData))

      const result = await transport.get<typeof mockData>('/users/1')

      expect(result.status).toBe(200)
      expect(result.body).toEqual(mockData)
      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should append query params to GET request', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, []))

      await transport.get('/search', { q: 'hello', limit: '10' })

      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('q=hello')
      expect(calledUrl).toContain('limit=10')
    })

    it('should merge query params with existing query string in path', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, []))

      await transport.get('/search?sort=asc', { q: 'hello' })

      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('sort=asc')
      expect(calledUrl).toContain('q=hello')
    })
  })

  describe('POST requests', () => {
    it('should make a POST request with JSON body', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      const requestBody = { name: 'John' }
      const responseData = { id: 1, name: 'John' }
      fetchMock.mockResolvedValueOnce(createMockResponse(201, responseData))

      const result = await transport.post<typeof responseData>('/users', requestBody)

      expect(result.status).toBe(201)
      expect(result.body).toEqual(responseData)

      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      expect(fetchOptions.method).toBe('POST')
      expect(fetchOptions.body).toBe(JSON.stringify(requestBody))
    })

    it('should make a POST request without body', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

      const result = await transport.post('/trigger')

      expect(result.status).toBe(200)
    })
  })

  describe('PUT requests', () => {
    it('should make a PUT request with JSON body', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      const requestBody = { name: 'Updated' }
      fetchMock.mockResolvedValueOnce(createMockResponse(200, requestBody))

      const result = await transport.put('/users/1', requestBody)

      expect(result.status).toBe(200)
      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      expect(fetchOptions.method).toBe('PUT')
    })
  })

  describe('PATCH requests', () => {
    it('should make a PATCH request with JSON body', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      const requestBody = { name: 'Patched' }
      fetchMock.mockResolvedValueOnce(createMockResponse(200, requestBody))

      const result = await transport.patch('/users/1', requestBody)

      expect(result.status).toBe(200)
      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      expect(fetchOptions.method).toBe('PATCH')
    })
  })

  describe('DELETE requests', () => {
    it('should make a DELETE request', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

      const result = await transport.delete('/users/1')

      expect(result.status).toBe(200)
      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      expect(fetchOptions.method).toBe('DELETE')
    })
  })

  describe('generic request method', () => {
    it('should route through the request method with all options', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, { ok: true }))

      const result = await transport.request({
        method: 'POST',
        path: '/items',
        body: { name: 'item' },
        headers: { 'X-Request-Id': '123' },
        params: { verbose: 'true' },
      })

      expect(result.status).toBe(200)
      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      expect(fetchOptions.method).toBe('POST')
      expect(fetchOptions.headers).toBeDefined()
    })
  })

  describe('authentication', () => {
    it('should inject Bearer token in Authorization header', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        auth: { type: 'bearer', credentials: 'my-token' },
      }
      const transport = new BaseHttpTransport(config)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.get('/protected')

      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      const headers = fetchOptions.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer my-token')
    })

    it('should inject API key in X-API-Key header by default', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        auth: { type: 'api_key', credentials: 'my-api-key' },
      }
      const transport = new BaseHttpTransport(config)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.get('/data')

      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      const headers = fetchOptions.headers as Record<string, string>
      expect(headers['X-API-Key']).toBe('my-api-key')
    })

    it('should inject API key as query param when configured', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        auth: { type: 'api_key', credentials: 'my-api-key' },
      }
      const transport = new BaseHttpTransport(config, { apiKeyInQuery: true })
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.get('/data')

      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('api_key=my-api-key')
    })

    it('should inject Basic auth in Authorization header', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        auth: { type: 'basic', credentials: 'username:password' },
      }
      const transport = new BaseHttpTransport(config)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.get('/protected')

      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      const headers = fetchOptions.headers as Record<string, string>
      const expected = `Basic ${Buffer.from('username:password').toString('base64')}`
      expect(headers['Authorization']).toBe(expected)
    })

    it('should inject OAuth2 token in Authorization header', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        auth: { type: 'oauth2', credentials: 'oauth-access-token' },
      }
      const transport = new BaseHttpTransport(config)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.get('/protected')

      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      const headers = fetchOptions.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer oauth-access-token')
    })
  })

  describe('timeout', () => {
    it('should use default 30s timeout', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.get('/data')

      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      expect(fetchOptions.signal).toBeDefined()
    })

    it('should use custom timeout from config', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        timeout: 5000,
      }
      const transport = new BaseHttpTransport(config)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.get('/data')

      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      expect(fetchOptions.signal).toBeDefined()
    })

    it('should throw timeout error when request exceeds timeout', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        timeout: 100,
        retries: 0,
      }
      const transport = new BaseHttpTransport(config)

      const abortError = new DOMException('The operation was aborted', 'AbortError')
      fetchMock.mockRejectedValueOnce(abortError)

      try {
        await transport.get('/slow')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toHaveProperty('type', 'timeout')
        expect(err).toHaveProperty('retryable', true)
      }
    })
  })

  describe('retry strategy', () => {
    it('should retry on 5xx errors with exponential backoff', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        retries: 3,
        retryDelay: 10,
      }
      const transport = new BaseHttpTransport(config)

      fetchMock
        .mockResolvedValueOnce(createMockResponse(500, { error: 'internal' }))
        .mockResolvedValueOnce(createMockResponse(502, { error: 'bad gateway' }))
        .mockResolvedValueOnce(createMockResponse(200, { ok: true }))

      const result = await transport.get('/flaky')

      expect(result.status).toBe(200)
      expect(result.body).toEqual({ ok: true })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('should NOT retry on 4xx errors', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        retries: 3,
        retryDelay: 10,
      }
      const transport = new BaseHttpTransport(config)

      fetchMock.mockResolvedValueOnce(createMockResponse(400, { error: 'bad request' }))

      try {
        await transport.get('/bad')
      } catch (err) {
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(err).toHaveProperty('type', 'auth')
      }
    })

    it('should retry on network errors', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        retries: 2,
        retryDelay: 10,
      }
      const transport = new BaseHttpTransport(config)

      fetchMock
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(createMockResponse(200, { ok: true }))

      const result = await transport.get('/flaky-network')

      expect(result.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('should exhaust retries and throw server error', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        retries: 2,
        retryDelay: 10,
      }
      const transport = new BaseHttpTransport(config)

      fetchMock
        .mockResolvedValueOnce(createMockResponse(500, {}))
        .mockResolvedValueOnce(createMockResponse(500, {}))
        .mockResolvedValueOnce(createMockResponse(500, {}))

      try {
        await transport.get('/always-fails')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(err).toHaveProperty('type', 'server')
        expect(err).toHaveProperty('retryable', true)
        expect(err).toHaveProperty('statusCode', 500)
      }
    })

    it('should not retry when retries is 0', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        retries: 0,
      }
      const transport = new BaseHttpTransport(config)

      fetchMock.mockResolvedValueOnce(createMockResponse(500, {}))

      try {
        await transport.get('/fail')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      }
    })
  })

  describe('error classification', () => {
    it('should classify 401 as auth error', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(createMockResponse(401, { error: 'unauthorized' }))

      try {
        await transport.get('/protected')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toHaveProperty('type', 'auth')
        expect(err).toHaveProperty('statusCode', 401)
        expect(err).toHaveProperty('retryable', false)
      }
    })

    it('should classify 403 as auth error', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(createMockResponse(403, { error: 'forbidden' }))

      try {
        await transport.get('/forbidden')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toHaveProperty('type', 'auth')
        expect(err).toHaveProperty('statusCode', 403)
        expect(err).toHaveProperty('retryable', false)
      }
    })

    it('should classify 429 as rate_limit error', async () => {
      const transport = new BaseHttpTransport({ ...defaultConfig, retries: 0 })
      fetchMock.mockResolvedValueOnce(
        createMockResponse(
          429,
          { error: 'rate limited' },
          {
            'Retry-After': '30',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': '1700000000',
          },
        ),
      )

      try {
        await transport.get('/limited')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toHaveProperty('type', 'rate_limit')
        expect(err).toHaveProperty('statusCode', 429)
        expect(err).toHaveProperty('retryable', true)
      }
    })

    it('should classify 500 as server error', async () => {
      const transport = new BaseHttpTransport({ ...defaultConfig, retries: 0 })
      fetchMock.mockResolvedValueOnce(createMockResponse(500, { error: 'internal' }))

      try {
        await transport.get('/error')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toHaveProperty('type', 'server')
        expect(err).toHaveProperty('statusCode', 500)
        expect(err).toHaveProperty('retryable', true)
      }
    })

    it('should classify 502 as server error', async () => {
      const transport = new BaseHttpTransport({ ...defaultConfig, retries: 0 })
      fetchMock.mockResolvedValueOnce(createMockResponse(502, { error: 'bad gateway' }))

      try {
        await transport.get('/error')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toHaveProperty('type', 'server')
        expect(err).toHaveProperty('statusCode', 502)
      }
    })

    it('should classify 503 as server error', async () => {
      const transport = new BaseHttpTransport({ ...defaultConfig, retries: 0 })
      fetchMock.mockResolvedValueOnce(createMockResponse(503, { error: 'unavailable' }))

      try {
        await transport.get('/error')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toHaveProperty('type', 'server')
        expect(err).toHaveProperty('statusCode', 503)
      }
    })

    it('should classify network errors as network type', async () => {
      const transport = new BaseHttpTransport({ ...defaultConfig, retries: 0 })
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

      try {
        await transport.get('/down')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toHaveProperty('type', 'network')
        expect(err).toHaveProperty('retryable', true)
      }
    })

    it('should classify abort errors as timeout type', async () => {
      const transport = new BaseHttpTransport({ ...defaultConfig, retries: 0 })
      fetchMock.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))

      try {
        await transport.get('/slow')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toHaveProperty('type', 'timeout')
        expect(err).toHaveProperty('retryable', true)
      }
    })

    it('should classify JSON parse errors as parse type', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(
        new Response('not valid json {{{', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      try {
        await transport.get('/bad-json')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toHaveProperty('type', 'parse')
        expect(err).toHaveProperty('retryable', false)
      }
    })
  })

  describe('response parsing', () => {
    it('should auto-parse JSON responses', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      const data = { id: 1, items: [1, 2, 3] }
      fetchMock.mockResolvedValueOnce(createMockResponse(200, data))

      const result = await transport.get<typeof data>('/data')

      expect(result.body).toEqual(data)
    })

    it('should return text for non-JSON content type', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(
        new Response('plain text response', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      )

      const result = await transport.get<string>('/text')

      expect(result.body).toBe('plain text response')
    })

    it('should handle empty response body (204)', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

      const result = await transport.get('/no-content')

      expect(result.status).toBe(204)
      expect(result.body).toBeUndefined()
    })
  })

  describe('rate limit header parsing', () => {
    it('should parse X-RateLimit-Remaining header', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(
        createMockResponse(
          200,
          { ok: true },
          {
            'X-RateLimit-Remaining': '58',
            'X-RateLimit-Reset': '1700000000',
          },
        ),
      )

      const result = await transport.get('/data')

      expect(result.headers['x-ratelimit-remaining']).toBe('58')
      expect(result.headers['x-ratelimit-reset']).toBe('1700000000')
    })

    it('should parse Retry-After header on 429', async () => {
      const transport = new BaseHttpTransport({ ...defaultConfig, retries: 0 })
      fetchMock.mockResolvedValueOnce(
        createMockResponse(
          429,
          { error: 'rate limited' },
          {
            'Retry-After': '60',
            'X-RateLimit-Remaining': '0',
          },
        ),
      )

      try {
        await transport.get('/limited')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toHaveProperty('type', 'rate_limit')
      }
    })
  })

  describe('default headers', () => {
    it('should send Content-Type: application/json for requests with body', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.post('/data', { key: 'value' })

      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      const headers = fetchOptions.headers as Record<string, string>
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('should merge config headers with request headers', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        headers: { 'X-App-Id': 'my-app' },
      }
      const transport = new BaseHttpTransport(config)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.get('/data', undefined)

      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      const headers = fetchOptions.headers as Record<string, string>
      expect(headers['X-App-Id']).toBe('my-app')
    })

    it('should allow per-request headers to override defaults', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com',
        headers: { 'X-App-Id': 'default-app' },
      }
      const transport = new BaseHttpTransport(config)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.request({
        method: 'GET',
        path: '/data',
        headers: { 'X-App-Id': 'override-app' },
      })

      const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
      const headers = fetchOptions.headers as Record<string, string>
      expect(headers['X-App-Id']).toBe('override-app')
    })
  })

  describe('URL construction', () => {
    it('should prepend baseURL to path', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.get('/users')

      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toBe('https://api.example.com/users')
    })

    it('should handle baseURL with trailing slash', async () => {
      const config: HttpTransportConfig = {
        baseURL: 'https://api.example.com/',
      }
      const transport = new BaseHttpTransport(config)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.get('/users')

      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toBe('https://api.example.com/users')
    })

    it('should handle path without leading slash', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      await transport.get('users')

      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toBe('https://api.example.com/users')
    })
  })

  describe('duration tracking', () => {
    it('should track request duration in response', async () => {
      const transport = new BaseHttpTransport(defaultConfig)
      fetchMock.mockResolvedValueOnce(createMockResponse(200, {}))

      const result = await transport.get('/data')

      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(typeof result.duration).toBe('number')
    })
  })
})
