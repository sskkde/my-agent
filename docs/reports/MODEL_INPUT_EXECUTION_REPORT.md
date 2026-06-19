# P9 Model Input Builder Execution Report

> Created: 2026-05-23
> Author: Sisyphus
> Version: v0.9.0-model-input
> Note (2026-06-19): This report documents the P9 baseline. The prompt migration added `routing_tool_call` as a fourth mode, B1/B2/B3 sub-sections, T5/T6/T7 taxonomy template consumption, top-level `summaryLayers`, and Segment D provenance. See `docs/architecture/MODEL_INPUT_ARCHITECTURE.md` for the current state.

---

## 1. Completion Summary

| Area                             | Status   | Key Deliverables                                                        |
| -------------------------------- | -------- | ----------------------------------------------------------------------- |
| AgentKernel Model Hardcode Fix   | Complete | `src/kernel/agent-kernel.ts`, `src/kernel/types.ts`, defaultModel field |
| TokenUsage DeepSeek Cache        | Complete | `src/llm/types.ts`, promptCacheHitTokens, cacheHitRate fields           |
| Baseline Report                  | Complete | `docs/reports/MODEL_INPUT_BASELINE_REPORT.md`                           |
| .md Template System              | Complete | 8 templates in `src/prompt/templates/`                                  |
| Template Registry                | Complete | `src/prompt/prompt-template-registry.ts`, Map-based registry            |
| Template Loader                  | Complete | `src/prompt/template-loader.ts`, placeholder replacement                |
| Template Hash                    | Complete | `src/prompt/template-hash.ts`, SHA-256 hashing                          |
| ModelInputBuilder Core           | Complete | `src/kernel/model-input/model-input-builder.ts`, 7 layers, 4 segments   |
| ModelInputTypes                  | Complete | `src/kernel/model-input/model-input-types.ts`, mode, projection types   |
| ModelInputCacheKey               | Complete | `src/kernel/model-input/model-input-cache-key.ts`, SHA-256(A+B+C)       |
| StaticPrefixBuilder              | Complete | `src/kernel/model-input/static-prefix-builder.ts`, Layer 1-4            |
| ToolPlaneProjection              | Complete | `src/tools/tool-plane-prompt-projection.ts`, routing/execution modes    |
| ToolExposurePlan                 | Complete | `src/tools/tool-exposure-plan.ts`, 5 exposure levels                    |
| ToolSchemaCanonicalizer          | Complete | `src/tools/tool-schema-canonicalizer.ts`, deterministic JSON            |
| InstructionResolver              | Complete | `src/instructions/instruction-resolver.ts`, multi-source aggregation    |
| InstructionHash                  | Complete | `src/instructions/instruction-hash.ts`, tenant isolation                |
| ContextBundleProjection          | Complete | `src/kernel/model-input/context-bundle-projection.ts`, Layer 7          |
| ContextItemRenderer              | Complete | `src/kernel/model-input/context-item-renderer.ts`, semanticType mapping |
| ContextPairIntegrity             | Complete | `src/kernel/model-input/context-pair-integrity.ts`, pair protection     |
| TenantProjectInstructionRenderer | Complete | `src/kernel/model-input/tenant-project-instruction-renderer.ts`         |
| ToolPlaneProjectionRenderer      | Complete | `src/kernel/model-input/tool-plane-projection-renderer.ts`              |
| AgentKernel Integration          | Complete | `src/kernel/agent-kernel.ts`, ModelInputBuilder injection               |
| LongTermMemoryExtractor Fix      | Complete | `src/memory/long-term-memory-extractor-service.ts`, model field         |
| ForegroundAgent Shadow Mode      | Complete | `src/foreground/foreground-agent.ts`, dual-path mode                    |
| SearchSubagent Integration       | Complete | `src/search/search-subagent.ts`, ModelInputBuilder usage                |
| MemoryExtractor Integration      | Complete | `src/memory/long-term-memory-extractor-service.ts`, 7 layers            |
| ModelInputSnapshotStore          | Complete | `src/kernel/model-input/model-input-snapshot-store.ts`                  |
| ModelInputRedactor               | Complete | `src/kernel/model-input/model-input-redactor.ts`, 19 patterns           |
| ModelInputMetrics                | Complete | `src/observability/model-input-metrics.ts`, cache tracking              |
| Security Tests                   | Complete | `tests/security/model-input/prompt-injection-boundary.test.ts`          |
| Cache Stability Tests            | Complete | Tests for Segment A hash stability                                      |

---

## 2. Wave Execution Summary

