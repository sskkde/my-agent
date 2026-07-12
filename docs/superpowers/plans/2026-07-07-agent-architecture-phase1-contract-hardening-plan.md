# Agent Architecture Phase 1 Contract Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 1 of the agent architecture optimization by enforcing structured output contracts at runtime and ensuring LLM-facing tool schemas come from the registered tool definitions.

**Architecture:** Phase 1 adds a small in-repo output contract validator and wires it into the current structured JSON boundaries without introducing a JSON Schema dependency. Tool schema projection is hardened so production LLM tool definitions use `ToolRegistry` schemas, while catalog summaries remain display-only metadata.

**Tech Stack:** TypeScript, ESM modules, Vitest, existing `AgentKernel`, existing memory extraction service, existing `ToolRegistry`, existing `ModelInputBuilder`, no new runtime dependency.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-07-agent-architecture-optimization-design.md`.
- Scope is Phase 1 only: output contract runtime validator, unified structured output error type, `ToolRegistry` schema source hardening, and empty schema fallback protection.
- Do not enable or change P10 prompt/memory rollout flags.
- Do not implement Segment D token budget rollout in this plan.
- Do not implement structured ReAct trace or richer `decisionTrace` in this plan.
- Do not create a golden dataset or prompt regression runner in this plan.
- Do not persist full raw Chain of Thought.
- Do not add Ajv or another schema validation dependency; use a focused in-repo validator for the current contracts.
- Do not force `output:default-chat.schema` to be JSON; it remains a natural-language contract.
- Treat `output:search-evidence.schema` as the search answer synthesis contract for this phase; the structured evidence remains produced by `handleSearchSubagentTool()` from tool results, not by parsing the Phase 2 answer string.
- Keep API route contracts unchanged.
- TypeScript strict mode is enabled with `noUnusedLocals` and `noUnusedParameters`.
- Use TDD for production code changes: write failing test, run it, implement minimal code, rerun.

---

## File Structure

- Create: `src/contracts/output-contract-validator.ts`
- Responsibility: Runtime contract registry plus parser/validator for structured JSON output contracts. This owns unified structured output validation errors and intentionally skips natural-language contracts.

- Create: `tests/unit/contracts/output-contract-validator.test.ts`
- Responsibility: Unit coverage for contract registry lookup, valid memory candidate JSON, invalid JSON, schema mismatch, natural-language contract skip, and unknown structured contract behavior.

- Modify: `src/memory/long-term-memory-extractor-service.ts`
- Responsibility: Replace ad hoc memory extraction JSON parsing with the shared output contract validator, while preserving domain-level candidate filtering through `validateExtractedCandidate()`.

- Modify: `tests/unit/memory/long-term-memory-extractor-service.test.ts`
- Responsibility: Confirm memory extraction maps invalid JSON to `INVALID_JSON`, structural schema failures to `SCHEMA_MISMATCH`, and domain-invalid candidates to discard counts rather than whole-run failure.

- Create: `tests/unit/kernel/agent-kernel-output-contract.test.ts`
- Responsibility: Unit coverage for `AgentKernel` final content validation when the run uses `structured_json` mode and a structured output contract.

- Modify: `src/kernel/agent-kernel.ts`
- Responsibility: Validate final LLM content before completing structured JSON runs, returning parsed structured payload on success and unified errors on failure.

- Modify: `src/api/tool-catalog.ts`
- Responsibility: Make `getToolDefinitions()` require a `ToolRegistry` and return LLM tool definitions from registered tool schemas instead of fallback catalog summaries.

- Modify: `tests/unit/tools/tool-catalog-consistency.test.ts`
- Responsibility: Prove API-facing tool definitions preserve registered schemas exactly.

- Modify: `src/foreground/tool-projection-mapper.ts`
- Responsibility: Remove silent empty-schema fallback for function-calling tool definitions; require either registry lookup or an explicit summary schema.

- Modify: `src/foreground/foreground-agent.ts`
- Responsibility: Stop using fallback catalog summaries as function-calling schema inputs when no `ToolRegistry` is present; fail closed to an empty tool projection instead of synthesizing empty schemas.

- Modify: `tests/unit/foreground/tool-projection.test.ts`
- Responsibility: Update summary test helpers to provide explicit schemas and add a regression that missing registry plus missing schema fails closed.

- Modify: `tests/unit/foreground/runturn-kernel.test.ts`
- Responsibility: Update foreground agent unit fixtures to provide a schema-backed `ToolRegistry` and add a no-registry fail-closed regression.

- Modify: `tests/architecture/no-legacy-prompt-path.test.ts`
- Responsibility: Add architecture guards preventing reintroduction of fallback empty LLM tool schemas and bypasses around the shared output contract validator.

---

### Task 1: Add Shared Output Contract Validator

**Files:**
- Create: `src/contracts/output-contract-validator.ts`
- Create: `tests/unit/contracts/output-contract-validator.test.ts`

**Interfaces:**
- Consumes: `ModelInputMode` from `src/kernel/model-input/model-input-types.ts`
- Produces: `validateOutputContractContent(input: OutputContractValidationInput): OutputContractValidationResult`
- Produces: `StructuredOutputContractError` for callers that prefer exception mapping
- Produces: structured contract IDs `output:memory-candidate.schema` and `output:planner.schema`
- Produces: natural-language contract IDs `output:default-chat.schema` and `output:search-evidence.schema`

- [ ] **Step 1: Write failing validator tests**

Use `apply_patch` to add `tests/unit/contracts/output-contract-validator.test.ts` with this content:

```typescript
import { describe, expect, it } from 'vitest'
import {
  StructuredOutputContractError,
  getOutputContractDefinition,
  validateOutputContractContent,
} from '../../../src/contracts/output-contract-validator.js'

const validMemoryCandidateEnvelope = {
  candidates: [
    {
      memoryType: 'user_preference',
      text: 'User prefers concise answers',
      confidence: 0.9,
      importance: 'medium',
      sensitivity: 'low',
      keywords: ['concise', 'answers'],
      scope: { visibility: 'private_user' },
      sourceRefs: {
        transcriptRefs: ['turn-1'],
        extraction: {
          windowHash: 'hash-1',
          triggerTurnId: 'turn-1',
          includedTurnIds: ['turn-1'],
        },
      },
    },
  ],
}

