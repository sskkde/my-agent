# Phase 3 ReAct Trace — Implementation Plan

> **REQUIRED SUB-SKILL**: This plan must be executed using `subagent-driven-development` and `writing-plans`. Each task must follow `test-driven-development`. Before completing, run `verification-before-completion`.

**Goal**: Build Phase 3 structured decision trace with tool selection tracking, observation summaries, and risk assessments.

**Architecture**: New `StructuredDecisionTrace` type coexisting with deprecated `ForegroundDecision`, observation summary generators per tool category, trace collection in `AgentKernel.run()` loop, trace integration in `ForegroundAgent` and transcript store.

**Tech Stack**: TypeScript, ESM, Vitest, existing `AgentKernel`, existing `ForegroundAgent`, no new dependency.

---

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-07-agent-architecture-optimization-design.md`.
- Scope limited to Phase 3: structured decision trace, tool selection/rejection reason, observation summary, foreground real decision trace.
- Do NOT implement Phase 4 golden dataset or prompt regression runner.
- Do NOT delete `ForegroundDecision` type (keep deprecated coexistence).
- Do NOT save full raw Chain of Thought.
- Do NOT change API route contracts.
- TypeScript strict mode with `noUnusedLocals` and `noUnusedParameters`.
- Use TDD for all production code: write failing test → run → implement → rerun → commit.
- All new files must export types/functions properly for tree-shaking ESM.

---

## File Structure

```
src/kernel/
  decision-trace-types.ts          # NEW — StructuredDecisionTrace + related types
  observation-summary-builder.ts   # NEW — buildObservationSummary()
  decision-trace-builder.ts        # NEW — buildDecisionTrace()
  types.ts                         # MODIFY — add structuredTrace to KernelRunResult
  agent-kernel.ts                  # MODIFY — call buildDecisionTrace in buildResult

src/foreground/
  foreground-runner-types.ts       # MODIFY — add structuredTrace to ForegroundTurnResult
  foreground-agent.ts              # MODIFY — extract structuredTrace from kernelResult
  tools/transcript-redaction-mapper.ts  # MODIFY — pass structuredTrace to runtimeSummary

src/storage/
  transcript-store.ts              # MODIFY — extend runtimeSummary type

tests/unit/kernel/
  decision-trace-types.test.ts     # NEW — type-level tests
  observation-summary-builder.test.ts  # NEW
  decision-trace-builder.test.ts   # NEW

tests/unit/foreground/
  decision-trace-integration.test.ts  # NEW

tests/architecture/
  no-legacy-prompt-path.test.ts    # MODIFY — add Phase 3 guards
```

---

## Task 1: Define Decision Trace Types + Observation Summary Builder

**Commit message**: `feat(kernel): add decision trace types and observation summaries`

### Step 1.1: Write failing type-level tests

Create `tests/unit/kernel/decision-trace-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type {
  StructuredDecisionTrace,
  DecisionRoute,
  ToolSelectionRecord,
  ObservationSummary,
  RiskAssessmentRecord,
} from '../../../src/kernel/decision-trace-types.js'

