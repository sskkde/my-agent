# Agent Architecture Phase 0 Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 0 of the agent architecture optimization by proving all production LLM paths use the real `ModelInputBuilder` and removing foreground/kernel prompt-path ambiguity.

**Architecture:** The existing `ModelInputBuilder` remains the single model-input construction component. Phase 0 only converges dependencies, removes a stub fallback, tightens architecture guards, and documents the production LLM call path inventory; schema validators, tool schema unification, context rollout, ReAct trace, and prompt golden tests are intentionally deferred to later phases.

**Tech Stack:** TypeScript, ESM modules, Vitest, Fastify API context factories, SQLite `:memory:` tests, existing prompt template registry and `ModelInputBuilder`.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-07-agent-architecture-optimization-design.md`.
- Scope is Phase 0 only: LLM call path inventory, `kernel-config-builder` stub path disposition, unused `ForegroundAgent` option cleanup, and minimal production-path regression tests.
- Do not implement structured output runtime validator in this plan.
- Do not change tool schema projection behavior except as required by compile fixes from dependency convergence.
- Do not enable or change P10 prompt/memory feature flags.
- Do not persist full raw Chain of Thought.
- Keep existing API behavior and public route contracts unchanged.
- TypeScript strict mode is enabled with `noUnusedLocals` and `noUnusedParameters`; remove unused imports and fields.
- Use TDD for production code changes: write failing test, run it, implement minimal code, rerun.

---

## File Structure

- Create: `docs/reports/AGENT_ARCHITECTURE_PHASE0_INVENTORY.md`
- Responsibility: Human-readable inventory of production and test LLM call paths, the chosen disposition for `kernel-config-builder`, and explicit non-goals for later phases.

- Modify: `src/processing/processor-orchestration.ts`
- Responsibility: Add `modelInputBuilder: ModelInputBuilder` to `ProcessorOrchestrationDeps` so any kernel config built from orchestration dependencies must receive the real model input builder.

- Modify: `src/api/context.ts`
- Responsibility: Pass the already-created real `modelInputBuilder` into `createOrchestrationMessageProcessor()` dependencies.

- Modify: `src/foreground/kernel-config-builder.ts`
- Responsibility: Remove `createMinimalModelInputBuilder()` and use `deps.modelInputBuilder` when constructing `KernelConfig`.

- Modify: `src/foreground/foreground-agent.ts`
- Responsibility: Remove unused foreground options and imports: `llmAdapter`, `modelInputBuilder`, `modelInputSnapshotStore`, `promptProjectionResolver`.

- Modify: `tests/unit/foreground/kernel-config-builder.test.ts`
- Responsibility: Add a regression that `buildKernelConfigFromDeps()` preserves the injected real builder and no longer creates an empty-segment stub.

- Modify: `tests/unit/foreground/runturn-kernel.test.ts`
- Responsibility: Update mock `ProcessorOrchestrationDeps` builders to include `modelInputBuilder`; keep compact executor regression intact.

- Modify: `tests/unit/processing/processor-orchestration.test.ts`
- Responsibility: Add required `modelInputBuilder` to unit deps setup.

- Modify: `tests/integration/foreground/kernel-driven-turns.integration.test.ts`
- Responsibility: Add required `modelInputBuilder` to integration deps setup.

- Modify: `tests/architecture/no-legacy-prompt-path.test.ts`
- Responsibility: Add architecture guards preventing `createMinimalModelInputBuilder` and other empty segment stub builders from reappearing in `src/`.

- Modify: `tests/integration/api/context-dependencies.test.ts`
- Responsibility: Add an integration regression that a default `createApiContext()` message processing path sends an LLM request whose first system message contains non-empty Segment A content from the real `ModelInputBuilder`.

---

### Task 1: Write Phase 0 LLM Call Path Inventory

**Files:**
- Create: `docs/reports/AGENT_ARCHITECTURE_PHASE0_INVENTORY.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-07-agent-architecture-optimization-design.md`
- Produces: A reviewable inventory document used by Tasks 2-5 to keep scope bounded.

- [ ] **Step 1: Create the inventory report**

Use `apply_patch` to add `docs/reports/AGENT_ARCHITECTURE_PHASE0_INVENTORY.md` with this exact content:

```markdown
# Agent Architecture Phase 0 Inventory

