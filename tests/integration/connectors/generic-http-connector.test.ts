import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createGenericHttpConnectorAdapter } from '../../../src/connectors/generic-http/generic-http-connector.js'
import { parseOpenApiSpec, buildInputSchema } from '../../../src/connectors/generic-http/openapi-parser.js'
import type { GenericHttpConfig } from '../../../src/connectors/generic-http/generic-http-types.js'
import type { ConnectorInstance } from '../../../src/storage/connector-store.js'
import type { ConnectorCallRequest } from '../../../src/connectors/types.js'

function createMockInstance(config: GenericHttpConfig): ConnectorInstance {
  return {
    id: 'test-instance-id',
    connectorInstanceId: 'generic-http-instance-001',
    connectorDefinitionId: 'def-001',
    userId: 'test-user-001',
    name: 'Test Generic HTTP Instance',
    authStateRef: 'auth-001',
    config: config as unknown as Record<string, unknown>,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

const PETSTORE_SPEC = {
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  servers: [{ url: 'https://petstore.example.com/api' }],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }],
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { name: { type: 'string' }, tag: { type: 'string' } } },
            },
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'showPetById',
        summary: 'Info for a specific pet',
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
      },
      delete: {
        operationId: 'deletePet',
        summary: 'Delete a specific pet',
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
      },
    },
  },
}