describe('StructuredDecisionTrace types', () => {
  it('DecisionRoute accepts answer_directly, tool_loop, and failed', () => {
    const routes: DecisionRoute[] = ['answer_directly', 'tool_loop', 'failed']
    expect(routes).toHaveLength(3)
  })

  it('ToolSelectionRecord has required fields', () => {
    const record: ToolSelectionRecord = {
      toolName: 'web_search',
      toolCallId: 'call_123',
      selectionReason: 'llm_choice',
    }
    expect(record.toolName).toBe('web_search')
    expect(record.selectionReason).toBe('llm_choice')
  })

  it('ToolSelectionRecord accepts rejectionReason', () => {
    const record: ToolSelectionRecord = {
      toolName: 'file_write',
      selectionReason: 'llm_choice',
      rejectionReason: 'permission_denied',
    }
    expect(record.rejectionReason).toBe('permission_denied')
  })

  it('ObservationSummary has required fields', () => {
    const summary: ObservationSummary = {
      toolName: 'web_search',
      toolCallId: 'call_456',
      summaryType: 'search_facts',
      summary: 'Found 3 results about TypeScript',
    }
    expect(summary.summaryType).toBe('search_facts')
    expect(summary.evidenceCount).toBeUndefined()
  })

  it('ObservationSummary accepts optional evidenceCount', () => {
    const summary: ObservationSummary = {
      toolName: 'web_search',
      toolCallId: 'call_456',
      summaryType: 'search_facts',
      summary: 'Found 3 results',
      evidenceCount: 3,
    }
    expect(summary.evidenceCount).toBe(3)
  })

  it('RiskAssessmentRecord has all required fields', () => {
    const record: RiskAssessmentRecord = {
      toolName: 'file_write',
      toolCallId: 'call_789',
      riskLevel: 'high',
      riskReason: 'Write operations modify files on disk',
      approvalStatus: 'auto_approved',
    }
    expect(record.riskLevel).toBe('high')
    expect(record.denialReason).toBeUndefined()
  })

  it('RiskAssessmentRecord accepts denialReason', () => {
    const record: RiskAssessmentRecord = {
      toolName: 'file_delete',
      toolCallId: 'call_999',
      riskLevel: 'high',
      riskReason: 'Delete operations remove files',
      approvalStatus: 'denied',
      denialReason: 'User rejected the operation',
    }
    expect(record.denialReason).toBe('User rejected the operation')
  })

  it('StructuredDecisionTrace has all fields', () => {
    const trace: StructuredDecisionTrace = {
      route: 'tool_loop',
      intent: 'search the web for latest news',
      candidateTools: ['web_search', 'file_read'],
      selectedTools: [],
      rejectedTools: [],
      observationSummaries: [],
      riskAssessments: [],
      finalAnswerSource: 'llm_direct',
    }
    expect(trace.route).toBe('tool_loop')
    expect(trace.finalAnswerSource).toBe('llm_direct')
    expect(trace.reasoningSummary).toBeUndefined()
  })

  it('StructuredDecisionTrace accepts optional reasoningSummary', () => {
    const trace: StructuredDecisionTrace = {
      route: 'answer_directly',
      intent: 'greeting',
      candidateTools: [],
      selectedTools: [],
      rejectedTools: [],
      observationSummaries: [],
      riskAssessments: [],
      finalAnswerSource: 'llm_direct',
      reasoningSummary: 'Simple greeting, no tools needed',
    }
    expect(trace.reasoningSummary).toBe('Simple greeting, no tools needed')
  })

  it('all selectionReason values are valid', () => {
    const reasons: ToolSelectionRecord['selectionReason'][] = ['llm_choice', 'internal_handler', 'auto_approved']
    expect(reasons).toHaveLength(3)
  })

  it('all rejectionReason values are valid', () => {
    const reasons: ToolSelectionRecord['rejectionReason'][] = ['not_called', 'permission_denied', 'unprojected']
    expect(reasons).toHaveLength(3)
  })

  it('all approvalStatus values are valid', () => {
    const statuses: RiskAssessmentRecord['approvalStatus'][] = [
      'auto_approved', 'pending', 'approved', 'denied', 'not_required',
    ]
    expect(statuses).toHaveLength(5)
  })

  it('all summaryType values are valid', () => {
    const types: ObservationSummary['summaryType'][] = ['search_facts', 'file_preview', 'memory_keywords', 'generic']
    expect(types).toHaveLength(4)
  })
})
```

### Step 1.2: Run — test fails (module not found)

```bash
npm test -- tests/unit/kernel/decision-trace-types.test.ts
```

### Step 1.3: Implement types

Create `src/kernel/decision-trace-types.ts`:

```typescript
export type DecisionRoute = 'answer_directly' | 'tool_loop' | 'failed'

export interface ToolSelectionRecord {
  toolName: string
  toolCallId?: string
  selectionReason: 'llm_choice' | 'internal_handler' | 'auto_approved'
  rejectionReason?: 'not_called' | 'permission_denied' | 'unprojected'
}

export interface ObservationSummary {
  toolName: string
  toolCallId: string
  summaryType: 'search_facts' | 'file_preview' | 'memory_keywords' | 'generic'
  summary: string
  evidenceCount?: number
}

export interface RiskAssessmentRecord {
  toolName: string
  toolCallId: string
  riskLevel: 'high' | 'medium' | 'low'
  riskReason: string
  approvalStatus: 'auto_approved' | 'pending' | 'approved' | 'denied' | 'not_required'
  denialReason?: string
}

export interface StructuredDecisionTrace {
  route: DecisionRoute
  intent: string
  candidateTools: string[]
  selectedTools: ToolSelectionRecord[]
  rejectedTools: ToolSelectionRecord[]
  observationSummaries: ObservationSummary[]
  riskAssessments: RiskAssessmentRecord[]
  finalAnswerSource: 'llm_direct' | 'tool_synthesized' | 'error'
  reasoningSummary?: string
}
```

### Step 1.4: Rerun tests — passes

```bash
npm test -- tests/unit/kernel/decision-trace-types.test.ts
```

### Step 1.5: Write failing tests for observation summary builder

Create `tests/unit/kernel/observation-summary-builder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildObservationSummary } from '../../../src/kernel/observation-summary-builder.js'
import type { ToolUseResult } from '../../../src/kernel/types.js'