P9 delivered 17 tasks across 6 waves:

### Wave 1: Foundation (T1, T2, T3)

- **T1**: Fixed AgentKernel `model: 'default-model'` hardcode
  - Added `defaultModel` field to `KernelConfig`
  - Model now resolved from config or `KernelRunInput`
  - Added `prompt-builder.test.ts` with 80%+ coverage
- **T2**: Created `MODEL_INPUT_BASELINE_REPORT.md`
  - Documented 4 LLM request paths
  - Captured prompt hash stability requirements
  - Recorded design decisions
- **T3**: Extended TokenUsage for DeepSeek cache metrics
  - Added `promptCacheHitTokens`, `promptCacheMissTokens`, `cacheHitRate`
  - Provider response mapping supports optional fields

### Wave 2: Template System (T4, T5)

- **T4**: Created 8 `.md` template files
  - `platform/base.md`, `platform/safety.md` (Layer 1)
  - `provider/openai.md`, `provider/deepseek.md` (Layer 2)
  - `agents/foreground.md`, `agents/kernel.md` (Layer 3)
  - `output/foreground.schema.md`, `output/planner.schema.md` (Layer 4)
  - All templates verified free of dynamic fields
- **T5**: Implemented TypeScript template system
  - `prompt-template-registry.ts`: Map-based immutable registry
  - `template-loader.ts`: File loading with `{placeholder}` replacement
  - `template-hash.ts`: SHA-256 hashing with normalization

### Wave 3: Builder Core + Projections (T6, T7, T8)

- **T6**: ModelInputBuilder core implementation
  - 7-layer architecture: Platform, Provider, Agent, Output, Instruction, Tool, Context
  - 4-segment caching: A (static), B (instructions), C (tools), D (dynamic)
  - 3 modes: routing_json, function_calling, structured_json
  - Segment A hash stable across user messages
- **T7**: ToolPlaneProjection implementation
  - `tool-plane-prompt-projection.ts`: Generates model-visible projections
  - `tool-exposure-plan.ts`: 5 exposure levels (always_on, intent_loaded, agent_loaded, lazy_discoverable, hidden)
  - `tool-schema-canonicalizer.ts`: Deterministic JSON serialization
  - Routing mode: tool IDs + summaries only
  - Execution mode: full schemas in `LLMRequest.tools`
- **T8**: InstructionResolver implementation
  - `instruction-resolver.ts`: Multi-source aggregation
  - `instruction-hash.ts`: Deterministic hash with tenant isolation
  - Priority ordering: systemPrompt (10), routingPrompt (20)

### Wave 4: Layer 7 + Integration (T9, T10, T11)

- **T9**: ContextBundleProjection implementation
  - `context-bundle-projection.ts`: Layer 7 rendering
  - `context-item-renderer.ts`: semanticType to role mapping
    - `constraint` -> `system`
    - `draft`, `summary` -> `assistant`
    - `plan_view`, `workflow_step_view`, `background_run_view` -> `system`
  - `context-pair-integrity.ts`: Pair protection for tool_use/tool_result
- **T10**: AgentKernel integration
  - Replaced `buildLLMRequest()` with `ModelInputBuilder.build()`
  - Injected `modelInputBuilder` via `KernelConfig`
  - Transcript increment preserved through Layer 7
- **T11**: Fixed LongTermMemoryExtractor model hardcode
  - Model now from `AgentConfig` or environment

### Wave 5: Foreground + Subagents (T12, T13, T14)

- **T12**: ForegroundAgent shadow mode
  - Dual-path mode: old path and new ModelInputBuilder path run in parallel
  - Comparison logging for verification
  - JSON routing contract preserved
- **T13**: SearchSubagent integration
  - Two-phase build for web search workflow
  - Function calling mode with tool schemas
- **T14**: MemoryExtractor integration
  - Structured JSON mode
  - Full 7-layer support

### Wave 6: Observability + Security + Documentation (T15, T16, T17)

- **T15**: Snapshot, redaction, and metrics
  - `model-input-snapshot-store.ts`: Records LLM calls for audit
  - `model-input-redactor.ts`: 19 redaction patterns for secrets
  - `model-input-metrics.ts`: DeepSeek cache hit/miss tracking
- **T16**: Security and cache tests
  - Prompt injection boundary tests
  - Segment A hash stability tests
  - Tenant isolation verification
- **T17**: Documentation (this task)
  - Execution report
  - Release checklist
  - Architecture documentation

---

## 3. Commands Verified