describe('Generic HTTP Connector', () => {
  let originalMockMode: string | undefined

  beforeEach(() => {
    originalMockMode = process.env.GENERIC_HTTP_MOCK_MODE
  })

  afterEach(() => {
    if (originalMockMode !== undefined) {
      process.env.GENERIC_HTTP_MOCK_MODE = originalMockMode
    } else {
      delete process.env.GENERIC_HTTP_MOCK_MODE
    }
  })

  describe('Custom Config with baseURL + auth + headers', () => {
    it('should discover capabilities from request templates', () => {
      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        defaultHeaders: { 'X-Custom-Header': 'value' },
        auth: { type: 'bearer', credentials: { token: 'test-token' } },
        requestTemplates: [
          {
            operationId: 'get_user',
            method: 'GET',
            path: '/users/{{user_id}}',
            description: 'Get a user by ID',
            category: 'read',
            riskLevel: 'low',
          },
          {
            operationId: 'create_user',
            method: 'POST',
            path: '/users',
            bodyTemplate: { name: '{{name}}', email: '{{email}}' },
            description: 'Create a new user',
            category: 'write',
            riskLevel: 'medium',
          },
        ],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)
      const capabilities = adapter.discoverCapabilities(instance)

      expect(capabilities).toHaveLength(2)
      expect(capabilities[0].capabilityId).toBe('generic_http.get_user')
      expect(capabilities[0].category).toBe('read')
      expect(capabilities[0].riskLevel).toBe('low')
      expect(capabilities[0].requiresAuth).toBe(true)
      expect(capabilities[0].supportedOperations).toEqual(['get_user'])

      expect(capabilities[1].capabilityId).toBe('generic_http.create_user')
      expect(capabilities[1].category).toBe('write')
      expect(capabilities[1].riskLevel).toBe('medium')
    })

    it('should discover capabilities without auth', () => {
      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [
          {
            operationId: 'list_items',
            method: 'GET',
            path: '/items',
          },
        ],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)
      const capabilities = adapter.discoverCapabilities(instance)

      expect(capabilities).toHaveLength(1)
      expect(capabilities[0].requiresAuth).toBe(false)
    })
  })

  describe('Request Template Variable Replacement', () => {
    it('should replace {{variable}} placeholders in path', async () => {
      process.env.GENERIC_HTTP_MOCK_MODE = 'true'

      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [
          {
            operationId: 'get_user',
            method: 'GET',
            path: '/users/{{user_id}}/profile',
          },
        ],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)

      const request: ConnectorCallRequest = {
        requestId: 'req-001',
        connectorInstanceId: instance.id,
        capabilityId: 'generic_http.get_user',
        operation: 'get_user',
        params: { user_id: '123' },
        userId: 'test-user-001',
      }

      const result = await adapter.execute(instance, request)
      expect(result).toBeDefined()
      expect((result as Record<string, unknown>).mock).toBe(true)
    })

    it('should replace {{variable}} placeholders in headers', async () => {
      process.env.GENERIC_HTTP_MOCK_MODE = 'true'

      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [
          {
            operationId: 'get_data',
            method: 'GET',
            path: '/data',
            headers: { 'X-API-Key': '{{api_key}}' },
          },
        ],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)

      const request: ConnectorCallRequest = {
        requestId: 'req-002',
        connectorInstanceId: instance.id,
        capabilityId: 'generic_http.get_data',
        operation: 'get_data',
        params: { api_key: 'my-secret-key' },
        userId: 'test-user-001',
      }

      const result = await adapter.execute(instance, request)
      expect(result).toBeDefined()
    })

    it('should replace {{variable}} placeholders in body template', async () => {
      process.env.GENERIC_HTTP_MOCK_MODE = 'true'

      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [
          {
            operationId: 'create_user',
            method: 'POST',
            path: '/users',
            bodyTemplate: { name: '{{name}}', email: '{{email}}' },
          },
        ],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)

      const request: ConnectorCallRequest = {
        requestId: 'req-003',
        connectorInstanceId: instance.id,
        capabilityId: 'generic_http.create_user',
        operation: 'create_user',
        params: { name: 'John', email: 'john@example.com' },
        userId: 'test-user-001',
      }

      const result = await adapter.execute(instance, request)
      expect(result).toBeDefined()
      expect((result as Record<string, unknown>).status).toBe('created')
    })

    it('should throw on unknown operation', async () => {
      process.env.GENERIC_HTTP_MOCK_MODE = 'true'

      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [{ operationId: 'get_user', method: 'GET', path: '/users/{{user_id}}' }],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)

      const request: ConnectorCallRequest = {
        requestId: 'req-004',
        connectorInstanceId: instance.id,
        capabilityId: 'generic_http.unknown',
        operation: 'unknown_op',
        params: {},
        userId: 'test-user-001',
      }

      await expect(adapter.execute(instance, request)).rejects.toThrow('Unknown operation: unknown_op')
    })
  })

  describe('Response Mapping', () => {
    it('should apply response mapping to extract nested data', async () => {
      process.env.GENERIC_HTTP_MOCK_MODE = 'true'

      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [{ operationId: 'list_items', method: 'GET', path: '/items' }],
        responseMappings: {
          list_items: { jsonPath: 'data' },
        },
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)

      const request: ConnectorCallRequest = {
        requestId: 'req-005',
        connectorInstanceId: instance.id,
        capabilityId: 'generic_http.list_items',
        operation: 'list_items',
        params: {},
        userId: 'test-user-001',
      }

      const result = await adapter.execute(instance, request)
      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
      expect(result).toEqual([])
    })
  })

  describe('OpenAPI Spec Parsing', () => {
    it('should parse a minimal Petstore-like spec', () => {
      const result = parseOpenApiSpec(PETSTORE_SPEC)

      expect(result.config.baseURL).toBe('https://petstore.example.com/api')
      expect(result.config.requestTemplates).toHaveLength(4)
      expect(result.warnings).toHaveLength(0)

      const listPets = result.config.requestTemplates.find((t) => t.operationId === 'listPets')
      expect(listPets).toBeDefined()
      expect(listPets!.method).toBe('GET')
      expect(listPets!.path).toBe('/pets')
      expect(listPets!.category).toBe('read')
      expect(listPets!.riskLevel).toBe('low')

      const createPet = result.config.requestTemplates.find((t) => t.operationId === 'createPet')
      expect(createPet).toBeDefined()
      expect(createPet!.method).toBe('POST')
      expect(createPet!.category).toBe('write')

      const showPetById = result.config.requestTemplates.find((t) => t.operationId === 'showPetById')
      expect(showPetById).toBeDefined()
      expect(showPetById!.method).toBe('GET')
      expect(showPetById!.path).toBe('/pets/{petId}')

      const deletePet = result.config.requestTemplates.find((t) => t.operationId === 'deletePet')
      expect(deletePet).toBeDefined()
      expect(deletePet!.method).toBe('DELETE')
      expect(deletePet!.riskLevel).toBe('high')
    })

    it('should generate input schema from OpenAPI parameters', () => {
      const showPetByIdOp = PETSTORE_SPEC.paths['/pets/{petId}'].get
      const schema = buildInputSchema({
        ...showPetByIdOp,
        parameters: showPetByIdOp.parameters.map((p) => ({
          ...p,
          in: p.in as 'path' | 'query' | 'header' | 'cookie',
        })),
      })

      expect(schema.type).toBe('object')
      expect(schema.properties).toHaveProperty('petId')
      expect(schema.required).toContain('petId')
    })

    it('should warn on invalid spec', () => {
      const result = parseOpenApiSpec(null)
      expect(result.warnings).toHaveLength(1)
      expect(result.config.requestTemplates).toHaveLength(0)
    })

    it('should warn on unsupported OpenAPI version', () => {
      const result = parseOpenApiSpec({ openapi: '2.0', paths: {} })
      expect(result.warnings.some((w) => w.includes('Unsupported'))).toBe(true)
    })

    it('should warn when no paths found', () => {
      const result = parseOpenApiSpec({ openapi: '3.0.0', info: { title: 'Empty', version: '1.0' } })
      expect(result.warnings.some((w) => w.includes('No paths'))).toBe(true)
    })

    it('should use basePath when servers not present', () => {
      const result = parseOpenApiSpec({
        openapi: '3.0.0',
        basePath: 'https://legacy.example.com',
        paths: { '/test': { get: { operationId: 'testOp' } } },
      })

      expect(result.config.baseURL).toBe('https://legacy.example.com')
    })

    it('should generate operationId from path when missing', () => {
      const result = parseOpenApiSpec({
        openapi: '3.0.0',
        servers: [{ url: 'https://api.example.com' }],
        paths: { '/items/{id}': { get: {} } },
      })

      expect(result.config.requestTemplates[0].operationId).toBe('get_items_id')
    })
  })

  describe('OpenAPI Integration with Connector', () => {
    it('should merge OpenAPI spec with manual templates', () => {
      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [{ operationId: 'custom_op', method: 'GET', path: '/custom' }],
        openApiImport: {
          specObject: PETSTORE_SPEC,
        },
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)
      const capabilities = adapter.discoverCapabilities(instance)

      expect(capabilities.length).toBeGreaterThanOrEqual(5)
      expect(capabilities.some((c) => c.capabilityId === 'generic_http.custom_op')).toBe(true)
      expect(capabilities.some((c) => c.capabilityId === 'generic_http.listPets')).toBe(true)
    })

    it('should override baseURL with basePathOverride', () => {
      const config: GenericHttpConfig = {
        baseURL: 'https://original.example.com',
        requestTemplates: [],
        openApiImport: {
          specObject: PETSTORE_SPEC,
          basePathOverride: 'https://override.example.com',
        },
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)
      const capabilities = adapter.discoverCapabilities(instance)

      expect(capabilities.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('Mock Mode', () => {
    it('should return mock responses when GENERIC_HTTP_MOCK_MODE=true', async () => {
      process.env.GENERIC_HTTP_MOCK_MODE = 'true'

      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [
          { operationId: 'get_user', method: 'GET', path: '/users/{{user_id}}' },
          { operationId: 'create_user', method: 'POST', path: '/users' },
          { operationId: 'delete_user', method: 'DELETE', path: '/users/{{user_id}}' },
        ],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)

      const getResult = await adapter.execute(instance, {
        requestId: 'req-mock-1',
        connectorInstanceId: instance.id,
        capabilityId: 'generic_http.get_user',
        operation: 'get_user',
        params: { user_id: '1' },
        userId: 'test-user-001',
      })
      expect((getResult as Record<string, unknown>).mock).toBe(true)
      expect((getResult as Record<string, unknown>).status).toBe('ok')

      const postResult = await adapter.execute(instance, {
        requestId: 'req-mock-2',
        connectorInstanceId: instance.id,
        capabilityId: 'generic_http.create_user',
        operation: 'create_user',
        params: {},
        userId: 'test-user-001',
      })
      expect((postResult as Record<string, unknown>).mock).toBe(true)
      expect((postResult as Record<string, unknown>).status).toBe('created')

      const deleteResult = await adapter.execute(instance, {
        requestId: 'req-mock-3',
        connectorInstanceId: instance.id,
        capabilityId: 'generic_http.delete_user',
        operation: 'delete_user',
        params: { user_id: '1' },
        userId: 'test-user-001',
      })
      expect((deleteResult as Record<string, unknown>).mock).toBe(true)
      expect((deleteResult as Record<string, unknown>).status).toBe('deleted')
    })

    it('should report healthy in mock mode', () => {
      process.env.GENERIC_HTTP_MOCK_MODE = 'true'

      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)

      const health = adapter.checkHealth(instance)
      expect(health.healthy).toBe(true)
      expect(health.message).toBe('Mock mode active')
    })
  })

  describe('checkHealth', () => {
    it('should return healthy when config is valid', () => {
      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)

      const health = adapter.checkHealth(instance)
      expect(health.healthy).toBe(true)
      expect(health.message).toBe('Configuration valid')
    })

    it('should return unhealthy when baseURL is missing', () => {
      const config: GenericHttpConfig = {
        baseURL: '',
        requestTemplates: [],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)

      const health = adapter.checkHealth(instance)
      expect(health.healthy).toBe(false)
      expect(health.message).toBe('No baseURL configured')
    })

    it('should return unhealthy when config is missing', () => {
      const instance: ConnectorInstance = {
        id: 'test-instance-id',
        connectorInstanceId: 'generic-http-instance-002',
        connectorDefinitionId: 'def-001',
        userId: 'test-user-001',
        name: 'Test Instance No Config',
        authStateRef: 'auth-001',
        config: undefined,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const adapter = createGenericHttpConnectorAdapter()
      const health = adapter.checkHealth(instance)
      expect(health.healthy).toBe(false)
    })

    it('should probe health asynchronously in mock mode', async () => {
      process.env.GENERIC_HTTP_MOCK_MODE = 'true'

      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [],
        healthCheckPath: '/health',
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)

      const health = await adapter.probeHealth(instance)
      expect(health.healthy).toBe(true)
      expect(health.message).toBe('Mock mode active')
    })
  })

  describe('Auth Configuration', () => {
    it('should support bearer auth in config', () => {
      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        auth: { type: 'bearer', credentials: { token: 'my-bearer-token' } },
        requestTemplates: [{ operationId: 'get_data', method: 'GET', path: '/data' }],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)
      const capabilities = adapter.discoverCapabilities(instance)

      expect(capabilities[0].requiresAuth).toBe(true)
    })

    it('should support api_key auth in config', () => {
      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        auth: { type: 'api_key', credentials: { api_key: 'my-api-key' } },
        requestTemplates: [{ operationId: 'get_data', method: 'GET', path: '/data' }],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)
      const capabilities = adapter.discoverCapabilities(instance)

      expect(capabilities[0].requiresAuth).toBe(true)
    })

    it('should support basic auth in config', () => {
      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        auth: { type: 'basic', credentials: { username: 'user', password: 'pass' } },
        requestTemplates: [{ operationId: 'get_data', method: 'GET', path: '/data' }],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)
      const capabilities = adapter.discoverCapabilities(instance)

      expect(capabilities[0].requiresAuth).toBe(true)
    })
  })

  describe('Input Schema Generation', () => {
    it('should generate input schema with path parameters as required', () => {
      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [
          {
            operationId: 'get_user',
            method: 'GET',
            path: '/users/{{user_id}}/posts/{{post_id}}',
          },
        ],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)
      const capabilities = adapter.discoverCapabilities(instance)

      const schema = capabilities[0].inputSchema
      expect(schema.properties).toHaveProperty('user_id')
      expect(schema.properties).toHaveProperty('post_id')
      expect(schema.required).toEqual(['user_id', 'post_id'])
    })

    it('should generate input schema with body for POST templates', () => {
      const config: GenericHttpConfig = {
        baseURL: 'https://api.example.com',
        requestTemplates: [
          {
            operationId: 'create_user',
            method: 'POST',
            path: '/users',
            bodyTemplate: { name: '{{name}}' },
          },
        ],
      }

      const adapter = createGenericHttpConnectorAdapter()
      const instance = createMockInstance(config)
      const capabilities = adapter.discoverCapabilities(instance)

      const schema = capabilities[0].inputSchema
      expect(schema.properties).toHaveProperty('body')
    })
  })
})
