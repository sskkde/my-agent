import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../../src/api/context.js';
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';
import type { Stores } from '../../../src/gateway/types.js';
import type { SearchSubagentSuccessResult, SearchSubagentFailureResult } from '../../../src/search/search-subagent.js';

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

  describe('pure web.search SearchSubagent branch', () => {
    it('invokes SearchSubagent for pure web.search', async () => {
      // Setup AgentConfig with search LLM fields
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');
      
      const mockSearchSubagentExecute = vi.fn().mockResolvedValue({
        success: true,
        answer: 'Based on the search results, here is the answer.',
        toolResult: {
          query: 'test query',
          results: [{ title: 'A', url: 'https://a.com', snippet: 's' }],
          total: 1,
          provider: 'searxng',
          endpointHost: 'localhost:8888',
        },
        metadata: {
          providerId: 'provider-search',
          model: 'gpt-4.1-mini',
          querySource: 'search_subagent',
          durationMs: 150,
        },
      } as SearchSubagentSuccessResult);
      
      const mockSearchSubagent = {
        execute: mockSearchSubagentExecute,
      };
      
      
      const mockForegroundAgent = {
        processMessage: vi.fn().mockResolvedValue({
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Web search request',
          userVisibleResponse: 'Searching the web...',
          suggestedTools: ['web.search'],
        }),
      };
      
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
          searchSubagent: mockSearchSubagent,
          agentConfigStore: context.agentConfigStore,
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
      expect(mockSearchSubagentExecute).toHaveBeenCalled();
      expect(result.result?.text).toContain('answer');
    });

    it('returns SearchSubagent answer for foreground web search', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');
      
      const mockSearchSubagentExecute = vi.fn().mockResolvedValue({
        success: true,
        answer: 'TypeScript is a strongly typed programming language that builds on JavaScript.',
        toolResult: {
          query: 'What is TypeScript',
          results: [
            { title: 'TypeScript Official', url: 'https://www.typescriptlang.org/', snippet: 'TypeScript is JavaScript with syntax for types.' },
          ],
          total: 1,
          provider: 'searxng',
          endpointHost: 'localhost:8888',
        },
        metadata: {
          providerId: 'provider-search',
          model: 'gpt-4.1-mini',
          querySource: 'search_subagent',
          durationMs: 200,
        },
      } as SearchSubagentSuccessResult);
      
      const mockSearchSubagent = {
        execute: mockSearchSubagentExecute,
      };
      
      const mockForegroundAgent = {
        processMessage: vi.fn().mockResolvedValue({
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Web search request',
          userVisibleResponse: 'Searching the web...',
          suggestedTools: ['web.search'],
        }),
      };
      
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
          searchSubagent: mockSearchSubagent,
          agentConfigStore: context.agentConfigStore,
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
      expect(result.result?.data?.searchSubagentMetadata).toBeDefined();
      const metadata = result.result?.data?.searchSubagentMetadata as {
        providerId: string;
        model: string;
        querySource: string;
      };
      expect(metadata.providerId).toBe('provider-search');
      expect(metadata.model).toBe('gpt-4.1-mini');
      expect(metadata.querySource).toBe('search_subagent');
    });

    it('does not invoke SearchSubagent for mixed tool suggestions', async () => {
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');
      
      const mockSearchSubagentExecute = vi.fn();
      
      const mockSearchSubagent = {
        execute: mockSearchSubagentExecute,
      };
      
      
      const mockForegroundAgent = {
        processMessage: vi.fn().mockResolvedValue({
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Mixed tool request',
          userVisibleResponse: 'Processing...',
          suggestedTools: ['web.search', 'docs.search'],
        }),
      };
      
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
          searchSubagent: mockSearchSubagent,
          agentConfigStore: context.agentConfigStore,
        },
      });
      
      const result = await processor({
        correlationId: 'corr-mixed-001',
        userId,
        sessionId: 'session-001',
        text: 'Search web and docs',
        timestamp: new Date().toISOString(),
        metadata: {},
      });
      
      expect(result.success).toBe(true);
      expect(mockSearchSubagentExecute).not.toHaveBeenCalled();
      expect(result.result?.data?.suggestedTools).toEqual(['web.search', 'docs.search']);
    });

    it('does not invoke SearchSubagent for non-search tools', async () => {
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');
      
      const mockSearchSubagentExecute = vi.fn();
      
      const mockSearchSubagent = {
        execute: mockSearchSubagentExecute,
      };
      
      const mockForegroundAgent = {
        processMessage: vi.fn().mockResolvedValue({
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Memory retrieval',
          userVisibleResponse: 'Retrieving memory...',
          suggestedTools: ['memory.retrieve'],
        }),
      };
      
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
          searchSubagent: mockSearchSubagent,
          agentConfigStore: context.agentConfigStore,
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
      expect(mockSearchSubagentExecute).not.toHaveBeenCalled();
    });
  });

  describe('keeps non-search dispatch_tool behavior unchanged', () => {
    it('does not invoke SearchSubagent for docs.search', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');
      
      const mockSearchSubagentExecute = vi.fn();
      
      const mockSearchSubagent = {
        execute: mockSearchSubagentExecute,
      };
      
      const mockForegroundAgent = {
        processMessage: vi.fn().mockResolvedValue({
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Docs search request',
          userVisibleResponse: 'Searching docs...',
          suggestedTools: ['docs.search'],
        }),
      };
      
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
          searchSubagent: mockSearchSubagent,
          agentConfigStore: context.agentConfigStore,
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
      expect(mockSearchSubagentExecute).not.toHaveBeenCalled();
      expect(result.result?.data?.suggestedTools).toEqual(['docs.search']);
    });

    it('does not invoke SearchSubagent for web.fetch', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');
      
      const mockSearchSubagentExecute = vi.fn();
      
      const mockSearchSubagent = {
        execute: mockSearchSubagentExecute,
      };
      
      const mockForegroundAgent = {
        processMessage: vi.fn().mockResolvedValue({
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Web fetch request',
          userVisibleResponse: 'Fetching web content...',
          suggestedTools: ['web.fetch'],
        }),
      };
      
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
          searchSubagent: mockSearchSubagent,
          agentConfigStore: context.agentConfigStore,
        },
      });
      
      const result = await processor({
        correlationId: 'corr-fetch-001',
        userId,
        sessionId: 'session-001',
        text: 'Fetch https://example.com',
        timestamp: new Date().toISOString(),
        metadata: {},
      });
      
      expect(result.success).toBe(true);
      expect(mockSearchSubagentExecute).not.toHaveBeenCalled();
      expect(result.result?.data?.suggestedTools).toEqual(['web.fetch']);
    });

    it('does not invoke SearchSubagent for mixed web.search and docs.search', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');
      
      const mockSearchSubagentExecute = vi.fn();
      
      const mockSearchSubagent = {
        execute: mockSearchSubagentExecute,
      };
      
      const mockForegroundAgent = {
        processMessage: vi.fn().mockResolvedValue({
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Mixed search request',
          userVisibleResponse: 'Searching both web and docs...',
          suggestedTools: ['web.search', 'docs.search'],
        }),
      };
      
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
          searchSubagent: mockSearchSubagent,
          agentConfigStore: context.agentConfigStore,
        },
      });
      
      const result = await processor({
        correlationId: 'corr-mixed-002',
        userId,
        sessionId: 'session-001',
        text: 'Search web and docs for TypeScript',
        timestamp: new Date().toISOString(),
        metadata: {},
      });
      
      expect(result.success).toBe(true);
      expect(mockSearchSubagentExecute).not.toHaveBeenCalled();
      expect(result.result?.data?.suggestedTools).toEqual(['web.search', 'docs.search']);
    });

    it('does not invoke SearchSubagent for mixed web.search and web.fetch', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');
      
      const mockSearchSubagentExecute = vi.fn();
      
      const mockSearchSubagent = {
        execute: mockSearchSubagentExecute,
      };
      
      const mockForegroundAgent = {
        processMessage: vi.fn().mockResolvedValue({
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Mixed web tools request',
          userVisibleResponse: 'Processing...',
          suggestedTools: ['web.search', 'web.fetch'],
        }),
      };
      
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
          searchSubagent: mockSearchSubagent,
          agentConfigStore: context.agentConfigStore,
        },
      });
      
      const result = await processor({
        correlationId: 'corr-mixed-web-001',
        userId,
        sessionId: 'session-001',
        text: 'Search and fetch',
        timestamp: new Date().toISOString(),
        metadata: {},
      });
      
      expect(result.success).toBe(true);
      expect(mockSearchSubagentExecute).not.toHaveBeenCalled();
      expect(result.result?.data?.suggestedTools).toEqual(['web.search', 'web.fetch']);
    });
  });

  describe('error paths for SearchSubagent', () => {
    it('falls through when search LLM is not configured', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: null,
        searchLlmModel: null,
      });
      
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');
      
      const mockSearchSubagentExecute = vi.fn();
      
      const mockSearchSubagent = {
        execute: mockSearchSubagentExecute,
      };
      
      const mockForegroundAgent = {
        processMessage: vi.fn().mockResolvedValue({
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Web search request',
          userVisibleResponse: 'Searching the web...',
          suggestedTools: ['web.search'],
        }),
      };
      
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
          searchSubagent: mockSearchSubagent,
          agentConfigStore: context.agentConfigStore,
        },
      });
      
      const result = await processor({
        correlationId: 'corr-no-config-001',
        userId,
        sessionId: 'session-001',
        text: 'Search for something',
        timestamp: new Date().toISOString(),
        metadata: {},
      });
      
      expect(result.success).toBe(true);
      expect(mockSearchSubagentExecute).not.toHaveBeenCalled();
    });

    it('falls through when SearchSubagent fails', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');
      
      const mockSearchSubagentExecute = vi.fn().mockResolvedValue({
        success: false,
        errorCode: 'SEARCH_MODEL_INCAPABLE',
        message: 'Search model does not support function calling',
      } as SearchSubagentFailureResult);
      
      const mockSearchSubagent = {
        execute: mockSearchSubagentExecute,
      };
      
      const mockForegroundAgent = {
        processMessage: vi.fn().mockResolvedValue({
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Web search request',
          userVisibleResponse: 'Searching the web...',
          suggestedTools: ['web.search'],
        }),
      };
      
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
          searchSubagent: mockSearchSubagent,
          agentConfigStore: context.agentConfigStore,
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
      
      expect(result.success).toBe(true);
      expect(mockSearchSubagentExecute).toHaveBeenCalled();
      expect(result.result?.data?.suggestedTools).toEqual(['web.search']);
    });

    it('falls through when SearchSubagent throws an error', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const { createOrchestrationProcessor } = await import('../../../src/processing/processor-orchestration.js');
      
      const mockSearchSubagentExecute = vi.fn().mockRejectedValue(new Error('SearchSubagent crashed'));
      
      const mockSearchSubagent = {
        execute: mockSearchSubagentExecute,
      };
      
      const mockForegroundAgent = {
        processMessage: vi.fn().mockResolvedValue({
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Web search request',
          userVisibleResponse: 'Searching the web...',
          suggestedTools: ['web.search'],
        }),
      };
      
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
          searchSubagent: mockSearchSubagent,
          agentConfigStore: context.agentConfigStore,
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
      
      expect(result.success).toBe(true);
      expect(mockSearchSubagentExecute).toHaveBeenCalled();
      expect(result.result?.data?.suggestedTools).toEqual(['web.search']);
    });
  });
});
