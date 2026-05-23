/**
 * Search Subagent
 * Dedicated synchronous service for web search with forced tool choice.
 * Uses ModelInputBuilder for both LLM calls with shared Segment A cache.
 */

import type { LLMRequest, ToolDefinition } from '../llm/types';
import type { WebSearchResult } from './types';
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js';
import type { ToolPlaneProjection } from '../kernel/model-input/model-input-types.js';
import { extractToolsForRequest } from '../kernel/model-input/model-input-builder.js';

/**
 * Search subagent configuration
 */
export interface SearchSubagentConfig {
  /** LLM adapter for executing requests */
  llmAdapter: {
    complete: (request: LLMRequest) => Promise<{
      success: boolean;
      response?: {
        id: string;
        model: string;
        content: string;
        toolCalls?: Array<{
          id: string;
          type: 'function';
          function: {
            name: string;
            arguments: string;
          };
        }>;
        finishReason: string;
      };
      error?: {
        code: string;
        message: string;
      };
    }>;
    getProviderCapabilities?: () => {
      supportsFunctionCalling: boolean;
    };
  };

  /** Web search executor function */
  webSearchExecutor: (params: { query: string }) => Promise<WebSearchResult & { success: boolean }>;

  /** ModelInputBuilder for constructing LLM messages */
  modelInputBuilder: ModelInputBuilder;

  /** Provider family for template resolution (e.g., 'openai', 'deepseek') */
  providerFamily: string;

  /** Search model provider ID */
  searchLlmProviderId: string;

  /** Search model name */
  searchLlmModel: string;

  /** Optional main model provider ID (for reference only, not used) */
  mainLlmProviderId?: string;

  /** Optional main model name (for reference only, not used) */
  mainLlmModel?: string;
}

/**
 * Search subagent input
 */
export interface SearchSubagentInput {
  /** Search query */
  query: string;

  /** User ID */
  userId: string;

  /** Session ID */
  sessionId: string;
}

/**
 * Search subagent success result
 */
export interface SearchSubagentSuccessResult {
  success: true;
  answer: string;
  toolResult: WebSearchResult;
  metadata: {
    providerId: string;
    model: string;
    querySource: 'search_subagent';
    durationMs: number;
    segmentAHash?: string;
  };
}

/**
 * Search subagent failure result
 */
export interface SearchSubagentFailureResult {
  success: false;
  errorCode: 'SEARCH_MODEL_INCAPABLE' | 'INVALID_TOOL_CALL' | 'MODEL_UNAVAILABLE' | 'NO_TOOL_CALL';
  message: string;
}

/**
 * Search subagent result
 */
export type SearchSubagentResult = SearchSubagentSuccessResult | SearchSubagentFailureResult;

/**
 * Search subagent interface
 */
export interface SearchSubagent {
  execute: (input: SearchSubagentInput) => Promise<SearchSubagentResult>;
}

/**
 * Web search tool schema
 */
const WEB_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web.search',
    description: 'Search the public web for information',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * Tool plane projection for web.search tool
 */
const WEB_SEARCH_TOOL_PROJECTION: ToolPlaneProjection = {
  toolIds: ['web.search'],
  tools: [WEB_SEARCH_TOOL],
};

/**
 * Build the tool result context as context items for Layer 7
 */
function buildToolResultContext(toolResult: WebSearchResult, searchQuery: string): Array<{
  itemId: string;
  content: string;
  semanticType?: string;
}> {
  return [
    {
      itemId: 'search-query',
      content: `Search Query: ${searchQuery}`,
      semanticType: 'search_context',
    },
    {
      itemId: 'search-results',
      content: `Search Results:\n${JSON.stringify(toolResult, null, 2)}`,
      semanticType: 'tool_output',
    },
  ];
}

/**
 * Create a search subagent
 */
