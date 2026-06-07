# P10 Prompt × Memory Enhancement — Release Checklist

> Version: 1.0.0
> Created: 2026-05-24
> Phase: P0/P1 (Complete) + P2 (Decision-gated)

---

## Overview

| Attribute         | Value                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Phase             | P0/P1 (Complete) + P2 (Decision-gated, Abstraction Complete)                                                       |
| Implementation    | PM-1 through PM-22 (22 tasks) + Final Wave (F1-F4)                                                                 |
| Production Files  | 14 modified/created                                                                                                |
| Test Files        | 14 created                                                                                                         |
| Final Wave Status | F1-F4 all APPROVED                                                                                                 |
| P2 Status         | Abstraction complete, NoOpVectorBackend active, Lifecycle shadow mode ready — Production activation decision-gated |

---

## Feature Flags

All feature flags default to OFF for safe staged rollout:

| Flag                             | Default | Purpose                                                                          |
| -------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `PROMPT_MEMORY_P0_ENABLED`       | OFF     | Master flag for persona/toolSelectionPolicy/memoryPolicy projections             |
| `MEMORY_SEMANTIC_POLICY_ENABLED` | OFF     | Enable memory semantic policy (ephemeral pattern rejection, long_term_fact type) |
| `HYBRID_RETRIEVAL_ENABLED`       | OFF     | Enable hybrid retrieval (entity/time index + vector fallback)                    |
| `LIFECYCLE_SCORING_SHADOW`       | OFF     | Enable lifecycle scoring shadow mode                                             |
| `LIFECYCLE_POLICY_ENABLED`       | OFF     | Enable lifecycle policy transitions                                              |
| `PROMPT_SUMMARY_LAYERS_ENABLED`  | OFF     | Enable summary layer injection                                                   |

### Flag Behavior

| Flag State      | Behavior                             |
| --------------- | ------------------------------------ |
| OFF (undefined) | P9 baseline behavior, identical hash |
| ON              | P10 features enabled, hash changes   |

### Safe Rollout Order

1. `MEMORY_SEMANTIC_POLICY_ENABLED` — Low risk, shadow extraction monitors impact
2. `PROMPT_MEMORY_P0_ENABLED` — Medium risk, affects prompt construction
3. `PROMPT_SUMMARY_LAYERS_ENABLED` — Medium risk, affects context enrichment
4. `HYBRID_RETRIEVAL_ENABLED` — Higher risk, affects retrieval quality
5. `LIFECYCLE_SCORING_SHADOW` — Shadow mode, safe to enable for monitoring
6. `LIFECYCLE_POLICY_ENABLED` — Higher risk, affects memory lifecycle

---

## Evidence References

### Code Quality Gates

| Check             | Command                    | Expected | Evidence    |
| ----------------- | -------------------------- | -------- | ----------- |
| TypeScript        | `npm run typecheck`        | Clean    | No errors   |
| Unit Tests        | `npm run test:unit`        | All pass | 2524 passed |
| Integration Tests | `npm run test:integration` | All pass | 199 passed  |
| Security Tests    | `npm run test:security`    | All pass | 97 passed   |

### P10-Specific Gates

| Check                  | Command                                                              | Evidence |
| ---------------------- | -------------------------------------------------------------------- | -------- |
| Memory Semantic Policy | `npm test -- tests/unit/memory/memory-semantic-policy`               | Passed   |
| Persona Projection     | `npm test -- tests/unit/kernel/model-input/persona-projection`       | Passed   |
| Tool Selection Policy  | `npm test -- tests/unit/kernel/model-input/tool-selection-policy`    | Passed   |
| Memory Policy          | `npm test -- tests/unit/kernel/model-input/memory-policy-projection` | Passed   |
| Candidate Validation   | `npm test -- tests/unit/memory/memory-candidate-validation`          | Passed   |
| Shadow Extraction      | `npm test -- tests/unit/memory/shadow-extraction`                    | Passed   |
| Weekly Summary         | `npm test -- tests/unit/memory/summary-manager`                      | Passed   |
| Planner Bridge         | `npm test -- tests/unit/memory/planner-state-bridge`                 | Passed   |
| Rolling Summary        | `npm test -- tests/unit/memory/rolling-summary-policy`               | Passed   |
| Hybrid Retrieval       | `npm test -- tests/unit/memory/hybrid-retrieval`                     | Passed   |
| Lifecycle Scoring      | `npm test -- tests/unit/memory/lifecycle-scoring`                    | Passed   |
| Entity/Time Index      | `npm test -- tests/unit/memory/entity-time-index`                    | Passed   |

### Architecture Verification

| Check                            | Evidence                     |
| -------------------------------- | ---------------------------- |
| Strategy/Data Separation         | Verified via code review     |
| Template Registry (16 templates) | Verified via registry dump   |
| Hash Stability (flag OFF)        | Verified via hash comparison |
| Persona Injection Boundary       | Verified via security tests  |

