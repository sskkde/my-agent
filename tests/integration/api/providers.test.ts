import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext } from '../../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import type { ApiContext } from '../../../src/api/context.js'
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js'
import { randomUUID } from 'crypto'

describe('Provider API Integration', () => {
  let server: FastifyInstance
  let context: ApiContext
  let authToken: string
  let userId: string
  const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-testing-only-do-not-use-in-production'

  beforeAll(async () => {
    process.env.APP_SECRET_KEY = TEST_ENCRYPTION_KEY

    const contextResult = createApiContext({ dbPath: ':memory:' })
    if ('code' in contextResult) {
      throw new Error(`Failed to create API context: ${contextResult.message}`)
    }
    context = contextResult

    server = await createApiServer(context)

    // Create a test user
    userId = randomUUID()
    context.stores.userStore.create({
      userId,
      username: 'testuser',
      passwordHash: await hashPassword('testpassword'),
    })

    // Create a session token for authentication
    authToken = generateSessionToken()
    const tokenHash = hashToken(authToken)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    context.stores.authTokenStore.create({
      tokenHash,
      userId,
      expiresAt,
    })
  })

  afterAll(async () => {
    delete process.env.APP_SECRET_KEY
    await server.close()
    context.connection.close()
  })

  beforeEach(() => {
    // Clean up providers before each test
    const providers = context.providerConfigStore.listByUser(userId)
    for (const provider of providers) {
      context.providerConfigStore.remove(provider.providerId)
    }
  })

  describe('GET /api/providers', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/providers',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return empty array when no providers exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data).toEqual([])
    })

    it('should return list of providers for authenticated user', async () => {
      // Create a provider first
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Test OpenAI',
        apiKey: 'sk-test1234567890',
        enabled: true,
      })

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data).toHaveLength(1)
      expect(body.data[0]).toMatchObject({
        providerType: 'openai',
        displayName: 'Test OpenAI',
        enabled: true,
        configured: true,
        apiKeyLast4: '7890',
      })
      expect(body.data[0].apiKey).toBeUndefined()
      expect(body.data[0].encryptedApiKey).toBeUndefined()
    })
  })

  describe('POST /api/providers', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        payload: {
          providerType: 'openai',
          apiKey: 'sk-test1234567890',
        },
      })

      expect(response.statusCode).toBe(401)
    })

    it('should create a new OpenAI provider', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'openai',
          displayName: 'My OpenAI',
          apiKey: 'sk-test1234567890',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'openai',
        displayName: 'My OpenAI',
        enabled: true,
        configured: true,
        apiKeyLast4: '7890',
      })
      expect(body.data.providerId).toBeDefined()
      expect(body.data.apiKey).toBeUndefined()
    })

    it('should create a new Ollama provider', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'ollama',
          displayName: 'Local Ollama',
          baseUrl: 'http://localhost:11434',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'ollama',
        displayName: 'Local Ollama',
        enabled: true,
        baseUrl: 'http://localhost:11434',
      })
    })

    it('should create a new custom provider', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'custom',
          displayName: 'Custom Compatible API',
          apiKey: 'custom-key-1234567890',
          baseUrl: 'https://api.example.com/v1',
          selectedModel: 'custom-model',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'custom',
        displayName: 'Custom Compatible API',
        enabled: true,
        configured: true,
        apiKeyLast4: '7890',
        baseUrl: 'https://api.example.com/v1',
        selectedModel: 'custom-model',
      })
      expect(body.data.apiKey).toBeUndefined()
    })

    it('should return 400 for invalid provider type', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'invalid',
          apiKey: 'test',
        },
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error.code).toBe('INVALID_PROVIDER_TYPE')
    })

    it('should return 400 when OpenAI provider missing apiKey', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'openai',
          displayName: 'Test',
        },
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error.code).toBe('API_KEY_REQUIRED')
    })

    it('should create Ollama provider with catalog default baseUrl when not provided', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'ollama',
          displayName: 'Test',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data.providerType).toBe('ollama')
      expect(body.data.baseUrl).toBe('http://localhost:11434')
      expect(body.data.family).toBe('ollama')
      expect(body.data.protocol).toBe('ollama_chat')
    })

    it('should create provider with runtime metadata without leaking header values', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'custom',
          displayName: 'Metadata Provider',
          apiKey: 'custom-key-1234567890',
          baseUrl: 'https://api.example.com/v1',
          selectedModel: 'custom-model',
          family: 'openai_compatible',
          protocol: 'openai_chat',
          priority: 7,
          defaultModel: 'custom-model',
          headers: { 'X-Gateway-Token': 'secret-token' },
          capabilities: { functionCalling: true, jsonMode: true },
          models: [{ modelId: 'custom-model', limits: { outputTokens: 8192 } }],
          options: { tenant: 'enterprise' },
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'custom',
        displayName: 'Metadata Provider',
        selectedModel: 'custom-model',
        family: 'openai_compatible',
        protocol: 'openai_chat',
        priority: 7,
        defaultModel: 'custom-model',
        headersConfigured: true,
        capabilities: { functionCalling: true, jsonMode: true },
        models: [{ modelId: 'custom-model', limits: { outputTokens: 8192 } }],
        options: { tenant: 'enterprise' },
      })
      expect(body.data.headers).toBeUndefined()
      expect(JSON.stringify(body.data)).not.toContain('secret-token')

      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/providers/${body.data.providerId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })
      const getBody = JSON.parse(getResponse.body)
      expect(getBody.data.headersConfigured).toBe(true)
      expect(getBody.data.headers).toBeUndefined()
      expect(JSON.stringify(getBody.data)).not.toContain('secret-token')
    })

    it('should return 400 when custom provider missing apiKey', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'custom',
          displayName: 'Custom API',
          baseUrl: 'https://api.example.com/v1',
        },
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error.code).toBe('API_KEY_REQUIRED')
    })

    it('should create DashScope provider with key-only (no baseUrl)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'dashscope',
          displayName: 'My DashScope',
          apiKey: 'sk-dashscope-test-key',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'dashscope',
        displayName: 'My DashScope',
        enabled: true,
        configured: true,
        apiKeyLast4: '-key',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        family: 'openai_compatible',
        protocol: 'openai_chat',
        defaultModel: 'qwen-plus',
      })
      expect(body.data.apiKey).toBeUndefined()
    })

    it('should create Spark provider with key-only (no baseUrl)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'iflytek-spark',
          displayName: 'My Spark',
          apiKey: 'sk-spark-test-key',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'iflytek-spark',
        displayName: 'My Spark',
        enabled: true,
        baseUrl: 'https://spark-api-open.xf-yun.com/v1',
        defaultModel: 'spark-max',
      })
    })

    it('should create Volcengine provider with key-only (no baseUrl)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'volcengine',
          displayName: 'My Volcengine',
          apiKey: 'sk-volcengine-test-key',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'volcengine',
        displayName: 'My Volcengine',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      })
    })

    it('should allow domestic provider with custom baseUrl override', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'dashscope',
          displayName: 'DashScope Custom URL',
          apiKey: 'sk-dashscope-test-key',
          baseUrl: 'https://custom.dashscope.com/v1',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data.baseUrl).toBe('https://custom.dashscope.com/v1')
    })

    it('should return 400 when domestic provider missing apiKey', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'dashscope',
          displayName: 'DashScope No Key',
        },
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error.code).toBe('API_KEY_REQUIRED')
    })

    it('should create Qianfan provider with key-only', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { cookie: `agent-platform-session=${authToken}` },
        payload: { providerType: 'qianfan', displayName: 'My Qianfan', apiKey: 'sk-qianfan-test-key' },
      })
      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'qianfan',
        displayName: 'My Qianfan',
        enabled: true,
        configured: true,
        baseUrl: 'https://qianfan.baidubce.com/v2',
        defaultModel: 'ernie-4.0-8k',
      })
    })

    it('should create Zhipu provider with key-only', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { cookie: `agent-platform-session=${authToken}` },
        payload: { providerType: 'zhipu', displayName: 'My Zhipu', apiKey: 'sk-zhipu-test-key' },
      })
      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'zhipu',
        displayName: 'My Zhipu',
        enabled: true,
        configured: true,
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        defaultModel: 'glm-4-plus',
      })
    })

    it('should create Moonshot provider with key-only', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { cookie: `agent-platform-session=${authToken}` },
        payload: { providerType: 'moonshot', displayName: 'My Moonshot', apiKey: 'sk-moonshot-test-key' },
      })
      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'moonshot',
        displayName: 'My Moonshot',
        enabled: true,
        configured: true,
        baseUrl: 'https://api.moonshot.cn/v1',
        defaultModel: 'moonshot-v1-auto',
      })
    })

    it('should create MiniMax provider with key-only', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { cookie: `agent-platform-session=${authToken}` },
        payload: { providerType: 'minimax', displayName: 'My MiniMax', apiKey: 'sk-minimax-test-key' },
      })
      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'minimax',
        displayName: 'My MiniMax',
        enabled: true,
        configured: true,
        baseUrl: 'https://api.minimax.chat/v1',
        defaultModel: 'MiniMax-Text-01',
      })
    })

    it('should create JD Cloud Yanxi provider with key-only', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { cookie: `agent-platform-session=${authToken}` },
        payload: { providerType: 'jdcloud-yanxi', displayName: 'My JD Cloud', apiKey: 'sk-jdcloud-test-key' },
      })
      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'jdcloud-yanxi',
        displayName: 'My JD Cloud',
        enabled: true,
        configured: true,
        baseUrl: 'https://api.jd.com/v1',
        defaultModel: 'yanxi-v1',
      })
    })

    it('should create MiMo provider with key-only', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { cookie: `agent-platform-session=${authToken}` },
        payload: { providerType: 'mimo', displayName: 'My MiMo', apiKey: 'sk-mimo-test-key' },
      })
      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'mimo',
        displayName: 'My MiMo',
        enabled: true,
        configured: true,
        baseUrl: 'https://api.mimmo.com/v1',
        defaultModel: 'mimo-v1',
      })
    })

    it('should create StepFun provider with key-only', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { cookie: `agent-platform-session=${authToken}` },
        payload: { providerType: 'stepfun', displayName: 'My StepFun', apiKey: 'sk-stepfun-test-key' },
      })
      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'stepfun',
        displayName: 'My StepFun',
        enabled: true,
        configured: true,
        baseUrl: 'https://api.stepfun.com/v1',
        defaultModel: 'step-1v-32k',
      })
    })

    it('should create Hunyuan provider with key-only', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { cookie: `agent-platform-session=${authToken}` },
        payload: { providerType: 'hunyuan', displayName: 'My Hunyuan', apiKey: 'sk-hunyuan-test-key' },
      })
      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'hunyuan',
        displayName: 'My Hunyuan',
        enabled: true,
        configured: true,
        baseUrl: 'https://hunyuan.tencentcloudapi.com/v1',
        defaultModel: 'hunyuan-pro',
      })
    })

    it('should create DeepSeek provider with key-only', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { cookie: `agent-platform-session=${authToken}` },
        payload: { providerType: 'deepseek', displayName: 'My DeepSeek', apiKey: 'sk-deepseek-test-key' },
      })
      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'deepseek',
        displayName: 'My DeepSeek',
        enabled: true,
        configured: true,
        baseUrl: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-v4-flash',
      })
    })

    it('should create SiliconFlow provider with key-only', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { cookie: `agent-platform-session=${authToken}` },
        payload: { providerType: 'siliconflow', displayName: 'My SiliconFlow', apiKey: 'sk-siliconflow-test-key' },
      })
      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        providerType: 'siliconflow',
        displayName: 'My SiliconFlow',
        enabled: true,
        configured: true,
        baseUrl: 'https://api.siliconflow.cn/v1',
        defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
      })
    })

    it('should return 400 when each domestic provider missing apiKey', async () => {
      const domesticTypes = [
        'qianfan', 'zhipu', 'moonshot', 'minimax', 'jdcloud-yanxi',
        'mimo', 'stepfun', 'hunyuan', 'deepseek', 'siliconflow',
      ]

      for (const providerType of domesticTypes) {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/providers',
          headers: { cookie: `agent-platform-session=${authToken}` },
          payload: { providerType, displayName: `${providerType} No Key` },
        })
        expect(response.statusCode).toBe(400)
        const body = JSON.parse(response.body)
        expect(body.error.code).toBe('API_KEY_REQUIRED')
      }
    })

    it('should return 400 when custom provider missing baseUrl', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'custom',
          displayName: 'Custom API',
          apiKey: 'custom-key-1234567890',
        },
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error.code).toBe('BASE_URL_REQUIRED')
    })
  })

  describe('PATCH /api/providers/:providerId', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/providers/test-id',
        payload: {
          displayName: 'Updated',
        },
      })

      expect(response.statusCode).toBe(401)
    })

    it('should update provider display name', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Original Name',
        apiKey: 'sk-test1234567890',
        enabled: true,
      })

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/providers/${provider.providerId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'Updated Name',
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.displayName).toBe('Updated Name')
    })

    it('should update runtime metadata fields', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Metadata Update Provider',
        apiKey: 'sk-test1234567890',
        enabled: true,
      })

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/providers/${provider.providerId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          family: 'openai_compatible',
          protocol: 'openai_chat',
          priority: 3,
          defaultModel: 'gpt-4o-mini',
          headers: { 'X-Org-Id': 'org-secret' },
          capabilities: { promptCache: true },
          models: [{ modelId: 'gpt-4o-mini', displayName: 'GPT 4o Mini Override' }],
          options: { routing: 'primary' },
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        family: 'openai_compatible',
        protocol: 'openai_chat',
        priority: 3,
        defaultModel: 'gpt-4o-mini',
        headersConfigured: true,
        capabilities: { promptCache: true },
        models: [{ modelId: 'gpt-4o-mini', displayName: 'GPT 4o Mini Override' }],
        options: { routing: 'primary' },
      })
      expect(body.data.headers).toBeUndefined()
      expect(JSON.stringify(body.data)).not.toContain('org-secret')
    })

    it('should return 404 for non-existent provider', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/providers/non-existent-id',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'Updated',
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('should return 403 when accessing other user provider', async () => {
      const otherUserId = randomUUID()
      context.stores.userStore.create({
        userId: otherUserId,
        username: 'otheruser',
        passwordHash: await hashPassword('password'),
      })

      const otherProvider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId: otherUserId,
        providerType: 'openai',
        displayName: 'Other Provider',
        apiKey: 'sk-other1234567890',
        enabled: true,
      })

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/providers/${otherProvider.providerId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'Hacked',
        },
      })

      expect(response.statusCode).toBe(403)
    })
  })

  describe('DELETE /api/providers/:providerId', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/providers/test-id',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should delete provider', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'To Delete',
        apiKey: 'sk-test1234567890',
        enabled: true,
      })

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/providers/${provider.providerId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(204)

      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/providers`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })
      const body = JSON.parse(getResponse.body)
      expect(body.data).toHaveLength(0)
    })

    it('should return 404 for non-existent provider', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/providers/non-existent-id',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('should return 403 when deleting other user provider', async () => {
      const otherUserId = randomUUID()
      context.stores.userStore.create({
        userId: otherUserId,
        username: 'otheruser2',
        passwordHash: await hashPassword('password'),
      })

      const otherProvider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId: otherUserId,
        providerType: 'openai',
        displayName: 'Other Provider',
        apiKey: 'sk-other1234567890',
        enabled: true,
      })

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/providers/${otherProvider.providerId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(403)
    })
  })

  describe('POST /api/providers/:providerId/test', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers/test-id/test',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should test connection and return result', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'ollama',
        displayName: 'Test Ollama',
        baseUrl: 'http://invalid-host:11434',
        enabled: true,
      })

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data).toHaveProperty('success')
      expect(body.data).toHaveProperty('latencyMs')
      expect(typeof body.data.latencyMs).toBe('number')
    })

    it('should test custom provider connection and return result', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'custom',
        displayName: 'Custom API',
        apiKey: 'custom-key-1234567890',
        baseUrl: 'not-a-valid-url',
        enabled: true,
      })

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        success: false,
        latencyMs: 0,
        error: 'Invalid base URL format',
      })
    })

    it('should include network error details when custom provider connection fails', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'custom',
        displayName: 'Unreachable Custom API',
        apiKey: 'custom-key-1234567890',
        baseUrl: 'http://127.0.0.1:1/v1',
        enabled: true,
      })

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.success).toBe(false)
      expect(body.data.error).toContain('Connection error:')
      expect(body.data.error).toContain('127.0.0.1:1')
      expect(body.data.error.length).toBeGreaterThan('Connection error:'.length)
    })

    it('should use configured OpenAI base URL when testing connection', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'OpenAI Compatible API',
        apiKey: 'sk-test1234567890',
        baseUrl: 'http://127.0.0.1:1/v1',
        enabled: true,
      })

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.success).toBe(false)
      expect(body.data.error).toContain('http://127.0.0.1:1/v1/models')
      expect(body.data.error).not.toContain('api.openai.com')
    })

    it('should use configured OpenRouter base URL when testing connection', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openrouter',
        displayName: 'OpenRouter Compatible API',
        apiKey: 'sk-or-test1234567890',
        baseUrl: 'http://127.0.0.1:1/api/v1',
        enabled: true,
      })

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.success).toBe(false)
      expect(body.data.error).toContain('http://127.0.0.1:1/api/v1/models')
      expect(body.data.error).not.toContain('openrouter.ai')
    })

    it('should append models directly for custom versioned API paths', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'custom',
        displayName: 'Volcengine Ark Coding API',
        apiKey: 'custom-key-1234567890',
        baseUrl: 'http://127.0.0.1:1/api/coding/v3',
        enabled: true,
      })

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.success).toBe(false)
      expect(body.data.error).toContain('http://127.0.0.1:1/api/coding/v3/models')
      expect(body.data.error).not.toContain('/api/v1/coding/v3/v1/models')
    })

    it('should test DashScope connection using catalog default baseUrl', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'dashscope',
        displayName: 'DashScope Test',
        apiKey: 'sk-dashscope-test-key',
        enabled: true,
      })

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data).toHaveProperty('success')
      expect(body.data).toHaveProperty('latencyMs')
      expect(body.data.success).toBe(false)
      expect(body.data.error).toBeDefined()
      expect(body.data.latencyMs).toBeGreaterThan(0)
    })

    it('should test domestic provider with custom baseUrl override', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'dashscope',
        displayName: 'DashScope Custom URL',
        apiKey: 'sk-dashscope-test-key',
        baseUrl: 'http://127.0.0.1:1/v1',
        enabled: true,
      })

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.success).toBe(false)
      expect(body.data.error).toContain('127.0.0.1:1')
      expect(body.data.error).not.toContain('dashscope.aliyuncs.com')
    })

    it('should return 404 for non-existent provider', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers/non-existent-id/test',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('should return 403 when testing other user provider', async () => {
      const otherUserId = randomUUID()
      context.stores.userStore.create({
        userId: otherUserId,
        username: 'otheruser3',
        passwordHash: await hashPassword('password'),
      })

      const otherProvider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId: otherUserId,
        providerType: 'ollama',
        displayName: 'Other Ollama',
        baseUrl: 'http://localhost:11434',
        enabled: true,
      })

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/providers/${otherProvider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(403)
    })

    it('should not include API key in error messages', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Test OpenAI',
        apiKey: 'sk-secretapikey123',
        enabled: true,
      })

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const responseBody = response.body
      expect(responseBody).not.toContain('sk-secretapikey123')
      expect(responseBody).not.toContain('secretapikey')
    })
  })
})