describe('output contract validator', () => {
  it('registers memory candidate as a structured JSON contract', () => {
    expect(getOutputContractDefinition('output:memory-candidate.schema')).toEqual({
      contractId: 'output:memory-candidate.schema',
      kind: 'structured_json',
      description: 'Memory extraction candidates envelope',
    })
  })

  it('registers default chat as a natural-language contract', () => {
    expect(getOutputContractDefinition('output:default-chat.schema')).toEqual({
      contractId: 'output:default-chat.schema',
      kind: 'natural_language',
      description: 'Default conversational markdown response',
    })
  })

  it('parses and validates valid memory candidate JSON', () => {
    const result = validateOutputContractContent({
      contractId: 'output:memory-candidate.schema',
      mode: 'structured_json',
      content: JSON.stringify(validMemoryCandidateEnvelope),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.parsed).toEqual(validMemoryCandidateEnvelope)
      expect(result.skippedReason).toBeUndefined()
    }
  })

  it('returns INVALID_JSON for malformed structured JSON', () => {
    const result = validateOutputContractContent({
      contractId: 'output:memory-candidate.schema',
      mode: 'structured_json',
      content: '{ candidates: [',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('INVALID_JSON')
      expect(result.message).toContain('not valid JSON')
    }
  })

  it('returns SCHEMA_MISMATCH when memory candidates are structurally invalid', () => {
    const result = validateOutputContractContent({
      contractId: 'output:memory-candidate.schema',
      mode: 'structured_json',
      content: JSON.stringify({ candidates: [{ text: 'missing required fields' }] }),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('SCHEMA_MISMATCH')
      expect(result.details).toContain('candidates[0].memoryType must be a string')
      expect(result.details).toContain('candidates[0].confidence must be a number')
    }
  })

  it('skips natural-language contracts without parsing content as JSON', () => {
    const result = validateOutputContractContent({
      contractId: 'output:default-chat.schema',
      mode: 'function_calling',
      content: 'Plain conversational markdown response.',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('natural_language')
      expect(result.skippedReason).toBe('natural_language_contract')
      expect(result.parsed).toBeUndefined()
    }
  })

  it('fails closed for unknown contracts in structured_json mode', () => {
    const result = validateOutputContractContent({
      contractId: 'output:unknown.schema',
      mode: 'structured_json',
      content: '{}',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('UNKNOWN_OUTPUT_CONTRACT')
      expect(result.contractId).toBe('output:unknown.schema')
    }
  })

  it('wraps validation failures in StructuredOutputContractError', () => {
    const result = validateOutputContractContent({
      contractId: 'output:memory-candidate.schema',
      mode: 'structured_json',
      content: '{}',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const error = new StructuredOutputContractError(result)
      expect(error.code).toBe('SCHEMA_MISMATCH')
      expect(error.contractId).toBe('output:memory-candidate.schema')
      expect(error.details).toContain('candidates must be an array')
    }
  })
})
```

- [ ] **Step 2: Run validator tests to verify they fail**

Run: `npm test -- tests/unit/contracts/output-contract-validator.test.ts`

Expected before implementation: FAIL with module resolution error for `src/contracts/output-contract-validator.ts`.

- [ ] **Step 3: Add the validator implementation**

Use `apply_patch` to add `src/contracts/output-contract-validator.ts` with this content:

```typescript
import type { ModelInputMode } from '../kernel/model-input/model-input-types.js'

export type OutputContractKind = 'natural_language' | 'structured_json'

export type StructuredOutputErrorCode = 'INVALID_JSON' | 'SCHEMA_MISMATCH' | 'UNKNOWN_OUTPUT_CONTRACT'

export interface OutputContractDefinition {
  readonly contractId: string
  readonly kind: OutputContractKind
  readonly description: string
}

export interface OutputContractValidationInput {
  readonly contractId?: string
  readonly mode: ModelInputMode
  readonly content: string
}

export interface OutputContractValidationSuccess {
  readonly ok: true
  readonly contractId?: string
  readonly kind: OutputContractKind | 'none'
  readonly parsed?: unknown
  readonly skippedReason?: 'no_contract' | 'natural_language_contract' | 'non_structured_mode'
}

export interface OutputContractValidationFailure {
  readonly ok: false
  readonly contractId?: string
  readonly kind?: OutputContractKind
  readonly code: StructuredOutputErrorCode
  readonly message: string
  readonly details: readonly string[]
}

export type OutputContractValidationResult = OutputContractValidationSuccess | OutputContractValidationFailure

export class StructuredOutputContractError extends Error {
  readonly code: StructuredOutputErrorCode
  readonly contractId?: string
  readonly details: readonly string[]

  constructor(result: OutputContractValidationFailure) {
    super(result.message)
    this.name = 'StructuredOutputContractError'
    this.code = result.code
    this.contractId = result.contractId
    this.details = result.details
  }
}

const CONTRACTS = new Map<string, OutputContractDefinition>([
  [
    'output:default-chat.schema',
    {
      contractId: 'output:default-chat.schema',
      kind: 'natural_language',
      description: 'Default conversational markdown response',
    },
  ],
  [
    'output:search-evidence.schema',
    {
      contractId: 'output:search-evidence.schema',
      kind: 'natural_language',
      description: 'Search answer synthesis response; structured evidence is produced by the search tool result',
    },
  ],
  [
    'output:memory-candidate.schema',
    {
      contractId: 'output:memory-candidate.schema',
      kind: 'structured_json',
      description: 'Memory extraction candidates envelope',
    },
  ],
  [
    'output:planner.schema',
    {
      contractId: 'output:planner.schema',
      kind: 'structured_json',
      description: 'Execution plan envelope',
    },
  ],
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
}

function requireString(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== 'string' || (record[key] as string).length === 0) {
    errors.push(`${path}.${key} must be a string`)
  }
}

function requireNumber(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) {
    errors.push(`${path}.${key} must be a number`)
  }
}

function validateMemoryCandidateEnvelope(value: unknown): readonly string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ['root must be an object']
  }

  if (!Array.isArray(value.candidates)) {
    return ['candidates must be an array']
  }

  value.candidates.forEach((candidate, index) => {
    const path = `candidates[${index}]`
    if (!isRecord(candidate)) {
      errors.push(`${path} must be an object`)
      return
    }

    requireString(candidate, 'memoryType', path, errors)
    requireString(candidate, 'text', path, errors)
    requireNumber(candidate, 'confidence', path, errors)
    requireString(candidate, 'importance', path, errors)
    requireString(candidate, 'sensitivity', path, errors)

    if (!isStringArray(candidate.keywords)) {
      errors.push(`${path}.keywords must be a non-empty string array`)
    }

    if (!isRecord(candidate.scope) || candidate.scope.visibility !== 'private_user') {
      errors.push(`${path}.scope.visibility must be private_user`)
    }

    if (!isRecord(candidate.sourceRefs)) {
      errors.push(`${path}.sourceRefs must be an object`)
    } else if (!isStringArray(candidate.sourceRefs.transcriptRefs)) {
      errors.push(`${path}.sourceRefs.transcriptRefs must be a non-empty string array`)
    }

    if (candidate.entities !== undefined && !Array.isArray(candidate.entities)) {
      errors.push(`${path}.entities must be an array when provided`)
    }

    if (candidate.structured !== undefined && !isRecord(candidate.structured)) {
      errors.push(`${path}.structured must be an object when provided`)
    }

    if (candidate.discardReason !== undefined && typeof candidate.discardReason !== 'string') {
      errors.push(`${path}.discardReason must be a string when provided`)
    }
  })

  return errors
}

function validatePlannerEnvelope(value: unknown): readonly string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ['root must be an object']
  }

  requireString(value, 'id', 'plan', errors)
  requireString(value, 'goal', 'plan', errors)
  if (!Array.isArray(value.steps)) {
    errors.push('plan.steps must be an array')
  }
  if (typeof value.createdAt !== 'string') {
    errors.push('plan.createdAt must be a string')
  }
  if (typeof value.updatedAt !== 'string') {
    errors.push('plan.updatedAt must be a string')
  }
  if (typeof value.version !== 'number') {
    errors.push('plan.version must be a number')
  }

  return errors
}

