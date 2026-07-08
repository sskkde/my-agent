# Agent Architecture Phase 4 Prompt Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 4 prompt evaluation framework with golden dataset, regression runner, diff report, and candidate workflow.

**Architecture:** Golden cases as TypeScript files, regression runner integrated into Vitest, diff report comparing baseline vs current, candidate workflow with template overrides. Uses existing `ModelInputBuilder`, `PromptTemplateRegistry`, `TemplateLoader`, `OutputContractValidator`, and feature flag system.

**Tech Stack:** TypeScript, ESM, Vitest, existing `ModelInputBuilder` (src/kernel/model-input/model-input-builder.ts), existing `PromptTemplateRegistry` (src/prompt/prompt-template-registry.ts), existing `TemplateLoader` (src/prompt/template-loader.ts), existing `ToolDefinition` (src/llm/types.ts), existing `ContextBundle` (src/context/types.ts), existing `ModelInputMode`/`ModelInputSegmentHashes` (src/kernel/model-input/model-input-types.ts), existing `validateOutputContractContent` (src/contracts/output-contract-validator.ts), existing feature flags (src/prompt/feature-flags.ts), no new dependency.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-08-agent-architecture-phase4-prompt-evaluation-design.md`.
- Scope is Phase 4 only: golden dataset, regression runner, diff report, candidate workflow framework.
- Do not implement APE/DSPy automatic optimization algorithms.
- Do not automatically write to production prompt templates.
- Do not introduce LLM-specific tokenizer dependency (continue using char/4 estimation).
- Do not change API route contracts.
- Do not introduce Ajv or other schema validation dependency.
- Do not modify existing prompt template content.
- TypeScript strict mode with `noUnusedLocals` and `noUnusedParameters`.
- Use TDD for production code changes: write failing test, run it, implement minimal code, rerun.

## File Structure

### Create: `src/golden/golden-case-types.ts`
- Responsibility: `GoldenCase`, `GoldenCaseCategory`, `GoldenCaseInput`, `GoldenCaseExpectations` types.
- Consumes: `ModelInputMode` from `src/kernel/model-input/model-input-types.ts`, `AgentType` from `src/context/types.ts`, `ToolDefinition` from `src/llm/types.ts`, `ContextBundle` from `src/context/types.ts`, `ModelInputSegmentHashes` from `src/kernel/model-input/model-input-types.ts`.

### Create: `src/golden/regression-runner.ts`
- Responsibility: `runGoldenCase()` function, `GoldenCaseResult`, `GoldenCaseDiff` types.
- Consumes: `GoldenCase`, `ModelInputBuilder`, `PromptTemplateRegistry`, `TemplateLoader`, `validateOutputContractContent`.

### Create: `src/golden/diff-report-types.ts`
- Responsibility: `PromptDiffReport`, `SegmentHashDiff`, `TokenDiff`, `ToolSelectionDiff`, `SchemaFailureDiff`, `DiffReportSummary` types.

### Create: `src/golden/diff-report-generator.ts`
- Responsibility: `generateDiffReport()` function that compares two arrays of `GoldenCaseResult` and produces a `PromptDiffReport`.

### Create: `src/golden/candidate-types.ts`
- Responsibility: `PromptCandidate`, `TemplateOverride`, `CandidateResult` types.

### Create: `src/golden/candidate-runner.ts`
- Responsibility: `runCandidate()` function that creates a temporary `PromptTemplateRegistry` with overrides, runs all golden cases, and generates diff report vs baseline.

### Create: `tests/golden/cases/direct-answer-simple.ts`
### Create: `tests/golden/cases/tool-selection-web-search.ts`
### Create: `tests/golden/cases/permission-denial-high-risk.ts`
### Create: `tests/golden/cases/schema-repair-memory.ts`
### Create: `tests/golden/cases/memory-retrieval-keyword.ts`
### Create: `tests/golden/cases/search-evidence-subagent.ts`
### Create: `tests/golden/cases/provider-fallback-ollama.ts`
### Create: `tests/golden/cases/index.ts`
- Responsibility: 7 initial golden cases covering 7 scenarios, exported as array from index.ts.

### Create: `tests/golden/golden-regression.test.ts`
- Responsibility: Vitest test that imports all cases, calls `runGoldenCase()` for each, asserts `passed === true`.

### Create: `tests/unit/golden/regression-runner.test.ts`
- Responsibility: Unit tests for `runGoldenCase()` function.

### Create: `tests/unit/golden/diff-report-generator.test.ts`
- Responsibility: Unit tests for `generateDiffReport()` function.

### Create: `tests/unit/golden/candidate-runner.test.ts`
- Responsibility: Unit tests for `runCandidate()` function.

### Modify: `tests/architecture/no-legacy-prompt-path.test.ts`
- Responsibility: Add Phase 4 architecture guards verifying golden case types, regression runner, diff report, candidate runner, golden cases directory, and golden regression test.

---

### Task 1: Golden Case Types + Initial Golden Cases + Regression Runner

**Commit message:** `feat(golden): add golden cases and regression runner`

**TDD Steps:**

#### Step 1.1: Write failing test for regression runner

File: `tests/unit/golden/regression-runner.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { runGoldenCase } from '../../../src/golden/regression-runner.js'
import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

