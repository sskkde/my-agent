# Agent Architecture Phase 3 ReAct Trace Design

> Date: 2026-07-08
> Status: Draft for review
> Scope: Phase 3 of agent architecture optimization - ReAct Trace and Decision Explanation
> Parent spec: docs/superpowers/specs/2026-07-07-agent-architecture-optimization-design.md

## 背景

Phase 0 完成了 LLM 调用路径收敛，Phase 1 完成了输出契约加固，Phase 2 完成了 context engineering rollout。Phase 3 聚焦结构化 ReAct trace 和决策解释能力。

当前状态：
- `decisionTrace` 已标记 `@deprecated`，所有路径硬编码为 `answer_directly`。
- Kernel transcript 完整记录 tool_call/tool_result（含参数和结果），但持久化时全部删除，仅保留 toolName 和 status。
- 不存在候选工具、选定工具、被拒工具的追踪。
- 不存在 observation summary；工具结果要么完整保留在内存 transcript 中，要么持久化时完全删除。
- 有审批机制但不在 trace 中记录；`TurnTranscript.runtimeSummary.approvalSummaries` 已定义但未填充。
- `ToolCallSummary` 有 `summary`、`transcriptSummary`、`resultRef` 字段但全部未使用。

## 目标

1. 定义 `StructuredDecisionTrace` 类型，替代 deprecated 的 `ForegroundDecision`。
2. 实现按工具类别的 observation summary 生成器。
3. 在 AgentKernel 运行循环中收集 trace 数据。
4. 将 trace 接入 ForegroundAgent 并持久化到 transcript store。
5. 增加 architecture guards 防止回归。

## 非目标

- 不删除 `ForegroundDecision` 类型（保持 deprecated 并存）。
- 不保存完整原始 Chain of Thought。
- 不实现 Phase 4 golden dataset 或 prompt regression runner。
- 不引入新的 LLM provider 或 memory 后端。
- 不改变 API route contracts。
- 不引入 Ajv 或其他 schema validation 依赖。

## 设计方案

### 1. 类型定义 + Observation Summary 生成器

**新增文件**：`src/kernel/decision-trace-types.ts`

```typescript
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
```

**新增文件**：`src/kernel/observation-summary-builder.ts`

函数 `buildObservationSummary(toolName: string, toolResult: ToolUseResult): ObservationSummary`

按工具类别策略：
- `search_subagent` / `web_search` -> `search_facts`：提取 top-3 extractedFacts
- `file_read` / `file_glob` -> `file_preview`：前 200 字符 + 行数
- `memory_retrieve` -> `memory_keywords`：记录数量 + top-3 keywords
- 其他 -> `generic`：截断结果文本到 500 字符

### 2. AgentKernel Trace 收集

**新增文件**：`src/kernel/decision-trace-builder.ts`

函数 `buildDecisionTrace(state: KernelRunState, input: KernelRunInput, finalContent?: string): StructuredDecisionTrace`

收集点：
1. **候选工具**：从 `input.toolProjection.toolIds` 获取（run 开始时）
2. **选定工具**：从 `state.toolCalls` 中每条记录
3. **被拒工具**：`candidateTools` - `selectedTools` 的差集
4. **Observation summaries**：每个 `tool_result` 转入 `buildObservationSummary()`
5. **Risk assessments**：检查工具类别是否高风险，记录审批状态
6. **Route**：有工具调用 -> `tool_loop`；无工具调用直接回复 -> `answer_directly`；失败 -> `failed`
7. **Final answer source**：有工具调用且最终回复包含工具结果信息 -> `tool_synthesized`；无工具调用 -> `llm_direct`；失败 -> `error`

**修改文件**：
- `src/kernel/types.ts`：`KernelRunResult` 增加可选字段 `structuredTrace?: StructuredDecisionTrace`
- `src/kernel/agent-kernel.ts`：在 `buildResult()` 中调用 `buildDecisionTrace()`，将结果附加到 `KernelRunResult`

