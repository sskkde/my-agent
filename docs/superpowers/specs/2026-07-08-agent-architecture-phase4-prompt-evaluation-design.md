# Agent Architecture Phase 4 Prompt Evaluation Design

> Date: 2026-07-08
> Status: Draft for review
> Scope: Phase 4 of agent architecture optimization - Prompt Evaluation and Offline Optimization
> Parent spec: docs/superpowers/specs/2026-07-07-agent-architecture-optimization-design.md

## 背景

Phase 0 完成了 LLM 调用路径收敛，Phase 1 完成了输出契约加固，Phase 2 完成了 context engineering rollout，Phase 3 完成了 ReAct trace 和决策解释。Phase 4 聚焦 prompt 生命周期治理能力。

当前状态：
- 34 个 prompt 模板文件，7 层注册表完整实现。
- 模型输入快照存储已实现但仅内存（`Map`），无 SQLite 持久化。
- Segment hash（SHA-256）完整实现，已用于缓存验证。
- 无任何 golden/snapshot 级别的 prompt 测试。这是主要缺口。
- `scripts/token-baseline.ts` 存在，使用 char/4 估算。
- 4 个输出合约已注册，Phase 1 已实现 validator。
- 6 个 feature flag + 3-state phase 系统（Phase 2），未集成到测试工具。

## 目标

1. 建立 golden dataset，覆盖直接回答、工具选择、权限拒绝、schema repair、memory retrieval、search evidence、provider fallback。
2. 构建 prompt/template regression runner，集成到 Vitest。
3. 生成 segment/token/tool/schema diff report。
4. 提供 offline prompt candidate workflow 框架（不做自动优化算法）。
5. 增加 architecture guards 防止回归。

## 非目标

- 不实现 APE/DSPy 自动优化算法（只做候选生成和比较框架）。
- 不自动写入生产 prompt 模板。
- 不引入 LLM 特定 tokenizer 依赖（继续使用 char/4 估算）。
- 不改变 API route contracts。
- 不引入 Ajv 或其他 schema validation 依赖。
- 不修改现有 prompt 模板内容。

## 设计方案

### 1. Golden Case 类型 + 初始 Cases + Regression Runner

**Golden Case 类型**（`src/golden/golden-case-types.ts`）：

```typescript
export interface GoldenCase {
  id: string
  category: GoldenCaseCategory
  description: string
  input: GoldenCaseInput
  expectations: GoldenCaseExpectations
}

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
```

**初始 Golden Cases**（`tests/golden/cases/` 目录，每个 case 一个 `.ts` 文件）：
1. `direct-answer-simple.ts` - 直接回答场景
2. `tool-selection-web-search.ts` - 工具选择场景
3. `permission-denial-high-risk.ts` - 权限拒绝场景
4. `schema-repair-memory.ts` - schema 修复场景
5. `memory-retrieval-keyword.ts` - 记忆检索场景
6. `search-evidence-subagent.ts` - 搜索证据场景
7. `provider-fallback-ollama.ts` - provider 回退场景

**Regression Runner**（`src/golden/regression-runner.ts`）：
- `runGoldenCase(case: GoldenCase): GoldenCaseResult`
- 构建真实 `ModelInputBuilder`，调用 `build(input)`
- 检查 segment hashes、token estimates、tool projection、output contract validation
- 返回 `{ passed: boolean, caseId, diffs: GoldenCaseDiff[] }`

**Vitest 集成**（`tests/golden/golden-regression.test.ts`）：
- 加载所有 golden cases
- 对每个 case 运行 `runGoldenCase()`
- 断言 `passed === true`
- 输出 diff 信息用于调试

### 2. Diff Report 生成器

**Diff Report 类型**（`src/golden/diff-report-types.ts`）：

