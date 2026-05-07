import { afterEach, describe, it, expect, vi } from 'vitest';
import { createWebSearchTool, type WebSearchParams, type WebSearchResult } from '../../../src/tools/builtins/web-search.js';
import type { ToolExecutionContext } from '../../../src/tools/types.js';

function createToolContext(): ToolExecutionContext {
  return {
    toolCallId: 'tc-web-search-001',
    toolName: 'web.search',
    userId: 'user-123',
    sessionId: 'session-001',
    permissionContext: {
      userId: 'user-123',
      sessionId: 'session-001',
      mode: 'ask_on_write',
      grants: [],
    },
    executionStartTime: new Date().toISOString(),
    stores: {
      toolExecutionStore: {
        updateStatus: () => {},
        saveResult: () => {},
      },
    },
  };
}

describe('web.search tool', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('Tool Definition', () => {
    it('should have correct name and metadata', () => {
      const tool = createWebSearchTool();

      expect(tool.name).toBe('web.search');
      expect(tool.category).toBe('search');
      expect(tool.sensitivity).toBe('medium');
      expect(tool.schema.required).toContain('query');
    });
  });

  describe('Parameter Validation', () => {
    it('should reject missing query', async () => {
      const tool = createWebSearchTool();
      const result = await tool.handler({} as WebSearchParams, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_REQUIRED_FIELD');
    });

    it('should reject blank query', async () => {
      const tool = createWebSearchTool();
      const result = await tool.handler({ query: '   ' }, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_REQUIRED_FIELD');
    });
  });

  describe('Provider Configuration', () => {
    it('should return recoverable error when endpoint is not configured', async () => {
      vi.stubEnv('WEB_SEARCH_API_URL', '');
      const tool = createWebSearchTool({ endpointUrl: undefined });
      const result = await tool.handler({ query: 'latest TypeScript release' }, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
      expect(result.error?.recoverable).toBe(true);
    });

    it('should reject invalid endpoint URLs', async () => {
      const tool = createWebSearchTool({ endpointUrl: 'not-a-url' });
      const result = await tool.handler({ query: 'typescript' }, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_ENDPOINT');
    });
  });

  describe('Search Execution', () => {
    it('should fetch and normalize provider results', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          results: [
            { title: 'Result A', url: 'https://example.com/a', snippet: 'Alpha' },
            { name: 'Result B', link: 'https://example.com/b', description: 'Beta', source: 'example.com' },
          ],
        }),
      } as unknown as Response);
      const tool = createWebSearchTool({
        endpointUrl: 'https://search.example.test/api/search',
        provider: 'test-provider',
        fetchImpl,
      });

      const result = await tool.handler({ query: 'agent tools', limit: 2 }, createToolContext());

      expect(result.success).toBe(true);
      expect(fetchImpl).toHaveBeenCalledOnce();
      const requestedUrl = fetchImpl.mock.calls[0]?.[0] as URL;
      expect(requestedUrl.searchParams.get('q')).toBe('agent tools');
      expect(requestedUrl.searchParams.get('limit')).toBe('2');

      const data = result.data as WebSearchResult;
      expect(data.provider).toBe('test-provider');
      expect(data.endpointHost).toBe('search.example.test');
      expect(data.results).toEqual([
        { title: 'Result A', url: 'https://example.com/a', snippet: 'Alpha' },
        { title: 'Result B', url: 'https://example.com/b', snippet: 'Beta', source: 'example.com' },
      ]);
      expect(result.resultPreview).toContain('Found 2 web results');
    });

    it('should support endpoint templates with query placeholder', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ results: [] }),
      } as unknown as Response);
      const tool = createWebSearchTool({
        endpointUrl: 'https://search.example.test/?query={query}',
        fetchImpl,
      });

      const result = await tool.handler({ query: 'hello world' }, createToolContext());

      expect(result.success).toBe(true);
      const requestedUrl = fetchImpl.mock.calls[0]?.[0] as URL;
      expect(requestedUrl.searchParams.get('query')).toBe('hello world');
    });

    it('should cap result limit at ten', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          results: Array.from({ length: 20 }, (_, index) => ({
            title: `Result ${index}`,
            url: `https://example.com/${index}`,
            snippet: 'Snippet',
          })),
        }),
      } as unknown as Response);
      const tool = createWebSearchTool({ endpointUrl: 'https://search.example.test/api', fetchImpl });

      const result = await tool.handler({ query: 'many', limit: 100 }, createToolContext());

      expect(result.success).toBe(true);
      const data = result.data as WebSearchResult;
      expect(data.results).toHaveLength(10);
    });

    it('should return provider error for non-2xx responses', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: vi.fn(),
      } as unknown as Response);
      const tool = createWebSearchTool({ endpointUrl: 'https://search.example.test/api', fetchImpl });

      const result = await tool.handler({ query: 'rate limited' }, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PROVIDER_ERROR');
      expect(result.error?.message).toContain('429');
    });

    it('should return search failure for malformed JSON', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      } as unknown as Response);
      const tool = createWebSearchTool({ endpointUrl: 'https://search.example.test/api', fetchImpl });

      const result = await tool.handler({ query: 'bad response' }, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SEARCH_FAILED');
      expect(result.error?.message).toContain('Invalid JSON');
    });
  });
});
