import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'
import type { TurnTranscript } from '../../../src/storage/transcript-store.js'
import type { CreateSessionInput } from '../../../src/storage/session-store.js'

describe('Usage API', () => {
  let ctx: AuthenticatedTestContext
  let authCookie: string

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext()
    authCookie = ctx.authCookie
  }, 60000)

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx)
  })

  describe('GET /api/usage - Empty database', () => {
    it('should return 200 with empty items and total=0 when no sessions exist', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/usage',
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.items).toEqual([])
      expect(body.data.total).toBe(0)
      expect(body.data.limit).toBe(50)
      expect(body.data.offset).toBe(0)
    })

    it('should return 200 with zero counts for specific session with no transcripts', async () => {
      // Create a session first
      const sessionInput: CreateSessionInput = {
        sessionId: 'test-session-empty',
        userId: 'test-user',
        title: 'Test Session Empty',
      }
      ctx.apiContext.stores.sessionStore.create(sessionInput)

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/usage?sessionId=test-session-empty',
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.items).toHaveLength(1)
      expect(body.data.items[0].sessionId).toBe('test-session-empty')
      expect(body.data.items[0].messageCount).toBe(0)
      expect(body.data.items[0].turnCount).toBe(0)
      expect(body.data.items[0].toolCallCount).toBe(0)
      expect(body.data.items[0].approvalCount).toBe(0)
      expect(body.data.items[0].artifactCount).toBe(0)
      expect(body.data.items[0].runCount).toBe(0)
      expect(body.data.items[0].estimatedInputTokens).toBe(0)
      expect(body.data.items[0].estimatedOutputTokens).toBe(0)
      expect(body.data.items[0].estimatedTotalTokens).toBe(0)
      expect(body.data.items[0].estimatedCostCents).toBeNull()
    })
  })

  describe('GET /api/usage - With data', () => {
    const sessionWithData = 'test-session-data'
    const userId = 'test-user'

    beforeAll(() => {
      // Create session
      ctx.apiContext.stores.sessionStore.create({
        sessionId: sessionWithData,
        userId,
        title: 'Test Session With Data',
      })

      // Create transcript with messages, tool calls, approvals, and artifacts
      const turn: TurnTranscript = {
        turnId: 'turn-001',
        sessionId: sessionWithData,
        userId,
        input: {
          userMessageSummary: 'Hello, can you help me analyze this data?',
          contentRefs: ['file1.csv', 'file2.csv'],
        },
        output: {
          visibleMessages: [
            { messageId: 'msg-001', role: 'assistant', content: "I'd be happy to help you analyze your data!" },
            { messageId: 'msg-002', role: 'assistant', content: 'Let me start by examining the files you provided.' },
          ],
          artifactRefs: ['report-001', 'chart-001'],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-1', toolName: 'read_csv', status: 'completed' as const },
            { toolCallId: 'tc-2', toolName: 'analyze_data', status: 'completed' as const },
            { toolCallId: 'tc-3', toolName: 'generate_chart', status: 'completed' as const },
          ],
          approvalSummaries: ['Approval requested: Execute analysis on production data (MEDIUM RISK)'],
          plannerRunIds: ['run-001', 'run-002'],
        },
        visibility: 'public',
        createdAt: '2026-04-29T10:00:00.000Z',
      }
      ctx.apiContext.stores.transcriptStore.saveTurn(turn)
    })

    it('should return usage summary with correct counts', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/usage?sessionId=${sessionWithData}`,
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.items).toHaveLength(1)

      const summary = body.data.items[0]
      expect(summary.sessionId).toBe(sessionWithData)
      expect(summary.messageCount).toBe(2) // 2 visible messages
      expect(summary.turnCount).toBe(1)
      expect(summary.toolCallCount).toBe(3) // 3 tool calls
      expect(summary.approvalCount).toBe(1) // 1 approval
      expect(summary.artifactCount).toBe(2) // 2 artifacts
      expect(summary.runCount).toBe(2) // 2 planner runs
    })

    it('should return estimated token counts based on content length', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/usage?sessionId=${sessionWithData}`,
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      const summary = body.data.items[0]

      // Token estimates should be > 0 (based on content length / 4)
      expect(summary.estimatedInputTokens).toBeGreaterThan(0)
      expect(summary.estimatedOutputTokens).toBeGreaterThan(0)
      expect(summary.estimatedTotalTokens).toBe(summary.estimatedInputTokens + summary.estimatedOutputTokens)
    })

    it('should always have estimatedCostCents as null', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/usage?sessionId=${sessionWithData}`,
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.items[0].estimatedCostCents).toBeNull()
    })

    it('should include updatedAt timestamp', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/usage?sessionId=${sessionWithData}`,
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.items[0].updatedAt).toBeDefined()
      expect(new Date(body.data.items[0].updatedAt)).toBeInstanceOf(Date)
    })
  })

  describe('GET /api/usage - Pagination', () => {
    beforeAll(() => {
      // Create multiple sessions
      for (let i = 0; i < 5; i++) {
        ctx.apiContext.stores.sessionStore.create({
          sessionId: `pagination-session-${i}`,
          userId: 'test-user',
          title: `Session ${i}`,
        })
      }
    })

    it('should respect limit parameter', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/usage?limit=3',
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.items.length).toBeLessThanOrEqual(3)
      expect(body.data.limit).toBe(3)
    })

    it('should respect offset parameter', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/usage?limit=2&offset=2',
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.offset).toBe(2)
      expect(body.data.items.length).toBeLessThanOrEqual(2)
    })

    it('should enforce max limit of 200', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/usage?limit=500',
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.limit).toBe(200)
    })

    it('should handle offset beyond total gracefully', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/usage?offset=1000',
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.items).toEqual([])
    })
  })

  describe('GET /api/sessions/:sessionId/usage', () => {
    const sessionForEndpoint = 'test-session-endpoint'

    beforeAll(() => {
      ctx.apiContext.stores.sessionStore.create({
        sessionId: sessionForEndpoint,
        userId: 'test-user',
        title: 'Test Session Endpoint',
      })

      const turn: TurnTranscript = {
        turnId: 'turn-endpoint-001',
        sessionId: sessionForEndpoint,
        userId: 'test-user',
        input: {
          userMessageSummary: 'Test message for endpoint',
        },
        output: {
          visibleMessages: [{ messageId: 'msg-e001', role: 'assistant', content: 'Response from endpoint test' }],
        },
        visibility: 'public',
        createdAt: '2026-04-29T11:00:00.000Z',
      }
      ctx.apiContext.stores.transcriptStore.saveTurn(turn)
    })

    it('should return single usage summary for session', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${sessionForEndpoint}/usage`,
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.sessionId).toBe(sessionForEndpoint)
      expect(body.data.messageCount).toBe(1)
      expect(body.data.turnCount).toBe(1)
    })

    it('should return 404 for non-existent session', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/sessions/non-existent-session/usage',
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(404)
      const body = JSON.parse(response.body)
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('should return zero counts for session with no transcripts', async () => {
      // Create session without transcripts
      ctx.apiContext.stores.sessionStore.create({
        sessionId: 'empty-session',
        userId: 'test-user',
        title: 'Empty Session',
      })

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/sessions/empty-session/usage',
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.data.messageCount).toBe(0)
      expect(body.data.turnCount).toBe(0)
      expect(body.data.estimatedCostCents).toBeNull()
    })
  })

  describe('GET /api/usage - Multiple sessions', () => {
    it('should return usage for all sessions when no sessionId filter', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/usage',
        headers: {
          cookie: authCookie,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      // Should have multiple sessions from previous tests
      expect(body.data.total).toBeGreaterThan(0)
      expect(body.data.items.length).toBeGreaterThan(0)
    })
  })
})