```typescript
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

**Diff Report 生成器**（`src/golden/diff-report-generator.ts`）：
- `generateDiffReport(baseline: GoldenCaseResult[], current: GoldenCaseResult[]): PromptDiffReport`
- 接受两组 `GoldenCaseResult`（baseline 和 current），逐 case 比较
- 输出结构化 `PromptDiffReport`

**使用方式**：
- 在 CI 中运行 baseline（main 分支）和 current（PR 分支），生成 diff report
- 也可手动运行比较两个 snapshot

### 3. Candidate Workflow 框架

**Candidate 类型**（`src/golden/candidate-types.ts`）：

```typescript
export interface PromptCandidate {
  candidateId: string
  description: string
  templateOverrides: TemplateOverride[]
  featureFlagOverrides: Record<string, string>
  createdAt: string
}

export interface TemplateOverride {
  templateId: string
  content: string
}

export interface CandidateResult {
  candidate: PromptCandidate
  goldenResults: GoldenCaseResult[]
  diffReport: PromptDiffReport
  approved: boolean
}
```

**Candidate Runner**（`src/golden/candidate-runner.ts`）：
- `runCandidate(candidate: PromptCandidate, baseline: GoldenCaseResult[]): CandidateResult`
- 用 `templateOverrides` 创建临时 `PromptTemplateRegistry`（不修改生产注册表）
- 用 `featureFlagOverrides` 设置环境变量
- 运行所有 golden cases
- 生成 diff report vs baseline

**安全约束**：
- 候选只生成 diff report，不自动写入生产模板
- 候选结果需要人工 review 后才能手动应用
- `approved` 字段默认为 `false`

### 4. Architecture Guards + 最终验证

**新增架构守卫**：
1. Golden case types guard：验证 `golden-case-types.ts` 导出 `GoldenCase`、`GoldenCaseCategory`
2. Regression runner guard：验证 `regression-runner.ts` 导出 `runGoldenCase`
3. Diff report guard：验证 `diff-report-generator.ts` 导出 `generateDiffReport`
4. Candidate runner guard：验证 `candidate-runner.ts` 导出 `runCandidate`
5. Golden cases existence guard：验证 `tests/golden/cases/` 目录下有至少 7 个 case 文件
6. Golden regression test guard：验证 `tests/golden/golden-regression.test.ts` 存在且包含 `runGoldenCase`

## Task 组织

| Task | 内容 | 提交信息 |
|------|------|---------|
| 1 | Golden case 类型 + 初始 cases + regression runner | `feat(golden): add golden cases and regression runner` |
| 2 | Diff report 生成器 | `feat(golden): add diff report generator` |
| 3 | Candidate workflow 框架 | `feat(golden): add candidate workflow framework` |
| 4 | Architecture guards + 最终验证 | `test(architecture): guard phase4 prompt evaluation` |

## 全局约束

- 遵循 `docs/superpowers/specs/2026-07-07-agent-architecture-optimization-design.md`。
- 范围仅限 Phase 4：golden dataset、regression runner、diff report、candidate workflow 框架。
- 不实现 APE/DSPy 自动优化算法。
- 不自动写入生产 prompt 模板。
- 不引入 LLM 特定 tokenizer 依赖。
- 不改变 API route contracts。
- 不修改现有 prompt 模板内容。
- TypeScript strict mode 启用 `noUnusedLocals` 和 `noUnusedParameters`。
- 使用 TDD 进行生产代码变更：先写失败测试，运行，实现最小代码，重运行。

## 验收标准

- `GoldenCase` 类型包含 id、category、description、input、expectations。
- 7 个初始 golden cases 覆盖 7 个场景。
- `runGoldenCase()` 构建真实 `ModelInputBuilder` 并检查 segment hashes、token estimates、tool projection。
- Golden regression tests 集成到 Vitest 并通过。
- `generateDiffReport()` 比较 baseline 和 current 的 hash/token/tool/schema 变化。
- `runCandidate()` 用 template overrides 运行 golden set 并生成 diff report。
- 候选结果不自动写入生产模板，需要人工 review。
- Architecture guards 防止 Phase 4 改动被回归。