> Date: 2026-07-07
> Scope: Phase 0 architecture convergence for `docs/superpowers/specs/2026-07-07-agent-architecture-optimization-design.md`

## Purpose

Phase 0 proves that production LLM requests use the real seven-layer `ModelInputBuilder` and removes prompt-path ambiguity before later phases add validators, context rollout, trace, or prompt evaluation.

## Production LLM Call Paths

| Path | Entry | Model Input Builder Source | Phase 0 Disposition |
| --- | --- | --- | --- |
| Foreground chat | `src/api/context.ts` -> `createOrchestrationMessageProcessor()` -> `ForegroundAgent.runTurn()` -> `AgentKernel.run()` | Real `ModelInputBuilder` constructed in `src/api/context.ts` and injected into `AgentKernel` | Preserve and add integration regression for outbound LLM request messages. |
| Kernel direct execution | `new AgentKernel({ modelInputBuilder })` | Caller-provided `KernelConfig.modelInputBuilder` | Preserve; unit and integration tests already construct explicit builders. |
| Search subagent | `src/api/context.ts` -> `createSearchSubagent()` | Real `ModelInputBuilder` from API context | Preserve; no behavior change in Phase 0. |
| Long-term memory extraction | `createLongTermMemoryScheduler()` -> extractor service | Real `ModelInputBuilder` from API context | Preserve; no behavior change in Phase 0. |
| Subagent context manager | `createDefaultSubagentContextManager()` | Explicit `modelInputBuilder` in subagent manager options | Preserve; no behavior change in Phase 0. |
| Foreground kernel config builder | `src/foreground/kernel-config-builder.ts` -> `buildKernelConfigFromDeps()` | Currently creates `createMinimalModelInputBuilder()` stub | Replace with required `deps.modelInputBuilder`. |

## Phase 0 Decisions

- `ProcessorOrchestrationDeps` will require `modelInputBuilder: ModelInputBuilder`.
- `buildKernelConfigFromDeps()` will not create or fallback to a local stub builder.
- `createForegroundAgent()` will expose only options it actually uses.
- Architecture tests will prevent reintroduction of empty segment model-input stubs in `src/`.

## Deferred To Later Phases

- Runtime output contract validator.
- Tool schema single-source enforcement beyond existing projections.
- Segment D token budget policy changes.
- Structured ReAct trace and richer decision trace.
- Golden dataset and prompt regression runner.
```

- [ ] **Step 2: Verify report has no placeholders**

Run: `rg -n "T[B]D|TO[D]O|待[定]|\?\?|PLACEHOLD[E]R|FIXM[E]" docs/reports/AGENT_ARCHITECTURE_PHASE0_INVENTORY.md`

Expected: no output and exit code 1 from `rg` because there are no matches.

- [ ] **Step 3: Verify markdown whitespace**

Run: `git diff --check -- docs/reports/AGENT_ARCHITECTURE_PHASE0_INVENTORY.md`

Expected: no output and exit code 0.

- [ ] **Step 4: Commit**

Run:

```bash
git add docs/reports/AGENT_ARCHITECTURE_PHASE0_INVENTORY.md
git commit -m "docs: add agent architecture phase0 inventory"
```

Expected: commit succeeds. If the user did not request commits for this session, skip this step and report that the commit step was intentionally skipped.

---

### Task 2: Require Real ModelInputBuilder In Kernel Config Builder

**Files:**
- Modify: `src/processing/processor-orchestration.ts`
- Modify: `src/api/context.ts`
- Modify: `src/foreground/kernel-config-builder.ts`
- Modify: `tests/unit/foreground/kernel-config-builder.test.ts`
- Modify: `tests/unit/foreground/runturn-kernel.test.ts`
- Modify: `tests/unit/processing/processor-orchestration.test.ts`
- Modify: `tests/integration/foreground/kernel-driven-turns.integration.test.ts`

**Interfaces:**
- Consumes: `ModelInputBuilder` from `src/kernel/model-input/model-input-builder.ts`
- Produces: `ProcessorOrchestrationDeps.modelInputBuilder: ModelInputBuilder`
- Produces: `buildKernelConfigFromDeps(deps: ProcessorOrchestrationDeps, agentConfig?: AgentConfig): KernelConfig` using `deps.modelInputBuilder`

- [ ] **Step 1: Write failing unit test for injected builder preservation**

In `tests/unit/foreground/kernel-config-builder.test.ts`, update imports:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildKernelConfigFromDeps } from '../../../src/foreground/kernel-config-builder.js'
import type { ProcessorOrchestrationDeps } from '../../../src/processing/processor-orchestration.js'
import type { DispatchRequest, DispatchResult } from '../../../src/dispatcher/types.js'
import { createRealModelInputBuilder } from '../../helpers/model-input.js'
```