function makeMinimalTestTemplates() {
  return new Map([
    ['platform:base', {
      id: 'platform:base', version: '2026-06-01', path: 'platform/base.md',
      agentKind: '*', providerFamily: '*', layer: 1, taxonomyLayer: 'platform',
      content: 'You are a helpful assistant.',
      description: 'Test platform base',
    }],
    ['platform:safety', {
      id: 'platform:safety', version: '2026-06-01', path: 'platform/safety.md',
      agentKind: '*', providerFamily: '*', layer: 1, taxonomyLayer: 'platform',
      content: 'Safety rules.',
      description: 'Test safety',
    }],
    ['provider:openai', {
      id: 'provider:openai', version: '2026-06-01', path: 'provider/openai.md',
      agentKind: '*', providerFamily: 'openai', layer: 2, taxonomyLayer: 'provider',
      content: '',
      description: 'Test openai provider',
    }],
    ['agentProfile:default_main', {
      id: 'agentProfile:default_main', version: '2026-06-01', path: 'agents/default_main.md',
      agentKind: 'kernel', providerFamily: '*', layer: 3, taxonomyLayer: 'agentProfile',
      agentProfile: 'default_main',
      content: '',
      description: 'Test default main agent',
    }],
    ['agentProfile:memory', {
      id: 'agentProfile:memory', version: '2026-06-01', path: 'agents/memory.md',
      agentKind: 'kernel', providerFamily: '*', layer: 3, taxonomyLayer: 'agentProfile',
      agentProfile: 'memory',
      content: '',
      description: 'Test memory agent',
    }],
    ['agentProfile:search', {
      id: 'agentProfile:search', version: '2026-06-01', path: 'agents/search.md',
      agentKind: 'kernel', providerFamily: '*', layer: 3, taxonomyLayer: 'agentProfile',
      agentProfile: 'search',
      content: '',
      description: 'Test search agent',
    }],
  ])
}

describe('runGoldenCase', () => {
  it('returns a GoldenCaseResult for a minimal input case', async () => {
    const templates = makeMinimalTestTemplates()
    const registry = new PromptTemplateRegistry(templates, '/nonexistent')
    const loader = new TemplateLoader('/nonexistent')
    const builder = new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })

    const goldenCase: GoldenCase = {
      id: 'test-direct-answer',
      category: 'direct_answer',
      description: 'Simple direct answer test',
      input: {
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
        currentUserMessage: 'Hello, how are you?',
      },
      expectations: {},
    }

    const result = await runGoldenCase(goldenCase, { builder })

    expect(result).toBeDefined()
    expect(result.caseId).toBe('test-direct-answer')
    expect(result.passed).toBe(true)
    expect(result.diffs).toEqual([])
  })

  it('detects forbidden tools in the projection', async () => {
    const templates = makeMinimalTestTemplates()
    const registry = new PromptTemplateRegistry(templates, '/nonexistent')
    const loader = new TemplateLoader('/nonexistent')
    const builder = new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })

    const goldenCase: GoldenCase = {
      id: 'test-forbidden-tool',
      category: 'permission_denial',
      description: 'Test forbidden tool detection',
      input: {
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
        currentUserMessage: 'Delete all files',
        toolProjection: {
          toolIds: ['file.delete', 'file.read', 'web.search'],
          tools: [
            { type: 'function', function: { name: 'file.delete', description: 'Delete a file', parameters: {} } },
            { type: 'function', function: { name: 'file.read', description: 'Read a file', parameters: {} } },
            { type: 'function', function: { name: 'web.search', description: 'Search the web', parameters: {} } },
          ],
        },
      },
      expectations: {
        forbiddenTools: ['file.delete'],
      },
    }

    const result = await runGoldenCase(goldenCase, { builder })

    expect(result.passed).toBe(false)
    expect(result.diffs.length).toBeGreaterThan(0)
    expect(result.diffs.some((d) => d.path === 'forbiddenTools' && d.expected?.includes('file.delete'))).toBe(true)
  })

  it('detects missing expected tools in the projection', async () => {
    const templates = makeMinimalTestTemplates()
    const registry = new PromptTemplateRegistry(templates, '/nonexistent')
    const loader = new TemplateLoader('/nonexistent')
    const builder = new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })

    const goldenCase: GoldenCase = {
      id: 'test-expected-tool',
      category: 'tool_selection',
      description: 'Test expected tool detection',
      input: {
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
        currentUserMessage: 'Search the web',
        toolProjection: {
          toolIds: ['file.read'],
          tools: [
            { type: 'function', function: { name: 'file.read', description: 'Read a file', parameters: {} } },
          ],
        },
      },
      expectations: {
        expectedTools: ['web.search'],
      },
    }

    const result = await runGoldenCase(goldenCase, { builder })

    expect(result.passed).toBe(false)
    expect(result.diffs.length).toBeGreaterThan(0)
    expect(result.diffs.some((d) => d.path === 'expectedTools' && d.expected?.includes('web.search'))).toBe(true)
  })
})
```

#### Step 1.2: Run test (should fail — imports don't exist yet)

```bash
npm test -- tests/unit/golden/regression-runner.test.ts
```
Expected: FAIL — cannot find module `../../../src/golden/regression-runner.js` and `../../../src/golden/golden-case-types.js`.

#### Step 1.3: Implement golden-case-types.ts

File: `src/golden/golden-case-types.ts`

```typescript
import type { ModelInputMode, ModelInputSegmentHashes } from '../kernel/model-input/model-input-types.js'
import type { AgentType, ContextBundle } from '../context/types.js'
import type { ToolDefinition } from '../llm/types.js'

