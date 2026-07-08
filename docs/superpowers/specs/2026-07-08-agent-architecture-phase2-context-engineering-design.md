# Agent Architecture Phase 2 Context Engineering Design

> Date: 2026-07-08
> Status: Draft for review
> Scope: Phase 2 of agent architecture optimization - Context Engineering Rollout
> Parent spec: docs/superpowers/specs/2026-07-07-agent-architecture-optimization-design.md

## 背景

Phase 0 完成了 LLM 调用路径收敛，Phase 1 完成了输出契约加固。Phase 2 聚焦 context engineering 管线的可观测性、可预算和可回滚能力。

当前状态：
- P10 feature flag 全部默认关闭，无 shadow/canary 机制（仅有 `memory-lifecycle-scoring.ts` 的 3 阶段示例）。
- Segment D 已有 10 个子段，但无 per-subsection token budget。
- Context manager 已有评分/选择/预算执行，但预算是全局的。
- Memory 注入缺少 provenance（source type、freshness、relevance reason）。
- 无 context/memory 相关运行时指标。

## 目标

1. 为 P10 feature flag 增加 shadow/canary/default phase 机制。
2. 建立 context/memory 指标持久化基础设施。
3. 为 Segment D 每个 subsection 配置 token budget 和裁剪策略。
4. 为 memory 注入增加 provenance，使每次注入可解释。
5. 增加 architecture guards 防止回归。

## 非目标

- 不引入集中化 flag registry 或运行时 flag 服务。
- 不实现 Phase 3 ReAct trace 或 Phase 4 golden dataset。
- 不改变 P10 flag 的默认值（仍为关闭）。
- 不引入新的 LLM provider 或 memory 后端。
- 不改变 API route contracts。
- 不引入 Ajv 或其他 schema validation 依赖。

## 设计方案

### 1. Feature Flag Rollout 机制

扩展现有 env-var 模式，为每个 P10 flag 增加 phase 字段。

**Phase 值**：
- `shadow`：flag 返回 `false`（不启用功能），但记录指标。用于安全观测功能是否会被正确触发。
- `canary`：flag 返回 `true`（启用功能），同时记录指标。用于小范围验证。
- `default`：flag 返回 `true`，不额外记录。全量启用。

**环境变量**：
- `PROMPT_MEMORY_P0_PHASE`：`shadow` | `canary` | `default`（未设置时，flag 行为不变）
- `TOOL_LOOP_V2_PHASE`：同上

**模式参考**：`src/memory/memory-lifecycle-scoring.ts` 的 `getLifecyclePolicyPhase()`。

**新增文件**：
- `src/prompt/feature-flag-phase.ts`：`FeatureFlagPhase` 类型 + `getFlagPhase(envVar: string): FeatureFlagPhase | undefined` 函数
- `tests/unit/prompt/feature-flag-phase.test.ts`

**修改文件**：
- `src/prompt/feature-flags.ts`：每个 P10 flag 增加 `*Phase` 函数，原 flag 函数在 `canary`/`default` phase 时返回 `true`
- `tests/unit/prompt/feature-flags.test.ts`：增加 phase 测试

### 2. Context/Memory 指标基础设施

在 SQLite 中持久化记录每次模型输入的 context/memory 指标。

**Schema**（新表 `context_metrics`）：
```sql
CREATE TABLE context_metrics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  timestamp TEXT NOT NULL,
  segment_d_token_estimate INTEGER NOT NULL,
  segment_d_token_actual INTEGER NOT NULL,
  memory_injected_count INTEGER NOT NULL DEFAULT 0,
  memory_token_estimate INTEGER NOT NULL DEFAULT 0,
  summary_hit_count INTEGER NOT NULL DEFAULT 0,
  summary_token_estimate INTEGER NOT NULL DEFAULT 0,
  transcript_token_estimate INTEGER NOT NULL DEFAULT 0,
  pinned_item_count INTEGER NOT NULL DEFAULT 0,
  ordered_item_count INTEGER NOT NULL DEFAULT 0,
  dropped_context_reasons TEXT,
  flag_phase TEXT,
  flag_name TEXT
);
CREATE INDEX idx_context_metrics_run_id ON context_metrics(run_id);
CREATE INDEX idx_context_metrics_agent_id ON context_metrics(agent_id, timestamp);
```