Then add this test inside `describe('buildKernelConfigFromDeps', () => { ... })` after the existing tool executor test:

```typescript
  it('uses the injected real ModelInputBuilder instead of creating an empty-segment stub', async () => {
    const modelInputBuilder = createRealModelInputBuilder()
    const deps = {
      runtimeDispatcher: { dispatch: vi.fn() },
      llmAdapter: {},
      modelInputBuilder,
    } as unknown as ProcessorOrchestrationDeps

    const config = buildKernelConfigFromDeps(deps)

    expect(config.modelInputBuilder).toBe(modelInputBuilder)

    const built = await config.modelInputBuilder.build({
      mode: 'function_calling',
      agentType: 'main',
      agentProfile: 'default_main',
      providerFamily: 'openai',
      outputContract: 'output:default-chat.schema',
      currentUserMessage: 'hello',
      toolProjection: { toolIds: [] },
    })

    expect(built.segments.staticPrefix).toContain('You are a foreground routing agent')
    expect(built.segmentHashes.segmentA).toMatch(/^[a-f0-9]{64}$/)
    expect(built.segmentHashes.segmentA).not.toBe('')
  })
```

- [ ] **Step 2: Run failing test**

Run: `npm test -- tests/unit/foreground/kernel-config-builder.test.ts -t "uses the injected real ModelInputBuilder"`

Expected before implementation: TypeScript compile fails because `ProcessorOrchestrationDeps` does not define `modelInputBuilder`, or the assertion fails because `config.modelInputBuilder` is not the injected instance.

- [ ] **Step 3: Add `modelInputBuilder` to orchestration deps**

In `src/processing/processor-orchestration.ts`, add this import near other type imports:

```typescript
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
```

Then add this field to `ProcessorOrchestrationDeps` after `llmAdapter`:

```typescript
  /** Shared builder for all LLM model input construction */
  modelInputBuilder: ModelInputBuilder
```

- [ ] **Step 4: Pass real builder from API context into orchestration deps**

In `src/api/context.ts`, update the `createOrchestrationMessageProcessor({ ... })` call near the bottom so it includes `modelInputBuilder` immediately after `llmAdapter`:

```typescript
      agentKernel,
      llmAdapter,
      modelInputBuilder,
      transcriptStore,
```

- [ ] **Step 5: Remove the stub builder and use injected builder**

In `src/foreground/kernel-config-builder.ts`, delete the entire `createMinimalModelInputBuilder()` function.

Then replace this line in `buildKernelConfigFromDeps()`:

```typescript
  const modelInputBuilder = createMinimalModelInputBuilder()
```

with:

