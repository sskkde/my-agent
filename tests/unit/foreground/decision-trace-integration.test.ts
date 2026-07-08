import { describe, it, expect } from 'vitest'
import type { KernelRunResult } from '../../../src/kernel/types.js'
import type { StructuredDecisionTrace } from '../../../src/kernel/decision-trace-types.js'
import type { ForegroundTurnResult } from '../../../src/foreground/foreground-runner-types.js'
import type { TurnTranscript } from '../../../src/storage/transcript-store.js'
import { mapKernelResultToTranscript } from '../../../src/foreground/tools/transcript-redaction-mapper.js'
import { mapKernelErrorToForegroundResult } from '../../../src/foreground/kernel-guard-constants.js'

describe('Foreground decision trace integration', () => {
  const sampleTrace: StructuredDecisionTrace = {
    route: 'tool_loop',
    intent: 'search the web',
    candidateTools: ['web_search', 'file_read'],
    selectedTools: [{ toolName: 'web_search', toolCallId: 'call_1', selectionReason: 'llm_choice' }],
    rejectedTools: [{ toolName: 'file_read', selectionReason: 'llm_choice', rejectionReason: 'not_called' }],
    observationSummaries: [{
      toolName: 'web_search', toolCallId: 'call_1',
      summaryType: 'search_facts', summary: 'Found results', evidenceCount: 3,
    }],
    riskAssessments: [],
    finalAnswerSource: 'tool_synthesized',
  }

  it('ForegroundTurnResult carries structuredTrace when present', () => {
    const result: ForegroundTurnResult = {
      status: 'completed',
      finalResponse: 'Here are the results',
      decisionTrace: { route: 'answer_directly', requiresPlanner: false, reason: 'test' },
      kernelResult: { finalStatus: 'completed', iterationsUsed: 1, toolCallCount: 1 },
      structuredTrace: sampleTrace,
    }
    expect(result.structuredTrace).toBeDefined()
    expect(result.structuredTrace?.route).toBe('tool_loop')
    expect(result.structuredTrace?.intent).toBe('search the web')
  })

  it('ForegroundTurnResult carries structuredTrace when status is failed', () => {
    const errorResult: ForegroundTurnResult = mapKernelErrorToForegroundResult({
      finalStatus: 'failed',
      finalResponse: 'Error',
      iterationsUsed: 1,
      toolCalls: [{ toolCallId: 'call_1', toolName: 'web_search', params: {} }],
      transcript: [],
      error: { code: 'LLM_ERROR', message: 'Service unavailable' },
      structuredTrace: sampleTrace,
    })
    expect(errorResult.structuredTrace).toBeDefined()
    expect(errorResult.structuredTrace?.route).toBe('tool_loop')
    expect(errorResult.structuredTrace?.intent).toBe('search the web')
    expect(errorResult.status).toBe('failed')
  })

  it('KernelRunResult carries structuredTrace when present', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'completed',
      finalResponse: 'Answer',
      iterationsUsed: 1,
      toolCalls: [],
      transcript: [],
      structuredTrace: sampleTrace,
    }
    expect(kernelResult.structuredTrace?.route).toBe('tool_loop')
  })

  it('mapKernelResultToTranscript propagates structuredTrace to runtimeSummary', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'completed',
      finalResponse: 'Answer',
      iterationsUsed: 1,
      toolCalls: [{ toolCallId: 'call_1', toolName: 'web_search', params: {} }],
      transcript: [],
      structuredTrace: sampleTrace,
    }
    const runtimeSummary = mapKernelResultToTranscript(kernelResult)
    expect(runtimeSummary?.structuredTrace).toBeDefined()
    expect(runtimeSummary?.structuredTrace?.route).toBe('tool_loop')
    expect(runtimeSummary?.observationSummaries).toBeDefined()
    expect(runtimeSummary?.riskAssessments).toBeDefined()
  })

  it('mapKernelResultToTranscript returns undefined when no tool calls and no trace', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'completed',
      finalResponse: 'Direct answer',
      iterationsUsed: 1,
      toolCalls: [],
      transcript: [],
    }
    const runtimeSummary = mapKernelResultToTranscript(kernelResult)
    expect(runtimeSummary).toBeUndefined()
  })

  it('mapKernelResultToTranscript returns runtimeSummary when no tool calls but structuredTrace exists', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'completed',
      finalResponse: 'Direct answer',
      iterationsUsed: 1,
      toolCalls: [],
      transcript: [],
      structuredTrace: {
        route: 'answer_directly',
        intent: 'greeting',
        candidateTools: [],
        selectedTools: [],
        rejectedTools: [],
        observationSummaries: [],
        riskAssessments: [],
        finalAnswerSource: 'llm_direct',
      },
    }
    const runtimeSummary = mapKernelResultToTranscript(kernelResult)
    expect(runtimeSummary).toBeDefined()
    expect(runtimeSummary?.structuredTrace?.route).toBe('answer_directly')
  })

  it('TurnTranscript.runtimeSummary can carry structuredTrace', () => {
    const transcript: TurnTranscript = {
      turnId: 'turn_1',
      sessionId: 'session_1',
      userId: 'user_1',
      input: {},
      output: { visibleMessages: [] },
      runtimeSummary: {
        toolCallSummaries: [{ toolCallId: 'call_1', toolName: 'web_search', status: 'completed' }],
        structuredTrace: sampleTrace,
        observationSummaries: sampleTrace.observationSummaries,
        riskAssessments: sampleTrace.riskAssessments,
      },
      visibility: 'public',
      createdAt: new Date().toISOString(),
    }
    expect(transcript.runtimeSummary?.structuredTrace?.route).toBe('tool_loop')
    expect(transcript.runtimeSummary?.observationSummaries).toHaveLength(1)
    expect(transcript.runtimeSummary?.riskAssessments).toHaveLength(0)
  })
})