export function createSearchSubagent(config: SearchSubagentConfig) {
  const {
    llmAdapter,
    webSearchExecutor,
    modelInputBuilder,
    providerFamily,
    searchLlmProviderId,
    searchLlmModel,
  } = config;

  let cachedSegmentAHash: string | undefined;

  async function execute(input: SearchSubagentInput): Promise<SearchSubagentResult> {
    const startTime = Date.now();

    if (llmAdapter.getProviderCapabilities) {
      const capabilities = llmAdapter.getProviderCapabilities();
      if (!capabilities.supportsFunctionCalling) {
        return {
          success: false,
          errorCode: 'SEARCH_MODEL_INCAPABLE',
          message: 'Search model does not support function calling',
        };
      }
    }

    // ─── Phase 1: Tool Call (function_calling mode) ──────────────────────────────
    const phase1BuildInput = {
      mode: 'function_calling' as const,
      agentKind: 'search',
      providerFamily,
      toolProjection: WEB_SEARCH_TOOL_PROJECTION,
      currentUserMessage: input.query,
      currentDate: new Date().toISOString(),
      sessionId: input.sessionId,
    };

    let phase1Built;
    try {
      phase1Built = await modelInputBuilder.build(phase1BuildInput);
    } catch (error) {
      return {
        success: false,
        errorCode: 'MODEL_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Failed to build LLM request',
      };
    }

    cachedSegmentAHash = phase1Built.segmentHashes.segmentA;

    const tools = extractToolsForRequest(phase1BuildInput);

    const llmRequest: LLMRequest = {
      model: searchLlmModel,
      messages: phase1Built.messages,
      tools,
      toolChoice: {
        type: 'function',
        function: { name: 'web.search' },
      },
    };

    let llmResult;
    try {
      llmResult = await llmAdapter.complete(llmRequest);
    } catch (error) {
      return {
        success: false,
        errorCode: 'MODEL_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Model unavailable',
      };
    }

    if (!llmResult.success || !llmResult.response) {
      return {
        success: false,
        errorCode: 'MODEL_UNAVAILABLE',
        message: llmResult.error?.message || 'Model request failed',
      };
    }

    const response = llmResult.response;

    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        success: false,
        errorCode: 'NO_TOOL_CALL',
        message: 'Model did not produce a tool call',
      };
    }

    const toolCall = response.toolCalls[0];
    if (toolCall.function.name !== 'web.search') {
      return {
        success: false,
        errorCode: 'INVALID_TOOL_CALL',
        message: `Model called invalid tool: ${toolCall.function.name}`,
      };
    }

    let searchQuery: string;
    try {
      const args = JSON.parse(toolCall.function.arguments);
      searchQuery = args.query;
      if (typeof searchQuery !== 'string' || searchQuery.trim().length === 0) {
        return {
          success: false,
          errorCode: 'INVALID_TOOL_CALL',
          message: 'Invalid web.search arguments: missing or empty query',
        };
      }
    } catch {
      return {
        success: false,
        errorCode: 'INVALID_TOOL_CALL',
        message: 'Invalid web.search arguments: failed to parse JSON',
      };
    }

    const toolResult = await webSearchExecutor({ query: searchQuery });

    // ─── Phase 2: Answer Generation (structured_json mode) ────────────────────────
    const toolResultContext = buildToolResultContext(toolResult, searchQuery);

    const phase2BuildInput = {
      mode: 'structured_json' as const,
      agentKind: 'search',
      providerFamily,
      currentUserMessage: input.query,
      currentDate: new Date().toISOString(),
      sessionId: input.sessionId,
      contextBundle: {
        orderedItems: toolResultContext,
      },
    };

    let phase2Built;
    try {
      phase2Built = await modelInputBuilder.build(phase2BuildInput);
    } catch {
      return {
        success: true,
        answer: 'Search completed but answer generation failed.',
        toolResult,
        metadata: {
          providerId: searchLlmProviderId,
          model: searchLlmModel,
          querySource: 'search_subagent',
          durationMs: Date.now() - startTime,
          segmentAHash: cachedSegmentAHash,
        },
      };
    }

    const segmentAMatched = phase2Built.segmentHashes.segmentA === cachedSegmentAHash;

    if (process.env.NODE_ENV !== 'production') {
      console.log('[SearchSubagent] Segment A cache check:', {
        phase1SegmentA: cachedSegmentAHash?.substring(0, 8),
        phase2SegmentA: phase2Built.segmentHashes.segmentA.substring(0, 8),
        matched: segmentAMatched,
      });
    }

    const answerRequest: LLMRequest = {
      model: searchLlmModel,
      messages: phase2Built.messages,
    };

    let answerResult;
    try {
      answerResult = await llmAdapter.complete(answerRequest);
    } catch {
      return {
        success: true,
        answer: 'Search completed but answer generation failed.',
        toolResult,
        metadata: {
          providerId: searchLlmProviderId,
          model: searchLlmModel,
          querySource: 'search_subagent',
          durationMs: Date.now() - startTime,
          segmentAHash: cachedSegmentAHash,
        },
      };
    }

    const answer = answerResult.success && answerResult.response
      ? answerResult.response.content
      : 'Search completed but answer generation failed.';

    return {
      success: true,
      answer,
      toolResult,
      metadata: {
        providerId: searchLlmProviderId,
        model: searchLlmModel,
        querySource: 'search_subagent',
        durationMs: Date.now() - startTime,
        segmentAHash: cachedSegmentAHash,
      },
    };
  }

  return {
    execute,
  };
}