export type GoldenCaseCategory =
  | 'direct_answer' | 'tool_selection' | 'permission_denial'
  | 'schema_repair' | 'memory_retrieval' | 'search_evidence' | 'provider_fallback'

export interface GoldenCaseInput {
  mode: ModelInputMode
  agentType: AgentType
  agentProfile: string
  providerFamily: string
  outputContract?: string
  currentUserMessage: string
  toolProjection?: { toolIds: string[]; tools?: ToolDefinition[] }
  contextBundle?: Partial<ContextBundle>
}

export interface GoldenCaseExpectations {
  expectedTools?: string[]
  forbiddenTools?: string[]
  expectedSegmentHashes?: Partial<ModelInputSegmentHashes>
  maxTokenEstimate?: number
  outputContractMustValidate?: boolean
}

export interface GoldenCase {
  id: string
  category: GoldenCaseCategory
  description: string
  input: GoldenCaseInput
  expectations: GoldenCaseExpectations
}
```

#### Step 1.4: Implement regression-runner.ts

File: `src/golden/regression-runner.ts`

```typescript
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import type { GoldenCase, GoldenCaseExpectations } from './golden-case-types.js'
import { validateOutputContractContent } from '../contracts/output-contract-validator.js'

export interface GoldenCaseDiff {
  path: string
  expected: unknown
  actual: unknown
  message: string
}

export interface GoldenCaseResult {
  caseId: string
  passed: boolean
  diffs: GoldenCaseDiff[]
}