```typescript
  const modelInputBuilder = deps.modelInputBuilder
```

- [ ] **Step 6: Update runturn-kernel test deps helper**

In `tests/unit/foreground/runturn-kernel.test.ts`, add this import near the other imports:

```typescript
import { createRealModelInputBuilder } from '../../helpers/model-input.js'
```

Then update `createMockDeps()` so the returned object includes `modelInputBuilder` after `llmAdapter`:

```typescript
      llmAdapter: { complete: vi.fn() } as unknown as LLMAdapter,
      modelInputBuilder: createRealModelInputBuilder(),
      transcriptStore: {} as ProcessorOrchestrationDeps['transcriptStore'],
```

- [ ] **Step 7: Update processor orchestration unit deps setup**

In `tests/unit/processing/processor-orchestration.test.ts`, add this import:

```typescript
import { createRealModelInputBuilder } from '../../helpers/model-input.js'
```

Then update the `deps = { ... }` object in `beforeEach()` so it includes:

```typescript
      llmAdapter: mockLlmAdapter,
      modelInputBuilder: createRealModelInputBuilder(),
      transcriptStore: mockTranscriptStore,
```

- [ ] **Step 8: Update foreground integration deps setup**

In `tests/integration/foreground/kernel-driven-turns.integration.test.ts`, add this import:

```typescript
import { createRealModelInputBuilder } from '../../helpers/model-input.js'
```

Then update the `deps: ProcessorOrchestrationDeps = { ... }` object in `buildDepsAndProcessor()` so it includes:

```typescript
      llmAdapter: {
        providers: [],
        config: { providers: [], defaultTimeoutMs: 10000, enableCircuitBreaker: false },
        complete: vi.fn(),
        stream: async function* () {},
      } as unknown as ProcessorOrchestrationDeps['llmAdapter'],
      modelInputBuilder: createRealModelInputBuilder(),
      transcriptStore: mockTranscriptStore,
```

- [ ] **Step 9: Run focused tests**

Run: `npm test -- tests/unit/foreground/kernel-config-builder.test.ts tests/unit/foreground/runturn-kernel.test.ts tests/unit/processing/processor-orchestration.test.ts tests/integration/foreground/kernel-driven-turns.integration.test.ts`

Expected: all tests in these files pass.

- [ ] **Step 10: Run typecheck**

Run: `npm run typecheck`

Expected: `tsc --noEmit` exits 0 with no errors.

- [ ] **Step 11: Commit**

Run:

```bash
git add src/processing/processor-orchestration.ts src/api/context.ts src/foreground/kernel-config-builder.ts tests/unit/foreground/kernel-config-builder.test.ts tests/unit/foreground/runturn-kernel.test.ts tests/unit/processing/processor-orchestration.test.ts tests/integration/foreground/kernel-driven-turns.integration.test.ts
git commit -m "refactor(agent): require real model input builder"
```

Expected: commit succeeds. If the user did not request commits for this session, skip this step and report that the commit step was intentionally skipped.

---

### Task 3: Remove Unused ForegroundAgent Options

**Files:**
- Modify: `src/foreground/foreground-agent.ts`
- Modify: `tests/unit/foreground/runturn-kernel.test.ts`

**Interfaces:**
- Consumes: `CreateForegroundAgentOptions` in `src/foreground/foreground-agent.ts`
- Produces: `CreateForegroundAgentOptions` containing only used fields: `agentConfig`, `agentKernel`, `toolCatalog`, `toolRegistry`, `skillRegistry`, `skillEnvelopeRegistry`, `skillDocumentLoader`, `agentProfileRegistry`, `maxIterations`, `timeoutMs`, `attachmentResolver`

- [ ] **Step 1: Write behavior-preserving test for explicit used options**

In `tests/unit/foreground/runturn-kernel.test.ts`, add this test inside `describe('ForegroundAgent.runTurn via AgentKernel', () => { ... })` after the first `runTurn calls AgentKernel.run...` test:

