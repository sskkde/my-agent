import type { ToolDefinition, ToolHandler, ToolExecutionResult, ToolExecutionContext } from '../types.js';
import type { ToolResultStore } from '../../storage/tool-result-store.js';

export interface DocsSearchParams {
  query: string;
  limit?: number;
}

export interface DocsSearchResultItem {
  docId: string;
  title: string;
  snippet: string;
  source: string;
}

export interface DocsSearchResult {
  results: DocsSearchResultItem[];
  total: number;
  query: string;
  [key: string]: unknown;
}

const LARGE_RESULT_THRESHOLD = 10000;

export function createDocsSearchTool(toolResultStore?: ToolResultStore): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as DocsSearchParams;

    if (!typedParams.query) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: query',
          recoverable: true,
        },
      };
    }

    const limit = typedParams.limit ?? 10;

    const mockResults: DocsSearchResultItem[] = Array.from({ length: Math.min(limit, 20) }, (_, i) => ({
      docId: `doc_${i + 1}`,
      title: `Documentation for ${typedParams.query} - Part ${i + 1}`,
      snippet: `This is a detailed snippet about ${typedParams.query}... ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. '.repeat(10)}`,
      source: i % 2 === 0 ? 'internal' : 'external',
    }));

    const result: DocsSearchResult = {
      results: mockResults,
      total: mockResults.length,
      query: typedParams.query,
    };

    const resultJson = JSON.stringify(result);
    let resultRef: string | undefined;

    if (resultJson.length > LARGE_RESULT_THRESHOLD && toolResultStore) {
      const stored = toolResultStore.create({
        resultRef: `docs_${Date.now()}`,
        toolCallId: context.toolCallId,
        toolName: 'docs_search',
        userId: context.userId,
        sessionId: context.sessionId,
        preview: `Found ${result.results.length} documents for "${typedParams.query}"`,
        structuredContent: result,
        sensitivity: 'low',
      });
      resultRef = stored.resultRef;
    }

    return {
      success: true,
      data: result,
      resultPreview: `Found ${result.results.length} documents for "${typedParams.query}"${resultRef ? ' (results stored)' : ''}`,
      resultRef,
      structuredContent: result,
    };
  };

  return {
    name: 'docs_search',
    description: 'Search documentation for relevant content (mock implementation)',
    category: 'search',
    sensitivity: 'low',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        limit: { type: 'number', description: 'Maximum number of results to return' },
      },
      required: ['query'],
    },
    handler,
  };
}