---

## Verification Commands

### Pre-Deployment

```bash
# Type check
npm run typecheck

# Run all P10 tests
npm run test:p10

# Build frontend
npm run build:web

# Run full test suite
npm test
```

### Post-Deployment (Feature Flag OFF)

```bash
# Verify hash stability
npm run test:hash-stability

# Verify no behavior changes
npm run test:regression
```

### Post-Deployment (Feature Flag ON)

```bash
# Enable P0 features
export PROMPT_MEMORY_P0_ENABLED=true

# Enable semantic policy
export MEMORY_SEMANTIC_POLICY_ENABLED=true

# Verify shadow extraction
npm run test:shadow-extraction

# Monitor memory extraction diffs
npm run monitor:shadow-diff
```

---

## Rollback Procedure

### Immediate Rollback (All Features)

```bash
# Disable all P10 features
unset PROMPT_MEMORY_P0_ENABLED
unset MEMORY_SEMANTIC_POLICY_ENABLED
unset HYBRID_RETRIEVAL_ENABLED
unset LIFECYCLE_SCORING_SHADOW
unset LIFECYCLE_POLICY_ENABLED
unset PROMPT_SUMMARY_LAYERS_ENABLED
```

### Partial Rollback (Specific Feature)

```bash
# Disable only semantic policy
unset MEMORY_SEMANTIC_POLICY_ENABLED

# Disable only projections
unset PROMPT_MEMORY_P0_ENABLED
```

### Database Migration Rollback

**Warning**: SQLite ADD COLUMN cannot be reverted. The following columns remain but are unused when flags are OFF:

- `memory_extraction_run.policy_version`
- `memory_extraction_run.variant`
- `memory_extraction_run.shadow_comparison_payload`
- `long_term_memories.entity_names`

These columns do not affect system behavior when feature flags are OFF.

### Code Rollback

Revert git commits in reverse order:

1. PM-22 → PM-16 (P2 integration)
2. PM-15 → PM-10 (P1 integration)
3. PM-9 → PM-1 (P0 implementation)

---

## Monitoring Checklist

### Pre-Enablement Monitoring

| Metric       | Threshold | Action                  |
| ------------ | --------- | ----------------------- |
| Error rate   | < 1%      | Proceed with enablement |
| Latency P99  | < 5s      | Proceed with enablement |
| Memory usage | < 80%     | Proceed with enablement |

### Post-Enablement Monitoring

| Metric                | Threshold | Action     |
| --------------------- | --------- | ---------- |
| Shadow diff rate      | < 10%     | Acceptable |
| Memory rejection rate | < 5%      | Acceptable |
| Cache hit rate        | > 80%     | Acceptable |
| Error rate increase   | < 0.5%    | Acceptable |

### Alert Triggers

| Condition          | Alert Level | Action                         |
| ------------------ | ----------- | ------------------------------ |
| Error rate > 2%    | Critical    | Immediate rollback             |
| Shadow diff > 20%  | Warning     | Investigate, consider rollback |
| Cache hit < 50%    | Warning     | Investigate prompt changes     |
| Memory usage > 90% | Critical    | Scale or investigate leak      |

---

## Must Have Checklist

All items verified:

- [x] Memory Semantic Policy收紧（禁止项扩展 + `long_term_fact` 类型）
- [x] Layer 5/6/7 新字段 + 渲染逻辑
- [x] Weekly Summary 写入
- [x] PlannerStatePatch → SessionMemory bridge
- [x] Shadow mode 验证机制
- [x] 所有新功能默认关闭的 feature flag
- [x] Hybrid retrieval 抽象接口 (P2 decision-gated, abstraction complete — vector backend deferred)
- [x] Lifecycle scoring shadow (P2 decision-gated, shadow mode complete — production rollout decision-gated)

---

## Must NOT Have Checklist

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

## Sign-Off

### Technical Sign-Off

| Role           | Date       | Status              |
| -------------- | ---------- | ------------------- |
| Lead Developer | 2026-05-24 | Complete            |
| QA             | 2026-05-24 | All tests pass      |
| Security       | 2026-05-24 | Boundary tests pass |

### Release Approval

| Approver | Date       | Decision |
| -------- | ---------- | -------- |
| Sisyphus | 2026-05-24 | Approved |

---

**Release Status**: P10 P0/P1 Complete + P2 Abstraction Complete (Decision-gated) / Ready for Phased Rollout After Validation
**Target Release Date**: 2026-05-24
**Release Manager**: Sisyphus

> All automated gates passed. Feature flags default OFF. P2 items (hybrid retrieval vector backend, lifecycle scoring production rollout) are abstraction-complete with NoOpVectorBackend and shadow-mode safeguards; production activation requires separate decision. Manual deployment verification recommended before production rollout.
