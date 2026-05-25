# P10 Prompt × Memory — Release Checklist

> Created: 2026-05-24
> Version: v0.10.0-prompt-memory

---

## 1. Overview

| Attribute | Value |
|-----------|-------|
| Phase | P0/P1 (Complete) + P2 (Decision-gated: PM-17~PM-21) |
| Implementation | PM-1 through PM-21 (21 tasks) + Final Wave (F1-F4) |
| Production Files | 14 modified/created |
| Test Files | 14 created |
| Final Wave Status | F1-F4 all APPROVED |
| Production Readiness | P0/P1 ready for phased rollout; P2 production activation decision-gated |

### P0 Deliverables (Complete)
- Memory Semantic Policy — `long_term_fact` type + 禁止项扩展
- Layer 5 Persona Projection — 结构化 PersonaProjection 接口
- Layer 6 Tool Selection Policy — 结构化 ToolSelectionPolicyProjection
- Layer 7 Memory Policy — 结构化 MemoryPolicyProjection
- Memory Candidate 校验 — 扩展 ExtractedMemoryCandidate + validateMemoryCandidate()
- Feature Flag Scaffolding — PROMPT_MEMORY_P0_ENABLED
- Shadow Extraction 机制 — 扩展 memory_extraction_run_store

### P1 Deliverables (Complete)
- Weekly Summary 写入 — SummaryManager.writeWeeklySummary
- PlannerStatePatch → SessionMemory bridge — plannerStateToSessionPatch + PlannerStatePatchData schema
- Rolling Summary 触发策略升级 — topic_shift + plan_update events
- 分层 Summary Prompts — 5 layer prompts + SummaryLayerProjection

### P2 Deliverables (Decision-gated, Abstraction Complete)
- Hybrid Retrieval 抽象 — VectorRetrievalBackend interface + NoOpVectorBackend
- Entity/Time Index — migration v55 + getByEntityName/getByDateRange
- Lifecycle Scoring Shadow — LifecycleScorer pure function; production rollout gated by `LIFECYCLE_POLICY_ENABLED`

---

## 2. Verification Gates

### 2.1 Code Quality Gates

| Check | Expected | Actual |
|-------|----------|--------|
| `npm run typecheck` | Clean | ✅ Clean |
| `npm run test:unit` | All pass | ✅ 2378 pass / 9 skip |
| `npm run test:integration` | All pass | ✅ 199 pass (10 files) |
| Security Tests | All pass | ✅ All pass |
| Token budget delta | ≤ 500 tokens | ✅ Verified |
| Hash stability (flag OFF) | = P9 baseline | ✅ Identical |

### 2.2 P10-Specific Gates

| Check | Command | Status |
|-------|---------|--------|
| Memory Semantic Policy Tests | `npm test -- tests/unit/memory/memory-semantic-policy` | Passed |
| Persona Projection Tests | `npm test -- tests/unit/kernel/model-input/persona-projection` | Passed |
| Tool Selection Policy Tests | `npm test -- tests/unit/kernel/model-input/tool-selection-policy` | Passed |
| Memory Policy Projection Tests | `npm test -- tests/unit/kernel/model-input/memory-policy-projection` | Passed |
| Candidate Validation Tests | `npm test -- tests/unit/memory/memory-candidate-validation` | Passed |
| Shadow Extraction Tests | `npm test -- tests/unit/memory/shadow-extraction` | Passed |
| Weekly Summary Tests | `npm test -- tests/unit/memory/summary-manager` | Passed |
| Planner Bridge Tests | `npm test -- tests/unit/memory/planner-state-bridge` | Passed |
| Rolling Summary Tests | `npm test -- tests/unit/memory/rolling-summary-policy` | Passed |
| Hybrid Retrieval Tests | `npm test -- tests/unit/memory/hybrid-retrieval` | Passed |
| Lifecycle Scoring Tests | `npm test -- tests/unit/memory/lifecycle-scoring` | Passed |
| Entity/Time Index Tests | `npm test -- tests/unit/memory/entity-time-index` | Passed |

### 2.3 Template-driven Projection Loading Gates

| Check | Verification | Status |
|-------|-------------|--------|
| Persona/Tool/Memory templates load correctly | 模板文件存在且可加载 | ✅ Verified |
| ForegroundAgent no longer hardcodes P10 projection text | 代码已改用 resolver | ✅ Verified |
| Feature flag OFF preserves baseline hash | `isPromptMemoryP0Enabled()=false` → `{}` | ✅ Verified |
| Segment A stable under all flag combinations | Hash 计算不受模板加载影响 | ✅ Verified |
| Memory extraction stable rules from templates | `agents:memory.md` + `output:memory-candidate.schema.md` | ✅ Verified |
| Fallback defaults work when templates unavailable | `DEFAULT_*` 常量正确使用 | ✅ Verified |
| Flag interaction matrix correct | P0 × TEMPLATE_PROJECTION 四种组合正确 | ✅ Verified |