| Command                                                     | Result | Notes                                 |
| ----------------------------------------------------------- | ------ | ------------------------------------- |
| `npm run typecheck`                                         | PASS   | 0 errors                              |
| `npm test`                                                  | PASS   | All unit tests pass                   |
| `npm test -- tests/unit/kernel/model-input`                 | PASS   | 4 test files                          |
| `npm test -- tests/unit/prompt`                             | PASS   | Template registry, loader, hash tests |
| `npm test -- tests/unit/instructions`                       | PASS   | 2 test files                          |
| `npm test -- tests/unit/tools/tool-plane-prompt-projection` | PASS   | Projection tests                      |
| `npm test -- tests/security/model-input`                    | PASS   | Security boundary tests               |

---

## 4. Key Metrics

### 4.1 Test Coverage

| Category                  | Count   | Description                                |
| ------------------------- | ------- | ------------------------------------------ |
| Model Input Builder Tests | 4 files | builder, redactor, snapshot-store, metrics |
| Prompt System Tests       | 4 files | registry, loader, hash, prompt-builder     |
| Instruction Tests         | 2 files | resolver, hash                             |
| Tool Projection Tests     | 2 files | unit, integration                          |
| Security Tests            | 1 file  | prompt-injection-boundary                  |

### 4.2 Architecture Metrics

| Metric                     | Value |
| -------------------------- | ----- |
| Total Source Files Created | 20+   |
| Total Test Files Created   | 13+   |
| Template Files             | 8     |
| Layers                     | 7     |
| Segments                   | 4     |
| Modes                      | 3     |
| Exposure Levels            | 5     |

### 4.3 Cache Optimization

| Metric             | Value                                                        |
| ------------------ | ------------------------------------------------------------ | ------ | ------- |
| Segment A Fields   | Layer 1-4 (static prefix)                                    |
| Segment B Fields   | Layer 5 (tenant/project instructions)                        |
| Segment C Fields   | Layer 6 (tool plane projection)                              |
| Segment D Fields   | Layer 7 (context bundle + dynamic)                           |
| Cache Key Formula  | SHA-256(A_hash                                               | B_hash | C_hash) |
| Dynamic Exclusions | currentDate, runId, messageId, requestId, currentUserMessage |

### 4.4 DeepSeek Cache Metrics

| Field                   | Description                        |
| ----------------------- | ---------------------------------- |
| `promptCacheHitTokens`  | Tokens served from KV cache        |
| `promptCacheMissTokens` | Tokens requiring fresh computation |
| `cacheHitRate`          | Hit / (Hit + Miss) ratio           |

---

## 5. Deliverables Summary

### Source Files

| Path                                                            | Description               |
| --------------------------------------------------------------- | ------------------------- |
| `src/kernel/model-input/model-input-builder.ts`                 | Core 7-layer builder      |
| `src/kernel/model-input/model-input-types.ts`                   | Input/output types        |
| `src/kernel/model-input/model-input-cache-key.ts`               | Cache key computation     |
| `src/kernel/model-input/static-prefix-builder.ts`               | Layer 1-4 builder         |
| `src/kernel/model-input/context-bundle-projection.ts`           | Layer 7 projection        |
| `src/kernel/model-input/context-item-renderer.ts`               | ContextItem to LLMMessage |
| `src/kernel/model-input/context-pair-integrity.ts`              | Pair protection           |
| `src/kernel/model-input/tool-plane-projection-renderer.ts`      | Layer 6 renderer          |
| `src/kernel/model-input/tenant-project-instruction-renderer.ts` | Layer 5 renderer          |
| `src/kernel/model-input/model-input-snapshot-store.ts`          | Audit snapshots           |
| `src/kernel/model-input/model-input-redactor.ts`                | Secret redaction          |
| `src/prompt/prompt-template-registry.ts`                        | Template registry         |
| `src/prompt/template-loader.ts`                                 | Template loader           |
| `src/prompt/template-hash.ts`                                   | SHA-256 hashing           |
| `src/instructions/instruction-resolver.ts`                      | Instruction aggregation   |
| `src/instructions/instruction-hash.ts`                          | Instruction hashing       |
| `src/tools/tool-plane-prompt-projection.ts`                     | Tool projection           |
| `src/tools/tool-exposure-plan.ts`                               | Exposure levels           |
| `src/tools/tool-schema-canonicalizer.ts`                        | Canonical JSON            |
| `src/observability/model-input-metrics.ts`                      | Cache metrics             |

### Template Files

