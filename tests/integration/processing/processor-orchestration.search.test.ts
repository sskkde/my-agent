import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext } from '../../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import type { ApiContext } from '../../../src/api/context.js'
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js'
import { randomUUID } from 'crypto'
import type { Stores } from '../../../src/gateway/types.js'
import type { ForegroundTurnResult } from '../../../src/foreground/foreground-runner-types.js'
import type { ForegroundAgent } from '../../../src/foreground/foreground-agent.js'

describe('Processor orchestration SearchSubagent branch', () => {
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

  describe('pure web_search SearchSubagent branch', () => {
    it('returns SearchSubagent answer via runner for foreground web search', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'TypeScript is a strongly typed programming language that builds on JavaScript.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Web search request',
            suggestedTools: ['web_search'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: `search-corr-search-001`,
                toolName: 'web_search',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          agentConfigStore: context.agentConfigStore,
        },
      })

      const result = await processor({
        correlationId: 'corr-search-002',
        userId,
        sessionId: 'session-001',
        text: 'What is TypeScript?',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      expect(result.success).toBe(true)
      expect(result.result?.text).toBe('TypeScript is a strongly typed programming language that builds on JavaScript.')
      expect(result.result?.route).toBe('dispatch_tool')
      expect(mockForegroundAgent.runTurn).toHaveBeenCalled()
    })

    it('includes runtimeSummary with search toolCallSummaries from runner', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'Based on the search results, here is the answer.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Web search request',
            suggestedTools: ['web_search'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'search-corr-search-001',
                toolName: 'web_search',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          agentConfigStore: context.agentConfigStore,
        },
      })

      const result = await processor({
        correlationId: 'corr-search-001',
        userId,
        sessionId: 'session-001',
        text: 'Search for TypeScript tutorials',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      expect(result.success).toBe(true)
      expect(result.result?.text).toContain('answer')
      expect(result.result?.data?.runtimeSummary).toBeDefined()
      const summary = result.result?.data?.runtimeSummary as {
        toolCallSummaries: Array<{ toolName: string; status: string }>
      }
      expect(summary.toolCallSummaries[0].toolName).toBe('web_search')
      expect(summary.toolCallSummaries[0].status).toBe('completed')
    })
  })

  describe('non-search dispatch_tool routes via runner', () => {
    it('passes through non-search tool results from runner', async () => {
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'Memory retrieved successfully.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Memory retrieval',
            suggestedTools: ['memory_retrieve'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-memory-001',
                toolName: 'memory_retrieve',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
        },
      })

      const result = await processor({
        correlationId: 'corr-memory-001',
        userId,
        sessionId: 'session-001',
        text: 'What do you remember?',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      expect(result.success).toBe(true)
      expect(result.result?.text).toBe('Memory retrieved successfully.')
      expect(result.result?.route).toBe('dispatch_tool')
    })

    it('does not contain "Processing tool request..." in any response', async () => {
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'The documentation shows that TypeScript interfaces can be extended.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Docs search request',
            suggestedTools: ['docs_search'],
          },
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
        },
      })

      const result = await processor({
        correlationId: 'corr-docs-001',
        userId,
        sessionId: 'session-001',
        text: 'Search the documentation',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      expect(result.success).toBe(true)
      expect(result.result?.text).not.toContain('Processing tool request...')
      expect(result.result?.text).not.toContain('Processing...')
    })
  })

  describe('error paths for runner', () => {
    it('returns error when runner reports failure', async () => {
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'failed',
          finalResponse: 'Search failed.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Web search request',
            suggestedTools: ['web_search'],
          },
          error: {
            code: 'SEARCH_MODEL_INCAPABLE',
            message: 'Search model does not support function calling',
          },
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
        },
      })

      const result = await processor({
        correlationId: 'corr-fail-001',
        userId,
        sessionId: 'session-001',
        text: 'Search for something',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PROCESSING_ERROR')
      expect(result.error?.message).toBe('Search model does not support function calling')
      expect(result.error?.details).toEqual({ foregroundErrorCode: 'SEARCH_MODEL_INCAPABLE' })
    })

    it('returns PROCESSING_ERROR when runner throws', async () => {
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockRejectedValue(new Error('Runner crashed')),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
        },
      })

      const result = await processor({
        correlationId: 'corr-throw-001',
        userId,
        sessionId: 'session-001',
        text: 'Search for something',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PROCESSING_ERROR')
      expect(result.error?.message).toBe('Runner crashed')
    })
  })

  describe('sync search trace and persistence assertions', () => {
    it('tool summaries identify search_subagent for sync search', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'Based on search results, TypeScript is a typed superset of JavaScript.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Web search request',
            suggestedTools: ['search_subagent'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-search-subagent-001',
                toolName: 'search_subagent',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          agentConfigStore: context.agentConfigStore,
        },
      })

      const result = await processor({
        correlationId: 'corr-search-subagent-001',
        userId,
        sessionId: 'session-search-subagent',
        text: 'What is TypeScript?',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      expect(result.success).toBe(true)
      expect(result.result?.data?.runtimeSummary).toBeDefined()

      const summary = result.result?.data?.runtimeSummary as {
        toolCallSummaries?: Array<{ toolCallId: string; toolName: string; status: string }>
      }

      expect(summary?.toolCallSummaries).toBeDefined()
      expect(summary?.toolCallSummaries?.length).toBeGreaterThan(0)
      expect(summary?.toolCallSummaries?.[0]?.toolName).toBe('search_subagent')
      expect(summary?.toolCallSummaries?.[0]?.toolCallId).toBe('tc-search-subagent-001')
      expect(summary?.toolCallSummaries?.[0]?.status).toBe('completed')
    })

    it('sync search does not create subagent_runs records', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const initialRuns = context.subagentRunStore.query({ userId })
      const initialCount = initialRuns.length

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'Search completed.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Web search request',
            suggestedTools: ['search_subagent'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-sync-search-001',
                toolName: 'search_subagent',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          agentConfigStore: context.agentConfigStore,
        },
      })

      await processor({
        correlationId: 'corr-sync-no-runs',
        userId,
        sessionId: 'session-sync-no-runs',
        text: 'Search for something',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      const finalRuns = context.subagentRunStore.query({ userId })
      expect(finalRuns.length).toBe(initialCount)

      const sessionRuns = finalRuns.filter((r: { sessionId?: string }) => r.sessionId === 'session-sync-no-runs')
      expect(sessionRuns).toHaveLength(0)
    })

    it('sync search creates transcript with tool summaries, not subagent_runs', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'Result from sync search.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Web search request',
            suggestedTools: ['search_subagent'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-transcript-001',
                toolName: 'search_subagent',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          agentConfigStore: context.agentConfigStore,
        },
      })

      await processor({
        correlationId: 'corr-transcript-check',
        userId,
        sessionId: 'session-transcript-check',
        text: 'Search query',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      const transcripts = context.stores.transcriptStore.findBySession('session-transcript-check')
      expect(transcripts.length).toBeGreaterThan(0)

      const transcriptWithToolSummaries = transcripts.find(t =>
        t.runtimeSummary?.toolCallSummaries?.some(s => s.toolName === 'search_subagent')
      )
      expect(transcriptWithToolSummaries).toBeDefined()

      const runs = context.subagentRunStore.query({ userId })
      const sessionRuns = runs.filter((r: { sessionId?: string }) => r.sessionId === 'session-transcript-check')
      expect(sessionRuns).toHaveLength(0)
    })

    it('sync search path does not create subagent_runs for search_processor', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'Search result.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Web search request',
            suggestedTools: ['search_subagent'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-search',
                toolName: 'search_subagent',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          agentConfigStore: context.agentConfigStore,
        },
      })

      await processor({
        correlationId: 'corr-no-subagent-run',
        userId,
        sessionId: 'session-no-subagent-run',
        text: 'Search query',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      const runs = context.subagentRunStore.query({ userId })
      const searchRuns = runs.filter((r: { sessionId?: string }) =>
        r.sessionId === 'session-no-subagent-run'
      )

      expect(searchRuns).toHaveLength(0)
    })
  })

  describe('search_subagent failure and empty-result paths', () => {
    it('returns safe response for empty search results without hallucinating fake results', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      // Mock ForegroundAgent to simulate empty results scenario
      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'I searched for your query but found no relevant results. You may want to try different keywords or broaden your search.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Web search request',
            suggestedTools: ['search_subagent'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-empty-search-001',
                toolName: 'search_subagent',
                status: 'completed',
                summary: 'Search returned 0 results',
              },
            ],
          },
          toolCallSummaries: [
            {
              toolCallId: 'tc-empty-search-001',
              toolName: 'search_subagent',
              status: 'completed',
              summary: 'Search returned 0 results',
            },
          ],
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          agentConfigStore: context.agentConfigStore,
        },
      })

      const result = await processor({
        correlationId: 'corr-empty-results',
        userId,
        sessionId: 'session-empty-results',
        text: 'Search for something very obscure',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      // Assert: Success with safe response
      expect(result.success).toBe(true)
      expect(result.result?.text).toContain('no relevant results')
      
      // Assert: Response does NOT contain fake/hallucinated results
      expect(result.result?.text).not.toContain('according to the results')
      expect(result.result?.text).not.toContain('the search found')
      expect(result.result?.text).not.toContain('sources indicate')
      
      // Assert: Tool summary shows completed status (not failed)
      expect(result.result?.data?.runtimeSummary).toBeDefined()
      const summary = result.result?.data?.runtimeSummary as {
        toolCallSummaries: Array<{ toolName: string; status: string }>
      }
      expect(summary.toolCallSummaries[0].toolName).toBe('search_subagent')
      expect(summary.toolCallSummaries[0].status).toBe('completed')
      
      // Assert: No uncaught exception
      expect(result.error).toBeUndefined()
    })

    it('returns structured error when search_subagent fails without throwing exception', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      // Mock ForegroundAgent to simulate search failure (not exception)
      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'failed',
          finalResponse: 'Search failed due to model unavailability.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Web search request',
            suggestedTools: ['search_subagent'],
          },
          error: {
            code: 'MODEL_UNAVAILABLE',
            message: 'Search model is unavailable',
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-failed-search-001',
                toolName: 'search_subagent',
                status: 'failed',
                summary: 'Search failed: MODEL_UNAVAILABLE',
              },
            ],
          },
          toolCallSummaries: [
            {
              toolCallId: 'tc-failed-search-001',
              toolName: 'search_subagent',
              status: 'failed',
              summary: 'Search failed: MODEL_UNAVAILABLE',
            },
          ],
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          agentConfigStore: context.agentConfigStore,
        },
      })

      const result = await processor({
        correlationId: 'corr-search-failure',
        userId,
        sessionId: 'session-search-failure',
        text: 'Search for something',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      // Assert: Failure with structured error (not exception)
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PROCESSING_ERROR')
      expect(result.error?.message).toContain('unavailable')
      
      // Assert: Error details contain foreground error code
      expect(result.error?.details).toBeDefined()
      expect(result.error?.details?.foregroundErrorCode).toBe('MODEL_UNAVAILABLE')
      
      // Assert: No uncaught exception escaped
      expect(result.error?.message).not.toContain('TypeError')
      expect(result.error?.message).not.toContain('Cannot read')
      expect(result.error?.message).not.toContain('undefined')
    })

    it('foreground response does not hallucinate fake sources for empty results', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'I apologize, but I could not find any information about that topic. The search returned empty results.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Web search request',
            suggestedTools: ['search_subagent'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-no-sources',
                toolName: 'search_subagent',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          agentConfigStore: context.agentConfigStore,
        },
      })

      const result = await processor({
        correlationId: 'corr-no-sources',
        userId,
        sessionId: 'session-no-sources',
        text: 'Search for xyznonexistent123',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      expect(result.success).toBe(true)
      
      // Assert: Response explicitly mentions no results found
      expect(result.result?.text).toBeDefined()
      expect(result.result?.text?.toLowerCase()).toMatch(/could not find|no.*results|empty results/)
      
      // Assert: Response does NOT invent fake URLs or sources
      expect(result.result?.text).not.toMatch(/https?:\/\//)
      expect(result.result?.text).not.toMatch(/according to|source:|cited from/i)
      expect(result.result?.text).not.toContain('wikipedia.org')
      expect(result.result?.text).not.toContain('example.com')
    })

    it('search failure error is recoverable and does not crash kernel', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

      // Simulate SEARCH_MODEL_INCAPABLE error
      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'failed',
          finalResponse: 'Search failed because the model does not support function calling.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Web search request',
            suggestedTools: ['search_subagent'],
          },
          error: {
            code: 'SEARCH_MODEL_INCAPABLE',
            message: 'Search model does not support function calling',
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-incapable',
                toolName: 'search_subagent',
                status: 'failed',
                summary: 'Model incapable of function calling',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: mockForegroundAgent,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          agentConfigStore: context.agentConfigStore,
        },
      })

      const result = await processor({
        correlationId: 'corr-incapable',
        userId,
        sessionId: 'session-incapable',
        text: 'Search request',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      // Assert: Structured error returned (no uncaught exception)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('PROCESSING_ERROR')
      expect(result.error?.details?.foregroundErrorCode).toBe('SEARCH_MODEL_INCAPABLE')
      
      // Assert: Error is informative and recoverable
      expect(result.error?.message).not.toContain('uncaught')
      expect(result.error?.message).not.toContain('UnhandledPromiseRejection')
      
      // Assert: Tool summary shows failure status
      expect(result.result).toBeUndefined()
    })
  })
})