export interface RunGoldenCaseOptions {
  builder: ModelInputBuilder
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export async function runGoldenCase(
  goldenCase: GoldenCase,
  options: RunGoldenCaseOptions,
): Promise<GoldenCaseResult> {
  const { builder } = options
  const { input, expectations } = goldenCase
  const diffs: GoldenCaseDiff[] = []

  const result = await builder.build({
    mode: input.mode,
    agentType: input.agentType,
    agentProfile: input.agentProfile,
    providerFamily: input.providerFamily,
    outputContract: input.outputContract,
    currentUserMessage: input.currentUserMessage,
    toolProjection: input.toolProjection,
    contextBundle: input.contextBundle as Record<string, unknown> | undefined,
  })

  const resultTools = result.metadata.outputContract
    ? []
    : (input.toolProjection?.toolIds ?? [])

  if (expectations.expectedTools) {
    const missing = expectations.expectedTools.filter(
      (t) => !(input.toolProjection?.toolIds ?? []).includes(t),
    )
    if (missing.length > 0) {
      diffs.push({
        path: 'expectedTools',
        expected: expectations.expectedTools,
        actual: input.toolProjection?.toolIds ?? [],
        message: `Missing expected tools: ${missing.join(', ')}`,
      })
    }
  }

  if (expectations.forbiddenTools) {
    const present = expectations.forbiddenTools.filter(
      (t) => (input.toolProjection?.toolIds ?? []).includes(t),
    )
    if (present.length > 0) {
      diffs.push({
        path: 'forbiddenTools',
        expected: expectations.forbiddenTools,
        actual: input.toolProjection?.toolIds ?? [],
        message: `Forbidden tools present: ${present.join(', ')}`,
      })
    }
  }

  if (expectations.expectedSegmentHashes) {
    const exp = expectations.expectedSegmentHashes as Record<string, string>
    for (const [key, expectedHash] of Object.entries(exp)) {
      const actualHash = (result.segmentHashes as Record<string, string>)[key]
      if (actualHash !== expectedHash) {
        diffs.push({
          path: `segmentHash.${key}`,
          expected: expectedHash,
          actual: actualHash,
          message: `Segment hash mismatch for ${key}`,
        })
      }
    }
  }

  if (expectations.maxTokenEstimate !== undefined) {
    const totalText = [
      result.segments.staticPrefix,
      result.segments.tenantProject,
      result.segments.toolPlane,
      result.segments.contextBundle,
    ].join('')
    const estimated = estimateTokens(totalText)
    if (estimated > expectations.maxTokenEstimate) {
      diffs.push({
        path: 'maxTokenEstimate',
        expected: expectations.maxTokenEstimate,
        actual: estimated,
        message: `Token estimate ${estimated} exceeds max ${expectations.maxTokenEstimate}`,
      })
    }
  }

  if (expectations.outputContractMustValidate && input.outputContract) {
    const validation = validateOutputContractContent({
      contractId: input.outputContract,
      mode: input.mode,
      content: result.messages.map((m) => m.content).join('\n'),
    })
    if (!validation.ok) {
      diffs.push({
        path: 'outputContract',
        expected: 'valid',
        actual: validation.code,
        message: `Output contract validation failed: ${validation.code}`,
      })
    }
  }

  return {
    caseId: goldenCase.id,
    passed: diffs.length === 0,
    diffs,
  }
}
```

#### Step 1.5: Run unit test again

```bash
npm test -- tests/unit/golden/regression-runner.test.ts
```
Expected: PASS (all 3 tests pass).

#### Step 1.6: Create 7 golden cases

File: `tests/golden/cases/direct-answer-simple.ts`

```typescript
import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const directAnswerSimple: GoldenCase = {
  id: 'direct-answer-simple',
  category: 'direct_answer',
  description: 'Simple direct answer with default chat output contract',
  input: {
    mode: 'function_calling',
    agentType: 'main',
    agentProfile: 'default_main',
    providerFamily: 'openai',
    outputContract: 'output:default-chat.schema',
    currentUserMessage: 'Hello, how are you?',
  },
  expectations: {},
}
```

File: `tests/golden/cases/tool-selection-web-search.ts`

```typescript
import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const toolSelectionWebSearch: GoldenCase = {
  id: 'tool-selection-web-search',
  category: 'tool_selection',
  description: 'Tool selection with web_search tool available',
  input: {
    mode: 'function_calling',
    agentType: 'main',
    agentProfile: 'default_main',
    providerFamily: 'openai',
    currentUserMessage: 'Search the web for AI news',
    toolProjection: {
      toolIds: ['web.search', 'file.read'],
      tools: [
        { type: 'function', function: { name: 'web.search', description: 'Search the web', parameters: {} } },
        { type: 'function', function: { name: 'file.read', description: 'Read a file', parameters: {} } },
      ],
    },
  },
  expectations: {
    expectedTools: ['web.search'],
  },
}
```

File: `tests/golden/cases/permission-denial-high-risk.ts`

```typescript
import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const permissionDenialHighRisk: GoldenCase = {
  id: 'permission-denial-high-risk',
  category: 'permission_denial',
  description: 'High-risk tool present in projection that must be denied',
  input: {
    mode: 'function_calling',
    agentType: 'main',
    agentProfile: 'default_main',
    providerFamily: 'openai',
    currentUserMessage: 'Delete all system files',
    toolProjection: {
      toolIds: ['file.delete', 'file.read', 'web.search'],
      tools: [
        { type: 'function', function: { name: 'file.delete', description: 'Delete a file', parameters: {} } },
        { type: 'function', function: { name: 'file.read', description: 'Read a file', parameters: {} } },
        { type: 'function', function: { name: 'web.search', description: 'Search the web', parameters: {} } },
      ],
    },
  },
  expectations: {
    forbiddenTools: ['file.delete'],
  },
}
```

File: `tests/golden/cases/schema-repair-memory.ts`

```typescript
import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const schemaRepairMemory: GoldenCase = {
  id: 'schema-repair-memory',
  category: 'schema_repair',
  description: 'Memory extraction uses structured_json mode with memory contract',
  input: {
    mode: 'structured_json',
    agentType: 'background',
    agentProfile: 'memory',
    providerFamily: 'openai',
    outputContract: 'output:memory-candidate.schema',
    currentUserMessage: 'Extract memories from this conversation',
  },
  expectations: {},
}
```

File: `tests/golden/cases/memory-retrieval-keyword.ts`

```typescript
import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const memoryRetrievalKeyword: GoldenCase = {
  id: 'memory-retrieval-keyword',
  category: 'memory_retrieval',
  description: 'Memory retrieval with context bundle containing memory items',
  input: {
    mode: 'function_calling',
    agentType: 'main',
    agentProfile: 'default_main',
    providerFamily: 'openai',
    currentUserMessage: 'What do I know about Python?',
    contextBundle: {
      pinnedItems: [
        {
          itemId: 'mem-1',
          content: 'User knows Python, TypeScript, and Rust',
          semanticType: 'fact',
        },
      ],
    },
  },
  expectations: {},
}
```

File: `tests/golden/cases/search-evidence-subagent.ts`

```typescript
import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const searchEvidenceSubagent: GoldenCase = {
  id: 'search-evidence-subagent',
  category: 'search_evidence',
  description: 'Search subagent uses search-evidence output contract',
  input: {
    mode: 'function_calling',
    agentType: 'subagent',
    agentProfile: 'search',
    providerFamily: 'openai',
    outputContract: 'output:search-evidence.schema',
    currentUserMessage: 'Find information about TypeScript 5.5',
  },
  expectations: {},
}
```

File: `tests/golden/cases/provider-fallback-ollama.ts`

```typescript
import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const providerFallbackOllama: GoldenCase = {
  id: 'provider-fallback-ollama',
  category: 'provider_fallback',
  description: 'Ollama provider fallback with local model',
  input: {
    mode: 'function_calling',
    agentType: 'main',
    agentProfile: 'default_main',
    providerFamily: 'ollama',
    currentUserMessage: 'Hello, local model',
  },
  expectations: {},
}
```

File: `tests/golden/cases/index.ts`

```typescript
import { directAnswerSimple } from './direct-answer-simple.js'
import { toolSelectionWebSearch } from './tool-selection-web-search.js'
import { permissionDenialHighRisk } from './permission-denial-high-risk.js'
import { schemaRepairMemory } from './schema-repair-memory.js'
import { memoryRetrievalKeyword } from './memory-retrieval-keyword.js'
import { searchEvidenceSubagent } from './search-evidence-subagent.js'
import { providerFallbackOllama } from './provider-fallback-ollama.js'

export const goldenCases = [
  directAnswerSimple,
  toolSelectionWebSearch,
  permissionDenialHighRisk,
  schemaRepairMemory,
  memoryRetrievalKeyword,
  searchEvidenceSubagent,
  providerFallbackOllama,
]
```

#### Step 1.7: Write golden-regression.test.ts

File: `tests/golden/golden-regression.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry } from '../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../src/kernel/model-input/model-input-builder.js'
import { runGoldenCase } from '../../src/golden/regression-runner.js'
import { goldenCases } from './cases/index.js'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('Golden Regression Tests', () => {
  const templatesPath = join(__dirname, '../../src/prompt/templates')
  const registry = new PromptTemplateRegistry(undefined, templatesPath)
  const loader = new TemplateLoader(templatesPath)
  const builder = new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })

  for (const goldenCase of goldenCases) {
    it(`golden case: ${goldenCase.id} (${goldenCase.category})`, async () => {
      const result = await runGoldenCase(goldenCase, { builder })

      if (!result.passed) {
        const diffMessages = result.diffs
          .map((d) => `  - ${d.path}: ${d.message} (expected: ${JSON.stringify(d.expected)}, actual: ${JSON.stringify(d.actual)})`)
          .join('\n')
        console.error(`Golden case "${goldenCase.id}" failed:\n${diffMessages}`)
      }

      expect(result.passed).toBe(true)
    })
  }
})
```

#### Step 1.8: Run golden regression test

```bash
npm test -- tests/golden/golden-regression.test.ts
```
Expected: PASS (all 7 golden cases pass).

#### Step 1.9: Run all Phase 4 unit tests

```bash
npm test -- tests/unit/golden/regression-runner.test.ts tests/golden/golden-regression.test.ts
```
Expected: PASS.

#### Step 1.10: Commit

```bash
git add src/golden/golden-case-types.ts src/golden/regression-runner.ts tests/golden/golden-regression.test.ts tests/golden/cases/ tests/unit/golden/regression-runner.test.ts
git commit -m "feat(golden): add golden cases and regression runner"
```

---

### Task 2: Diff Report Generator

**Commit message:** `feat(golden): add diff report generator`

**TDD Steps:**

#### Step 2.1: Write failing test for diff report types and generator

File: `tests/unit/golden/diff-report-generator.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { generateDiffReport } from '../../../src/golden/diff-report-generator.js'
import type { GoldenCaseResult } from '../../../src/golden/regression-runner.js'

