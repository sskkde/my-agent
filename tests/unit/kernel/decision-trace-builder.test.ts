import { describe, it, expect } from 'vitest'
import { buildDecisionTrace } from '../../../src/kernel/decision-trace-builder.js'
import type { KernelRunState, KernelRunInput } from '../../../src/kernel/types.js'

function makeInput(overrides?: Partial<KernelRunInput>): KernelRunInput {
  return {
    contextBundle: { items: [], agentType: 'main', runId: 'test-run' } as any,
    runId: 'test-run',
    agentId: 'test-agent',
    agentType: 'main',
    userId: 'test-user',
    toolProjection: { toolIds: ['web_search', 'file_read', 'file_write'] },
    ...overrides,
  }
}

function makeState(overrides?: Partial<KernelRunState>): KernelRunState {
  return {
    currentIteration: 1,
    status: 'completed',
    contextItems: [],
    startTime: Date.now(),
    toolCalls: [],
    transcript: [],
    compactedItemIds: new Set(),
    compactedToolCallIds: new Set(),
    lastCompactSummaryItem: undefined,
    ...overrides,
  }
}

describe('buildDecisionTrace', () => {
  it('route is answer_directly when no tool calls', () => {
    const state = makeState({ toolCalls: [] })
    const input = makeInput({ toolProjection: { toolIds: [] } })
    const trace = buildDecisionTrace(state, input)
    expect(trace.route).toBe('answer_directly')
    expect(trace.finalAnswerSource).toBe('llm_direct')
    expect(trace.reasoningSummary).toBeDefined()
    expect(trace.reasoningSummary).toContain('LLM selected 0 tool(s) from 0 candidate(s); route: answer_directly')
  })

  it('route is tool_loop when tool calls exist', () => {
    const state = makeState({
      toolCalls: [{ toolCallId: 'call_1', toolName: 'web_search', params: {} }],
    })
    const trace = buildDecisionTrace(state, makeInput())
    expect(trace.route).toBe('tool_loop')
  })

  it('route is failed when state status is failed', () => {
    const state = makeState({ status: 'failed', toolCalls: [] })
    const trace = buildDecisionTrace(state, makeInput())
    expect(trace.route).toBe('failed')
    expect(trace.finalAnswerSource).toBe('error')
  })

  it('finalAnswerSource is tool_synthesized when tools used and finalContent present', () => {
    const state = makeState({
      toolCalls: [{ toolCallId: 'call_1', toolName: 'web_search', params: {} }],
    })
    const trace = buildDecisionTrace(state, makeInput(), 'Here is the answer based on search results')
    expect(trace.finalAnswerSource).toBe('tool_synthesized')
  })

  it('candidateTools comes from input.toolProjection.toolIds', () => {
    const trace = buildDecisionTrace(
      makeState(),
      makeInput({ toolProjection: { toolIds: ['web_search', 'file_read'] } }),
    )
    expect(trace.candidateTools).toEqual(['web_search', 'file_read'])
  })

  it('populates selectedTools from state.toolCalls', () => {
    const state = makeState({
      toolCalls: [
        { toolCallId: 'call_1', toolName: 'web_search', params: {} },
        { toolCallId: 'call_2', toolName: 'file_read', params: {} },
      ],
    })
    const trace = buildDecisionTrace(state, makeInput())
    expect(trace.selectedTools).toHaveLength(2)
    expect(trace.selectedTools[0]).toEqual({
      toolName: 'web_search',
      toolCallId: 'call_1',
      selectionReason: 'llm_choice',
    })
  })

  it('populates rejectedTools as candidate minus selected', () => {
    const state = makeState({
      toolCalls: [{ toolCallId: 'call_1', toolName: 'web_search', params: {} }],
    })
    const trace = buildDecisionTrace(
      state,
      makeInput({ toolProjection: { toolIds: ['web_search', 'file_read', 'file_write'] } }),
    )
    expect(trace.rejectedTools).toHaveLength(2)
    expect(trace.rejectedTools.map((r) => r.toolName).sort()).toEqual(['file_read', 'file_write'])
    expect(trace.rejectedTools.every((r) => r.rejectionReason === 'not_called')).toBe(true)
  })

  it('rejectedTools is empty when all candidates are selected', () => {
    const state = makeState({
      toolCalls: [
        { toolCallId: 'call_1', toolName: 'web_search', params: {} },
        { toolCallId: 'call_2', toolName: 'file_read', params: {} },
      ],
    })
    const trace = buildDecisionTrace(state, makeInput({ toolProjection: { toolIds: ['web_search', 'file_read'] } }))
    expect(trace.rejectedTools).toHaveLength(0)
  })

  it('handles missing toolProjection gracefully', () => {
    const trace = buildDecisionTrace(makeState({ toolCalls: [] }), makeInput({ toolProjection: undefined }))
    expect(trace.candidateTools).toEqual([])
  })

  it('generates observation summaries from transcript tool_result entries', () => {
    const state = makeState({
      toolCalls: [{ toolCallId: 'call_1', toolName: 'web_search', params: {} }],
      transcript: [
        { iteration: 1, timestamp: new Date().toISOString(), type: 'tool_call', content: { toolCallId: 'call_1' } },
        {
          iteration: 1,
          timestamp: new Date().toISOString(),
          type: 'tool_result',
          content: {
            toolCallId: 'call_1',
            result: { extractedFacts: [{ fact: 'TypeScript is great', sourceUrl: 'x', confidence: 0.9 }] },
          },
        },
      ],
    })
    const trace = buildDecisionTrace(state, makeInput())
    expect(trace.observationSummaries).toHaveLength(1)
    expect(trace.observationSummaries[0].summaryType).toBe('search_facts')
  })

  it('generates risk assessments for high-risk tools', () => {
    const state = makeState({
      toolCalls: [
        { toolCallId: 'call_1', toolName: 'file_write', params: {} },
        { toolCallId: 'call_2', toolName: 'web_search', params: {} },
      ],
    })
    const trace = buildDecisionTrace(state, makeInput())
    const highRisk = trace.riskAssessments.filter((r) => r.riskLevel === 'high')
    expect(highRisk).toHaveLength(1)
    expect(highRisk[0].toolName).toBe('file_write')
  })

  it('sets intent from contextBundle agentType', () => {
    const trace = buildDecisionTrace(makeState({ toolCalls: [] }), makeInput())
    expect(trace.intent).toBe('main')
  })

  it('skips transcript entries that are not tool_result', () => {
    const state = makeState({
      toolCalls: [],
      transcript: [
        { iteration: 1, timestamp: '', type: 'llm_request', content: {} },
        { iteration: 1, timestamp: '', type: 'llm_response', content: {} },
      ],
    })
    const trace = buildDecisionTrace(state, makeInput())
    expect(trace.observationSummaries).toHaveLength(0)
  })
})