### 3. ForegroundAgent 集成 + Transcript 持久化

**ForegroundTurnResult 扩展**：
- 新增字段 `structuredTrace?: StructuredDecisionTrace`（与 `decisionTrace` 并存，后者保持 deprecated）
- `mapKernelResultToForegroundResult()` 从 `kernelResult.structuredTrace` 提取

**Transcript Store 扩展**：
- `TurnTranscript.runtimeSummary` 增加字段：
  - `structuredTrace?: StructuredDecisionTrace`
  - `observationSummaries?: ObservationSummary[]`
  - `riskAssessments?: RiskAssessmentRecord[]`
- `approvalSummaries` 字段从 `string[]` 改为 `RiskAssessmentRecord[]`

**Redaction Mapper 扩展**：
- `transcript-redaction-mapper.ts` 将 `structuredTrace` 传入 `runtimeSummary`
- Trace 数据本身已经是 redacted 的（不包含完整工具参数或结果，只有摘要）

**修改文件**：
- `src/foreground/foreground-runner-types.ts`：`ForegroundTurnResult` 增加 `structuredTrace`
- `src/foreground/foreground-agent.ts`：`mapKernelResultToForegroundResult()` 提取 trace
- `src/storage/transcript-store.ts`：`runtimeSummary` 类型扩展
- `src/foreground/transcript-redaction-mapper.ts`：传递 trace 数据

### 4. Architecture Guards + 最终验证

**新增架构守卫**：
1. Decision trace types guard：验证 `decision-trace-types.ts` 导出 `StructuredDecisionTrace` 等
2. Observation summary builder guard：验证 `observation-summary-builder.ts` 导出 `buildObservationSummary`
3. Decision trace builder guard：验证 `agent-kernel.ts` 包含 `structuredTrace`
4. Foreground trace guard：验证 `foreground-agent.ts` 包含 `structuredTrace`
5. Transcript store guard：验证 `runtimeSummary` 包含 `structuredTrace`

## Task 组织

| Task | 内容 | 提交信息 |
|------|------|---------|
| 1 | 类型定义 + Observation Summary 生成器 | `feat(kernel): add decision trace types and observation summaries` |
| 2 | AgentKernel trace 收集 | `feat(kernel): collect structured decision trace` |
| 3 | ForegroundAgent 集成 + transcript 持久化 | `feat(foreground): integrate structured decision trace` |
| 4 | Architecture guards + 最终验证 | `test(architecture): guard phase3 react trace` |

## 全局约束

- 遵循 `docs/superpowers/specs/2026-07-07-agent-architecture-optimization-design.md`。
- 范围仅限 Phase 3：structured decision trace、tool selection/rejection reason、observation summary、foreground 真实 decisionTrace。
- 不实现 Phase 4 golden dataset 或 prompt regression runner。
- 不删除 `ForegroundDecision` 类型（保持 deprecated 并存）。
- 不保存完整原始 Chain of Thought。
- 不改变 API route contracts。
- TypeScript strict mode 启用 `noUnusedLocals` 和 `noUnusedParameters`。
- 使用 TDD 进行生产代码变更：先写失败测试，运行，实现最小代码，重运行。

## 验收标准

- `StructuredDecisionTrace` 类型包含 route、intent、candidateTools、selectedTools、rejectedTools、observationSummaries、riskAssessments、finalAnswerSource。
- Observation summary 按工具类别生成（search_facts、file_preview、memory_keywords、generic）。
- AgentKernel 在 run 结束时生成 `structuredTrace` 并附加到 `KernelRunResult`。
- ForegroundAgent 从 kernel 结果提取 `structuredTrace` 并附加到 `ForegroundTurnResult`。
- Transcript store 持久化 `structuredTrace` 到 `runtimeSummary`。
- `decisionTrace`（deprecated）保持不变，不删除。
- Architecture guards 防止 Phase 3 改动被回归。
