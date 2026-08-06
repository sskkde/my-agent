/**
 * Phase-1 query phase of the two-phase search subagent.
 *
 * Builds the function_calling model input (forced web_search tool_choice -> auto
 * retry -> input fallback), resolves the search query, and returns it to the
 * caller for direct backend execution. Optional dynamic round feedback is
 * rendered ONLY in the Segment D dynamic context so the static Segment A cache
 * prefix stays stable across builds (multi-round dependency).
 */

import type { LLMRequest, ToolDefinition } from '../llm/types.js'
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import type {
  ContextItemData,
  ModelInputBuildInput,
  ToolPlaneProjection,
} from '../kernel/model-input/model-input-types.js'
import { extractToolsForRequest } from '../kernel/model-input/model-input-builder.js'
import type { SearchSubagentConfig, SearchSubagentInput } from './search-subagent.js'

/**
 * Web search tool schema projected to the phase-1 model.
 */
export const WEB_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
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
}

/**
 * Tool plane projection exposing only the web_search tool.
 */
export const WEB_SEARCH_TOOL_PROJECTION: ToolPlaneProjection = {
  toolIds: ['web_search'],
  tools: [WEB_SEARCH_TOOL],
}

/**
 * Normalized response of a phase-1 LLM completion.
 */
export interface Phase1Response {
  id: string
  model: string
  content: string
  toolCalls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  finishReason: string
}

/**
 * Result of the phase-1 query phase: either a resolved search query or a typed
 * failure that terminates the search (the caller maps it to a failure result).
 */
export type QueryPhaseResult =
  | {
      ok: true
      searchQuery: string
      querySource: 'llm_tool_call' | 'input_fallback'
      segmentAHash: string
    }
  | {
      ok: false
      errorCode: 'MODEL_UNAVAILABLE' | 'INVALID_TOOL_CALL' | 'NO_TOOL_CALL'
      message: string
    }

export interface QueryPhaseDeps {
  llmAdapter: SearchSubagentConfig['llmAdapter']
  modelInputBuilder: ModelInputBuilder
  searchLlmModel: string
}

export interface QueryPhaseParams {
  /** Search subagent input (query/userId/sessionId). */
  input: SearchSubagentInput
  /** Resolved provider family for template resolution. */
  providerFamily: string
  /**
   * Optional dynamic round feedback (multi-round seam). Rendered in the Segment
   * D dynamic context only — never a new system/static prompt layer — so the
   * Segment A cache prefix stays stable across round builds.
   */
  dynamicContextItems?: ContextItemData[]
}

/**
 * Build the phase-1 function_calling model input. When round feedback is
 * present it lands in `contextBundle.orderedItems` (Segment D), keeping the
 * default path byte-identical to the pre-split executor.
 */
export function buildPhase1BuildInput(
  input: SearchSubagentInput,
  providerFamily: string,
  dynamicContextItems?: ContextItemData[],
): ModelInputBuildInput {
  const buildInput: ModelInputBuildInput = {
    mode: 'function_calling',
    agentType: 'subagent',
    agentProfile: 'search',
    providerFamily,
    toolProjection: WEB_SEARCH_TOOL_PROJECTION,
    currentUserMessage: input.query,
    currentDate: new Date().toISOString(),
    sessionId: input.sessionId,
    outputContract: 'output:search-evidence.schema',
  }
  if (dynamicContextItems && dynamicContextItems.length > 0) {
    buildInput.contextBundle = { orderedItems: dynamicContextItems }
  }
  return buildInput
}

type ParsedQueryArguments = { ok: true; query: string } | { ok: false; reason: 'unparseable' | 'invalid' }