function validateParsedContract(contractId: string, parsed: unknown): readonly string[] {
  switch (contractId) {
    case 'output:memory-candidate.schema':
      return validateMemoryCandidateEnvelope(parsed)
    case 'output:planner.schema':
      return validatePlannerEnvelope(parsed)
    default:
      return [`no validator registered for ${contractId}`]
  }
}

export function getOutputContractDefinition(contractId: string | undefined): OutputContractDefinition | undefined {
  if (!contractId) return undefined
  return CONTRACTS.get(contractId)
}

export function validateOutputContractContent(
  input: OutputContractValidationInput,
): OutputContractValidationResult {
  if (!input.contractId) {
    return { ok: true, kind: 'none', skippedReason: 'no_contract' }
  }

  const definition = getOutputContractDefinition(input.contractId)
  if (!definition) {
    return {
      ok: false,
      contractId: input.contractId,
      code: 'UNKNOWN_OUTPUT_CONTRACT',
      message: `Unknown output contract: ${input.contractId}`,
      details: [`${input.contractId} is not registered`],
    }
  }

  if (definition.kind === 'natural_language') {
    return {
      ok: true,
      contractId: definition.contractId,
      kind: definition.kind,
      skippedReason: 'natural_language_contract',
    }
  }

  if (input.mode !== 'structured_json') {
    return {
      ok: true,
      contractId: definition.contractId,
      kind: definition.kind,
      skippedReason: 'non_structured_mode',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input.content)
  } catch (error) {
    return {
      ok: false,
      contractId: definition.contractId,
      kind: definition.kind,
      code: 'INVALID_JSON',
      message: `Output for ${definition.contractId} is not valid JSON`,
      details: [error instanceof Error ? error.message : String(error)],
    }
  }

  const details = validateParsedContract(definition.contractId, parsed)
  if (details.length > 0) {
    return {
      ok: false,
      contractId: definition.contractId,
      kind: definition.kind,
      code: 'SCHEMA_MISMATCH',
      message: `Output for ${definition.contractId} failed schema validation`,
      details,
    }
  }

  return {
    ok: true,
    contractId: definition.contractId,
    kind: definition.kind,
    parsed,
  }
}
```

- [ ] **Step 4: Run validator tests**

Run: `npm test -- tests/unit/contracts/output-contract-validator.test.ts`

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/contracts/output-contract-validator.ts tests/unit/contracts/output-contract-validator.test.ts
git commit -m "feat(contracts): add output contract validator"
```

Expected: commit succeeds. If the user did not request commits for this session, skip this step and report that the commit step was intentionally skipped.

---

### Task 2: Use Validator In Memory Extraction Boundary

**Files:**
- Modify: `src/memory/long-term-memory-extractor-service.ts`
- Modify: `tests/unit/memory/long-term-memory-extractor-service.test.ts`

**Interfaces:**
- Consumes: `validateOutputContractContent()` from `src/contracts/output-contract-validator.ts`
- Consumes: `StructuredOutputContractError` from `src/contracts/output-contract-validator.ts`
- Produces: memory extractor failure codes `INVALID_JSON` and `SCHEMA_MISMATCH` from the shared validator

- [ ] **Step 1: Add failing memory extractor test for schema mismatch code**

In `tests/unit/memory/long-term-memory-extractor-service.test.ts`, add this test inside `describe('Failure Isolation', () => { ... })` after the existing invalid JSON test:

```typescript
    it('should mark run failed with SCHEMA_MISMATCH when structured output contract fails', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }))

      const llmAdapter = createMockLLMAdapter(JSON.stringify({ candidates: [{ text: 'missing structural fields' }] }))
      const deps = createDeps(llmAdapter)

      const service = createLongTermMemoryExtractorService(deps)
      const result = await service.run()

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.errorCode).toBe('SCHEMA_MISMATCH')
      }

      const memories = longTermMemoryStore.getByUserId('user-1')
      expect(memories).toHaveLength(0)
    })
```

