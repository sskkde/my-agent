import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext } from '../../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import type { ApiContext } from '../../../src/api/context.js'
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js'
import { randomUUID } from 'crypto'
import type { WorkflowStep } from '../../../src/workflows/types.js'

describe('Workflow API Integration', () => {
  let server: FastifyInstance
  let context: ApiContext
  let authToken: string
  let userId: string
  const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-testing-only-do-not-use-in-production'

  const validStep: WorkflowStep = {
    stepId: 'step-1',
    stepType: 'tool_call',
    name: 'Test Step',
    config: {
      toolName: 'status_query',
    },
  }

  const validSteps: WorkflowStep[] = [validStep]

  beforeAll(async () => {
    process.env.APP_SECRET_KEY = TEST_ENCRYPTION_KEY

    const contextResult = createApiContext({ dbPath: ':memory:' })
    if ('code' in contextResult) {
      throw new Error(`Failed to create API context: ${contextResult.message}`)
    }
    context = contextResult

    server = await createApiServer(context)

    userId = randomUUID()
    context.stores.userStore.create({
      userId,
      username: 'testuser',
      passwordHash: await hashPassword('testpassword'),
    })

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

  describe('GET /api/workflows/drafts', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/drafts',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return empty array when no drafts exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data).toEqual([])
    })

    it('should return list of drafts for authenticated user', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Test Workflow',
          steps: validSteps,
        },
      })

      expect(createResponse.statusCode).toBe(201)

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data).toHaveLength(1)
      expect(body.data[0]).toMatchObject({
        name: 'Test Workflow',
        ownerUserId: userId,
        status: 'draft',
      })
    })
  })

  describe('POST /api/workflows/drafts', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        payload: {
          name: 'Test',
          steps: validSteps,
        },
      })

      expect(response.statusCode).toBe(401)
    })

    it('should create a new workflow draft', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'New Workflow',
          description: 'A test workflow',
          steps: validSteps,
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        name: 'New Workflow',
        description: 'A test workflow',
        ownerUserId: userId,
        status: 'draft',
        validationIssues: [],
      })
      expect(body.data.draftId).toBeDefined()
      expect(body.data.steps).toEqual(validSteps)
    })

    it('should return 400 when name is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          steps: validSteps,
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('should return 400 when steps is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Test Workflow',
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('should return 400 when steps have invalid structure', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Test Workflow',
          steps: [{ invalidStep: true }],
        },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('GET /api/workflows/drafts/:draftId', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/drafts/some-id',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return 404 for non-existent draft', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/drafts/non-existent-id',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('should return draft for authenticated owner', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Get Test Workflow',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/workflows/drafts/${draftId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.draftId).toBe(draftId)
      expect(body.data.name).toBe('Get Test Workflow')
    })
  })

  describe('PATCH /api/workflows/drafts/:draftId', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/workflows/drafts/some-id',
        payload: { name: 'Updated' },
      })

      expect(response.statusCode).toBe(401)
    })

    it('should update draft name', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Original Name',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/workflows/drafts/${draftId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Updated Name',
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.name).toBe('Updated Name')
    })

    it('should update draft steps', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Steps Update Test',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const newSteps: WorkflowStep[] = [
        {
          stepId: 'step-1',
          stepType: 'tool_call',
          name: 'First Step',
          config: { toolName: 'status_query' },
        },
        {
          stepId: 'step-2',
          stepType: 'tool_call',
          name: 'Second Step',
          config: { toolName: 'memory_retrieve' },
          nextStepId: undefined,
        },
      ]

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/workflows/drafts/${draftId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          steps: newSteps,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.steps).toHaveLength(2)
    })

    it('should return 404 for non-existent draft', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/workflows/drafts/non-existent-id',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Updated',
        },
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('POST /api/workflows/drafts/:draftId/validate', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts/some-id/validate',
      })

      expect(response.statusCode).toBe(401)
    })

    it('creates and validates workflow draft', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Valid Workflow',
          steps: validSteps,
        },
      })

      expect(createResponse.statusCode).toBe(201)
      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const validateResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/validate`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(validateResponse.statusCode).toBe(200)
      const validateBody = JSON.parse(validateResponse.body)
      expect(validateBody.data.valid).toBe(true)
      expect(validateBody.data.issues).toEqual([])
    })

    it('should return validation issues for invalid draft', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Invalid Workflow',
          steps: [],
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/validate`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.valid).toBe(false)
      expect(body.data.issues.length).toBeGreaterThan(0)
    })

    it('should return 404 for non-existent draft', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts/non-existent-id/validate',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('POST /api/workflows/drafts/:draftId/publish', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts/some-id/publish',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should publish a valid draft', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Publishable Workflow',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/publish`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        name: 'Publishable Workflow',
        version: 1,
        status: 'published',
        ownerUserId: userId,
      })
      expect(body.data.workflowId).toBeDefined()
    })

    it('should return 400 for invalid draft', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Invalid for Publish',
          steps: [],
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/publish`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('should return 404 for non-existent draft', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts/non-existent-id/publish',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('DELETE /api/workflows/drafts/:draftId', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/workflows/drafts/some-id',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should delete draft', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'To Delete',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/workflows/drafts/${draftId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(204)

      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/workflows/drafts/${draftId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(getResponse.statusCode).toBe(404)
    })

    it('should return 404 for non-existent draft', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/workflows/drafts/non-existent-id',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('GET /api/workflows/definitions', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/definitions',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return definitions list for authenticated user', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/definitions',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(Array.isArray(body.data)).toBe(true)
    })

    it('should return list of definitions for authenticated user', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Definition List Test',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/publish`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/definitions',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data[0]).toMatchObject({
        name: 'Definition List Test',
        status: 'published',
      })
    })
  })

  describe('GET /api/workflows/definitions/:workflowId', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/definitions/some-id',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return 404 for non-existent definition', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/definitions/non-existent-id',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('should return definition for authenticated owner', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Get Definition Test',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const publishResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/publish`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const publishBody = JSON.parse(publishResponse.body)
      const workflowId = publishBody.data.workflowId

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/workflows/definitions/${workflowId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.workflowId).toBe(workflowId)
    })
  })

  describe('POST /api/workflows/runs', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/runs',
        payload: { definitionId: 'some-id' },
      })

      expect(response.statusCode).toBe(401)
    })

    it('should start a workflow run', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Run Test Workflow',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const publishResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/publish`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const publishBody = JSON.parse(publishResponse.body)
      const workflowId = publishBody.data.workflowId

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/runs',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          definitionId: workflowId,
          inputData: { testKey: 'testValue' },
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.data).toMatchObject({
        definitionId: workflowId,
        version: 1,
        status: 'running',
      })
      expect(body.data.workflowRunId).toBeDefined()
      expect(body.data.stepRuns).toHaveLength(1)
    })

    it('should return 400 when definitionId is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/runs',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })

    it('should return 404 for non-existent definition', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/runs',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          definitionId: 'non-existent-id',
        },
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('GET /api/workflows/runs/:workflowRunId', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/runs/some-id',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return 404 for non-existent run', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/runs/non-existent-id',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('should return run for authenticated owner', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Get Run Test',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const publishResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/publish`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const publishBody = JSON.parse(publishResponse.body)
      const workflowId = publishBody.data.workflowId

      const runResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/runs',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          definitionId: workflowId,
        },
      })

      const runBody = JSON.parse(runResponse.body)
      const workflowRunId = runBody.data.workflowRunId

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/workflows/runs/${workflowRunId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.workflowRunId).toBe(workflowRunId)
    })
  })

  describe('Cross-user access', () => {
    let otherUserId: string
    let otherAuthToken: string

    beforeAll(async () => {
      otherUserId = randomUUID()
      context.stores.userStore.create({
        userId: otherUserId,
        username: 'otheruser',
        passwordHash: await hashPassword('password'),
      })

      otherAuthToken = generateSessionToken()
      const tokenHash = hashToken(otherAuthToken)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      context.stores.authTokenStore.create({
        tokenHash,
        userId: otherUserId,
        expiresAt,
      })
    })

    it('rejects cross-user workflow access for draft', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Owner Draft',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/workflows/drafts/${draftId}`,
        headers: {
          cookie: `agent-platform-session=${otherAuthToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('rejects cross-user workflow access for definition', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Owner Definition',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const publishResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/publish`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const publishBody = JSON.parse(publishResponse.body)
      const workflowId = publishBody.data.workflowId

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/workflows/definitions/${workflowId}`,
        headers: {
          cookie: `agent-platform-session=${otherAuthToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('rejects cross-user workflow access for run', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Owner Run',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const publishResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/publish`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const publishBody = JSON.parse(publishResponse.body)
      const workflowId = publishBody.data.workflowId

      const runResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/runs',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          definitionId: workflowId,
        },
      })

      const runBody = JSON.parse(runResponse.body)
      const workflowRunId = runBody.data.workflowRunId

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/workflows/runs/${workflowRunId}`,
        headers: {
          cookie: `agent-platform-session=${otherAuthToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('rejects cross-user workflow access for update', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Owner Update Test',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/workflows/drafts/${draftId}`,
        headers: {
          cookie: `agent-platform-session=${otherAuthToken}`,
        },
        payload: {
          name: 'Hacked Name',
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('rejects cross-user workflow access for delete', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Owner Delete Test',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/workflows/drafts/${draftId}`,
        headers: {
          cookie: `agent-platform-session=${otherAuthToken}`,
        },
      })

      expect(response.statusCode).toBe(404)

      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/workflows/drafts/${draftId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(getResponse.statusCode).toBe(200)
    })

    it('rejects cross-user workflow access for validate', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Owner Validate Test',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/validate`,
        headers: {
          cookie: `agent-platform-session=${otherAuthToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('rejects cross-user workflow access for publish', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Owner Publish Test',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/publish`,
        headers: {
          cookie: `agent-platform-session=${otherAuthToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('rejects cross-user workflow access for start run', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/drafts',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Owner Start Run Test',
          steps: validSteps,
        },
      })

      const createBody = JSON.parse(createResponse.body)
      const draftId = createBody.data.draftId

      const publishResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/drafts/${draftId}/publish`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const publishBody = JSON.parse(publishResponse.body)
      const workflowId = publishBody.data.workflowId

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workflows/runs',
        headers: {
          cookie: `agent-platform-session=${otherAuthToken}`,
        },
        payload: {
          definitionId: workflowId,
        },
      })

      expect(response.statusCode).toBe(403)
    })
  })
})