**新增文件**：
- `migrations/NNN_add_context_metrics.sql`
- `src/storage/context-metrics-store.ts`：`createContextMetricsStore(connection)` 工厂
- `tests/unit/storage/context-metrics-store.test.ts`

**记录钩子**：
- 在 `AgentKernel.run()` 完成 `modelInputBuilder.build()` 后，调用 `contextMetricsStore.record(metrics)`
- 通过 `KernelConfig.contextMetricsStore` 注入（可选，测试中不注入则跳过）
- 指标数据来源：`BuiltModelInput.metadata` + `BuiltModelInput.segments` 的 token 估算

**查询 API**：
- `getMetricsByRunId(runId): ContextMetrics | null`
- `getRecentMetrics(agentId: string, limit: number): ContextMetrics[]`

### 3. Segment D Per-Subsection Token Budget Policy

为 Segment D 的每个子段配置 token budget 和裁剪策略。

**Budget 配置类型**：
```typescript
export interface SegmentDBudgetConfig {
  totalBudget: number
  subsections: {
    provenance: number
    memoryPolicy: number
    summaryLayers: number
    dynamicFields: number
    runtimeEnvironment: number
    contextItems: number
    userMessage: number
    transcript: number
  }
}
```

**默认预算分配**（基于总预算 4096 tokens）：

| 子段 | 默认预算 | 优先级 | 可裁剪 |
|------|---------|--------|--------|
| userMessage | 不限 | 最高 | 否 |
| pinnedItems (contextItems) | 1024 | 高 | 是 |
| orderedItems (contextItems) | 1024 | 高 | 是 |
| transcript | 768 | 中 | 是 |
| summaryLayers | 512 | 中 | 是 |
| memoryPolicy | 256 | 低 | 是 |
| runtimeEnvironment | 128 | 低 | 是 |
| provenance | 64 | 最低 | 是 |
| dynamicFields | 不限 | 高 | 否 |

**裁剪策略**：
- 当某子段超出预算时，从尾部裁剪（最低优先级的项先移除）
- `userMessage` 和 `dynamicFields` 不可裁剪
- 裁剪时记录 `dropped_context_reasons`（section、reason、item_count）
- 裁剪后的 token 估算写入 `segment_d_token_actual`

**新增文件**：
- `src/kernel/model-input/segment-d-budget.ts`：`SegmentDBudgetConfig` 类型 + `enforceSegmentDBudget()` 函数 + `DEFAULT_SEGMENT_D_BUDGET` 常量
- `tests/unit/kernel/model-input/segment-d-budget.test.ts`

**修改文件**：
- `src/kernel/model-input/model-input-builder.ts`：在 `buildSegmentD()` 末尾调用 `enforceSegmentDBudget()`
- `src/kernel/model-input/model-input-types.ts`：增加 `segmentDBudget?: SegmentDBudgetConfig` 到 `ModelInputBuildInput`
- `src/kernel/types.ts`：增加 `segmentDBudget?: SegmentDBudgetConfig` 到 `KernelConfig`
- `src/api/context.ts`：注入默认 `segmentDBudget` 到 `KernelConfig`

### 4. Memory Provenance

为内存注入增加出处信息，使每次内存项进入模型输入时可解释。

**Provenance 类型**：
```typescript
export interface MemoryProvenance {
  sourceType: 'long_term_memory' | 'session_memory' | 'summary_layer' | 'working_summary'
  sourceRef: string
  freshnessTs: string
  relevanceReason: string
  retrievalScore?: number
}
```

