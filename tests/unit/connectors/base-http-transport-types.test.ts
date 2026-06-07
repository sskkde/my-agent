/**
 * Tests for base HTTP transport types and interfaces
 * TDD: Define expected types before implementation
 */

import { describe, it, expect } from 'vitest'
import type {
  HttpTransportConfig,
  HttpTransportAuth,
  HttpTransportRequest,
  HttpTransportResponse,
  HttpTransportError,
  IHttpTransport,
} from '../../../src/connectors/base-http-transport-types.js'

describe('HttpTransportConfig', () => {
  it('should accept minimal config with baseURL only', () => {
    const config: HttpTransportConfig = {
      baseURL: 'https://api.example.com',
    }
    expect(config.baseURL).toBe('https://api.example.com')
  })

  it('should accept full config with all optional fields', () => {
    const config: HttpTransportConfig = {
      baseURL: 'https://api.example.com',
      timeout: 30000,
      retries: 3,
      retryDelay: 1000,
      headers: {
        'X-Custom-Header': 'value',
      },
      auth: {
        type: 'bearer',
        credentials: 'token-123',
      },
    }
    expect(config.timeout).toBe(30000)
    expect(config.retries).toBe(3)
    expect(config.retryDelay).toBe(1000)
    expect(config.headers).toBeDefined()
    expect(config.auth).toBeDefined()
  })
})

describe('HttpTransportAuth', () => {
  it('should support api_key auth type', () => {
    const auth: HttpTransportAuth = {
      type: 'api_key',
      credentials: 'my-api-key',
    }
    expect(auth.type).toBe('api_key')
    expect(auth.credentials).toBe('my-api-key')
  })

  it('should support bearer auth type', () => {
    const auth: HttpTransportAuth = {
      type: 'bearer',
      credentials: 'bearer-token',
    }
    expect(auth.type).toBe('bearer')
  })

  it('should support basic auth type', () => {
    const auth: HttpTransportAuth = {
      type: 'basic',
      credentials: 'base64-encoded-credentials',
    }
    expect(auth.type).toBe('basic')
  })

  it('should support oauth2 auth type', () => {
    const auth: HttpTransportAuth = {
      type: 'oauth2',
      credentials: 'oauth-access-token',
    }
    expect(auth.type).toBe('oauth2')
  })
})

describe('HttpTransportRequest', () => {
  it('should accept GET request with path only', () => {
    const request: HttpTransportRequest = {
      method: 'GET',
      path: '/users',
    }
    expect(request.method).toBe('GET')
    expect(request.path).toBe('/users')
  })

  it('should accept POST request with body', () => {
    const request: HttpTransportRequest = {
      method: 'POST',
      path: '/users',
      body: { name: 'John', email: 'john@example.com' },
    }
    expect(request.method).toBe('POST')
    expect(request.body).toBeDefined()
  })

  it('should accept request with headers and params', () => {
    const request: HttpTransportRequest = {
      method: 'GET',
      path: '/search',
      headers: {
        Accept: 'application/json',
      },
      params: {
        q: 'test',
        limit: '10',
      },
    }
    expect(request.headers).toBeDefined()
    expect(request.params).toBeDefined()
  })

  it('should support all HTTP methods', () => {
    const methods: HttpTransportRequest['method'][] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    methods.forEach((method) => {
      const request: HttpTransportRequest = {
        method,
        path: '/test',
      }
      expect(request.method).toBe(method)
    })
  })
})

describe('HttpTransportResponse<T>', () => {
  it('should accept response with generic body type', () => {
    interface User {
      id: number
      name: string
    }
    const response: HttpTransportResponse<User> = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { id: 1, name: 'John' },
      duration: 150,
    }
    expect(response.status).toBe(200)
    expect(response.body?.name).toBe('John')
  })

  it('should accept response with array body', () => {
    const response: HttpTransportResponse<string[]> = {
      status: 200,
      headers: {},
      body: ['item1', 'item2'],
      duration: 50,
    }
    expect(Array.isArray(response.body)).toBe(true)
  })

  it('should accept response with void body', () => {
    const response: HttpTransportResponse<void> = {
      status: 204,
      headers: {},
      duration: 30,
    }
    expect(response.status).toBe(204)
  })
})

describe('HttpTransportError', () => {
  it('should support timeout error type', () => {
    const error: HttpTransportError = {
      type: 'timeout',
      message: 'Request timed out after 30000ms',
      retryable: true,
    }
    expect(error.type).toBe('timeout')
    expect(error.retryable).toBe(true)
  })

  it('should support network error type', () => {
    const error: HttpTransportError = {
      type: 'network',
      message: 'Connection refused',
      retryable: true,
    }
    expect(error.type).toBe('network')
  })

  it('should support auth error type', () => {
    const error: HttpTransportError = {
      type: 'auth',
      message: 'Invalid API key',
      statusCode: 401,
      retryable: false,
    }
    expect(error.type).toBe('auth')
    expect(error.statusCode).toBe(401)
    expect(error.retryable).toBe(false)
  })

  it('should support rate_limit error type', () => {
    const error: HttpTransportError = {
      type: 'rate_limit',
      message: 'Rate limit exceeded',
      statusCode: 429,
      retryable: true,
    }
    expect(error.type).toBe('rate_limit')
  })

  it('should support server error type', () => {
    const error: HttpTransportError = {
      type: 'server',
      message: 'Internal server error',
      statusCode: 500,
      retryable: true,
    }
    expect(error.type).toBe('server')
  })

  it('should support parse error type', () => {
    const error: HttpTransportError = {
      type: 'parse',
      message: 'Failed to parse JSON response',
      retryable: false,
    }
    expect(error.type).toBe('parse')
  })
})

describe('IHttpTransport interface', () => {
  it('should define request method with generic response', async () => {
    // This test verifies the interface signature
    // Actual implementation will be in separate files
    const mockTransport: IHttpTransport = {
      request: async <T>(_req: HttpTransportRequest): Promise<HttpTransportResponse<T>> => {
        return {
          status: 200,
          headers: {},
          body: undefined as T,
          duration: 0,
        }
      },
      get: async <T>(_path: string, _params?: Record<string, string>): Promise<HttpTransportResponse<T>> => {
        return {
          status: 200,
          headers: {},
          body: undefined as T,
          duration: 0,
        }
      },
      post: async <T>(_path: string, _body?: unknown): Promise<HttpTransportResponse<T>> => {
        return {
          status: 200,
          headers: {},
          body: undefined as T,
          duration: 0,
        }
      },
      put: async <T>(_path: string, _body?: unknown): Promise<HttpTransportResponse<T>> => {
        return {
          status: 200,
          headers: {},
          body: undefined as T,
          duration: 0,
        }
      },
      patch: async <T>(_path: string, _body?: unknown): Promise<HttpTransportResponse<T>> => {
        return {
          status: 200,
          headers: {},
          body: undefined as T,
          duration: 0,
        }
      },
      delete: async <T>(_path: string): Promise<HttpTransportResponse<T>> => {
        return {
          status: 200,
          headers: {},
          body: undefined as T,
          duration: 0,
        }
      },
    }

    // Verify interface methods exist
    expect(typeof mockTransport.request).toBe('function')
    expect(typeof mockTransport.get).toBe('function')
    expect(typeof mockTransport.post).toBe('function')
    expect(typeof mockTransport.put).toBe('function')
    expect(typeof mockTransport.patch).toBe('function')
    expect(typeof mockTransport.delete).toBe('function')
  })
})