function makeResult(overrides: Partial<ToolUseResult> & { result?: unknown }): ToolUseResult {
  return {
    toolCallId: 'call_1',
    result: null,
    ...overrides,
  }
}

describe('buildObservationSummary', () => {
  describe('search_subagent → search_facts', () => {
    it('extracts top-3 facts from search_subagent result', () => {
      const result = makeResult({
        toolCallId: 'call_search',
        result: {
          extractedFacts: [
            { fact: 'TypeScript is a typed superset of JavaScript', sourceUrl: 'https://ts.dev', confidence: 0.95 },
            { fact: 'TypeScript 5.0 introduced decorators', sourceUrl: 'https://ts.dev/5.0', confidence: 0.9 },
            { fact: 'TypeScript compiles to plain JavaScript', sourceUrl: 'https://ts.dev', confidence: 0.85 },
            { fact: 'TypeScript supports generics', sourceUrl: 'https://ts.dev/generics', confidence: 0.8 },
          ],
        },
      })
      const summary = buildObservationSummary('search_subagent', result)
      expect(summary.summaryType).toBe('search_facts')
      expect(summary.summary).toContain('TypeScript is a typed superset')
      expect(summary.summary).toContain('TypeScript 5.0 introduced decorators')
      expect(summary.summary).toContain('TypeScript compiles')
      expect(summary.evidenceCount).toBe(4)
    })

    it('handles search_subagent with no facts', () => {
      const result = makeResult({
        toolCallId: 'call_empty',
        result: { extractedFacts: [] },
      })
      const summary = buildObservationSummary('search_subagent', result)
      expect(summary.summaryType).toBe('search_facts')
      expect(summary.summary).toBe('No facts extracted')
      expect(summary.evidenceCount).toBe(0)
    })

    it('handles search_subagent with error', () => {
      const result = makeResult({
        toolCallId: 'call_err',
        result: null,
        error: { code: 'SEARCH_FAILED', message: 'API error', recoverable: true },
      })
      const summary = buildObservationSummary('search_subagent', result)
      expect(summary.summaryType).toBe('search_facts')
      expect(summary.summary).toContain('Search failed')
      expect(summary.evidenceCount).toBeUndefined()
    })
  })

  describe('web_search → search_facts', () => {
    it('extracts facts from web_search result', () => {
      const result = makeResult({
        toolCallId: 'call_web',
        result: {
          extractedFacts: [
            { fact: 'TypeScript 5.5 released', sourceUrl: 'https://ts.dev', confidence: 0.9 },
            { fact: 'New type narrowing features', sourceUrl: 'https://ts.dev', confidence: 0.85 },
          ],
        },
      })
      const summary = buildObservationSummary('web_search', result)
      expect(summary.summaryType).toBe('search_facts')
      expect(summary.summary).toContain('TypeScript 5.5 released')
      expect(summary.evidenceCount).toBe(2)
    })
  })

  describe('file_read → file_preview', () => {
    it('includes first 200 chars and line/char count', () => {
      const content = 'a'.repeat(500)
      const result = makeResult({
        toolCallId: 'call_read',
        result: { content, path: '/test.txt' },
      })
      const summary = buildObservationSummary('file_read', result)
      expect(summary.summaryType).toBe('file_preview')
      expect(summary.summary).toContain('a'.repeat(200))
      expect(summary.summary).toContain('(500 chars)')
    })

    it('handles short content without trimming', () => {
      const result = makeResult({
        toolCallId: 'call_read_short',
        result: { content: 'Hello world', path: '/test.txt' },
      })
      const summary = buildObservationSummary('file_read', result)
      expect(summary.summary).toBe('Hello world (11 chars)')
    })

    it('handles file_read error', () => {
      const result = makeResult({
        toolCallId: 'call_read_err',
        result: null,
        error: { code: 'FILE_NOT_FOUND', message: '/test.txt not found', recoverable: false },
      })
      const summary = buildObservationSummary('file_read', result)
      expect(summary.summaryType).toBe('file_preview')
      expect(summary.summary).toContain('Read failed')
    })
  })

  describe('file_glob → file_preview', () => {
    it('lists matched files with count', () => {
      const result = makeResult({
        toolCallId: 'call_glob',
        result: { files: ['src/a.ts', 'src/b.ts', 'src/c.ts'] },
      })
      const summary = buildObservationSummary('file_glob', result)
      expect(summary.summaryType).toBe('file_preview')
      expect(summary.summary).toContain('3')
      expect(summary.summary).toContain('src/a.ts')
      expect(summary.evidenceCount).toBe(3)
    })
  })

  describe('memory_retrieve → memory_keywords', () => {
    it('includes count and top-3 keywords', () => {
      const result = makeResult({
        toolCallId: 'call_mem',
        result: {
          entries: [
            { id: '1', keyword: 'typescript', content: '...' },
            { id: '2', keyword: 'react', content: '...' },
            { id: '3', keyword: 'testing', content: '...' },
            { id: '4', keyword: 'decorators', content: '...' },
          ],
          keywords: ['typescript', 'react', 'testing', 'decorators'],
        },
      })
      const summary = buildObservationSummary('memory_retrieve', result)
      expect(summary.summaryType).toBe('memory_keywords')
      expect(summary.summary).toContain('4')
      expect(summary.summary).toContain('typescript')
      expect(summary.summary).toContain('react')
      expect(summary.summary).toContain('testing')
      expect(summary.evidenceCount).toBe(4)
    })

    it('handles memory_retrieve with fewer than 3 keywords', () => {
      const result = makeResult({
        toolCallId: 'call_mem2',
        result: {
          entries: [{ id: '1', keyword: 'hello', content: '...' }],
          keywords: ['hello'],
        },
      })
      const summary = buildObservationSummary('memory_retrieve', result)
      expect(summary.summary).toContain('1')
      expect(summary.summary).toContain('hello')
    })
  })

  describe('generic fallback', () => {
    it('truncates result to 500 chars', () => {
      const result = makeResult({
        toolCallId: 'call_generic',
        result: { data: 'x'.repeat(1000) },
      })
      const summary = buildObservationSummary('other_tool', result)
      expect(summary.summaryType).toBe('generic')
      expect(summary.summary.length).toBeLessThanOrEqual(500)
      expect(summary.summary).toContain('...[truncated]')
    })

    it('short result is not truncated', () => {
      const result = makeResult({
        toolCallId: 'call_short',
        result: { data: 'short result' },
      })
      const summary = buildObservationSummary('other_tool', result)
      expect(summary.summary).toBe(JSON.stringify({ data: 'short result' }))
    })

    it('handles error in generic tool', () => {
      const result = makeResult({
        toolCallId: 'call_err',
        result: null,
        error: { code: 'ERR', message: 'Something broke', recoverable: true },
      })
      const summary = buildObservationSummary('other_tool', result)
      expect(summary.summaryType).toBe('generic')
      expect(summary.summary).toContain('failed')
    })
  })
})
```

### Step 1.6: Run — test fails

```bash
npm test -- tests/unit/kernel/observation-summary-builder.test.ts
```

### Step 1.7: Implement observation summary builder

Create `src/kernel/observation-summary-builder.ts`:

```typescript
import type { ToolUseResult } from './types.js'
import type { ObservationSummary } from './decision-trace-types.js'