```typescript
  it('createForegroundAgent only relies on explicit foreground options it consumes', async () => {
    const agentWithOptions = createForegroundAgent({
      agentKernel: mockAgentKernel,
      maxIterations: 2,
      timeoutMs: 1234,
    })

    await agentWithOptions.runTurn(createMockInput())

    const kernelInput = vi.mocked(mockAgentKernel.run).mock.calls[0][0] as KernelRunInput
    expect(kernelInput.maxIterations).toBe(2)
    expect(kernelInput.timeoutMs).toBe(1234)
  })
```

- [ ] **Step 2: Run focused test before cleanup**

Run: `npm test -- tests/unit/foreground/runturn-kernel.test.ts -t "only relies on explicit foreground options"`

Expected before implementation: test passes. This is a behavior-preserving guard, not a red test.

- [ ] **Step 3: Remove unused imports from foreground agent**

In `src/foreground/foreground-agent.ts`, delete these imports:

```typescript
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import type { ModelInputSnapshotStore } from '../kernel/model-input/model-input-snapshot-store.js'
import type { LLMAdapter } from '../llm/adapter.js'
import type { PromptProjectionResolver } from '../prompt/prompt-projection-types.js'
```

- [ ] **Step 4: Remove unused option fields**

In `src/foreground/foreground-agent.ts`, replace the `CreateForegroundAgentOptions` interface with:

```typescript
export interface CreateForegroundAgentOptions {
  readonly agentConfig?: AgentConfig
  readonly agentKernel?: AgentKernel
  readonly toolCatalog?: ReturnType<typeof getToolCatalog>
  readonly toolRegistry?: ToolRegistry
  readonly skillRegistry?: SkillRegistry
  readonly skillEnvelopeRegistry?: AgentTypeSkillEnvelopeRegistry
  readonly skillDocumentLoader?: SkillDocumentLoader
  readonly agentProfileRegistry?: AgentProfileRegistry
  readonly maxIterations?: number
  readonly timeoutMs?: number
  readonly attachmentResolver?: AttachmentResolver
}
```

- [ ] **Step 5: Run foreground unit tests**

Run: `npm test -- tests/unit/foreground/runturn-kernel.test.ts`

Expected: all tests in the file pass.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: `tsc --noEmit` exits 0 with no unused import or excess property errors.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/foreground/foreground-agent.ts tests/unit/foreground/runturn-kernel.test.ts
git commit -m "refactor(foreground): remove unused agent options"
```

Expected: commit succeeds. If the user did not request commits for this session, skip this step and report that the commit step was intentionally skipped.

---

### Task 4: Add Production ApiContext Regression For Real ModelInputBuilder

**Files:**
- Modify: `tests/integration/api/context-dependencies.test.ts`

**Interfaces:**
- Consumes: `createApiContext({ dbPath, llmAdapter })`
- Consumes: `LLMAdapter.complete(request)` call arguments from the default `AgentKernel` created in API context
- Produces: Integration coverage proving default message processing reaches real `ModelInputBuilder` with non-empty Segment A in the outbound LLM request.

- [ ] **Step 1: Add imports for mock adapter and request assertion spy**

In `tests/integration/api/context-dependencies.test.ts`, update imports:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createApiContext, DEFAULT_MESSAGE_PROCESSOR_TIMEOUT_MS, isApiContextError } from '../../../src/api/context.js'
import { DEFAULT_REPAIR_ATTEMPTS, DEFAULT_ROUTING_TIMEOUT_MS } from '../../../src/storage/agent-config-store.js'
import { createMockLLMAdapter } from '../../../src/llm/mock-adapter.js'
import type { MessageProcessor, MessageProcessorInput, MessageProcessorOutput } from '../../../src/processing/types.js'
```

Only add `vi` if the file does not already import it; keep existing type imports.

- [ ] **Step 2: Write failing integration test**