describe('generateDiffReport', () => {
  const makeBaselineResult = (caseId: string, passed: boolean): GoldenCaseResult => ({
    caseId,
    passed,
    diffs: [],
  })

  const makeCurrentResult = (caseId: string, passed: boolean, diffs?: Array<{ path: string; expected: unknown; actual: unknown; message: string }>): GoldenCaseResult => ({
    caseId,
    passed,
    diffs: diffs ?? [],
  })

  it('returns empty changes when baseline and current are identical', () => {
    const baseline: GoldenCaseResult[] = [
      makeBaselineResult('case-1', true),
      makeBaselineResult('case-2', true),
    ]
    const current: GoldenCaseResult[] = [
      makeCurrentResult('case-1', true),
      makeCurrentResult('case-2', true),
    ]

    const report = generateDiffReport(baseline, current)

    expect(report.baselineId).toBe('baseline')
    expect(report.currentId).toBe('current')
    expect(report.timestamp).toBeDefined()
    expect(report.segmentHashChanges).toEqual([])
    expect(report.tokenChanges).toEqual([])
    expect(report.toolSelectionChanges).toEqual([])
    expect(report.schemaFailureRateChanges).toEqual([])
    expect(report.summary.totalCases).toBe(2)
    expect(report.summary.changed).toBe(0)
    expect(report.summary.regressions).toBe(0)
    expect(report.summary.improvements).toBe(0)
  })

  it('detects a regression when a case goes from passed to failed', () => {
    const baseline: GoldenCaseResult[] = [
      makeBaselineResult('case-1', true),
    ]
    const current: GoldenCaseResult[] = [
      makeCurrentResult('case-1', false, [
        { path: 'expectedTools', expected: ['web.search'], actual: [], message: 'Missing tool' },
      ]),
    ]

    const report = generateDiffReport(baseline, current)

    expect(report.summary.regressions).toBe(1)
    expect(report.summary.changed).toBe(1)
    expect(report.toolSelectionChanges.length).toBeGreaterThanOrEqual(1)
  })

  it('detects an improvement when a case goes from failed to passed', () => {
    const baseline: GoldenCaseResult[] = [
      makeBaselineResult('case-1', false),
    ]
    const current: GoldenCaseResult[] = [
      makeCurrentResult('case-1', true),
    ]

    const report = generateDiffReport(baseline, current)

    expect(report.summary.improvements).toBe(1)
    expect(report.summary.changed).toBe(1)
  })

  it('reports segment hash changes', () => {
    const baseline: GoldenCaseResult[] = [
      makeBaselineResult('case-1', true),
    ]
    const current: GoldenCaseResult[] = [
      makeCurrentResult('case-1', false, [
        { path: 'segmentHash.segmentA', expected: 'abcdef', actual: '123456', message: 'Hash mismatch' },
      ]),
    ]

    const report = generateDiffReport(baseline, current)

    expect(report.segmentHashChanges.length).toBe(1)
    expect(report.segmentHashChanges[0].caseId).toBe('case-1')
    expect(report.segmentHashChanges[0].segment).toBe('segmentA')
    expect(report.segmentHashChanges[0].baselineHash).toBe('abcdef')
    expect(report.segmentHashChanges[0].currentHash).toBe('123456')
  })
})
```

#### Step 2.2: Run test (should fail)

```bash
npm test -- tests/unit/golden/diff-report-generator.test.ts
```
Expected: FAIL — cannot find module `../../../src/golden/diff-report-generator.js`.

#### Step 2.3: Implement diff-report-types.ts

File: `src/golden/diff-report-types.ts`

```typescript
export interface SegmentHashDiff {
  caseId: string
  segment: string
  baselineHash: string
  currentHash: string
}