function extractSearchFacts(toolName: string, toolCallId: string, result: ToolUseResult): ObservationSummary {
  if (result.error) {
    return { toolName, toolCallId, summaryType: 'search_facts', summary: `Search failed: ${result.error.message}` }
  }
  const data = result.result as Record<string, unknown> | null | undefined
  const facts = data?.extractedFacts as Array<{ fact: string }> | undefined
  if (!facts || facts.length === 0) {
    return { toolName, toolCallId, summaryType: 'search_facts', summary: 'No facts extracted', evidenceCount: 0 }
  }
  const topFacts = facts.slice(0, 3).map((f) => f.fact).join('; ')
  return { toolName, toolCallId, summaryType: 'search_facts', summary: topFacts, evidenceCount: facts.length }
}

function extractFilePreview(toolName: string, toolCallId: string, result: ToolUseResult): ObservationSummary {
  if (result.error) {
    return { toolName, toolCallId, summaryType: 'file_preview', summary: `Read failed: ${result.error.message}` }
  }
  const data = result.result as Record<string, unknown> | null | undefined

  if (toolName === 'file_glob') {
    const files = data?.files as string[] | undefined
    if (!files || files.length === 0) {
      return { toolName, toolCallId, summaryType: 'file_preview', summary: 'No files matched', evidenceCount: 0 }
    }
    const preview = files.length <= 3 ? files.join(', ') : `${files.slice(0, 3).join(', ')}, ...`
    return { toolName, toolCallId, summaryType: 'file_preview', summary: `${files.length} files: ${preview}`, evidenceCount: files.length }
  }

  const content = data?.content as string | undefined
  if (content !== undefined) {
    const preview = content.length > 200 ? content.slice(0, 200) : content
    return { toolName, toolCallId, summaryType: 'file_preview', summary: `${preview} (${content.length} chars)`, evidenceCount: 1 }
  }
  return { toolName, toolCallId, summaryType: 'file_preview', summary: 'No content available', evidenceCount: 0 }
}

