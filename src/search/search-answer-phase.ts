/**
 * Phase-2 answer phase of the two-phase search subagent.
 *
 * Builds the structured_json model input with the evidence-context bundle,
 * compares the Segment A hash against the phase-1 build, and generates the
 * final answer. Every failure path degrades to a safe success result that keeps
 * the tool result for downstream post-processing.
 */

import type { LLMRequest } from '../llm/types.js'
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import type { ModelInputBuildInput } from '../kernel/model-input/model-input-types.js'
import type { WebSearchResult } from './types.js'
import type {
  SearchPhaseObservation,
  SearchSubagentConfig,
  SearchSubagentInput,
  SearchSubagentSuccessResult,
} from './search-subagent.js'

/** Safe degraded answer returned when phase-2 build/LLM fails or the completion deadline settles. */
export const DEGRADED_ANSWER = 'Search completed but answer generation failed.'

/**
 * Build the tool result context items rendered into the phase-2 Segment D
 * context bundle (search query + full tool result).
 */
export function buildToolResultContext(
  toolResult: WebSearchResult,
  searchQuery: string,
): Array<{ itemId: string; content: string; semanticType?: string }> {
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
  ]
}

/**
 * Build the phase-2 structured_json model input from the evidence context.
 */
export function buildPhase2BuildInput(
  input: SearchSubagentInput,
  providerFamily: string,
  toolResultContext: Array<{ itemId: string; content: string; semanticType?: string }>,
): ModelInputBuildInput {
  return {
    mode: 'structured_json',
    agentType: 'subagent',
    agentProfile: 'search',
    providerFamily,
    currentUserMessage: input.query,
    currentDate: new Date().toISOString(),
    sessionId: input.sessionId,
    outputContract: 'output:search-evidence.schema',
    contextBundle: {
      orderedItems: toolResultContext,
    },
  }
}

export interface AnswerPhaseDeps {
  llmAdapter: SearchSubagentConfig['llmAdapter']
  modelInputBuilder: ModelInputBuilder
  searchLlmModel: string
  phaseObserver?: (observation: SearchPhaseObservation) => void
}

export interface AnswerPhaseParams {
  input: SearchSubagentInput
  providerFamily: string
  searchLlmProviderId: string
  toolResult: WebSearchResult
  searchQuery: string
  cachedSegmentAHash?: string
  startTime: number
}

function degradedSuccess(params: AnswerPhaseParams, searchLlmModel: string): SearchSubagentSuccessResult {
  return {
    success: true,
    answer: DEGRADED_ANSWER,
    toolResult: params.toolResult,
    metadata: {
      providerId: params.searchLlmProviderId,
      model: searchLlmModel,
      querySource: 'search_subagent',
      durationMs: Date.now() - params.startTime,
      segmentAHash: params.cachedSegmentAHash,
    },
  }
}

/**
 * Run the phase-2 answer phase: build the evidence-context input, verify the
 * Segment A hash matches phase-1, then produce the final answer. Never throws —
 * every failure degrades to a safe success that preserves the tool result.
 */
export async function runAnswerPhase(
  deps: AnswerPhaseDeps,
  params: AnswerPhaseParams,
): Promise<SearchSubagentSuccessResult> {
  const { llmAdapter, modelInputBuilder, searchLlmModel, phaseObserver } = deps
  const { input, providerFamily } = params

  const toolResultContext = buildToolResultContext(params.toolResult, params.searchQuery)
  const phase2BuildInput = buildPhase2BuildInput(input, providerFamily, toolResultContext)

  let phase2Built: Awaited<ReturnType<ModelInputBuilder['build']>>
  try {
    phase2Built = await modelInputBuilder.build(phase2BuildInput)
  } catch {
    return degradedSuccess(params, searchLlmModel)
  }

  phaseObserver?.({ phase: 'phase2' })

  const segmentAMatched = phase2Built.segmentHashes.segmentA === params.cachedSegmentAHash

  if (process.env.NODE_ENV !== 'production') {
    console.log('[SearchSubagent] Segment A cache check:', {
      phase1SegmentA: params.cachedSegmentAHash?.substring(0, 8),
      phase2SegmentA: phase2Built.segmentHashes.segmentA.substring(0, 8),
      matched: segmentAMatched,
    })
  }

  const answerRequest: LLMRequest = {
    model: searchLlmModel,
    messages: phase2Built.messages,
  }

  let answerResult
  try {
    answerResult = await llmAdapter.complete(answerRequest)
  } catch {
    return degradedSuccess(params, searchLlmModel)
  }

  const answer = answerResult.success && answerResult.response ? answerResult.response.content : DEGRADED_ANSWER

  return {
    success: true,
    answer,
    toolResult: params.toolResult,
    metadata: {
      providerId: params.searchLlmProviderId,
      model: searchLlmModel,
      querySource: 'search_subagent',
      durationMs: Date.now() - params.startTime,
      segmentAHash: params.cachedSegmentAHash,
    },
  }
}