- [ ] **Step 2: Tighten existing schema mismatch assertion**

In `tests/unit/memory/long-term-memory-extractor-service.test.ts`, replace the assertion in `it('should mark run failed when LLM response has schema mismatch', ...)` with:

```typescript
      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.errorCode).toBe('SCHEMA_MISMATCH')
      }
```

- [ ] **Step 3: Run the focused memory tests to verify failure**

Run: `npm test -- tests/unit/memory/long-term-memory-extractor-service.test.ts -t "SCHEMA_MISMATCH|schema mismatch"`

Expected before implementation: FAIL because schema mismatch is still reported as `INVALID_JSON` or a generic error code.

- [ ] **Step 4: Import the shared validator in memory extractor service**

In `src/memory/long-term-memory-extractor-service.ts`, add this import after the existing `ModelInputBuilder` import:

```typescript
import {
  StructuredOutputContractError,
  validateOutputContractContent,
} from '../contracts/output-contract-validator.js'
```

- [ ] **Step 5: Replace ad hoc parser with validator-backed parser**

In `src/memory/long-term-memory-extractor-service.ts`, replace the existing `parseLLMResponse(content: string)` function with:

```typescript
function parseLLMResponse(content: string): ExtractedMemoryCandidate[] {
  const validation = validateOutputContractContent({
    contractId: 'output:memory-candidate.schema',
    mode: 'structured_json',
    content,
  })

  if (!validation.ok) {
    throw new StructuredOutputContractError(validation)
  }

  const parsed = validation.parsed as { candidates: ExtractedMemoryCandidate[] }
  return parsed.candidates
}
```

- [ ] **Step 6: Preserve validator failure code in the run result**

In `src/memory/long-term-memory-extractor-service.ts`, replace the catch block around `parseLLMResponse(llmResult.response.content)` with:

```typescript
        try {
          candidates = parseLLMResponse(llmResult.response.content)
        } catch (error) {
          const errorCode = error instanceof StructuredOutputContractError ? error.code : 'INVALID_JSON'
          deps.memoryExtractionRunStore.markFailed(run.runId, errorCode)
          return { status: 'failed', errorCode }
        }
```

- [ ] **Step 7: Run memory extractor tests**

Run: `npm test -- tests/unit/memory/long-term-memory-extractor-service.test.ts`

