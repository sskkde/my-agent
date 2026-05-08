/**
 * Search Subagent
 * Dedicated synchronous service for web search with forced tool choice
 */

import type { LLMRequest, ToolDefinition } from '../llm/types';
import type { WebSearchResult } from './types';

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
 * Create a search subagent
 */
export function createSearchSubagent(config: SearchSubagentConfig) {
  const {
    llmAdapter,
    webSearchExecutor,
    searchLlmProviderId,
    searchLlmModel,
  } = config;

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

    const llmRequest: LLMRequest = {
      model: searchLlmModel,
      messages: [
        {
          role: 'system',
          content: 'You are a search assistant. Use the web.search tool to find information.',
        },
        {
          role: 'user',
          content: input.query,
        },
      ],
      tools: [WEB_SEARCH_TOOL],
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

    const answerRequest: LLMRequest = {
      model: searchLlmModel,
      messages: [
        {
          role: 'system',
          content: 'You are a search assistant. Provide a helpful answer based on the search results.',
        },
        {
          role: 'user',
          content: input.query,
        },
        {
          role: 'assistant',
          content: '',
          toolCalls: response.toolCalls,
        },
        {
          role: 'tool',
          toolCallId: toolCall.id,
          content: JSON.stringify(toolResult),
        },
      ],
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
      },
    };
  }

  return {
    execute,
  };
}
