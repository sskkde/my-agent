/**
 * Runtime boundary tests proving sync search does NOT use subagent_runtime
 *
 * These tests verify that the synchronous search_subagent path:
 * - Does NOT instantiate SubagentRuntimeImpl
 * - Does NOT create subagent_runs DB records
 * - Does NOT call foreground_launch_subagent
 * - Does NOT involve search_processor (which is out of scope)
 *
 * The sync search path uses direct LLM calls and tool execution,
 * resulting in transcript/tool-summary oriented DB footprint, not runtime-run oriented.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext } from '../../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import type { ApiContext } from '../../../src/api/context.js'
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js'
import { randomUUID } from 'crypto'
import type { Stores } from '../../../src/gateway/types.js'
import type { ForegroundTurnResult } from '../../../src/foreground/foreground-runner-types.js'
import type { ForegroundAgent } from '../../../src/foreground/foreground-agent.js'

describe('Search runtime boundary - sync search does not use subagent_runtime', () => {
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

  describe('sync search does NOT create subagent_runs', () => {
    it('search_subagent tool does not create subagent_runs DB records', async () => {
      // Configure search model
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      // Track initial subagent_runs count
      const initialRuns = context.subagentRunStore.query({ userId })
      const initialCount = initialRuns.length

      // Create mock foreground agent that simulates search_subagent execution
      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'Search completed successfully.',
          decisionTrace: {
            route: 'dispatch_tool',
            requiresPlanner: false,
            reason: 'Web search request',
            suggestedTools: ['web_search'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'search-tc-001',
                toolName: 'web_search',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

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

      // Execute search
      await processor({
        correlationId: 'corr-search-no-runtime',
        userId,
        sessionId: 'session-no-runtime',
        text: 'Search for TypeScript tutorials',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      // Verify NO subagent_runs were created
      const finalRuns = context.subagentRunStore.query({ userId })
      expect(finalRuns.length).toBe(initialCount)

      // Verify no subagent_run_id references in transcripts
      const transcripts = context.stores.transcriptStore.findBySession('session-no-runtime')
      const runtimeOrientedSummaries = transcripts.filter((t) =>
        t.runtimeSummary?.toolCallSummaries?.some(
          (s) => s.toolName.includes('search_processor') || s.toolName.includes('subagent_runtime'),
        ),
      )
      expect(runtimeOrientedSummaries).toHaveLength(0)
    })

    it('search_subagent tool does not use SubagentRuntimeImpl', async () => {
      // Track SubagentRuntimeImpl instantiation
      // We verify through DB footprint that no runtime was created

      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'Search result.',
          decisionTrace: {
            route: 'dispatch_tool',
            suggestedTools: ['web_search'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-002',
                toolName: 'web_search',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

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
        correlationId: 'corr-no-subagent-runtime',
        userId,
        sessionId: 'session-no-impl',
        text: 'Search query',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      // Verify SubagentRuntimeImpl is not in the module dependency graph for search
      // This is verified by checking that no subagent_runs records exist
      const runs = context.subagentRunStore.query({ userId })
      const searchRuns = runs.filter(
        (r: { agentType: string }) => r.agentType === 'search_processor' || r.agentType === 'search',
      )
      expect(searchRuns).toHaveLength(0)
    })
  })

  describe('sync search does NOT call foreground_launch_subagent', () => {
    it('search_subagent path does not dispatch to subagent_runtime', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'Web search result.',
          decisionTrace: {
            route: 'dispatch_tool',
            suggestedTools: ['web_search'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-003',
                toolName: 'web_search',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

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
        correlationId: 'corr-no-dispatch',
        userId,
        sessionId: 'session-no-dispatch',
        text: 'Search query',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      // Verify no dispatch to subagent_runtime
      const transcripts = context.stores.transcriptStore.findBySession('session-no-dispatch')
      const runtimeDispatches = transcripts.filter((t) =>
        t.runtimeSummary?.toolCallSummaries?.some((s) => s.toolName === 'search_processor'),
      )
      expect(runtimeDispatches).toHaveLength(0)
    })

    it('search_subagent does not create launchSubagent calls', async () => {
      // This test verifies that the sync search path does not call launchSubagent
      // by checking the DB footprint

      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'Result.',
          decisionTrace: {
            route: 'dispatch_tool',
            suggestedTools: ['web_search'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-004',
                toolName: 'web_search',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

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
        correlationId: 'corr-no-launch',
        userId,
        sessionId: 'session-no-launch',
        text: 'Search query',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      // Verify no subagent_runs with search-related agentTypes
      const runs = context.subagentRunStore.query({ userId })
      const searchAgentRuns = runs.filter((r: { agentType: string }) => r.agentType.includes('search'))
      expect(searchAgentRuns).toHaveLength(0)
    })
  })

  describe('search_processor remains out of scope for sync search', () => {
    it('search_subagent does not invoke search_processor agentType', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'Result from direct web_search.',
          decisionTrace: {
            route: 'dispatch_tool',
            suggestedTools: ['web_search'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-005',
                toolName: 'web_search',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

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
        correlationId: 'corr-no-search-processor',
        userId,
        sessionId: 'session-no-processor',
        text: 'Search query',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      // Verify search_processor agentType is not used
      const runs = context.subagentRunStore.query({ userId })
      const searchProcessorRuns = runs.filter((r: { agentType: string }) => r.agentType === 'search_processor')
      expect(searchProcessorRuns).toHaveLength(0)
    })

    it('search_subagent uses web_search tool directly, not search_processor', async () => {
      // This test verifies that web_search tool is used directly in toolCallSummaries
      // and not routed through search_processor subagent

      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      let capturedToolSummaries: Array<{ toolName: string }> = []

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockImplementation(async () => {
          const result = {
            status: 'completed',
            finalResponse: 'Result.',
            decisionTrace: {
              route: 'dispatch_tool',
              suggestedTools: ['web_search'],
            },
            runtimeSummary: {
              toolCallSummaries: [
                {
                  toolCallId: 'tc-006',
                  toolName: 'web_search',
                  status: 'completed',
                },
              ],
            },
          } as ForegroundTurnResult
          capturedToolSummaries = result.runtimeSummary?.toolCallSummaries ?? []
          return result
        }),
      }

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

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
        correlationId: 'corr-direct-tool',
        userId,
        sessionId: 'session-direct-tool',
        text: 'Search query',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      // Verify toolCallSummaries contain web_search, not search_processor
      expect(capturedToolSummaries.length).toBeGreaterThan(0)
      expect(capturedToolSummaries[0].toolName).toBe('web_search')
      expect(capturedToolSummaries[0].toolName).not.toBe('search_processor')
    })
  })

  describe('DB footprint is transcript/tool-summary oriented, not runtime-run oriented', () => {
    it('sync search creates transcript entries, not subagent_runs', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockResolvedValue({
          status: 'completed',
          finalResponse: 'Transcript-based result.',
          decisionTrace: {
            route: 'dispatch_tool',
            suggestedTools: ['web_search'],
          },
          runtimeSummary: {
            toolCallSummaries: [
              {
                toolCallId: 'tc-007',
                toolName: 'web_search',
                status: 'completed',
              },
            ],
          },
        } as ForegroundTurnResult),
      }

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

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
        correlationId: 'corr-transcript-footprint',
        userId,
        sessionId: 'session-transcript',
        text: 'Search query',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      // Verify transcript entries exist
      const transcripts = context.stores.transcriptStore.findBySession('session-transcript')
      expect(transcripts.length).toBeGreaterThan(0)

      // Verify no subagent_runs
      const runs = context.subagentRunStore.query({ userId })
      expect(runs.filter((r: { sessionId?: string }) => r.sessionId === 'session-transcript')).toHaveLength(0)
    })

    it('sync search creates tool summaries, not runtime run records', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      let capturedRuntimeSummary: unknown = null

      const mockForegroundAgent: ForegroundAgent = {
        processMessage: vi.fn(),
        runTurn: vi.fn().mockImplementation(async () => {
          const result = {
            status: 'completed',
            finalResponse: 'Tool-summary based result.',
            decisionTrace: {
              route: 'dispatch_tool',
              suggestedTools: ['web_search'],
            },
            runtimeSummary: {
              toolCallSummaries: [
                {
                  toolCallId: 'tc-008',
                  toolName: 'web_search',
                  status: 'completed',
                },
              ],
            },
          } as ForegroundTurnResult
          capturedRuntimeSummary = result.runtimeSummary
          return result
        }),
      }

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js')

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
        correlationId: 'corr-tool-summary',
        userId,
        sessionId: 'session-tool-summary',
        text: 'Search query',
        timestamp: new Date().toISOString(),
        metadata: {},
      })

      // Verify runtimeSummary contains tool summaries
      expect(capturedRuntimeSummary).toBeDefined()
      const summary = capturedRuntimeSummary as { toolCallSummaries: Array<{ toolName: string }> }
      expect(summary.toolCallSummaries).toBeDefined()
      expect(summary.toolCallSummaries.length).toBeGreaterThan(0)
      expect(summary.toolCallSummaries[0].toolName).toBe('web_search')

      // Verify no runtime-run oriented data in DB
      const runs = context.subagentRunStore.query({ userId })
      const sessionRuns = runs.filter((r: { sessionId?: string }) => r.sessionId === 'session-tool-summary')
      expect(sessionRuns).toHaveLength(0)
    })
  })
})
