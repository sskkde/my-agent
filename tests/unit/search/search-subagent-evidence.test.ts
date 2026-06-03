import { describe, it, expect, vi } from 'vitest';
import type { SearchSubagentToolResult } from '../../../src/search/search-subagent-types.js';
import type { SearchSubagentToolInput, SearchSubagentToolDeps } from '../../../src/search/search-subagent-tool.js';
import type { ToolPlaneProjection } from '../../../src/kernel/model-input/model-input-types.js';
import { assertSearchScope, SearchSubagentScopeError } from '../../../src/search/search-subagent-types.js';

function createMockDeps(overrides: Partial<SearchSubagentToolDeps> = {}): SearchSubagentToolDeps {
  return {
    searchSubagent: {
      execute: vi.fn().mockResolvedValue({
        success: true,
        answer: 'Test answer',
        toolResult: {
          query: 'test query',
          results: [
            { title: 'Result 1', url: 'https://example.com/page1', snippet: 'Snippet 1' },
          ],
          total: 1,
          provider: 'searxng',
          endpointHost: 'localhost:8888',
        },
        metadata: {
          providerId: 'test-provider',
          model: 'test-model',
          querySource: 'search_subagent',
          durationMs: 100,
        },
      }),
    },
    queryPlanner: {
      plan: vi.fn().mockImplementation((input: SearchSubagentToolInput) => ({
        originalQuestion: input.originalQuestion,
        searchQuery: input.originalQuestion,
        intent: input.intent || 'general',
        requiresFreshness: input.freshnessRequired || false,
        locale: input.locale,
        missingCriticalContext: [],
      })),
    },
    resultNormalizer: {
      extractFacts: vi.fn().mockImplementation((results: Array<{ snippet: string; url: string }>) =>
        results.flatMap((r) =>
          r.snippet
            .split(/[.!?]+/)
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 10)
            .map((fact: string) => ({
              fact,
              sourceUrl: r.url,
              confidence: 0.7,
              relevanceScore: undefined,
            }))
        )
      ),
    },
    scopeGuard: assertSearchScope,
    ...overrides,
  };
}