function extractMemoryKeywords(toolName: string, toolCallId: string, result: ToolUseResult): ObservationSummary {
  const data = result.result as Record<string, unknown> | null | undefined
  const entries = data?.entries as Array<{ keyword: string }> | undefined
  const keywords = data?.keywords as string[] | undefined
  const count = entries?.length ?? 0
  const topKeywords = (keywords ?? entries?.map((e) => e.keyword) ?? []).slice(0, 3)
  return {
    toolName, toolCallId, summaryType: 'memory_keywords',
    summary: `${count} memories; keywords: ${topKeywords.join(', ')}`, evidenceCount: count,
  }
}

function extractGeneric(toolName: string, toolCallId: string, result: ToolUseResult): ObservationSummary {
  if (result.error) {
    return { toolName, toolCallId, summaryType: 'generic', summary: `Tool failed: ${result.error.message}` }
  }
  const serialized = JSON.stringify(result.result)
  const summary = serialized.length > 500 ? serialized.slice(0, 497) + '...[truncated]' : serialized
  return { toolName, toolCallId, summaryType: 'generic', summary }
}

export function buildObservationSummary(toolName: string, toolResult: ToolUseResult): ObservationSummary {
  const { toolCallId } = toolResult
  switch (toolName) {
    case 'search_subagent':
    case 'web_search':
      return extractSearchFacts(toolName, toolCallId, toolResult)
    case 'file_read':
    case 'file_glob':
      return extractFilePreview(toolName, toolCallId, toolResult)
    case 'memory_retrieve':
      return extractMemoryKeywords(toolName, toolCallId, toolResult)
    default:
      return extractGeneric(toolName, toolCallId, toolResult)
  }
}
```

### Step 1.8: Rerun tests — passes

```bash
npm test -- tests/unit/kernel/decision-trace-types.test.ts tests/unit/kernel/observation-summary-builder.test.ts
```

### Step 1.9: Commit

```bash
git add src/kernel/decision-trace-types.ts src/kernel/observation-summary-builder.ts tests/unit/kernel/decision-trace-types.test.ts tests/unit/kernel/observation-summary-builder.test.ts
git commit -m "feat(kernel): add decision trace types and observation summaries"
```

---

## Task 2: Build Decision Trace Builder + Wire into AgentKernel

**Commit message**: `feat(kernel): collect structured decision trace in agent kernel`

### Step 2.1: Write failing tests for decision trace builder

Create `tests/unit/kernel/decision-trace-builder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildDecisionTrace } from '../../../src/kernel/decision-trace-builder.js'
import type { KernelRunState, KernelRunInput } from '../../../src/kernel/types.js'

function makeInput(overrides?: Partial<KernelRunInput>): KernelRunInput {
  return {
    contextBundle: { items: [], agentType: 'main', runId: 'test-run' } as any,
    runId: 'test-run', agentId: 'test-agent', agentType: 'main', userId: 'test-user',
    toolProjection: { toolIds: ['web_search', 'file_read', 'file_write'] },
    ...overrides,
  }
}