function parseWebSearchArguments(argumentsJson: string): ParsedQueryArguments {
  let raw: unknown
  try {
    raw = JSON.parse(argumentsJson)
  } catch {
    return { ok: false, reason: 'unparseable' }
  }
  if (typeof raw !== 'object' || raw === null || !('query' in raw)) {
    return { ok: false, reason: 'invalid' }
  }
  const queryValue = (raw as Record<string, unknown>).query
  if (typeof queryValue !== 'string' || queryValue.trim().length === 0) {
    return { ok: false, reason: 'invalid' }
  }
  return { ok: true, query: queryValue.trim() }
}

/**
 * Run the phase-1 query phase: forced web_search tool_choice, auto retry when
 * the provider rejects forced tool choice, input-query fallback when no tool
 * call was produced, then resolve the search query.
 */
export async function runQueryPhase(deps: QueryPhaseDeps, params: QueryPhaseParams): Promise<QueryPhaseResult> {
  const { llmAdapter, modelInputBuilder, searchLlmModel } = deps
  const { input, providerFamily } = params

  const phase1BuildInput = buildPhase1BuildInput(input, providerFamily, params.dynamicContextItems)

  let phase1Built: Awaited<ReturnType<ModelInputBuilder['build']>>
  try {
    phase1Built = await modelInputBuilder.build(phase1BuildInput)
  } catch (error) {
    return {
      ok: false,
      errorCode: 'MODEL_UNAVAILABLE',
      message: error instanceof Error ? error.message : 'Failed to build LLM request',
    }
  }

  const segmentAHash = phase1Built.segmentHashes.segmentA
  const tools = extractToolsForRequest(phase1BuildInput)

  const forcedToolChoice = { type: 'function' as const, function: { name: 'web_search' } }

  async function completePhase1(
    toolChoice: LLMRequest['toolChoice'],
  ): Promise<{ ok: true; response: Phase1Response } | { ok: false; message: string }> {
    const request: LLMRequest = {
      model: searchLlmModel,
      messages: phase1Built.messages,
      tools,
      toolChoice,
    }
    try {
      const result = await llmAdapter.complete(request)
      if (!result.success || !result.response) {
        return { ok: false, message: result.error?.message || 'Model request failed' }
      }
      return { ok: true, response: result.response }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Model unavailable',
      }
    }
  }

  let phase1Response: Phase1Response | undefined
  let phase1Error: string | undefined

  const forcedAttempt = await completePhase1(forcedToolChoice)
  if (forcedAttempt.ok) {
    phase1Response = forcedAttempt.response
  } else {
    phase1Error = forcedAttempt.message
    const autoAttempt = await completePhase1('auto')
    if (autoAttempt.ok) {
      phase1Response = autoAttempt.response
    } else {
      phase1Error = autoAttempt.message
    }
  }

  if (phase1Response?.toolCalls && phase1Response.toolCalls.length > 0) {
    const toolCall = phase1Response.toolCalls[0]
    if (toolCall.function.name !== 'web_search') {
      return {
        ok: false,
        errorCode: 'INVALID_TOOL_CALL',
        message: `Model called invalid tool: ${toolCall.function.name}`,
      }
    }
    const parsedArgs = parseWebSearchArguments(toolCall.function.arguments)
    if (!parsedArgs.ok) {
      return {
        ok: false,
        errorCode: 'INVALID_TOOL_CALL',
        message:
          parsedArgs.reason === 'unparseable'
            ? 'Invalid web_search arguments: failed to parse JSON'
            : 'Invalid web_search arguments: missing or empty query',
      }
    }
    return {
      ok: true,
      searchQuery: parsedArgs.query,
      querySource: 'llm_tool_call',
      segmentAHash,
    }
  }

  const fallbackQuery = input.query.trim()
  if (fallbackQuery.length === 0) {
    return {
      ok: false,
      errorCode: phase1Response ? 'NO_TOOL_CALL' : 'MODEL_UNAVAILABLE',
      message: phase1Response
        ? 'Model did not produce a tool call and input query is empty'
        : phase1Error || 'Model request failed',
    }
  }
  return {
    ok: true,
    searchQuery: fallbackQuery,
    querySource: 'input_fallback',
    segmentAHash,
  }
}