In `tests/integration/api/context-dependencies.test.ts`, add this test inside `describe('MessageProcessor Integration', () => { ... })`, near the other `messageProcessor.process()` tests:

```typescript
    it('default processing path sends non-empty seven-layer model input to LLM', async () => {
      const llmAdapter = createMockLLMAdapter()
      const completeSpy = vi.spyOn(llmAdapter, 'complete')

      const result = createApiContext({
        dbPath: ':memory:',
        llmAdapter,
      })
      expect(isApiContextError(result)).toBe(false)
      if (isApiContextError(result)) return

      result.providerConfigStore.create({
        providerId: 'provider-phase0-user-001',
        userId: 'user-phase0-001',
        providerType: 'ollama',
        displayName: 'Phase 0 Ollama',
        baseUrl: 'http://localhost:11434',
        selectedModel: 'mock-model',
      })

      const output = await result.messageProcessor.process({
        correlationId: 'phase0-real-builder-001',
        userId: 'user-phase0-001',
        sessionId: 'session-phase0-001',
        text: 'Hello from phase 0 real builder test',
        timestamp: new Date().toISOString(),
      })

      expect(output.success).toBe(true)
      expect(completeSpy).toHaveBeenCalled()

      const request = completeSpy.mock.calls[0][0]
      expect(request.messages.length).toBeGreaterThan(0)
      expect(request.messages[0].role).toBe('system')
      expect(request.messages[0].content).toContain('Platform Base Template')
      expect(request.messages[0].content).toContain('Platform Safety Template')
      expect(request.messages[0].content).not.toBe('')

      result.connection.close()
    })
```

- [ ] **Step 3: Run failing integration test**

Run: `npm test -- tests/integration/api/context-dependencies.test.ts -t "default processing path sends non-empty seven-layer model input to LLM"`

Expected before Task 2 implementation: this may fail to compile because `ProcessorOrchestrationDeps.modelInputBuilder` is not wired, or fail if the default path does not reach real Segment A.

- [ ] **Step 4: Confirm implementation from Task 2 is enough**

No production changes should be needed in this task if Task 2 passed. If the test fails because mock provider returns JSON text and kernel treats it as final response, keep the assertion focused on `llmAdapter.complete` request messages; do not add new runtime behavior.

- [ ] **Step 5: Run focused integration test**

Run: `npm test -- tests/integration/api/context-dependencies.test.ts -t "default processing path sends non-empty seven-layer model input to LLM"`

Expected: PASS.

- [ ] **Step 6: Run related integration file**

Run: `npm test -- tests/integration/api/context-dependencies.test.ts`

Expected: all tests in the file pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add tests/integration/api/context-dependencies.test.ts
git commit -m "test(api): cover real model input path"
```

Expected: commit succeeds. If the user did not request commits for this session, skip this step and report that the commit step was intentionally skipped.

---

### Task 5: Add Architecture Guard Against Stub Model Input Builders

**Files:**
- Modify: `tests/architecture/no-legacy-prompt-path.test.ts`

**Interfaces:**
- Consumes: Existing `walkDirectory(srcDir)` helper in `tests/architecture/no-legacy-prompt-path.test.ts`
- Produces: Architecture regression tests that fail if source reintroduces stub model-input builders or empty segment hashes.

- [ ] **Step 1: Add architecture tests**

In `tests/architecture/no-legacy-prompt-path.test.ts`, add this block after the existing `describe('Foreground Agent Clean', () => { ... })` block and before `describe('New Path Preserved', () => { ... })`:

```typescript
  describe('No Stub ModelInputBuilder Paths', () => {
    it('no src/ file defines createMinimalModelInputBuilder', () => {
      const violations: Array<{ file: string; line: number }> = []

      for (const filePath of walkDirectory(srcDir)) {
        const relativePath = relative(rootDir, filePath).replace(/\\/g, '/')
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
          if (/createMinimalModelInputBuilder/.test(lines[i])) {
            violations.push({ file: relativePath, line: i + 1 })
          }
        }
      }

      if (violations.length > 0) {
        const formatted = violations.map((v) => `  - ${v.file}:${v.line}`).join('\n')
        throw new Error(
          `Found ${violations.length} createMinimalModelInputBuilder reference(s) in src/:\n${formatted}\n` +
            `Production model input construction must use the real ModelInputBuilder dependency.`,
        )
      }

      expect(violations).toHaveLength(0)
    })

    it('no src/ file returns empty model input segment hashes as a builder stub', () => {
      const violations: Array<{ file: string; line: number }> = []

      for (const filePath of walkDirectory(srcDir)) {
        const relativePath = relative(rootDir, filePath).replace(/\\/g, '/')
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
          if (/segmentA\s*:\s*['"]['"]/.test(lines[i])) {
            violations.push({ file: relativePath, line: i + 1 })
          }
        }
      }

      if (violations.length > 0) {
        const formatted = violations.map((v) => `  - ${v.file}:${v.line}`).join('\n')
        throw new Error(
          `Found ${violations.length} empty Segment A hash assignment(s) in src/:\n${formatted}\n` +
            `Empty segment hashes indicate a stub model-input path. Use ModelInputBuilder.build().`,
        )
      }

      expect(violations).toHaveLength(0)
    })
  })