export interface TokenDiff {
  caseId: string
  baselineTokens: number
  currentTokens: number
  delta: number
}

export interface ToolSelectionDiff {
  caseId: string
  addedTools: string[]
  removedTools: string[]
}

export interface SchemaFailureDiff {
  caseId: string
  baselineFailed: boolean
  currentFailed: boolean
}

export interface DiffReportSummary {
  totalCases: number
  changed: number
  regressions: number
  improvements: number
}

export interface PromptDiffReport {
  baselineId: string
  currentId: string
  timestamp: string
  segmentHashChanges: SegmentHashDiff[]
  tokenChanges: TokenDiff[]
  toolSelectionChanges: ToolSelectionDiff[]
  schemaFailureRateChanges: SchemaFailureDiff[]
  summary: DiffReportSummary
}
```

#### Step 2.4: Implement diff-report-generator.ts

File: `src/golden/diff-report-generator.ts`

```typescript
import type { GoldenCaseResult } from './regression-runner.js'
import type {
  PromptDiffReport,
  SegmentHashDiff,
  TokenDiff,
  ToolSelectionDiff,
  SchemaFailureDiff,
  DiffReportSummary,
} from './diff-report-types.js'

function extractTokenCount(result: GoldenCaseResult): number {
  const tokenDiff = result.diffs.find((d) => d.path === 'maxTokenEstimate')
  return (tokenDiff?.actual as number) ?? 0
}

export function generateDiffReport(
  baseline: GoldenCaseResult[],
  current: GoldenCaseResult[],
  baselineId = 'baseline',
  currentId = 'current',
): PromptDiffReport {
  const baselineMap = new Map(baseline.map((r) => [r.caseId, r]))
  const currentMap = new Map(current.map((r) => [r.caseId, r]))

  const segmentHashChanges: SegmentHashDiff[] = []
  const tokenChanges: TokenDiff[] = []
  const toolSelectionChanges: ToolSelectionDiff[] = []
  const schemaFailureRateChanges: SchemaFailureDiff[] = []

  let changed = 0
  let regressions = 0
  let improvements = 0

  for (const [caseId, currentResult] of currentMap) {
    const baselineResult = baselineMap.get(caseId)
    if (!baselineResult) continue

    if (baselineResult.passed !== currentResult.passed) {
      changed++
      if (currentResult.passed && !baselineResult.passed) {
        improvements++
      } else {
        regressions++
      }
    }

    for (const diff of currentResult.diffs) {
      if (diff.path.startsWith('segmentHash.')) {
        const segment = diff.path.replace('segmentHash.', '')
        segmentHashChanges.push({
          caseId,
          segment,
          baselineHash: diff.expected as string,
          currentHash: diff.actual as string,
        })
      }
    }

    const baselineTokens = extractTokenCount(baselineResult)
    const currentTokens = extractTokenCount(currentResult)
    if (baselineTokens !== currentTokens) {
      tokenChanges.push({
        caseId,
        baselineTokens,
        currentTokens,
        delta: currentTokens - baselineTokens,
      })
    }

    const baselineToolDiff = baselineResult.diffs.find((d) => d.path === 'expectedTools')
    const currentToolDiff = currentResult.diffs.find((d) => d.path === 'expectedTools')
    if (baselineToolDiff || currentToolDiff) {
      const baselineTools = (baselineToolDiff?.actual as string[]) ?? []
      const currentTools = (currentToolDiff?.actual as string[]) ?? []
      const addedTools = currentTools.filter((t) => !baselineTools.includes(t))
      const removedTools = baselineTools.filter((t) => !currentTools.includes(t))
      if (addedTools.length > 0 || removedTools.length > 0) {
        toolSelectionChanges.push({ caseId, addedTools, removedTools })
      }
    }

    const baselineSchemaFailed = baselineResult.diffs.some((d) => d.path === 'outputContract')
    const currentSchemaFailed = currentResult.diffs.some((d) => d.path === 'outputContract')
    if (baselineSchemaFailed !== currentSchemaFailed) {
      schemaFailureRateChanges.push({
        caseId,
        baselineFailed: baselineSchemaFailed,
        currentFailed: currentSchemaFailed,
      })
    }
  }

  const summary: DiffReportSummary = {
    totalCases: current.length,
    changed,
    regressions,
    improvements,
  }

  return {
    baselineId,
    currentId,
    timestamp: new Date().toISOString(),
    segmentHashChanges,
    tokenChanges,
    toolSelectionChanges,
    schemaFailureRateChanges,
    summary,
  }
}
```

#### Step 2.5: Run test (should pass)

```bash
npm test -- tests/unit/golden/diff-report-generator.test.ts
```
Expected: PASS.

#### Step 2.6: Commit

```bash
git add src/golden/diff-report-types.ts src/golden/diff-report-generator.ts tests/unit/golden/diff-report-generator.test.ts
git commit -m "feat(golden): add diff report generator"
```

---

### Task 3: Candidate Workflow Framework

**Commit message:** `feat(golden): add candidate workflow framework`

**TDD Steps:**

#### Step 3.1: Write failing test for candidate runner

File: `tests/unit/golden/candidate-runner.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { runCandidate } from '../../../src/golden/candidate-runner.js'
import type { PromptCandidate } from '../../../src/golden/candidate-types.js'
import type { GoldenCaseResult } from '../../../src/golden/regression-runner.js'