function makeState(overrides?: Partial<KernelRunState>): KernelRunState {
  return {
    currentIteration: 1, status: 'completed', contextItems: [], startTime: Date.now(),
    toolCalls: [], transcript: [], compactedItemIds: new Set(),
    compactedToolCallIds: new Set(), lastCompactSummaryItem: undefined,
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
    const trace = buildDecisionTrace(makeState(), makeInput({ toolProjection: { toolIds: ['web_search', 'file_read'] } }))
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
    expect(trace.selectedTools[0]).toEqual({ toolName: 'web_search', toolCallId: 'call_1', selectionReason: 'llm_choice' })
  })

  it('populates rejectedTools as candidate minus selected', () => {
    const state = makeState({
      toolCalls: [{ toolCallId: 'call_1', toolName: 'web_search', params: {} }],
    })
    const trace = buildDecisionTrace(state, makeInput({ toolProjection: { toolIds: ['web_search', 'file_read', 'file_write'] } }))
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
        { iteration: 1, timestamp: new Date().toISOString(), type: 'tool_result', content: { toolCallId: 'call_1', result: { extractedFacts: [{ fact: 'TypeScript is great', sourceUrl: 'x', confidence: 0.9 }] } } },
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
```

### Step 2.2: Run — test fails

```bash
npm test -- tests/unit/kernel/decision-trace-builder.test.ts
```

### Step 2.3: Implement decision trace builder

Create `src/kernel/decision-trace-builder.ts`:

```typescript
import type { KernelRunState, KernelRunInput, KernelTranscriptEntry, ToolUseResult } from './types.js'
import type { StructuredDecisionTrace, ToolSelectionRecord, RiskAssessmentRecord } from './decision-trace-types.js'
import { buildObservationSummary } from './observation-summary-builder.js'

function isHighRiskTool(toolName: string): boolean {
  const highRiskPrefixes = ['write', 'delete', 'send', 'execute', 'admin']
  return highRiskPrefixes.some((prefix) => toolName.startsWith(prefix) || toolName.includes(prefix))
}

function buildRiskAssessment(toolName: string, toolCallId: string): RiskAssessmentRecord {
  return { toolName, toolCallId, riskLevel: 'high', riskReason: `${toolName} belongs to a high-risk tool category`, approvalStatus: 'not_required' }
}

function isToolResultEntry(entry: KernelTranscriptEntry): entry is KernelTranscriptEntry & { content: ToolUseResult } {
  return entry.type === 'tool_result' && typeof entry.content === 'object' && entry.content !== null
}

export function buildDecisionTrace(
  state: KernelRunState,
  input: KernelRunInput,
  finalContent?: string,
): StructuredDecisionTrace {
  const candidateTools = input.toolProjection?.toolIds ?? []

  const selectedTools: ToolSelectionRecord[] = state.toolCalls.map((tc) => ({
    toolName: tc.toolName,
    toolCallId: tc.toolCallId,
    selectionReason: 'llm_choice' as const,
  }))

  const selectedNames = new Set(selectedTools.map((s) => s.toolName))
  const rejectedTools: ToolSelectionRecord[] = candidateTools
    .filter((name) => !selectedNames.has(name))
    .map((name) => ({ toolName: name, selectionReason: 'llm_choice' as const, rejectionReason: 'not_called' as const }))

  const observationSummaries = state.transcript
    .filter(isToolResultEntry)
    .map((entry) => {
      const tc = state.toolCalls.find((t) => t.toolCallId === (entry.content as ToolUseResult).toolCallId)
      return buildObservationSummary(tc?.toolName ?? 'unknown', entry.content as ToolUseResult)
    })

  const riskAssessments: RiskAssessmentRecord[] = selectedTools
    .filter((st) => st.toolCallId && isHighRiskTool(st.toolName))
    .map((st) => buildRiskAssessment(st.toolName, st.toolCallId!))

  const hasToolCalls = state.toolCalls.length > 0
  const route = hasToolCalls ? 'tool_loop' : state.status === 'failed' ? 'failed' : 'answer_directly'
  const finalAnswerSource = hasToolCalls && finalContent ? 'tool_synthesized' : state.status === 'failed' ? 'error' : 'llm_direct'
  const intent = (input.contextBundle?.agentType as string) ?? 'unknown'

  return { route, intent, candidateTools, selectedTools, rejectedTools, observationSummaries, riskAssessments, finalAnswerSource }
}
```

### Step 2.4: Modify types.ts — add structuredTrace to KernelRunResult

In `src/kernel/types.ts`:
- Add import: `import type { StructuredDecisionTrace } from './decision-trace-types.js'`
- Inside `KernelRunResult` interface, add field: `structuredTrace?: StructuredDecisionTrace`

### Step 2.5: Modify agent-kernel.ts — wire buildDecisionTrace into buildResult

**Changes to make:**

1. Add import at top:
```typescript
import { buildDecisionTrace } from './decision-trace-builder.js'
```

2. Add `input` parameter to `buildResult` method (change signature to accept `input: KernelRunInput`):

```typescript
  private buildResult(
    state: KernelRunState,
    finalStatus: KernelRunResult['finalStatus'],
    error?: { code: string; message: string },
    finalResponse?: string,
    structuredResult?: unknown,
    input?: KernelRunInput,
  ): KernelRunResult {
    const result: KernelRunResult = {
      finalStatus,
      finalResponse,
      iterationsUsed: state.currentIteration,
      toolCalls: state.toolCalls,
      transcript: state.transcript,
      error,
      ...(structuredResult !== undefined ? { structuredResult } : {}),
    }

    if (input) {
      result.structuredTrace = buildDecisionTrace(state, input, result.finalResponse)
    }

    return result
  }
```

3. Update all 9 call sites of `this.buildResult(...)` to pass `input` as the last argument. The 9 call sites are:

```
Line ~66:   return this.buildResult(state, 'timeout')                      → this.buildResult(state, 'timeout', undefined, undefined, undefined, input)
Line ~78:   return this.buildResult(state, 'timeout')                      → this.buildResult(state, 'timeout', undefined, undefined, undefined, input)
Line ~108:  return this.buildResult(state, 'completed', undefined, '')    → this.buildResult(state, 'completed', undefined, '', undefined, input)
Line ~123:  return this.buildResult(state, 'failed', { ... })             → this.buildResult(state, 'failed', { ... }, undefined, undefined, input)
Line ~206:  return this.buildResult(state, 'completed', undefined, undefined, stopStructuredResult)  → + input
Line ~246:  return this.buildResult(state, 'failed', { ... })             → + input
Line ~253:  return this.buildResult(state, 'completed', undefined, llmResponse.content, ...)  → + input
Line ~265:  return this.buildResult(state, 'max_iterations_reached')      → + input
Line ~272:  return this.buildResult(state, 'failed', { ... })             → + input
```

### Step 2.6: Rerun tests — passes

```bash
npm test -- tests/unit/kernel/decision-trace-builder.test.ts
npm test -- tests/unit/kernel/decision-trace-types.test.ts tests/unit/kernel/observation-summary-builder.test.ts tests/unit/kernel/decision-trace-builder.test.ts
```

### Step 2.7: Run full test suite to verify no regressions

```bash
npm test
```

### Step 2.8: Commit

```bash
git add src/kernel/decision-trace-builder.ts src/kernel/types.ts src/kernel/agent-kernel.ts tests/unit/kernel/decision-trace-builder.test.ts
git commit -m "feat(kernel): collect structured decision trace"
```

---

## Task 3: Integrate Trace into ForegroundAgent + Transcript Store

**Commit message**: `feat(foreground): integrate structured decision trace`

### Step 3.1: Write integration tests

Create `tests/unit/foreground/decision-trace-integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { KernelRunResult } from '../../../src/kernel/types.js'
import type { StructuredDecisionTrace } from '../../../src/kernel/decision-trace-types.js'
import type { ForegroundTurnResult } from '../../../src/foreground/foreground-runner-types.js'
import type { TurnTranscript } from '../../../src/storage/transcript-store.js'
import { mapKernelResultToTranscript } from '../../../src/foreground/tools/transcript-redaction-mapper.js'

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
    }
    // structuredTrace is optional — test the type compiles
    expect(result.status).toBe('completed')
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
    // Without toolCalls, existing behavior returns undefined.
    // The spec says this should still return runtimeSummary if structuredTrace exists.
    // So we need the mapper to check both conditions.
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
```

### Step 3.2: Run — test fails

```bash
npm test -- tests/unit/foreground/decision-trace-integration.test.ts
```

### Step 3.3: Modify ForegroundTurnResult — add structuredTrace

In `src/foreground/foreground-runner-types.ts`, add to `ForegroundTurnResult`:

```typescript
  /** Structured decision trace for this turn. */
  structuredTrace?: StructuredDecisionTrace
```

Add import:
```typescript
import type { StructuredDecisionTrace } from '../kernel/decision-trace-types.js'
```

### Step 3.4: Modify ForegroundAgent — extract structuredTrace from kernelResult

In `src/foreground/foreground-agent.ts`, modify `mapKernelResultToForegroundResult`:

In the `completed` branch (line ~139), add `structuredTrace` to the return object:
```typescript
  if (kernelResult.finalStatus === 'completed') {
    return {
      status: 'completed',
      finalResponse: kernelResult.finalResponse ?? '',
      decisionTrace: {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Kernel execution completed',
      },
      structuredTrace: kernelResult.structuredTrace,
      runtimeSummary: mapKernelResultToTranscript(kernelResult) ?? undefined,
      ...
    }
  }
```

In the `mapKernelErrorToForegroundResult` call (line ~158), the error path also needs `structuredTrace`. That function is in `kernel-guard-constants.ts` — add `structuredTrace` there too:

```typescript
  return {
    status: 'failed',
    finalResponse: userMessage,
    decisionTrace: { ... },
    structuredTrace: kernelResult.structuredTrace,
    runtimeSummary: { ... },
    ...
  }
```

### Step 3.5: Modify transcript-store.ts — extend runtimeSummary type

In `src/storage/transcript-store.ts`, extend `TurnTranscript.runtimeSummary`:

```typescript
import type { StructuredDecisionTrace, ObservationSummary, RiskAssessmentRecord } from '../kernel/decision-trace-types.js'

// Inside runtimeSummary type:
  runtimeSummary?: {
    foregroundDecisionId?: string
    plannerRunIds?: string[]
    runtimeActionIds?: string[]
    toolCallSummaries?: ToolCallSummary[]
    approvalSummaries?: string[]
    /** @since Phase 3 */
    structuredTrace?: StructuredDecisionTrace
    /** @since Phase 3 */
    observationSummaries?: ObservationSummary[]
    /** @since Phase 3 */
    riskAssessments?: RiskAssessmentRecord[]
  }
```

### Step 3.6: Modify transcript-redaction-mapper — pass structuredTrace

In `src/foreground/tools/transcript-redaction-mapper.ts`, modify `mapKernelResultToTranscript`:

Change the early return condition and extend the returned object:

```typescript
export function mapKernelResultToTranscript(
  kernelResult?: KernelRunResult,
): TurnTranscript['runtimeSummary'] | undefined {
  if (!kernelResult) return undefined

  const hasToolCalls = kernelResult.toolCalls && kernelResult.toolCalls.length > 0
  const hasStructuredTrace = kernelResult.structuredTrace !== undefined

  if (!hasToolCalls && !hasStructuredTrace) {
    return undefined
  }

  const toolCallSummaries: ToolCallSummary[] | undefined = hasToolCalls
    ? kernelResult.toolCalls.map((toolCall) => ({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        status: mapKernelStatusToToolCallStatus(kernelResult.finalStatus),
        summary: `Tool: ${toolCall.toolName}`,
      }))
    : undefined

  const runtimeSummary: TurnTranscript['runtimeSummary'] = {}

  if (toolCallSummaries) {
    runtimeSummary.toolCallSummaries = toolCallSummaries
  }

  if (hasStructuredTrace) {
    runtimeSummary.structuredTrace = kernelResult.structuredTrace
    runtimeSummary.observationSummaries = kernelResult.structuredTrace.observationSummaries
    runtimeSummary.riskAssessments = kernelResult.structuredTrace.riskAssessments
  }

  return runtimeSummary
}
```

### Step 3.7: Rerun tests — passes

```bash
npm test -- tests/unit/foreground/decision-trace-integration.test.ts
npm test
```

### Step 3.8: Commit

```bash
git add src/foreground/foreground-runner-types.ts src/foreground/foreground-agent.ts src/foreground/tools/transcript-redaction-mapper.ts src/foreground/kernel-guard-constants.ts src/storage/transcript-store.ts tests/unit/foreground/decision-trace-integration.test.ts
git commit -m "feat(foreground): integrate structured decision trace"
```

---

## Task 4: Architecture Guards + Final Verification

**Commit message**: `test(architecture): guard phase3 react trace`

### Step 4.1: Add Phase 3 guards to existing architecture test

In `tests/architecture/no-legacy-prompt-path.test.ts`, add a new describe block at the end (before the closing of the outer describe):

```typescript
describe('Phase 3 ReAct Trace Guards', () => {
  const srcDir = join(process.cwd(), 'src')

  it('decision-trace-types.ts exists with StructuredDecisionTrace', () => {
    const filePath = join(srcDir, 'kernel', 'decision-trace-types.ts')
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('StructuredDecisionTrace')
    expect(content).toContain('ToolSelectionRecord')
    expect(content).toContain('ObservationSummary')
    expect(content).toContain('RiskAssessmentRecord')
  })

  it('observation-summary-builder.ts exists with buildObservationSummary', () => {
    const filePath = join(srcDir, 'kernel', 'observation-summary-builder.ts')
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('buildObservationSummary')
  })

  it('decision-trace-builder.ts exists with buildDecisionTrace', () => {
    const filePath = join(srcDir, 'kernel', 'decision-trace-builder.ts')
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('buildDecisionTrace')
  })

  it('agent-kernel.ts contains structuredTrace', () => {
    const filePath = join(srcDir, 'kernel', 'agent-kernel.ts')
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('structuredTrace')
  })

  it('foreground-agent.ts contains structuredTrace', () => {
    const filePath = join(srcDir, 'foreground', 'foreground-agent.ts')
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('structuredTrace')
  })

  it('transcript-store.ts runtimeSummary contains structuredTrace', () => {
    const filePath = join(srcDir, 'storage', 'transcript-store.ts')
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('structuredTrace')
    expect(content).toContain('observationSummaries')
    expect(content).toContain('riskAssessments')
  })

  it('ForegroundDecision is NOT deleted (deprecated coexistence)', () => {
    const filePath = join(srcDir, 'foreground', 'types.ts')
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('ForegroundDecision')
    expect(content).toContain('@deprecated')
  })
})
```

### Step 4.2: Run architecture tests

```bash
npm test -- tests/architecture/no-legacy-prompt-path.test.ts
```

### Step 4.3: Final verification

Run all Phase 3 tests:
```bash
npm test -- tests/unit/kernel/decision-trace-types.test.ts tests/unit/kernel/observation-summary-builder.test.ts tests/unit/kernel/decision-trace-builder.test.ts tests/unit/foreground/decision-trace-integration.test.ts
```

Run typecheck:
```bash
npm run typecheck
```

Run full test suite:
```bash
npm test
```

Check for any trailing whitespace or merge conflicts:
```bash
git diff --check
```

### Step 4.4: Commit

```bash
git add tests/architecture/no-legacy-prompt-path.test.ts
git commit -m "test(architecture): guard phase3 react trace"
```