**注入路径**：
- `LongTermMemoryRecallService.recall()` 返回的 memory records 增加 `provenance` 字段
- `relevanceReason` 由 recall service 根据检索方式生成：
  - keyword match: `"keyword match: <matched_keyword>"`
  - metadata filter: `"metadata filter: <filter_field>=<value>"`
  - high confidence: `"high confidence: <score>"`
- `MemoryProvenance` 在 Segment D 的 provenance 子段中渲染为结构化文本

**渲染格式**：
```markdown
## Provenance
- sourceType: long_term_memory
  sourceRef: mem-abc123
  freshness: 2026-07-08T10:00:00Z
  relevanceReason: keyword match: concise
  retrievalScore: 0.85
```

**新增文件**：
- 无（修改现有文件）

**修改文件**：
- `src/memory/long-term-memory-recall.ts`：`recall()` 返回结果增加 `provenance` 字段
- `src/memory/types.ts`：增加 `MemoryProvenance` 接口
- `src/kernel/model-input/model-input-builder.ts`：`buildSegmentD()` 渲染 provenance 时包含 memory provenance
- `src/kernel/model-input/model-input-types.ts`：`MemoryPolicyProjection` 增加 `provenance?: MemoryProvenance[]`
- `tests/unit/memory/long-term-memory-recall.test.ts`：增加 provenance 测试

**指标关联**：
- `memory_injected_count` = provenance 数组长度
- `memory_token_estimate` = provenance 渲染文本的 token 估算

### 5. Architecture Guards + 最终验证

**新增架构守卫**（在 `tests/architecture/no-legacy-prompt-path.test.ts` 中增加 `Phase 2 Context Engineering Guards` 块）：

1. **Feature flag phase guard**：验证 `feature-flags.ts` 包含 `getPromptMemoryP0Phase` 函数
2. **Segment D budget guard**：验证 `model-input-builder.ts` 包含 `enforceSegmentDBudget` 调用
3. **Memory provenance guard**：验证 `long-term-memory-recall.ts` 包含 `MemoryProvenance` 和 `relevanceReason`
4. **Metrics store guard**：验证 `context-metrics-store.ts` 存在且导出 `record` 和 `getMetricsByRunId`

## Task 组织

| Task | 内容 | 提交信息 |
|------|------|---------|
| 1 | Feature flag rollout 机制 | `feat(prompt): add feature flag phase mechanism` |
| 2 | Context/Memory 指标基础设施 | `feat(metrics): add context metrics store` |
| 3 | Segment D token budget policy | `feat(kernel): enforce segment D token budgets` |
| 4 | Memory provenance | `feat(memory): add memory provenance` |
| 5 | Architecture guards + 最终验证 | `test(architecture): guard phase2 context engineering` |

## 全局约束

- 遵循 `docs/superpowers/specs/2026-07-07-agent-architecture-optimization-design.md`。
- 范围仅限 Phase 2：feature flag rollout、context/memory 指标、Segment D token budget、memory provenance。
- 不实现 Phase 3 ReAct trace 或 Phase 4 golden dataset。
- 不改变 P10 flag 的默认值（仍为关闭）。
- 不引入集中化 flag registry 或运行时 flag 服务。
- 不引入 Ajv 或其他 schema validation 依赖。
- 不改变 API route contracts。
- TypeScript strict mode 启用 `noUnusedLocals` 和 `noUnusedParameters`。
- 使用 TDD 进行生产代码变更：先写失败测试，运行，实现最小代码，重运行。

## 验收标准

- P10 feature flag 支持 shadow/canary/default phase。
- `context_metrics` 表持久化记录每次模型输入的 context/memory 指标。
- Segment D 每个 subsection 有 token budget 和裁剪策略。
- Memory 注入有 provenance（sourceType、sourceRef、freshnessTs、relevanceReason）。
- 长会话不会因无界上下文膨胀破坏 token budget。
- Architecture guards 防止 Phase 2 改动被回归。