| Path                                               | Layer | Description             |
| -------------------------------------------------- | ----- | ----------------------- |
| `src/prompt/templates/platform/base.md`            | 1     | Platform identity       |
| `src/prompt/templates/platform/safety.md`          | 1     | Security boundaries     |
| `src/prompt/templates/provider/openai.md`          | 2     | OpenAI-specific rules   |
| `src/prompt/templates/provider/deepseek.md`        | 2     | DeepSeek KV cache rules |
| `src/prompt/templates/agents/foreground.md`        | 3     | ForegroundAgent routing |
| `src/prompt/templates/agents/kernel.md`            | 3     | Kernel execution        |
| `src/prompt/templates/output/foreground.schema.md` | 4     | Routing JSON contract   |
| `src/prompt/templates/output/planner.schema.md`    | 4     | Planner output contract |

### Test Files

| Path                                                               | Description          |
| ------------------------------------------------------------------ | -------------------- |
| `tests/unit/kernel/model-input/model-input-builder.test.ts`        | Builder unit tests   |
| `tests/unit/kernel/model-input/model-input-redactor.test.ts`       | Redaction tests      |
| `tests/unit/kernel/model-input/model-input-snapshot-store.test.ts` | Snapshot tests       |
| `tests/unit/observability/model-input-metrics.test.ts`             | Metrics tests        |
| `tests/unit/agents/prompt-builder.test.ts`                         | Prompt builder tests |
| `tests/unit/agents/prompt-registry.test.ts`                        | Registry tests       |
| `tests/unit/instructions/instruction-resolver.test.ts`             | Resolver tests       |
| `tests/unit/instructions/instruction-hash.test.ts`                 | Hash tests           |
| `tests/unit/tools/tool-plane-prompt-projection.test.ts`            | Projection tests     |
| `tests/integration/tools/tool-plane.test.ts`                       | Integration tests    |
| `tests/security/model-input/prompt-injection-boundary.test.ts`     | Security tests       |

---

## 6. Pre-existing Issues (Non-blocking)

| Issue                             | Location       | Status                                             |
| --------------------------------- | -------------- | -------------------------------------------------- |
| LLMPlanGenerator path             | `src/planner/` | Declared out of scope for P9, recorded as P10 TODO |
| ContextManager interface mismatch | `src/context/` | Resolved via stateless adapter pattern             |

---

## Post-Release Fix Verification (2026-05-23)

After the initial P9 release (v0.9.0-model-input), a cross-check of the fix plan
(`my-agent-p9-model-input-final-fix-plan.md`) against the actual codebase revealed
that most gaps were already addressed, with 2 real gaps requiring fixes:

| Wave   | Issue                                | Actual Status                            | Action                                |
| ------ | ------------------------------------ | ---------------------------------------- | ------------------------------------- |
| Wave 1 | DeepSeek cache usage mapping         | Already mapped in `providers.ts:146-160` | None needed                           |
| Wave 2 | Foreground providerFamily            | Binary `ollama/openai` logic only        | Fixed: `resolveProviderFamily` helper |
| Wave 3 | Kernel toolProjection                | Already wired in `agent-kernel.ts:136`   | None needed                           |
| Wave 4 | Snapshot chain                       | Not wired into Foreground/AgentKernel    | Fixed: snapshot recording added       |
| Wave 5 | DeepSeek template alignment          | Already aligned with 7-layer design      | None needed                           |
| Wave 6 | Release Checklist / Execution Report | No fix verification section              | Added Final Fix Verification          |
| Wave 7 | test:p9 script                       | Missing from package.json                | Added                                 |

### Fixes Applied

- `resolveProviderFamily()` — normalizes provider IDs to `deepseek`, `ollama`, or `openai`
- ForegroundAgent + AgentKernel snapshot recording after LLM calls
- `test:p9` script for full P9 verification

### Verification

- Typecheck: ✅
- Unit tests: 99 files, 2209 passed, 9 skipped
- Security tests: 16 files, 343 passed
- provider-family-resolution test: 13/13 passed

---

## 7. Final Judgment

P9 ModelInputBuilder implementation is complete.

All 17 tasks across 6 waves have been executed successfully:

- 4 LLM request paths now use ModelInputBuilder (ForegroundAgent, AgentKernel, SearchSubagent, MemoryExtractor)
- 7-layer architecture with 4 cache segments implemented
- 3 modes supported (routing_json, function_calling, structured_json)
- Segment A hash stable across user message changes
- DeepSeek cache metrics tracked via TokenUsage extension
- Snapshots automatically redacted before storage
- Security boundary tests passing

**Release Status**: Ready for integration and deployment.