```

- [ ] **Step 2: Run architecture test before implementation**

Run: `npm test -- tests/architecture/no-legacy-prompt-path.test.ts -t "No Stub ModelInputBuilder Paths"`

Expected before Task 2 implementation: fails because `src/foreground/kernel-config-builder.ts` contains `createMinimalModelInputBuilder` and empty `segmentA` hash. After Task 2 implementation: passes.

- [ ] **Step 3: Run full architecture guard file**

Run: `npm test -- tests/architecture/no-legacy-prompt-path.test.ts`

Expected: all tests in the file pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add tests/architecture/no-legacy-prompt-path.test.ts
git commit -m "test(architecture): prevent stub model input paths"
```

Expected: commit succeeds. If the user did not request commits for this session, skip this step and report that the commit step was intentionally skipped.

---

### Task 6: Final Verification For Phase 0 Plan Execution

**Files:**
- Verify only; no new files.

**Interfaces:**
- Consumes: All outputs from Tasks 1-5.
- Produces: Evidence that Phase 0 convergence is type-safe and regression-covered.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 2: Run focused Phase 0 tests**

Run:

```bash
npm test -- tests/unit/foreground/kernel-config-builder.test.ts tests/unit/foreground/runturn-kernel.test.ts tests/unit/processing/processor-orchestration.test.ts tests/integration/foreground/kernel-driven-turns.integration.test.ts tests/integration/api/context-dependencies.test.ts tests/architecture/no-legacy-prompt-path.test.ts
```

Expected: all listed test files pass.

- [ ] **Step 3: Verify whitespace**

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 4: Verify Phase 0 inventory has no placeholders**

Run: `rg -n "T[B]D|TO[D]O|待[定]|\?\?|PLACEHOLD[E]R|FIXM[E]" docs/reports/AGENT_ARCHITECTURE_PHASE0_INVENTORY.md`

Expected: no output and exit code 1 from `rg` because there are no matches.

- [ ] **Step 5: Inspect git status**

Run: `git status --short`

Expected: only intended files are modified or no changes remain if commits were made.

- [ ] **Step 6: Summarize Phase 0 completion evidence**

Report these exact items to the reviewer:

```markdown
Phase 0 verification evidence:
- `npm run typecheck`: PASS
- Focused Phase 0 tests: PASS
- `git diff --check`: PASS
- Inventory placeholder scan: PASS
- Files changed: paste the exact `git status --short` output, or write `none` when there are no uncommitted changes
```

Do not claim Phase 1 items such as runtime output validators, tool schema unification, context budget rollout, ReAct trace, or golden dataset are complete.