---

## 3. Feature Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `PROMPT_MEMORY_P0_ENABLED` | OFF (undefined) | 统管 persona/toolSelectionPolicy/memoryPolicy 投影注入 |
| `PROMPT_TEMPLATE_PROJECTION_ENABLED` | OFF (undefined) | 启用模板驱动投影加载（门控于 P0） |
| `MEMORY_SEMANTIC_POLICY_ENABLED` | OFF | 统管 extraction 边界收紧 + long_term_fact 类型 |
| `HYBRID_RETRIEVAL_ENABLED` | OFF | 启用 Hybrid Retrieval (entity/time index + vector fallback) |
| `LIFECYCLE_SCORING_SHADOW` | OFF | 启用 Lifecycle Scoring shadow mode |
| `LIFECYCLE_POLICY_ENABLED` | OFF | 启用 Lifecycle Policy transitions |

### Flag Behavior

- Flag OFF → projection fields must be `undefined`, NOT empty string `""`
- Flag OFF → hash stability = P9 baseline (strictly identical)
- Flag OFF → no behavior changes to existing paths

### Flag Interaction Matrix

| PROMPT_MEMORY_P0_ENABLED | PROMPT_TEMPLATE_PROJECTION_ENABLED | Resolver 返回值 |
|--------------------------|-----------------------------------|----------------|
| OFF | OFF | `{}` (无投影) |
| OFF | ON | `{}` (TEMPLATE 被 P0 门控) |
| ON | OFF | Fallback Defaults |
| ON | ON | Template-loaded Projections |

---

## 4. Architecture Verification

### 4.1 Strategy/Data Separation

| Component | Type | Layer | Status |
|-----------|------|-------|--------|
| `personaProjection` | Strategy | ModelInputBuildInput 顶层 | Verified |
| `toolSelectionPolicy` | Strategy | ModelInputBuildInput 顶层 | Verified |
| `memoryPolicyProjection` | Strategy | ModelInputBuildInput 顶层 | Verified |
| `ToolPlaneProjection` | Data | 工具列表/权限 | Verified (不含 heuristics) |
| `ContextBundleData` | Data | 上下文内容 | Verified (不含 rules) |

### 4.2 Template Registry

| Template ID | Layer | File | Status |
|-------------|-------|------|--------|
| `persona:default` | 5 | `src/prompt/templates/persona/default.md` | Registered |
| `heuristics:tool-usage.common` | 6 | `src/prompt/templates/heuristics/tool-usage.common.md` | Registered |
| `context:memory-use-rules` | 7 | `src/prompt/templates/context/memory-use-rules.md` | Registered |
| `summary:session` | 7 | `src/prompt/templates/summary/session.md` | Registered |
| `summary:daily` | 7 | `src/prompt/templates/summary/daily.md` | Registered |
| `summary:weekly` | 7 | `src/prompt/templates/summary/weekly.md` | Registered |
| `summary:long-term` | 7 | `src/prompt/templates/summary/long-term.md` | Registered |
| `summary:atomic-facts` | 7 | `src/prompt/templates/summary/atomic-facts.md` | Registered |

**Total Templates: 16** (8 existing + 8 new)

---

## 5. Security Verification

### 5.1 Persona Injection Boundary

| Check | Status |
|-------|--------|
| Persona rendered as non-imperative text | Verified |
| Safety prefix: "不可覆盖系统规则/安全约束/工具授权/输出 schema/审计与租户边界" | Verified |
| Persona only affects Segment B | Verified |

### 5.2 Shadow Extraction Safety

| Check | Status |
|-------|--------|
| Shadow results NOT written to active LongTermMemoryStore | Verified |
| Shadow data follows tenant isolation | Verified |
| variant='shadow' distinguishes shadow records | Verified |

### 5.3 P0 Security Tests

| Test | Status |
|------|--------|
| Tenant isolation | Passed |
| Memory leakage | Passed |
| Deleted-memory-reingest | Passed |
| Persona-override | Passed |
| Tool-escalation | Passed |

---

## 6. Rollback Procedure

### 6.1 Feature Flags

All flags default to OFF. No action required for immediate rollback.

```bash
# Explicitly disable (already default)
unset PROMPT_MEMORY_P0_ENABLED
unset MEMORY_SEMANTIC_POLICY_ENABLED
unset HYBRID_RETRIEVAL_ENABLED
unset LIFECYCLE_SCORING_SHADOW
unset LIFECYCLE_POLICY_ENABLED
```

### 6.2 Database Migration

**Warning**: SQLite ADD COLUMN cannot be reverted. The following columns remain but are unused when flags are OFF:
- `memory_extraction_run.policy_version`
- `memory_extraction_run.variant`
- `memory_extraction_run.shadow_comparison_payload`
- `long_term_memories.entity_names`