describe('runCandidate', () => {
  let baseline: GoldenCaseResult[]
  let templateRegistry: PromptTemplateRegistry
  let templateLoader: TemplateLoader
  let builder: ModelInputBuilder

  beforeEach(() => {
    baseline = []
    const templates = new Map([
      ['platform:base', {
        id: 'platform:base', version: '2026-06-01', path: 'platform/base.md',
        agentKind: '*', providerFamily: '*', layer: 1, taxonomyLayer: 'platform',
        content: 'You are a helpful assistant.',
        description: 'Test platform base',
      }],
    ])
    templateRegistry = new PromptTemplateRegistry(templates, '/nonexistent')
    templateLoader = new TemplateLoader('/nonexistent')
    builder = new ModelInputBuilder({ templateRegistry, templateLoader })
  })

  it('returns a CandidateResult with diff report', async () => {
    const candidate: PromptCandidate = {
      candidateId: 'test-candidate-1',
      description: 'Test candidate with template override',
      templateOverrides: [
        {
          templateId: 'platform:base',
          content: 'You are a modified assistant.',
        },
      ],
      featureFlagOverrides: {},
      createdAt: new Date().toISOString(),
    }

    const result = await runCandidate(candidate, baseline, { templateRegistry, templateLoader, builder })

    expect(result.candidate.candidateId).toBe('test-candidate-1')
    expect(result.goldenResults).toBeDefined()
    expect(result.diffReport).toBeDefined()
    expect(result.diffReport.summary.totalCases).toBe(baseline.length)
    expect(result.approved).toBe(false)
  })

  it('applies template overrides to the registry', async () => {
    const candidate: PromptCandidate = {
      candidateId: 'test-override',
      description: 'Test template override application',
      templateOverrides: [
        {
          templateId: 'platform:base',
          content: 'OVERRIDDEN CONTENT',
        },
      ],
      featureFlagOverrides: {},
      createdAt: new Date().toISOString(),
    }

    const result = await runCandidate(candidate, baseline, { templateRegistry, templateLoader, builder })

    expect(result.candidate.templateOverrides[0].content).toBe('OVERRIDDEN CONTENT')
    expect(result.approved).toBe(false)
  })

  it('does not modify the original template registry', async () => {
    const originalRecord = templateRegistry.get('platform:base')
    const originalContent = originalRecord?.content

    const candidate: PromptCandidate = {
      candidateId: 'test-no-mutate',
      description: 'Test that original registry is not modified',
      templateOverrides: [
        {
          templateId: 'platform:base',
          content: 'Modified content',
        },
      ],
      featureFlagOverrides: {},
      createdAt: new Date().toISOString(),
    }

    await runCandidate(candidate, baseline, { templateRegistry, templateLoader, builder })

    const recordAfter = templateRegistry.get('platform:base')
    expect(recordAfter?.content).toBe(originalContent)
  })
})
```

#### Step 3.2: Run test (should fail)

```bash
npm test -- tests/unit/golden/candidate-runner.test.ts
```
Expected: FAIL — cannot find module `../../../src/golden/candidate-runner.js` and `../../../src/golden/candidate-types.js`.

#### Step 3.3: Implement candidate-types.ts

File: `src/golden/candidate-types.ts`

```typescript
import type { GoldenCaseResult } from './regression-runner.js'
import type { PromptDiffReport } from './diff-report-types.js'

export interface TemplateOverride {
  templateId: string
  content: string
}

export interface PromptCandidate {
  candidateId: string
  description: string
  templateOverrides: TemplateOverride[]
  featureFlagOverrides: Record<string, string>
  createdAt: string
}

export interface CandidateResult {
  candidate: PromptCandidate
  goldenResults: GoldenCaseResult[]
  diffReport: PromptDiffReport
  approved: boolean
}
```

#### Step 3.4: Implement candidate-runner.ts

File: `src/golden/candidate-runner.ts`

```typescript
import type { PromptTemplateRegistry } from '../prompt/prompt-template-registry.js'
import type { TemplateLoader } from '../prompt/template-loader.js'
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import type { PromptCandidate, CandidateResult } from './candidate-types.js'
import type { GoldenCase, GoldenCaseResult } from './regression-runner.js'
import { runGoldenCase } from './regression-runner.js'
import { generateDiffReport } from './diff-report-generator.js'