Expected: all tests in the file pass. The existing domain filtering test `should only write valid candidates and skip invalid ones` must still pass, proving structural validation did not replace domain-level candidate filtering.

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/memory/long-term-memory-extractor-service.ts tests/unit/memory/long-term-memory-extractor-service.test.ts
git commit -m "refactor(memory): validate extraction output contract"
```

Expected: commit succeeds. If the user did not request commits for this session, skip this step and report that the commit step was intentionally skipped.

---

### Task 3: Validate Structured JSON Final Responses In AgentKernel

**Files:**
- Create: `tests/unit/kernel/agent-kernel-output-contract.test.ts`
- Modify: `src/kernel/agent-kernel.ts`

**Interfaces:**
- Consumes: `validateOutputContractContent()` from `src/contracts/output-contract-validator.ts`
- Produces: `KernelRunResult.structuredResult` populated with parsed JSON when a structured JSON final response validates successfully
- Produces: `KernelRunResult.error.code` set to `INVALID_JSON`, `SCHEMA_MISMATCH`, or `UNKNOWN_OUTPUT_CONTRACT` when a structured JSON final response fails validation

- [ ] **Step 1: Write failing AgentKernel output contract tests**

Use `apply_patch` to add `tests/unit/kernel/agent-kernel-output-contract.test.ts` with this content:

```typescript
import { describe, expect, it } from 'vitest'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { ContextBundle } from '../../../src/context/types.js'
import type { KernelConfig, KernelRunInput } from '../../../src/kernel/types.js'
import type { BuiltModelInput, ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js'
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js'
import type { LLMProvider } from '../../../src/llm/provider.js'
import type { LLMRequest, LLMResult } from '../../../src/llm/types.js'

class StaticLLMAdapter implements LLMAdapter {
  config: LLMAdapterConfig = { providers: [], defaultTimeoutMs: 10000, enableCircuitBreaker: false }
  providers: LLMProvider[] = []

  constructor(private readonly content: string) {}

  async complete(request: LLMRequest): Promise<LLMResult> {
    return {
      success: true,
      response: {
        id: 'response-contract-test',
        model: request.model,
        content: this.content,
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      },
      providerId: 'test-provider',
    }
  }

  async *stream(): AsyncGenerator<{ delta: string; providerId: string }> {}
  addProvider(provider: LLMProvider): void {
    this.providers.push(provider)
  }
  removeProvider(providerId: string): void {
    this.providers = this.providers.filter((provider) => provider.id !== providerId)
  }
  getProvider(providerId: string): LLMProvider | undefined {
    return this.providers.find((provider) => provider.id === providerId)
  }
  getHealthyProviders(): LLMProvider[] {
    return this.providers
  }
  updateProviderPriority(_providerId: string, _priority: number): void {}
}

function createBuiltModelInput(input: ModelInputBuildInput): BuiltModelInput {
  return {
    messages: [{ role: 'user', content: input.currentUserMessage ?? 'test' }],
    segments: {
      staticPrefix: 'test-static-prefix',
      tenantProject: '',
      toolPlane: '',
      contextBundle: input.currentUserMessage ?? 'test',
    },
    segmentHashes: {
      segmentA: 'a'.repeat(64),
      segmentB: 'b'.repeat(64),
      segmentC: 'c'.repeat(64),
      segmentD: 'd'.repeat(64),
    },
    metadata: {
      mode: input.mode,
      agentKind: input.agentKind ?? 'kernel',
      agentType: input.agentType ?? 'main',
      agentProfile: input.agentProfile ?? 'default_main',
      providerFamily: input.providerFamily,
      outputContract: input.outputContract,
      messageCount: 1,
    },
  }
}

function createContextBundle(): ContextBundle {
  return {
    bundleId: 'bundle-contract-test',
    runId: 'run-contract-test',
    agentId: 'agent-contract-test',
    agentType: 'main',
    userId: 'user-contract-test',
    invocationSource: 'gateway_intent',
    pinnedItems: [],
    orderedItems: [],
    tokenEstimate: 100,
  }
}

function createKernel(content: string): AgentKernel {
  const config: KernelConfig = {
    llmAdapter: new StaticLLMAdapter(content),
    toolExecutor: { execute: async () => ({ success: true }) },
    contextManager: {
      assembleBundle: createContextBundle,
      getItems: () => [],
      addItem: () => {},
      applyDelta: () => {},
    },
    dispatcher: {
      dispatch: async () => ({
        requestId: 'req-contract-test',
        actionId: 'act-contract-test',
        status: 'completed',
        targetRuntime: 'tool_plane',
        createdAt: new Date().toISOString(),
      }),
    },
    modelInputBuilder: { build: async (input) => createBuiltModelInput(input) },
    maxIterations: 1,
    timeoutMs: 5000,
    defaultModel: 'test-model',
    providerFamily: 'openai',
  }
  return new AgentKernel(config)
}

function createRunInput(modelInputOverride: ModelInputBuildInput): KernelRunInput {
  return {
    contextBundle: createContextBundle(),
    runId: 'run-contract-test',
    agentId: 'agent-contract-test',
    agentType: 'main',
    userId: 'user-contract-test',
    modelInputOverride,
    maxIterations: 1,
    timeoutMs: 5000,
  }
}

const validMemoryEnvelope = {
  candidates: [
    {
      memoryType: 'user_preference',
      text: 'User prefers concise summaries',
      confidence: 0.91,
      importance: 'medium',
      sensitivity: 'low',
      keywords: ['concise', 'summaries'],
      scope: { visibility: 'private_user' },
      sourceRefs: { transcriptRefs: ['turn-1'] },
    },
  ],
}

describe('AgentKernel output contract validation', () => {
  it('returns parsed structuredResult for valid structured_json final content', async () => {
    const kernel = createKernel(JSON.stringify(validMemoryEnvelope))

    const result = await kernel.run(
      createRunInput({
        mode: 'structured_json',
        agentType: 'background',
        agentProfile: 'memory',
        providerFamily: 'openai',
        outputContract: 'output:memory-candidate.schema',
        currentUserMessage: 'extract memory',
      }),
    )

    expect(result.finalStatus).toBe('completed')
    expect(result.structuredResult).toEqual(validMemoryEnvelope)
  })

  it('fails structured_json final content when the output contract schema fails', async () => {
    const kernel = createKernel(JSON.stringify({ candidates: [{ text: 'missing fields' }] }))

    const result = await kernel.run(
      createRunInput({
        mode: 'structured_json',
        agentType: 'background',
        agentProfile: 'memory',
        providerFamily: 'openai',
        outputContract: 'output:memory-candidate.schema',
        currentUserMessage: 'extract memory',
      }),
    )

    expect(result.finalStatus).toBe('failed')
    expect(result.error?.code).toBe('SCHEMA_MISMATCH')
    expect(result.transcript.some((entry) => entry.type === 'error')).toBe(true)
  })

  it('keeps default chat natural-language responses unchanged', async () => {
    const kernel = createKernel('Plain text response')

    const result = await kernel.run(
      createRunInput({
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
        outputContract: 'output:default-chat.schema',
        currentUserMessage: 'hello',
      }),
    )

    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Plain text response')
    expect(result.structuredResult).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run AgentKernel contract tests to verify failure**

Run: `npm test -- tests/unit/kernel/agent-kernel-output-contract.test.ts`

Expected before implementation: FAIL because `structuredResult` is not populated and invalid structured content still completes.

- [ ] **Step 3: Import the validator in AgentKernel**

In `src/kernel/agent-kernel.ts`, add this import after the existing imports:

```typescript
import { validateOutputContractContent } from '../contracts/output-contract-validator.js'
```

- [ ] **Step 4: Add a private validation helper to AgentKernel**

In `src/kernel/agent-kernel.ts`, add this method before `private buildResult(...)`:

```typescript
  private validateFinalContentIfNeeded(
    content: string,
  ): { ok: true; structuredResult?: unknown } | { ok: false; code: string; message: string; details: readonly string[] } {
    const validation = validateOutputContractContent({
      contractId: this.lastBuiltModelInput?.metadata.outputContract,
      mode: this.lastBuiltModelInput?.metadata.mode ?? 'function_calling',
      content,
    })

    if (!validation.ok) {
      return {
        ok: false,
        code: validation.code,
        message: validation.message,
        details: validation.details,
      }
    }

    return validation.parsed === undefined ? { ok: true } : { ok: true, structuredResult: validation.parsed }
  }
```

- [ ] **Step 5: Validate final content before completing the run**

In `src/kernel/agent-kernel.ts`, replace this block:

```typescript
        if (llmResponse.content) {
          state.status = 'completed'
          return this.buildResult(state, 'completed', undefined, llmResponse.content)
        }
```

with:

```typescript
        if (llmResponse.content) {
          const finalContentValidation = this.validateFinalContentIfNeeded(llmResponse.content)
          if (!finalContentValidation.ok) {
            state.status = 'failed'
            this.commitTranscript(state, 'error', {
              code: finalContentValidation.code,
              message: finalContentValidation.message,
              details: finalContentValidation.details,
            })
            return this.buildResult(state, 'failed', {
              code: finalContentValidation.code,
              message: finalContentValidation.message,
            })
          }

          state.status = 'completed'
          return this.buildResult(
            state,
            'completed',
            undefined,
            llmResponse.content,
            finalContentValidation.structuredResult,
          )
        }
```

- [ ] **Step 6: Run AgentKernel output contract tests**

Run: `npm test -- tests/unit/kernel/agent-kernel-output-contract.test.ts`

Expected: PASS.

- [ ] **Step 7: Run existing AgentKernel projection tests**

Run: `npm test -- tests/unit/kernel/agent-kernel-tool-projection.test.ts`

Expected: PASS; default function-calling behavior remains unchanged.

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/kernel/agent-kernel.ts tests/unit/kernel/agent-kernel-output-contract.test.ts
git commit -m "feat(kernel): validate structured output contracts"
```

Expected: commit succeeds. If the user did not request commits for this session, skip this step and report that the commit step was intentionally skipped.

---

### Task 4: Make API Tool Definitions Use ToolRegistry Schemas

**Files:**
- Modify: `src/api/tool-catalog.ts`
- Modify: `tests/unit/tools/tool-catalog-consistency.test.ts`

**Interfaces:**
- Consumes: `ToolRegistry.listTools(): ToolDefinition[]`
- Consumes: `toLLMToolDefinition(tool: ToolDefinition): LLMToolDefinition`
- Produces: `getToolDefinitions(registry: ToolRegistry): LLMToolDefinition[]`

- [ ] **Step 1: Write failing catalog schema source test**

In `tests/unit/tools/tool-catalog-consistency.test.ts`, update the imports at the top:

```typescript
import { getToolDefinitions } from '../../../src/api/tool-catalog.js'
```

Then add this test at the end of `describe('Tool Catalog Consistency', () => { ... })`:

```typescript
  it('getToolDefinitions should use registered ToolRegistry schemas exactly', () => {
    const definitions = getToolDefinitions(registry)
    const registeredTools = registry.listTools()
    const registryByName = new Map(registeredTools.map((tool) => [tool.name, tool]))

    expect(definitions).toHaveLength(registeredTools.length)

    for (const definition of definitions) {
      const registeredTool = registryByName.get(definition.function.name)
      expect(registeredTool).toBeDefined()
      expect(definition.function.description).toBe(registeredTool!.description)
      expect(definition.function.parameters).toEqual(registeredTool!.schema)
    }

    const sessionHistory = definitions.find((definition) => definition.function.name === 'session_history')
    expect(sessionHistory).toBeDefined()
    const properties = sessionHistory!.function.parameters.properties as Record<string, unknown>
    expect(properties.sessionId).toMatchObject({ type: 'string' })
    expect(sessionHistory!.function.parameters.required).toContain('sessionId')
  })
```

- [ ] **Step 2: Run focused catalog test to verify failure**

Run: `npm test -- tests/unit/tools/tool-catalog-consistency.test.ts -t "registered ToolRegistry schemas"`

Expected before implementation: FAIL because `getToolDefinitions()` does not accept a registry and returns fallback empty parameter schemas.

- [ ] **Step 3: Replace fallback tool definition generation**

In `src/api/tool-catalog.ts`, update the imports:

```typescript
import type { ToolSummary } from './types.js'
import type { ToolDefinition as LLMToolDefinition } from '../llm/types.js'
import type { ToolRegistry } from '../tools/types.js'
import type { CanonicalToolCatalogEntry } from '../tools/tool-catalog.js'
import { getFallbackToolCatalog, buildRuntimeToolCatalog } from '../tools/tool-catalog.js'
import { toLLMToolDefinition } from '../tools/tool-plane-prompt-projection.js'
```

Then replace the `getToolDefinitions()` function with:

```typescript
export function getToolDefinitions(registry: ToolRegistry): LLMToolDefinition[] {
  return registry.listTools().map(toLLMToolDefinition)
}
```

- [ ] **Step 4: Run catalog consistency tests**

Run: `npm test -- tests/unit/tools/tool-catalog-consistency.test.ts`

Expected: all tests in the file pass.

- [ ] **Step 5: Search for no-arg getToolDefinitions callers**

Run: `rg -n "getToolDefinitions\(" src tests`

Expected: only the function definition in `src/api/tool-catalog.ts` and the new test call with `registry` appear. If another no-arg call exists, update it to pass the existing `toolRegistry` dependency from the surrounding context.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/api/tool-catalog.ts tests/unit/tools/tool-catalog-consistency.test.ts
git commit -m "refactor(tools): source api tool schemas from registry"
```

Expected: commit succeeds. If the user did not request commits for this session, skip this step and report that the commit step was intentionally skipped.

---

### Task 5: Fail Closed When Foreground Tool Projection Lacks Schemas

**Files:**
- Modify: `src/foreground/tool-projection-mapper.ts`
- Modify: `src/foreground/foreground-agent.ts`
- Modify: `tests/unit/foreground/tool-projection.test.ts`
- Modify: `tests/unit/foreground/runturn-kernel.test.ts`

**Interfaces:**
- Consumes: `ToolRegistry.getTool(name: string): ToolDefinition | null`
- Produces: `buildForegroundToolProjection()` behavior where every LLM-facing tool definition uses either a registered tool schema or an explicit summary schema
- Produces: fail-closed error message `Tool schema unavailable for <tool>; pass ToolRegistry or include summary schema`
- Produces: `ForegroundAgentImpl.getToolSummaries()` behavior where no registry means no callable tools, rather than fallback catalog summaries with no schemas

- [ ] **Step 1: Update foreground test helper to include an explicit schema**

In `tests/unit/foreground/tool-projection.test.ts`, replace the `createTool` helper with:

```typescript
  const createTool = (
    name: string,
    category: ToolCategory,
    sensitivity: ToolSensitivity,
    description: string = 'Test tool',
    schema = {
      type: 'object' as const,
      properties: {
        input: {
          type: 'string',
          description: 'Test input',
        },
      },
      required: [] as string[],
    },
  ) => ({
    name,
    category,
    sensitivity,
    description,
    schema,
  })
```

- [ ] **Step 2: Update expected summary schemas in the existing projection test**

In `tests/unit/foreground/tool-projection.test.ts`, replace the expected tool definition assertions in `it('should generate tool definitions for function calling mode', ...)` with:

```typescript
      expect(result.toolDefinitions).toHaveLength(2)
      expect(result.toolDefinitions[0]).toEqual({
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web',
          parameters: {
            type: 'object',
            properties: {
              input: {
                type: 'string',
                description: 'Test input',
              },
            },
            required: [],
          },
        },
      })
      expect(result.toolDefinitions[1]).toEqual({
        type: 'function',
        function: {
          name: 'status_query',
          description: 'Query status',
          parameters: {
            type: 'object',
            properties: {
              input: {
                type: 'string',
                description: 'Test input',
              },
            },
            required: [],
          },
        },
      })
```

- [ ] **Step 3: Add failing test for missing schema fail-closed behavior**

In `tests/unit/foreground/tool-projection.test.ts`, add this test inside `describe('edge cases', () => { ... })`:

```typescript
    it('throws when projected tool lacks registry and summary schema', () => {
      const allTools = [
        {
          name: 'web_search',
          category: 'search' as ToolCategory,
          sensitivity: 'low' as ToolSensitivity,
          description: 'Search the web',
        },
      ]

      expect(() => buildForegroundToolProjection(createMockInput(), allTools)).toThrow(
        'Tool schema unavailable for web_search; pass ToolRegistry or include summary schema',
      )
    })
```

- [ ] **Step 4: Add registry precedence regression**

In `tests/unit/foreground/tool-projection.test.ts`, add this test after the existing `should expose status_query tool with optional targetId parameter` test:

```typescript
    it('uses ToolRegistry schema before summary schema when both are present', () => {
      const toolRegistry = createToolRegistry()
      toolRegistry.register(createStatusQueryTool())

      const allTools = [
        createTool('status_query', 'internal', 'low', 'Query active work status', {
          type: 'object',
          properties: {
            wrong: { type: 'string' },
          },
          required: ['wrong'],
        }),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools, toolRegistry)
      const statusQueryDef = result.toolDefinitions[0]
      const properties = statusQueryDef.function.parameters.properties as Record<string, unknown>

      expect(properties).toHaveProperty('targetId')
      expect(properties).not.toHaveProperty('wrong')
      expect(statusQueryDef.function.parameters.required).toEqual([])
    })
```

- [ ] **Step 5: Run focused foreground projection tests to verify failure**

Run: `npm test -- tests/unit/foreground/tool-projection.test.ts -t "lacks registry|registry schema before summary|function calling mode"`

Expected before implementation: FAIL because missing schema currently falls back to `{ type: 'object', properties: {} }` and registry precedence may pass only partially.

- [ ] **Step 6: Add foreground agent no-registry fail-closed regression**

In `tests/unit/foreground/runturn-kernel.test.ts`, add this helper after `createMockKernelResult(...)`:

```typescript
function createSchemaBackedToolRegistry(): ToolRegistry {
  const registry = createToolRegistry()
  const tools: ToolDefinition[] = [
    {
      name: 'ask_user',
      description: 'Ask the user for clarification',
      category: 'internal',
      sensitivity: 'low',
      schema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Question to ask the user' },
        },
        required: ['question'],
      },
      handler: async () => ({ success: true, data: {} }),
    },
    {
      name: 'status_query',
      description: 'Query active work status',
      category: 'read',
      sensitivity: 'low',
      schema: {
        type: 'object',
        properties: {
          targetId: { type: 'string', description: 'Optional target ID' },
        },
        required: [],
      },
      handler: async () => ({ success: true, data: {} }),
    },
    {
      name: 'memory_retrieve',
      description: 'Retrieve memory records',
      category: 'read',
      sensitivity: 'medium',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Memory search query' },
        },
        required: ['query'],
      },
      handler: async () => ({ success: true, data: {} }),
    },
  ]

  for (const tool of tools) {
    registry.register(tool)
  }

  return registry
}
```

Then update the `beforeEach()` agent construction in `tests/unit/foreground/runturn-kernel.test.ts` from:

```typescript
    agent = createForegroundAgent({ agentKernel: mockAgentKernel })
```

to:

```typescript
    agent = createForegroundAgent({ agentKernel: mockAgentKernel, toolRegistry: createSchemaBackedToolRegistry() })
```

Then add this test inside `describe('ForegroundAgent.runTurn via AgentKernel', () => { ... })` after the first projection test:

```typescript
  it('does not synthesize fallback tool schemas when no ToolRegistry is configured', async () => {
    const agentWithoutRegistry = createForegroundAgent({ agentKernel: mockAgentKernel })

    await agentWithoutRegistry.runTurn(createMockInput())

    const kernelInput = vi.mocked(mockAgentKernel.run).mock.calls[0][0] as KernelRunInput
    expect(kernelInput.toolProjection).toEqual({ toolIds: [], tools: [] })
  })
```

- [ ] **Step 7: Run foreground agent tests to verify failure**

Run: `npm test -- tests/unit/foreground/runturn-kernel.test.ts -t "does not synthesize fallback tool schemas|function-calling projection"`

Expected before implementation: FAIL because `createForegroundAgent()` still uses fallback catalog summaries when no `ToolRegistry` is configured.

- [ ] **Step 8: Add explicit summary schema conversion helper**

In `src/foreground/tool-projection-mapper.ts`, add this helper after `function isToolSafeForDefaultProjection(...)`:

```typescript
function toLLMToolDefinitionFromSummary(tool: {
  name: string
  description: string
  schema?: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
    description?: string
  }
}): ToolDefinition {
  if (!tool.schema) {
    throw new Error(`Tool schema unavailable for ${tool.name}; pass ToolRegistry or include summary schema`)
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    },
  }
}
```

- [ ] **Step 9: Remove the empty schema fallback**

In `src/foreground/tool-projection-mapper.ts`, replace the `toolDefinitions` mapping block with:

```typescript
  const toolDefinitions: ToolDefinition[] = projectedTools.map((tool) => {
    if (toolRegistry) {
      const fullTool = toolRegistry.getTool(tool.name)
      if (fullTool) {
        return toLLMToolDefinition(fullTool)
      }
    }

    return toLLMToolDefinitionFromSummary(tool)
  })
```

- [ ] **Step 10: Stop foreground agent from using fallback catalog summaries as schemas**

In `src/foreground/foreground-agent.ts`, add this private method inside `ForegroundAgentImpl` before `async runTurn(...)`:

```typescript
  private getToolSummaries(): ReturnType<typeof getToolCatalog> {
    if (this.toolCatalog) {
      return this.toolCatalog
    }

    if (!this.toolRegistry) {
      return []
    }

    return this.toolRegistry.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      sensitivity: tool.sensitivity,
    }))
  }
```

Then replace this line in `runTurn()`:

```typescript
    const allTools = this.toolCatalog ?? getToolCatalog()
```

with:

```typescript
    const allTools = this.getToolSummaries()
```

- [ ] **Step 11: Run foreground projection tests**

Run: `npm test -- tests/unit/foreground/tool-projection.test.ts`

Expected: all tests in the file pass.

- [ ] **Step 12: Run foreground agent tests for production wiring**

Run: `npm test -- tests/unit/foreground/runturn-kernel.test.ts tests/integration/api/context-dependencies.test.ts`

Expected: PASS. This confirms `createApiContext()` still injects `toolRegistry` into `createForegroundAgent()` and production foreground runs do not depend on schema summaries.

- [ ] **Step 13: Run typecheck**

Run: `npm run typecheck`

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 14: Commit**

Run:

```bash
git add src/foreground/tool-projection-mapper.ts src/foreground/foreground-agent.ts tests/unit/foreground/tool-projection.test.ts tests/unit/foreground/runturn-kernel.test.ts
git commit -m "refactor(foreground): fail closed without tool schemas"
```

Expected: commit succeeds. If the user did not request commits for this session, skip this step and report that the commit step was intentionally skipped.

---

### Task 6: Add Architecture Guards And Final Verification

**Files:**
- Modify: `tests/architecture/no-legacy-prompt-path.test.ts`

**Interfaces:**
- Consumes: outputs from Tasks 1-5
- Produces: architecture coverage preventing empty schema fallback and structured output parser bypasses from returning silently

- [ ] **Step 1: Add architecture tests for Phase 1 contract hardening**

In `tests/architecture/no-legacy-prompt-path.test.ts`, add this block before `describe('New Path Preserved', () => { ... })`:

```typescript
  describe('Phase 1 Contract Hardening Guards', () => {
    it('api tool catalog does not synthesize empty LLM parameter schemas', () => {
      const filePath = join(srcDir, 'api', 'tool-catalog.ts')
      const content = readFileSync(filePath, 'utf-8')

      expect(content).toContain('getToolDefinitions(registry: ToolRegistry)')
      expect(content).toContain('registry.listTools().map(toLLMToolDefinition)')
      expect(content).not.toMatch(/parameters:\s*\{\s*type:\s*['"]object['"],\s*properties:\s*\{\s*\}\s*\}/)
    })

    it('foreground projection mapper fails closed when schemas are unavailable', () => {
      const filePath = join(srcDir, 'foreground', 'tool-projection-mapper.ts')
      const content = readFileSync(filePath, 'utf-8')

      expect(content).toContain('Tool schema unavailable for')
      expect(content).toContain('toLLMToolDefinitionFromSummary')
      expect(content).not.toContain("tool.schema ?? { type: 'object' as const, properties: {} }")
    })

    it('structured output JSON boundaries use the shared contract validator', () => {
      const memoryServicePath = join(srcDir, 'memory', 'long-term-memory-extractor-service.ts')
      const agentKernelPath = join(srcDir, 'kernel', 'agent-kernel.ts')
      const memoryService = readFileSync(memoryServicePath, 'utf-8')
      const agentKernel = readFileSync(agentKernelPath, 'utf-8')

      expect(memoryService).toContain('validateOutputContractContent')
      expect(memoryService).toContain("contractId: 'output:memory-candidate.schema'")
      expect(agentKernel).toContain('validateOutputContractContent')
      expect(agentKernel).toContain('validateFinalContentIfNeeded')
    })
  })
```

- [ ] **Step 2: Run architecture guard tests**

Run: `npm test -- tests/architecture/no-legacy-prompt-path.test.ts -t "Phase 1 Contract Hardening Guards"`

Expected: PASS after Tasks 1-5. If this fails, fix only the implementation drift that violates the guard; do not weaken the guard.

- [ ] **Step 3: Run all focused Phase 1 tests**

Run:

```bash
npm test -- tests/unit/contracts/output-contract-validator.test.ts tests/unit/memory/long-term-memory-extractor-service.test.ts tests/unit/kernel/agent-kernel-output-contract.test.ts tests/unit/kernel/agent-kernel-tool-projection.test.ts tests/unit/tools/tool-catalog-consistency.test.ts tests/unit/foreground/tool-projection.test.ts tests/unit/foreground/runturn-kernel.test.ts tests/integration/api/context-dependencies.test.ts tests/architecture/no-legacy-prompt-path.test.ts
```

Expected: all listed test files pass.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 5: Verify whitespace**

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 6: Search for empty schema fallback regressions in production source**

Run: `rg -n "tool\.schema \?\?|parameters:\s*\{\s*type:\s*['\"]object['\"],\s*properties:\s*\{\s*\}\s*\}" src/api/tool-catalog.ts src/foreground/tool-projection-mapper.ts src/tools/tool-plane-prompt-projection.ts`

Expected: no output.

- [ ] **Step 7: Inspect git status**

Run: `git status --short`

Expected: only intended Phase 1 files are modified or no changes remain if commits were made.

- [ ] **Step 8: Summarize Phase 1 verification evidence**

Report these exact items to the reviewer:

```markdown
Phase 1 verification evidence:
- `npm run typecheck`: PASS
- Focused Phase 1 tests: PASS
- `git diff --check`: PASS
- Empty schema fallback scan: PASS
- Files changed: paste the exact `git status --short` output, or write `none` when there are no uncommitted changes
```

Do not claim Phase 2 context budget rollout, Phase 3 ReAct trace, or Phase 4 golden dataset work is complete.

- [ ] **Step 9: Commit architecture guard**

Run:

```bash
git add tests/architecture/no-legacy-prompt-path.test.ts
git commit -m "test(architecture): guard phase1 contract hardening"
```

Expected: commit succeeds. If the user did not request commits for this session, skip this step and report that the commit step was intentionally skipped.