### 6.3 Template Rollback

- Previous templates remain registered
- New templates can be deregistered if needed
- No impact on existing prompt generation when flags OFF

### 6.4 Code Rollback

Revert git commits in reverse order:
1. PM-21 (lifecycle scoring)
2. PM-18 (hybrid retrieval integration)
3. PM-17 (entity/time index)
4. PM-16 (hybrid retrieval abstraction)
5. PM-15 (P1 integration)
6. PM-14 (summary layers)
7. PM-13 (rolling summary)
8. PM-12 (planner bridge)
9. PM-10/11 (weekly/planner summary)
10. PM-9 (P0 security tests)
11. PM-8b (shadow extraction)
12. PM-8a (feature flags)
13. PM-7 (builder rendering)
14. PM-4/5/6 (layer 5/6/7 projections)
15. PM-3 (candidate validation)
16. PM-2 (semantic policy)
17. PM-1 (token baseline)

---

## 7. Must Have Checklist

All items from the plan's "Must Have" section:

- [x] Memory Semantic Policy 收紧（禁止项扩展 + `long_term_fact` 类型）
- [x] Layer 5/6/7 新字段 + 渲染逻辑
- [x] Weekly Summary 写入
- [x] PlannerStatePatch → SessionMemory bridge
- [x] Shadow mode 验证机制
- [x] 所有新功能默认关闭的 feature flag
- [x] Hybrid retrieval 抽象接口 (P2 decision-gated, abstraction complete — vector backend deferred)
- [x] Lifecycle scoring shadow (P2 decision-gated, shadow complete — production rollout deferred)

### Template-driven Projection Loading (Complete)

- [x] PromptProjectionResolver 接口定义 + 实现
- [x] Fallback defaults (DEFAULT_PERSONA_PROJECTION, DEFAULT_TOOL_SELECTION_POLICY, DEFAULT_MEMORY_POLICY_PROJECTION)
- [x] Feature flag PROMPT_TEMPLATE_PROJECTION_ENABLED
- [x] ForegroundAgent resolver 集成
- [x] AgentKernel resolver 集成
- [x] Memory extraction templates (agents:memory.md, output:memory-candidate.schema.md)
- [x] Summary prompt builder (5 summary types)
- [x] Flag interaction matrix 验证

---

## 8. Must NOT Have Checklist

All items verified:

- [x] 不新增独立大型 PromptAssembler — 只扩展 ModelInputBuilder
- [x] 不修改 `src/llm/types.ts` 的 LLMRequest 接口
- [x] 不引入新 npm 依赖（P2 向量存储选型单独决策）
- [x] 不直接覆盖/删除现有 long-term memory — 只通过 supersede 渐进替换
- [x] 不让人格覆盖 platform base / 安全规则 / JSON contract / tool authorization / tenant isolation
- [x] 不回退到 OpenHanako 的巨型 buildSystemPrompt() 模式
- [x] 不在 P0 做 summaryLayers 注入（推迟到 P1 PM-14）
- [x] P0/P1 不引入向量存储 — 只做 lexical + metadata
- [x] 不创建与 `ExtractedMemoryCandidate` 并行的 `MemoryCandidate` 类型 — 扩展现有类型
- [x] 不让策略投影混入数据容器（ToolPlaneProjection / ContextBundleData）
- [x] 不 rename 现有 `RollingSummaryTriggerEvent` 的枚举值
- [x] 不在 feature flag OFF 时通过默认值影响 hash
- [x] 不让 `personaProjection` 为裸字符串 — 必须为结构化接口
- [x] 不在 P2 承诺具体实现 — PM-17~PM-21 标为 decision-gated

---

## 9. Final Wave Verification

| Review | Agent | Result |
|--------|-------|--------|
| F1: Plan Compliance Audit | Oracle | ✅ APPROVE |
| F2: Code Quality Review | unspecified-high | ✅ APPROVE |
| F3: Real Manual QA | unspecified-high | ✅ APPROVE |
| F4: Scope Fidelity Check | deep | ✅ APPROVE |

---

## 10. Sign-Off

### 10.1 Technical Sign-Off

| Role | Date | Status |
|------|------|--------|
| Lead Developer | 2026-05-24 | Complete |
| QA | 2026-05-24 | All tests pass |
| Security | 2026-05-24 | Boundary tests pass |

### 10.2 Release Approval

| Approver | Date | Decision |
|----------|------|----------|
| Sisyphus | 2026-05-24 | Approved |

---

**Release Status**: P10 P0/P1 Complete + P2 Abstraction Complete (Decision-gated) / Ready for Phased Rollout After Validation
**Target Release Date**: 2026-05-24
**Release Manager**: Sisyphus

> All automated gates passed. Feature flags default OFF. P2 items (hybrid retrieval vector backend and lifecycle policy rollout) remain decision-gated and require separate production activation approval.
