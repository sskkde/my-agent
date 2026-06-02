import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../../src/api/context.js';
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';
import type { Stores } from '../../../src/gateway/types.js';
import type { ForegroundKernelRunner } from '../../../src/foreground/foreground-kernel-runner.js';
import type { ForegroundTurnResult } from '../../../src/foreground/foreground-runner-types.js';

describe('Processor orchestration SearchSubagent branch', () => {
  let server: FastifyInstance;
  let context: ApiContext;
  let authToken: string;
  let userId: string;
  const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-testing-only-do-not-use-in-production';

  beforeAll(async () => {
    process.env.APP_SECRET_KEY = TEST_ENCRYPTION_KEY;

    const contextResult = createApiContext({ dbPath: ':memory:' });
    if ('code' in contextResult) {
      throw new Error(`Failed to create API context: ${contextResult.message}`);
    }
    context = contextResult;

    server = await createApiServer(context);

    userId = randomUUID();
    context.stores.userStore.create({
      userId,
      username: 'testuser',
      passwordHash: await hashPassword('testpassword'),
    });

    authToken = generateSessionToken();
    const tokenHash = hashToken(authToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    context.stores.authTokenStore.create({
      tokenHash,
      userId,
      expiresAt,
    });
  });

  afterAll(async () => {
    delete process.env.APP_SECRET_KEY;
    await server.close();
    context.connection.close();
  });

  describe('pure web_search SearchSubagent branch', () => {
    it('returns SearchSubagent answer via runner for foreground web search', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');

      const mockForegroundKernelRunner: ForegroundKernelRunner = {
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
            toolCallSummaries: [{
              toolCallId: `search-corr-search-001`,
              toolName: 'web_search',
              status: 'completed',
            }],
          },
        } as ForegroundTurnResult),
      };

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: { processMessage: vi.fn() } as any,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          agentConfigStore: context.agentConfigStore,
          foregroundKernelRunner: mockForegroundKernelRunner,
        },
      });

      const result = await processor({
        correlationId: 'corr-search-002',
        userId,
        sessionId: 'session-001',
        text: 'What is TypeScript?',
        timestamp: new Date().toISOString(),
        metadata: {},
      });

      expect(result.success).toBe(true);
      expect(result.result?.text).toBe('TypeScript is a strongly typed programming language that builds on JavaScript.');
      expect(result.result?.route).toBe('dispatch_tool');
      expect(mockForegroundKernelRunner.runTurn).toHaveBeenCalled();
    });

    it('includes runtimeSummary with search toolCallSummaries from runner', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });

      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');

      const mockForegroundKernelRunner: ForegroundKernelRunner = {
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
            toolCallSummaries: [{
              toolCallId: 'search-corr-search-001',
              toolName: 'web_search',
              status: 'completed',
            }],
          },
        } as ForegroundTurnResult),
      };

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: { processMessage: vi.fn() } as any,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          agentConfigStore: context.agentConfigStore,
          foregroundKernelRunner: mockForegroundKernelRunner,
        },
      });

      const result = await processor({
        correlationId: 'corr-search-001',
        userId,
        sessionId: 'session-001',
        text: 'Search for TypeScript tutorials',
        timestamp: new Date().toISOString(),
        metadata: {},
      });

      expect(result.success).toBe(true);
      expect(result.result?.text).toContain('answer');
      expect(result.result?.data?.runtimeSummary).toBeDefined();
      const summary = result.result?.data?.runtimeSummary as { toolCallSummaries: Array<{ toolName: string; status: string }> };
      expect(summary.toolCallSummaries[0].toolName).toBe('web_search');
      expect(summary.toolCallSummaries[0].status).toBe('completed');
    });
  });

  describe('non-search dispatch_tool routes via runner', () => {
    it('passes through non-search tool results from runner', async () => {
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');

      const mockForegroundKernelRunner: ForegroundKernelRunner = {
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
            toolCallSummaries: [{
              toolCallId: 'tc-memory-001',
              toolName: 'memory_retrieve',
              status: 'completed',
            }],
          },
        } as ForegroundTurnResult),
      };

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: { processMessage: vi.fn() } as any,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          foregroundKernelRunner: mockForegroundKernelRunner,
        },
      });

      const result = await processor({
        correlationId: 'corr-memory-001',
        userId,
        sessionId: 'session-001',
        text: 'What do you remember?',
        timestamp: new Date().toISOString(),
        metadata: {},
      });

      expect(result.success).toBe(true);
      expect(result.result?.text).toBe('Memory retrieved successfully.');
      expect(result.result?.route).toBe('dispatch_tool');
    });

    it('does not contain "Processing tool request..." in any response', async () => {
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');

      const mockForegroundKernelRunner: ForegroundKernelRunner = {
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
      };

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: { processMessage: vi.fn() } as any,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          foregroundKernelRunner: mockForegroundKernelRunner,
        },
      });

      const result = await processor({
        correlationId: 'corr-docs-001',
        userId,
        sessionId: 'session-001',
        text: 'Search the documentation',
        timestamp: new Date().toISOString(),
        metadata: {},
      });

      expect(result.success).toBe(true);
      expect(result.result?.text).not.toContain('Processing tool request...');
      expect(result.result?.text).not.toContain('Processing...');
    });
  });

  describe('error paths for runner', () => {
    it('returns error when runner reports failure', async () => {
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');

      const mockForegroundKernelRunner: ForegroundKernelRunner = {
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
      };

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: { processMessage: vi.fn() } as any,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          foregroundKernelRunner: mockForegroundKernelRunner,
        },
      });

      const result = await processor({
        correlationId: 'corr-fail-001',
        userId,
        sessionId: 'session-001',
        text: 'Search for something',
        timestamp: new Date().toISOString(),
        metadata: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PROCESSING_ERROR');
      expect(result.error?.message).toBe('Search model does not support function calling');
      expect(result.error?.details).toEqual({ foregroundErrorCode: 'SEARCH_MODEL_INCAPABLE' });
    });

    it('returns PROCESSING_ERROR when runner throws', async () => {
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');

      const mockForegroundKernelRunner: ForegroundKernelRunner = {
        runTurn: vi.fn().mockRejectedValue(new Error('Runner crashed')),
      };

      const processor = createOrchestrationProcessor({
        deps: {
          gateway: context.gateway,
          stores: context.stores as unknown as Stores,
          foregroundAgent: { processMessage: vi.fn() } as any,
          runtimeDispatcher: context.runtimeDispatcher,
          plannerRuntime: context.plannerRuntime,
          agentKernel: context.agentKernel,
          llmAdapter: context.llmAdapter,
          transcriptStore: context.stores.transcriptStore,
          foregroundKernelRunner: mockForegroundKernelRunner,
        },
      });

      const result = await processor({
        correlationId: 'corr-throw-001',
        userId,
        sessionId: 'session-001',
        text: 'Search for something',
        timestamp: new Date().toISOString(),
        metadata: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PROCESSING_ERROR');
      expect(result.error?.message).toBe('Runner crashed');
    });
  });
});