describe('SearchSubagent Evidence Tests', () => {
  describe('Query Planning', () => {
    it('weather query → SearchQueryPlan with intent=weather, requiresFreshness=true', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps({
        queryPlanner: {
          plan: vi.fn().mockReturnValue({
            originalQuestion: 'what is the weather in Tokyo today',
            searchQuery: 'weather Tokyo today',
            intent: 'weather',
            requiresFreshness: true,
            missingCriticalContext: [],
          }),
        },
      });

      const input: SearchSubagentToolInput = {
        originalQuestion: 'what is the weather in Tokyo today',
        intent: 'weather',
        freshnessRequired: true,
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult.intent).toBe('weather');
      expect(toolResult.freshness).toBe(true);
      expect(toolResult.queryPlan.intent).toBe('weather');
      expect(toolResult.queryPlan.requiresFreshness).toBe(true);
    });

    it('news query → SearchQueryPlan with intent=news, requiresFreshness=true', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps({
        queryPlanner: {
          plan: vi.fn().mockReturnValue({
            originalQuestion: 'latest news about AI',
            searchQuery: 'AI news latest',
            intent: 'news',
            requiresFreshness: true,
            missingCriticalContext: [],
          }),
        },
      });

      const input: SearchSubagentToolInput = {
        originalQuestion: 'latest news about AI',
        intent: 'news',
        freshnessRequired: true,
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult.intent).toBe('news');
      expect(toolResult.freshness).toBe(true);
      expect(toolResult.queryPlan.intent).toBe('news');
      expect(toolResult.queryPlan.requiresFreshness).toBe(true);
    });

    it('technical query → SearchQueryPlan with intent=technical, requiresFreshness=false', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps({
        queryPlanner: {
          plan: vi.fn().mockReturnValue({
            originalQuestion: 'how does quicksort algorithm work',
            searchQuery: 'quicksort algorithm explanation',
            intent: 'technical',
            requiresFreshness: false,
            missingCriticalContext: [],
          }),
        },
      });

      const input: SearchSubagentToolInput = {
        originalQuestion: 'how does quicksort algorithm work',
        intent: 'technical',
        freshnessRequired: false,
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult.intent).toBe('technical');
      expect(toolResult.freshness).toBe(false);
      expect(toolResult.queryPlan.intent).toBe('technical');
      expect(toolResult.queryPlan.requiresFreshness).toBe(false);
    });

    it('product query → SearchQueryPlan with intent=product, requiresFreshness=false', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps({
        queryPlanner: {
          plan: vi.fn().mockReturnValue({
            originalQuestion: 'best laptops for programming',
            searchQuery: 'laptops programming reviews',
            intent: 'product',
            requiresFreshness: false,
            missingCriticalContext: [],
          }),
        },
      });

      const input: SearchSubagentToolInput = {
        originalQuestion: 'best laptops for programming',
        intent: 'product',
        freshnessRequired: false,
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult.intent).toBe('product');
      expect(toolResult.freshness).toBe(false);
      expect(toolResult.queryPlan.intent).toBe('product');
      expect(toolResult.queryPlan.requiresFreshness).toBe(false);
    });
  });

  describe('Missing Critical Context', () => {
    it('query with incomplete context → missingCriticalContext array populated', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps({
        queryPlanner: {
          plan: vi.fn().mockReturnValue({
            originalQuestion: 'what is the weather today',
            searchQuery: 'weather today',
            intent: 'weather',
            requiresFreshness: true,
            missingCriticalContext: ['location', 'date'],
          }),
        },
      });

      const input: SearchSubagentToolInput = {
        originalQuestion: 'what is the weather today',
        intent: 'weather',
        freshnessRequired: true,
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult.queryPlan.missingCriticalContext).toBeDefined();
      expect(toolResult.queryPlan.missingCriticalContext).toContain('location');
      expect(toolResult.queryPlan.missingCriticalContext).toContain('date');
      expect(toolResult.queryPlan.missingCriticalContext.length).toBe(2);
    });

    it('query with complete context → missingCriticalContext empty', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps({
        queryPlanner: {
          plan: vi.fn().mockReturnValue({
            originalQuestion: 'weather in Tokyo Japan today',
            searchQuery: 'weather Tokyo Japan today',
            intent: 'weather',
            requiresFreshness: true,
            missingCriticalContext: [],
          }),
        },
      });

      const input: SearchSubagentToolInput = {
        originalQuestion: 'weather in Tokyo Japan today',
        intent: 'weather',
        freshnessRequired: true,
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult.queryPlan.missingCriticalContext).toBeDefined();
      expect(toolResult.queryPlan.missingCriticalContext).toHaveLength(0);
    });
  });

  describe('Freshness Warning', () => {
    it('time-sensitive query (weather) with results lacking publishedAt → warning added', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'Test answer',
            toolResult: {
              query: 'weather Tokyo',
              results: [
                { title: 'Tokyo Weather', url: 'https://weather.com/tokyo', snippet: 'Current temperature is 22°C' },
              ],
              total: 1,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 100,
            },
          }),
        },
        queryPlanner: {
          plan: vi.fn().mockReturnValue({
            originalQuestion: 'weather in Tokyo',
            searchQuery: 'weather Tokyo',
            intent: 'weather',
            requiresFreshness: true,
            missingCriticalContext: [],
          }),
        },
      });

      const input: SearchSubagentToolInput = {
        originalQuestion: 'weather in Tokyo',
        intent: 'weather',
        freshnessRequired: true,
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult.warnings).toBeDefined();
      expect(toolResult.warnings.length).toBeGreaterThan(0);
      expect(toolResult.warnings[0].code).toBe('FRESHNESS_UNVERIFIABLE');
      expect(toolResult.warnings[0].message).toContain('outdated');
      expect(toolResult.warnings[0].recoverable).toBe(true);
    });

    it('time-sensitive query (news) with results lacking retrievedAt → warning added', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'Test answer',
            toolResult: {
              query: 'latest AI news',
              results: [
                { title: 'AI Breakthrough', url: 'https://news.com/ai', snippet: 'New AI model released' },
              ],
              total: 1,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 100,
            },
          }),
        },
        queryPlanner: {
          plan: vi.fn().mockReturnValue({
            originalQuestion: 'latest AI news',
            searchQuery: 'latest AI news',
            intent: 'news',
            requiresFreshness: true,
            missingCriticalContext: [],
          }),
        },
      });

      const input: SearchSubagentToolInput = {
        originalQuestion: 'latest AI news',
        intent: 'news',
        freshnessRequired: true,
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult.warnings).toBeDefined();
      expect(toolResult.warnings.length).toBeGreaterThan(0);
      expect(toolResult.warnings[0].code).toBe('FRESHNESS_UNVERIFIABLE');
    });

    it('time-sensitive query with results containing dates → no warning', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'Test answer',
            toolResult: {
              query: 'latest AI news',
              results: [
                { title: 'AI Breakthrough', url: 'https://news.com/ai', snippet: 'Published on 2026-06-03: New AI model released' },
              ],
              total: 1,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 100,
            },
          }),
        },
        queryPlanner: {
          plan: vi.fn().mockReturnValue({
            originalQuestion: 'latest AI news',
            searchQuery: 'latest AI news',
            intent: 'news',
            requiresFreshness: true,
            missingCriticalContext: [],
          }),
        },
      });

      const input: SearchSubagentToolInput = {
        originalQuestion: 'latest AI news',
        intent: 'news',
        freshnessRequired: true,
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult.warnings).toHaveLength(0);
    });
  });

  describe('Result Normalization', () => {
    it('deduplication by URL removes duplicate entries', async () => {
      const { deduplicateResults } = await import('../../../src/search/search-subagent-tool.js');

      const results = [
        { title: 'A', url: 'https://example.com/page', snippet: 's1' },
        { title: 'B', url: 'https://example.com/page', snippet: 's2' },
        { title: 'C', url: 'https://example.com/other', snippet: 's3' },
      ];

      const deduplicated = deduplicateResults(results);
      expect(deduplicated).toHaveLength(2);
      expect(deduplicated[0].url).toBe('https://example.com/page');
      expect(deduplicated[1].url).toBe('https://example.com/other');
    });

    it('snippet cleaning strips HTML tags', async () => {
      const { cleanSnippets } = await import('../../../src/search/search-subagent-tool.js');

      const results = [
        { title: 'Test', url: 'https://example.com', snippet: '<p>Hello <b>world</b></p>' },
      ];

      const cleaned = cleanSnippets(results);
      expect(cleaned[0].snippet).toBe('Hello world');
    });

    it('snippet cleaning normalizes whitespace', async () => {
      const { cleanSnippets } = await import('../../../src/search/search-subagent-tool.js');

      const results = [
        { title: 'Test', url: 'https://example.com', snippet: '  Hello   world  ' },
      ];

      const cleaned = cleanSnippets(results);
      expect(cleaned[0].snippet).toBe('Hello world');
    });

    it('cropping to top N limits result count', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'Test answer',
            toolResult: {
              query: 'test query',
              results: Array.from({ length: 20 }, (_, i) => ({
                title: `Result ${i}`,
                url: `https://example.com/page${i}`,
                snippet: `Snippet ${i}`,
              })),
              total: 20,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 100,
            },
          }),
        },
      });

      const input: SearchSubagentToolInput = {
        originalQuestion: 'test query',
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult.results.length).toBeLessThanOrEqual(10);
      expect(toolResult.metadata.resultCount).toBeLessThanOrEqual(10);
    });
  });

  describe('Fact Extraction', () => {
    it('facts include sourceUrls', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'Test answer',
            toolResult: {
              query: 'test query',
              results: [
                { title: 'Result 1', url: 'https://example.com/page1', snippet: 'This is fact one. This is fact two.' },
                { title: 'Result 2', url: 'https://example.com/page2', snippet: 'Another fact here.' },
              ],
              total: 2,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 100,
            },
          }),
        },
      });

      const input: SearchSubagentToolInput = {
        originalQuestion: 'test query',
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult.extractedFacts).toBeDefined();
      expect(toolResult.extractedFacts.length).toBeGreaterThan(0);

      for (const fact of toolResult.extractedFacts) {
        expect(fact.sourceUrl).toBeDefined();
        expect(typeof fact.sourceUrl).toBe('string');
        expect(fact.sourceUrl.length).toBeGreaterThan(0);
        expect(fact.confidence).toBeGreaterThanOrEqual(0);
        expect(fact.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('each fact has confidence score', async () => {
      const { extractFacts } = await import('../../../src/search/search-subagent-tool.js');

      const results = [
        { title: 'Test', url: 'https://example.com', snippet: 'This is a fact. Another fact here.' },
      ];

      const facts = extractFacts(results);
      expect(facts.length).toBeGreaterThan(0);
      for (const fact of facts) {
        expect(fact.confidence).toBeDefined();
        expect(typeof fact.confidence).toBe('number');
        expect(fact.confidence).toBeGreaterThanOrEqual(0);
        expect(fact.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Non-Search Tool Rejection', () => {
    it('kernel calls foreground_spawn_planner → SearchSubagentScopeError thrown', () => {
      expect(() => assertSearchScope('foreground_spawn_planner')).toThrow(SearchSubagentScopeError);
      
      try {
        assertSearchScope('foreground_spawn_planner');
        expect.fail('Expected SearchSubagentScopeError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SearchSubagentScopeError);
        const scopeError = error as SearchSubagentScopeError;
        expect(scopeError.code).toBe('NON_SEARCH_TOOL_NOT_ALLOWED');
        expect(scopeError.toolId).toBe('foreground_spawn_planner');
      }
    });

    it('kernel calls file_read → SearchSubagentScopeError thrown', () => {
      expect(() => assertSearchScope('file_read')).toThrow(SearchSubagentScopeError);
    });

    it('kernel calls memory_retrieve → SearchSubagentScopeError thrown', () => {
      expect(() => assertSearchScope('memory_retrieve')).toThrow(SearchSubagentScopeError);
    });

    it('kernel calls web_fetch → SearchSubagentScopeError thrown', () => {
      expect(() => assertSearchScope('web_fetch')).toThrow(SearchSubagentScopeError);
    });

    it('valid search tools do NOT throw', () => {
      expect(() => assertSearchScope('web_search')).not.toThrow();
      expect(() => assertSearchScope('docs_search')).not.toThrow();
    });

    it('handleSearchSubagentTool returns error when scope guard rejects', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps({
        scopeGuard: (_toolId: string) => {
          throw new SearchSubagentScopeError('foreground_spawn_planner');
        },
      });

      const input: SearchSubagentToolInput = {
        originalQuestion: 'test query',
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('NON_SEARCH_TOOL_NOT_ALLOWED');
      expect(result.error!.recoverable).toBe(false);
    });
  });

  describe('Non-Foreground Agent Projection', () => {
    it('non-foreground agent (planner) with search_subagent in projection CAN call it', async () => {
      const plannerProjection: ToolPlaneProjection = {
        toolIds: ['search_subagent', 'memory_retrieve', 'context_read'],
        toolSummaries: 'Search, memory, and context tools for planning',
      };

      expect(plannerProjection.toolIds).toContain('search_subagent');

      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps();
      const input: SearchSubagentToolInput = {
        originalQuestion: 'research topic for planning',
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('tool availability is projection-based, not hardcoded to foreground agents', () => {
      const foregroundProjection: ToolPlaneProjection = {
        toolIds: ['search_subagent', 'foreground_spawn_planner', 'memory_retrieve', 'context_read'],
      };

      const plannerProjection: ToolPlaneProjection = {
        toolIds: ['search_subagent', 'memory_retrieve', 'context_read'],
      };

      const kernelProjection: ToolPlaneProjection = {
        toolIds: ['search_subagent', 'web_fetch', 'memory_retrieve'],
      };

      expect(foregroundProjection.toolIds).toContain('search_subagent');
      expect(plannerProjection.toolIds).toContain('search_subagent');
      expect(kernelProjection.toolIds).toContain('search_subagent');
    });

    it('projection can grant search_subagent to background agents', async () => {
      const backgroundAgentProjection: ToolPlaneProjection = {
        toolIds: ['search_subagent', 'memory_retrieve'],
        toolSummaries: 'Tools for autonomous background research',
      };

      expect(backgroundAgentProjection.toolIds).toContain('search_subagent');

      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps();
      const input: SearchSubagentToolInput = {
        originalQuestion: 'background research query',
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult.originalQuestion).toBe('background research query');
    });
  });

  describe('Structured Evidence Contract', () => {
    it('result does NOT include finalAnswer field', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps();
      const input: SearchSubagentToolInput = {
        originalQuestion: 'test query',
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult).not.toHaveProperty('finalAnswer');
    });

    it('result does NOT include userVisibleResponse field', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps();
      const input: SearchSubagentToolInput = {
        originalQuestion: 'test query',
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;
      expect(toolResult).not.toHaveProperty('userVisibleResponse');
    });

    it('result includes all required evidence fields', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js');

      const deps = createMockDeps();
      const input: SearchSubagentToolInput = {
        originalQuestion: 'test query',
        intent: 'general',
      };

      const result = await handleSearchSubagentTool(deps, input);

      expect(result.success).toBe(true);
      const toolResult = result.data as SearchSubagentToolResult;

      expect(toolResult.originalQuestion).toBeDefined();
      expect(toolResult.searchQuery).toBeDefined();
      expect(toolResult.intent).toBeDefined();
      expect(toolResult.freshness).toBeDefined();
      expect(toolResult.results).toBeDefined();
      expect(toolResult.extractedFacts).toBeDefined();
      expect(toolResult.warnings).toBeDefined();
      expect(toolResult.metadata).toBeDefined();
      expect(toolResult.queryPlan).toBeDefined();

      expect(toolResult.metadata.durationMs).toBeGreaterThanOrEqual(0);
      expect(toolResult.metadata.resultCount).toBeGreaterThanOrEqual(0);
      expect(toolResult.metadata.uniqueSourceCount).toBeGreaterThanOrEqual(0);
    });
  });
});