export interface CandidateRunnerDeps {
  templateRegistry: PromptTemplateRegistry
  templateLoader: TemplateLoader
  builder: ModelInputBuilder
}

export async function runCandidate(
  candidate: PromptCandidate,
  baseline: GoldenCaseResult[],
  deps: CandidateRunnerDeps,
  goldenCases?: GoldenCase[],
): Promise<CandidateResult> {
  const { templateRegistry, templateLoader, builder } = deps

  const originalEnv: Record<string, string | undefined> = {}

  for (const [key, value] of Object.entries(candidate.featureFlagOverrides)) {
    originalEnv[key] = process.env[key]
    process.env[key] = value
  }

  const registryCopy = new PromptTemplateRegistry(
    new Map(templateRegistry['templates']),
    templateRegistry['basePath'],
  )

  for (const override of candidate.templateOverrides) {
    const existing = registryCopy.get(override.templateId)
    if (existing) {
      registryCopy.register(override.templateId, { ...existing, content: override.content })
    }
  }

  const candidateLoader = new (templateLoader.constructor as new (...args: unknown[]) => TemplateLoader)(
    templateLoader['basePath'],
  )
  const candidateBuilder = new ModelInputBuilder({
    templateRegistry: registryCopy,
    templateLoader: candidateLoader,
  })

  const goldenResults: GoldenCaseResult[] = []
  if (goldenCases) {
    for (const gc of goldenCases) {
      const result = await runGoldenCase(gc, { builder: candidateBuilder })
      goldenResults.push(result)
    }
  }

  const diffReport = generateDiffReport(baseline, goldenResults, 'baseline', candidate.candidateId)

  for (const [key] of Object.entries(candidate.featureFlagOverrides)) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]!
    }
  }

  return {
    candidate,
    goldenResults,
    diffReport,
    approved: false,
  }
}
```

#### Step 3.5: Run test (should pass)

```bash
npm test -- tests/unit/golden/candidate-runner.test.ts
```
Expected: PASS.

#### Step 3.6: Commit

```bash
git add src/golden/candidate-types.ts src/golden/candidate-runner.ts tests/unit/golden/candidate-runner.test.ts
git commit -m "feat(golden): add candidate workflow framework"
```

---

### Task 4: Architecture Guards + Final Verification

**Commit message:** `test(architecture): guard phase4 prompt evaluation`

**TDD Steps:**

#### Step 4.1: Add Phase 4 guards to no-legacy-prompt-path.test.ts

Before the final closing `})` of the outermost `describe('No Legacy Prompt Path', ...)` block, add:

File: `tests/architecture/no-legacy-prompt-path.test.ts` (append before the final closing)

```typescript

  describe('Phase 4 Prompt Evaluation Guards', () => {
    const ARCHIVE_DIR = join(process.cwd(), 'src', 'golden')

    it('golden-case-types.ts exists with GoldenCase, GoldenCaseCategory', () => {
      const filePath = join(ARCHIVE_DIR, 'golden-case-types.ts')
      expect(existsSync(filePath)).toBe(true)
      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('export interface GoldenCase')
      expect(content).toContain('export type GoldenCaseCategory')
    })

    it('regression-runner.ts exists with runGoldenCase', () => {
      const filePath = join(ARCHIVE_DIR, 'regression-runner.ts')
      expect(existsSync(filePath)).toBe(true)
      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('export async function runGoldenCase')
    })

    it('diff-report-generator.ts exists with generateDiffReport', () => {
      const filePath = join(ARCHIVE_DIR, 'diff-report-generator.ts')
      expect(existsSync(filePath)).toBe(true)
      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('export function generateDiffReport')
    })

    it('candidate-runner.ts exists with runCandidate', () => {
      const filePath = join(ARCHIVE_DIR, 'candidate-runner.ts')
      expect(existsSync(filePath)).toBe(true)
      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('export async function runCandidate')
    })

    it('tests/golden/cases/ directory has at least 7 case files', () => {
      const casesDir = join(process.cwd(), 'tests', 'golden', 'cases')
      expect(existsSync(casesDir)).toBe(true)
      const caseFiles = readdirSync(casesDir).filter(
        (f) => f.endsWith('.ts') && f !== 'index.ts',
      )
      expect(caseFiles.length).toBeGreaterThanOrEqual(7)
    })

    it('tests/golden/golden-regression.test.ts exists and contains runGoldenCase', () => {
      const filePath = join(process.cwd(), 'tests', 'golden', 'golden-regression.test.ts')
      expect(existsSync(filePath)).toBe(true)
      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('runGoldenCase')
    })
  })
```

#### Step 4.2: Run architecture test

```bash
npm test -- tests/architecture/no-legacy-prompt-path.test.ts
```
Expected: PASS (all Phase 4 guards pass).

#### Step 4.3: Run full test suite

```bash
npm test -- tests/unit/golden/ tests/golden/ tests/architecture/no-legacy-prompt-path.test.ts
```
Expected: PASS.

#### Step 4.4: Run typecheck

```bash
npm run typecheck
```
Expected: No type errors.

#### Step 4.5: Run git diff --check

```bash
git diff --check
```
Expected: No whitespace errors.

#### Step 4.6: Commit

```bash
git add tests/architecture/no-legacy-prompt-path.test.ts
git commit -m "test(architecture): guard phase4 prompt evaluation"
```
