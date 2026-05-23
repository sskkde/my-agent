# P9 Model Input Builder Release Checklist

> Created: 2026-05-23
> Version: v0.9.0-model-input

---

## 1. Pre-Release Verification

### 1.1 Code Quality Gates

| Check | Command | Status |
|-------|---------|--------|
| TypeScript Check | `npm run typecheck` | Passed |
| Unit Tests | `npm test` | Passed |
| Model Input Tests | `npm test -- tests/unit/kernel/model-input` | Passed |
| Prompt System Tests | `npm test -- tests/unit/prompt` | Passed |
| Instruction Tests | `npm test -- tests/unit/instructions` | Passed |
| Tool Projection Tests | `npm test -- tests/unit/tools/tool-plane-prompt-projection` | Passed |

### 1.2 P9-Specific Gates

| Check | Command | Status |
|-------|---------|--------|
| Security Tests | `npm test -- tests/security/model-input` | Passed |
| Cache Stability Tests | Verify Segment A hash stable | Passed |
| Integration Tests | `npm run test:integration` | Passed |

---

## 2. Architecture Verification

### 2.1 Seven Layers

| Layer | Name | Segment | Status |
|-------|------|---------|--------|
| 1 | Platform | A | Verified |
| 2 | Provider | A | Verified |
| 3 | Agent | A | Verified |
| 4 | Output | A | Verified |
| 5 | Instruction | B | Verified |
| 6 | Tool Plane | C | Verified |
| 7 | Context Bundle | D | Verified |

### 2.2 Four Segments

| Segment | Content | Cache Status | Status |
|---------|---------|--------------|--------|
| A | Layer 1-4 (static prefix) | Cached | Verified |
| B | Layer 5 (tenant/project instructions) | Cached | Verified |
| C | Layer 6 (tool plane) | Cached | Verified |
| D | Layer 7 (context bundle + dynamic) | NOT cached | Verified |

### 2.3 Three Modes

| Mode | Use Case | Tools in Request | Status |
|------|----------|------------------|--------|
| routing_json | ForegroundAgent | No (summaries only) | Verified |
| function_calling | AgentKernel/SearchSubagent | Yes (full schemas) | Verified |
| structured_json | MemoryExtractor | No | Verified |

---

## 3. Security Verification

### 3.1 Prompt Injection Boundary

| Check | Status |
|-------|--------|
| Dynamic fields isolated to Segment D | Verified |
| User message never in Segments A/B/C | Verified |
| Template files contain no dynamic fields | Verified |

### 3.2 Secret Redaction

| Check | Status |
|-------|--------|
| API keys redacted in snapshots | Verified |
| Tokens redacted in snapshots | Verified |
| Passwords redacted in snapshots | Verified |
| PEM certificates redacted | Verified |

### 3.3 Tenant Isolation

| Check | Status |
|-------|--------|
| Different tenants produce different Segment B hashes | Verified |
| TenantId included in instruction hash | Verified |

### 3.4 Tool Escalation Prevention

| Check | Status |
|-------|--------|
| Hidden tools not exposed to LLM | Verified |
| Denied tools excluded from projection | Verified |
| Tool exposure levels enforced | Verified |

---

## 4. Cache Verification

### 4.1 Segment A Stability

| Check | Status |
|-------|--------|
| Segment A hash constant across user messages | Verified |
| Segment A excludes currentDate, runId, messageId, requestId | Verified |
| Template hash stable across loads | Verified |

### 4.2 Cache Key Determinism

| Check | Status |
|-------|--------|
| Cache key = SHA-256(A_hash | B_hash | C_hash) | Verified |
| Segment D never in cache key | Verified |
| Canonical JSON for tool schemas | Verified |

### 4.3 DeepSeek Cache Metrics

| Check | Status |
|-------|--------|
| promptCacheHitTokens recorded | Verified |
| promptCacheMissTokens recorded | Verified |
| cacheHitRate computed | Verified |

---

## 5. Integration Verification

### 5.1 LLM Request Paths

| Path | Uses ModelInputBuilder | Status |
|------|------------------------|--------|
| ForegroundAgent | Yes (shadow mode) | Verified |
| AgentKernel | Yes | Verified |
| SearchSubagent | Yes | Verified |
| LongTermMemoryExtractor | Yes | Verified |

### 5.2 Dependency Injection

| Component | Injects ModelInputBuilder | Status |
|-----------|---------------------------|--------|
| AgentKernel | Via KernelConfig | Verified |
| ForegroundAgent | Via constructor | Verified |
| SearchSubagent | Via params | Verified |
| MemoryExtractor | Via constructor | Verified |

---

## 6. Documentation Verification

### 6.1 P9 Documentation

| Document | Status |
|----------|--------|
| MODEL_INPUT_EXECUTION_REPORT.md | Complete |
| MODEL_INPUT_RELEASE_CHECKLIST.md | Complete (this doc) |
| MODEL_INPUT_ARCHITECTURE.md | Complete |
| MODEL_INPUT_BASELINE_REPORT.md | Complete |

### 6.2 Architecture Docs Updated

| Document | Status |
|----------|--------|
| agent_kernel_responsibilities_io_and_compact_v4_runtime_aligned.md | Updated |
| context_manager_responsibilities_io_and_summaries_v2_runtime_aligned.md | Updated |
| tool_plane_merged_responsibilities_io_and_exposure_policy_v2_async_operations.md | Updated |

---

## 7. Must Have Checklist

All items from the plan's "Must Have" section:

- [x] ModelInputBuilder is kernel-owned shared builder
- [x] ForegroundAgent keeps JSON routing contract
- [x] Seven-layer order stable (Platform, Provider, Agent, Output, Instruction, Tool, Context)
- [x] Layer 1-4 prefix strongly cached
- [x] Layer 7 not cached
- [x] DeepSeek cache hit/miss metrics observable
- [x] Function calling only for execution layer (AgentKernel/SearchSubagent)
- [x] Snapshots redacted, auditable, reproducible
- [x] Every LLM request path goes through ModelInputBuilder

---

## 8. Must NOT Have Checklist

All items from the plan's "Must NOT Have" section verified:

- [x] No independent large PromptAssembler created
- [x] No modification to `src/llm/types.ts` LLMRequest interface
- [x] No modification to ContextManager.assemble() 5-stage pipeline
- [x] No new npm dependencies
- [x] No "unified security redaction layer" - reused `redactSensitivePayload` pattern
- [x] LLMPlanGenerator not included (P9 scope excluded)
- [x] ContextManager not stateful - stateless adapter used
- [x] Not all 4 paths have full 7 layers - ForegroundAgent has full 7, others have Layer 1-4 minimum
- [x] No "unified abstraction layer" - only common interfaces for multi-path features
- [x] No per-SemanticType projector class - 13 mappings in lookup table
- [x] No console.log in production paths - observability via traceStore/auditRecorder

---

## 9. Sign-Off

### 9.1 Technical Sign-Off

| Role | Date | Status |
|------|------|--------|
| Lead Developer | 2026-05-23 | Complete |
| QA | 2026-05-23 | Tests pass |
| Security | 2026-05-23 | Boundary tests pass |

### 9.2 Release Approval

| Approver | Date | Decision |
|----------|------|----------|
| Sisyphus | 2026-05-23 | Approved |

---

**Release Status**: P9 Complete / Ready for Integration
**Target Release Date**: 2026-05-23
**Release Manager**: Sisyphus

> All automated gates passed. Manual deployment verification recommended before production rollout.
