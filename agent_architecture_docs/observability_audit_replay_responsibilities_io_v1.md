# Observability / Audit / Replay 功能职责与输入输出文档 v2（Foreground / PlannerRun 对齐版）

## 1. 文档目的

本文档定义个人助理型 Agent 平台中的 **Observability / Audit / Replay** 模块，包括：

- 模块定位与职责边界
- 参考 Claude Code 后可借鉴的运行追踪、工具记录、权限审计、Subagent 追踪、Compact / Memory 生命周期记录思路
- Telemetry、Audit、Replay、Debug Trace、Timeline、Metrics 的边界
- 输入输出对象、事件模型、查询接口、回放机制
- 与 Agent Kernel、Tool Plane、Permission Engine、Workflow Runtime、Subagent Runtime、Event Trigger Runtime、Connector Runtime、Memory System、Hooks / Event Bus、Runtime Dispatcher 的关系
- MVP 实现建议

---

## 2. 模块定位

Observability / Audit / Replay 的推荐定位是：

> **Agent 平台的可观测性、审计和复盘基础设施。**

它回答三类问题：

```text
Observability:
  系统现在发生了什么？运行状态是否健康？

Audit:
  系统为什么做了这件事？谁授权的？依据是什么？

Replay:
  如果要复盘、调试、恢复或再现，当时发生了哪些步骤？
```

它不是：

- Agent Kernel
- Event Store 本身
- Memory System
- Transcript Store
- Workflow Runtime
- Permission Engine
- 普通日志打印模块

它是建立在 Event Store、Transcript Store、Trace Store、Metrics Store、Audit Store 之上的可观察与复盘层。

---

## 3. 参考 Claude Code 的核心启发

Claude Code 值得借鉴的不是单独一个“监控模块”，而是其运行时天然具备可追踪结构。

Claude Code 的核心围绕 Query Loop 展开：读取历史与上下文、组织 memory / skills / tools、模型采样、解析 tool use、执行工具、回灌 tool result、继续循环，最后进入 stop / memory extraction / compact 等收尾流程。其核心模块包括 `query.ts`、tool orchestration / execution、permissions、AgentTool、compact、SessionMemory、extractMemories、MCP 和 tasks。这个结构本身天然形成一条可追踪的运行链路。  

从 Claude Code 可借鉴的点：

## 3.1 Query Loop 是天然 Trace Root

每次用户请求对应一个 run / turn / query loop。

可观察对象包括：

- 模型输入构建
- 模型采样
- assistant 输出
- tool use
- tool result
- compact
- stop reason
- error / interruption

对本系统的启发：

> 每个 Agent Kernel run 都应该生成一条完整 Run Trace。

---

## 3.2 Tool Execution 是关键审计点

Claude Code 的工具执行不是简单函数调用，而是包含 schema parse、validate input、permission check、pre/post hook、tool call、progress、result mapping、failure hook 等完整流水线。

对本系统的启发：

> 每次工具调用必须有完整的 ToolCallTrace 和 AuditRecord，尤其是外部写操作。

---

## 3.3 Permission Decision 必须可追溯

Claude Code 的权限系统包含 hooks、allow / deny 规则、mode 判定、classifier、interactive approval、runtime callback。

对本系统的启发：

> 每次 allow / ask / deny 都要记录触发原因、匹配规则、审批结果和授权作用域。

---

## 3.4 Subagent 是独立 Trace

Claude Code 的 Subagent 本质是由 AgentTool 拉起新的 query loop，完成后返回摘要。

对本系统的启发：

> SubagentRun 应有独立 trace，同时通过 parentRunId / rootRunId 与主 Agent 串联。

---

## 3.5 Compact / Memory 是可观测生命周期

Claude Code 有 Session Memory、持久记忆提取、自动 compact、compact 后状态重建。

对本系统的启发：

> compact、summary、memory extraction、memory write 都必须被记录和可追溯，否则后续无法解释“为什么系统记住了这件事”。

---

## 3.6 MCP / Connector 需要边界审计

Claude Code 的 MCP 层说明外部能力接入是运行时的一部分。

对本系统的启发：

> 每次外部资源读取、写入、MCP tool call、MCP notification、connector event 都应可审计。

---

## 4. Observability / Audit / Replay 的职责清单

## 4.1 Observability 职责

负责系统运行状态观测：

- Run trace
- Span trace
- Metrics
- Runtime timeline
- Error tracking
- Latency tracking
- Token / cost tracking
- Tool call statistics
- Connector health
- Queue backlog
- Event delivery lag
- Subagent watchdog status
- Workflow run progress
- Event trigger status
- Memory / summary pipeline status

---

## 4.2 Audit 职责

负责高可信操作记录：

- 用户输入
- Agent 输出
- 工具调用
- 外部写操作
- 权限决策
- 审批请求与结果
- Workflow 创建、启用、执行
- BackgroundSubagentRun 创建、恢复、失败
- Connector resource access
- Memory write / update / delete
- Summary write
- Bypass permission scope
- LLMPreApprovalJudge decision
- Hook mutation
- Runtime Dispatcher dispatch

Audit 记录应支持：

- 来源追溯
- 用户可解释
- 安全合规
- 删除 / 遗忘策略配合
- 争议复盘

---

## 4.3 Replay 职责

负责复盘和部分重放：

- 按 runId 还原执行路径
- 按 workflowRunId 还原 step 进度
- 按 backgroundRunId 还原后台 Subagent 执行
- 按 toolCallId 查工具输入输出
- 按 approvalId 查授权链路
- 按 memoryId 查记忆来源
- 从 Event Store 重建状态投影
- 支持 dry-run replay
- 支持 timeline replay
- 支持 failure replay

注意：

> Replay 不等于一定重新执行外部副作用。默认应是只读复盘；涉及外部写操作时必须进入 dry-run 或要求审批。

---

## 4.4 不应承担的职责

Observability / Audit / Replay 不应承担：

- 不驱动 Agent Loop
- 不执行工具
- 不做权限最终判断
- 不编排 Workflow
- 不生成长期记忆
- 不替代 Event Bus
- 不替代 Event Store
- 不直接通知用户
- 不修改业务状态，除非明确执行 replay recovery action

---

## 5. Observability、Audit、Replay、Event Store 的边界

```text
Event Store
  事实事件持久化

Telemetry / Trace Store
  运行性能与调用链

Audit Store
  高可信安全审计记录

Transcript Store
  用户可读对话与运行摘要

Replay Service
  基于 Event / Trace / Audit / Transcript 重建执行过程
```

### 5.1 Event Store

保真记录运行事实，支持状态恢复和 replay。

### 5.2 Trace Store

记录 span、latency、token、cost、调用链。

### 5.3 Audit Store

记录安全相关动作和授权依据。

### 5.4 Transcript Store

记录用户可读历史。

### 5.5 Replay Service

读取上述存储，生成 replay timeline 或状态重建结果。

---

## 6. 推荐子模块

```text
Observability / Audit / Replay
  ├─ TraceCollector
  ├─ SpanManager
  ├─ MetricsCollector
  ├─ RuntimeTimelineBuilder
  ├─ AuditRecorder
  ├─ AuditPolicyEngine
  ├─ AuditQueryService
  ├─ ReplayService
  ├─ ReplayPlanner
  ├─ ReplayStateRebuilder
  ├─ ReplaySafetyGuard
  ├─ FailureAnalyzer
  ├─ RunInspector
  ├─ CostTracker
  ├─ TokenUsageTracker
  ├─ ConnectorHealthObserver
  ├─ SubagentWatchObserver
  ├─ WorkflowRunObserver
  ├─ EventLagMonitor
  └─ ObservabilityDashboardAPI
```

---

## 7. 核心对象设计

## 7.1 TraceContext

```ts
type TraceContext = {
  traceId: string
  rootRunId?: string
  parentRunId?: string
  runId?: string
  sessionId?: string
  userId?: string

  correlationId?: string
  causationId?: string

  source:
    | "gateway"
    | "planner"
    | "kernel"
    | "workflow"
    | "subagent"
    | "tool"
    | "permission"
    | "event_trigger"
    | "connector"
    | "memory"
    | "dispatcher"
    | "system"

  createdAt: string
}
```

---

## 7.2 RuntimeSpan

```ts
type RuntimeSpan = {
  spanId: string
  traceId: string
  parentSpanId?: string

  spanType:
    | "gateway_inbound"
    | "intent_route"
    | "plan_create"
    | "model_input_build"
    | "model_sample"
    | "tool_call"
    | "permission_check"
    | "approval_wait"
    | "subagent_run"
    | "workflow_step"
    | "event_trigger_wait"
    | "connector_call"
    | "compact"
    | "summary_generate"
    | "memory_extract"
    | "dispatch"
    | "notification"
    | "hook"

  name: string

  status:
    | "started"
    | "completed"
    | "failed"
    | "cancelled"
    | "timeout"

  startedAt: string
  endedAt?: string
  durationMs?: number

  relatedRefs?: {
    sessionId?: string
    runId?: string
    planId?: string
    workflowRunId?: string
    workflowStepRunId?: string
    backgroundRunId?: string
    subagentRunId?: string
    toolCallId?: string
    approvalId?: string
    connectorId?: string
    memoryId?: string
    summaryId?: string
    artifactId?: string
  }

  attributes?: Record<string, unknown>

  error?: {
    code: string
    message: string
    recoverable: boolean
  }
}
```

---

## 7.3 RuntimeMetric

```ts
type RuntimeMetric = {
  metricId: string

  metricName:
    | "run_latency_ms"
    | "model_latency_ms"
    | "tool_latency_ms"
    | "connector_latency_ms"
    | "workflow_step_latency_ms"
    | "subagent_latency_ms"
    | "event_delivery_lag_ms"
    | "token_input_count"
    | "token_output_count"
    | "tool_call_count"
    | "permission_ask_count"
    | "approval_latency_ms"
    | "compact_count"
    | "memory_recall_count"
    | "memory_write_count"
    | "error_count"
    | "cost_estimate"

  value: number

  dimensions?: {
    userId?: string
    sessionId?: string
    runId?: string
    module?: string
    toolName?: string
    connectorId?: string
    model?: string
    workflowId?: string
    agentType?: string
  }

  timestamp: string
}
```

---

## 7.4 AuditRecord

```ts
type AuditRecord = {
  auditId: string
  eventId?: string
  traceId?: string

  auditType:
    | "user_input"
    | "assistant_output"
    | "tool_call"
    | "external_write"
    | "permission_decision"
    | "approval_request"
    | "approval_response"
    | "workflow_definition_change"
    | "workflow_run"
    | "subagent_run"
    | "connector_resource_access"
    | "memory_write"
    | "memory_delete"
    | "summary_write"
    | "hook_mutation"
    | "dispatch"
    | "bypass_permission"
    | "llm_preapproval"

  userId?: string
  sessionId?: string
  actor: {
    actorType:
      | "user"
      | "assistant"
      | "main_agent"
      | "subagent"
      | "workflow"
      | "system"
      | "connector"
      | "hook"
    actorId?: string
  }

  action: {
    actionType: string
    actionSummary: string
    inputHash?: string
    outputHash?: string
    diffSummary?: string
  }

  target?: {
    targetType:
      | "tool"
      | "connector_resource"
      | "workflow"
      | "memory"
      | "summary"
      | "artifact"
      | "calendar_event"
      | "email"
      | "file"
      | "external_system"
      | "runtime"
    targetId?: string
    displayName?: string
  }

  decision?: {
    behavior?: "allow" | "ask" | "deny" | "bypass"
    reason?: string
    policyRefs?: string[]
    approvalId?: string
    grantId?: string
  }

  relatedRefs?: {
    runId?: string
    workflowRunId?: string
    workflowStepRunId?: string
    backgroundRunId?: string
    subagentRunId?: string
    toolCallId?: string
    approvalId?: string
    memoryId?: string
    artifactId?: string
  }

  sensitivity:
    | "low"
    | "medium"
    | "high"
    | "restricted"

  retentionClass:
    | "short"
    | "standard"
    | "long"
    | "legal_hold"

  createdAt: string
}
```

---

## 7.5 RuntimeTimeline

```ts
type RuntimeTimeline = {
  timelineId: string

  rootRef: {
    rootType:
      | "session"
      | "run"
      | "workflow_run"
      | "background_run"
      | "subagent_run"
      | "tool_call"
      | "approval"
      | "memory"
    rootId: string
  }

  events: Array<{
    order: number
    timestamp: string
    eventType: string
    title: string
    summary?: string
    sourceModule: string
    status?: string
    relatedRefs?: Record<string, string>
    auditRef?: string
    traceSpanRef?: string
  }>

  builtAt: string
}
```

---

## 7.6 ReplayRequest

```ts
type ReplayRequest = {
  requestId: string
  requestedBy: {
    userId?: string
    actorType: "user" | "developer" | "system"
  }

  target: {
    targetType:
      | "session"
      | "run"
      | "workflow_run"
      | "background_run"
      | "subagent_run"
      | "tool_call"
      | "approval"
    targetId: string
  }

  replayMode:
    | "timeline_only"
    | "state_rebuild"
    | "dry_run"
    | "failure_analysis"
    | "resume_from_checkpoint"

  safetyPolicy: {
    allowExternalWrites: boolean
    requireApprovalForSideEffects: boolean
    redactSensitivePayloads: boolean
  }

  timeRange?: {
    startAt?: string
    endAt?: string
  }
}
```

---

## 7.7 ReplayResult

```ts
type ReplayResult = {
  requestId: string

  status:
    | "completed"
    | "partial"
    | "failed"
    | "requires_approval"

  timeline?: RuntimeTimeline

  rebuiltState?: {
    stateType: "session" | "run" | "workflow" | "subagent"
    stateRef?: string
    snapshot?: Record<string, unknown>
  }

  failureAnalysis?: {
    rootCause?: string
    contributingEvents?: string[]
    suggestedFixes?: string[]
    retryable?: boolean
  }

  blockedActions?: Array<{
    reason: string
    requiredApproval?: boolean
  }>

  sourceRefs: {
    eventIds?: string[]
    auditIds?: string[]
    traceIds?: string[]
    transcriptRefs?: string[]
  }
}
```

---

## 8. 关键追踪场景

## 8.1 Agent Kernel Run Trace

必须记录：

- model input build
- model sample
- assistant output parse
- tool dispatch
- tool results merged
- compact decision
- checkpoint
- turn commit
- final status

---

## 8.2 Tool Call Audit

必须记录：

- tool name
- input hash / redacted input
- permission decision
- connector target
- external write status
- output hash / summary
- tool latency
- error

---

## 8.3 Permission Audit

必须记录：

- permission mode
- policy refs
- matched rule
- LLMPreApprovalJudge decision
- user approval response
- grant scope
- expiry
- bypass scope

---

## 8.4 Workflow Replay

必须记录：

- workflow definition version
- workflow run start
- step start / complete / failed
- wait state
- approval state
- external event wakeup
- step retry
- final result

---

## 8.5 Subagent Replay

必须记录：

- subagentCode
- lineagePath
- parentRunId
- taskSpec
- context refs
- tool pool
- checkpoint
- artifact refs
- final result

---

## 8.6 Memory Explainability

必须记录：

- memory candidate source
- extraction request
- extraction policy
- memory write decision
- source transcript / summary refs
- user review if any
- memory lifecycle changes

---

## 9. 与其他模块关系

## 9.1 与 Hooks / Event Bus

Hooks / Event Bus 负责产生和分发事件。  
Observability / Audit / Replay 订阅关键事件，写入 Trace / Audit / Metrics / Timeline。

---

## 9.2 与 Event Store

Event Store 是 replay 的事实来源。  
Observability 不替代 Event Store，而是围绕 Event Store 建立查询、可视化、分析和回放能力。

---

## 9.3 与 Runtime Dispatcher

Runtime Dispatcher 每次 dispatch 必须记录：

- dispatch request
- target runtime
- policy check
- dispatch result
- latency
- error
- correlationId

---

## 9.4 与 Permission Engine

Permission decision 和 approval chain 必须进入 Audit Store。

---

## 9.5 与 Tool Plane / Connector Runtime

外部副作用必须有 audit trail。  
Connector resource access 必须可按 user / connector / resource / time 查询。

---

## 9.6 与 Memory / Summary System

Memory write / delete / recall 都应可解释。  
Summary write 应保留 source refs。

---

## 10. Replay 安全原则

1. 默认 replay 是 timeline-only，不重新执行副作用。
2. dry-run 不允许外部写操作。
3. resume_from_checkpoint 必须走 Permission Engine。
4. 涉及外部写操作必须重新审批，除非存在有效 grant。
5. replay 时必须保留原 workflow version / tool schema version / model config refs。
6. replay 输出必须标记“重放结果”，避免与原始运行混淆。
7. replay 不能绕过用户删除和隐私策略。
8. replay 读取敏感 payload 时需要权限。
9. replay recovery 必须产生新的 traceId，同时关联 originalTraceId。
10. replay 失败要进入 FailureAnalyzer。

---

## 11. MVP 实现建议

## Phase 1：基础可观测

实现：

- TraceContext
- RuntimeSpan
- RuntimeMetric
- AuditRecord
- EventStoreBridge
- Kernel / Tool / Permission / Dispatcher 基础 trace
- Run timeline 查询

---

## Phase 2：审计闭环

实现：

- Permission audit
- Tool call audit
- Connector resource access audit
- Memory write / delete audit
- WorkflowRun audit
- SubagentRun audit
- AuditQueryService

---

## Phase 3：Replay

实现：

- RuntimeTimelineBuilder
- ReplayRequest / ReplayResult
- timeline_only replay
- state_rebuild replay
- failure_analysis
- checkpoint resume audit

---

## Phase 4：产品化

实现：

- Observability Dashboard
- Run Inspector
- Workflow Run Timeline
- Subagent Trace Viewer
- Permission Audit UI
- Memory Explain UI
- Cost / Token Dashboard
- Replay Debug Console

---

## 12. 推荐目录结构

```text
src/
  observability/
    tracing/
      TraceContext.ts
      RuntimeSpan.ts
      SpanManager.ts
      TraceCollector.ts

    metrics/
      RuntimeMetric.ts
      MetricsCollector.ts
      TokenUsageTracker.ts
      CostTracker.ts

    audit/
      AuditRecord.ts
      AuditRecorder.ts
      AuditPolicyEngine.ts
      AuditQueryService.ts

    timeline/
      RuntimeTimeline.ts
      RuntimeTimelineBuilder.ts

    replay/
      ReplayService.ts
      ReplayPlanner.ts
      ReplayStateRebuilder.ts
      ReplaySafetyGuard.ts
      ReplayTypes.ts

    analysis/
      FailureAnalyzer.ts
      RunInspector.ts

    integrations/
      EventStoreBridge.ts
      EventBusSubscriber.ts
      DispatcherTraceAdapter.ts
      PermissionAuditAdapter.ts
      ToolAuditAdapter.ts
```

---

## 13. 关键原则

1. Trace 记录运行过程，Audit 记录安全与责任链，Replay 支持复盘与恢复。
2. Event Store 是事实源，Observability 是查询、分析、可视化和复盘层。
3. 所有外部写操作必须审计。
4. 所有 permission decision 必须可解释。
5. 所有 subagent / workflow / background run 必须可按 lineage 查询。
6. Replay 默认不能重新执行副作用。
7. 任何 resume_from_checkpoint 都必须生成新的 trace，并保留 originalTraceRef。
8. Memory / Summary 写入必须能解释来源。
9. 用户删除和隐私策略必须影响 replay 与 audit 查询结果。
10. Observability 应从 MVP 早期进入系统，而不是后补。

---

## 14. 最终结论

Observability / Audit / Replay 的核心价值是：

```text
让系统做过什么、为什么做、谁授权、如何复盘，都有据可查。
```

一句话总结：

> **Observability 解决“系统现在怎样运行”，Audit 解决“系统为什么能这么做”，Replay 解决“如何复盘和恢复”。**


---

# 16. Foreground / PlannerRun 可观测性扩展

需要新增以下 trace / audit 对象：

- foreground_turn_started
- foreground_decision_created
- direct_delegation_created
- planner_run_spawned
- planner_run_resumed
- planner_run_replanned
- planner_run_completed
- planner_run_archived
- active_work_projection_built
- assistant_persona_applied

关键审计点：

- Foreground Conversation Agent 为什么直接委派而不是创建 PlannerRun。
- PlannerRun 为什么选择某个 agent / tool / workflow。
- 用户 persona 是否被应用，以及是否被系统约束覆盖。
- 多 PlannerRun 并发时，用户打断或取消指向了哪个任务。

Replay 时应能按 plannerRunId 重建：

```text
ForegroundDecision
  → PlannerRun spawn
  → ExecutionPlan versions
  → RuntimeAction list
  → Subagent / Tool / Workflow results
  → Replan history
```

---

# P9 Update: ModelInput Snapshot & Cache Metrics

P9 引入 `ModelInputSnapshot` 和 `ModelInputMetrics`，扩展可观测性能力：

## ModelInputSnapshot

每次 LLM 调用保存脱敏快照，包含：

- `snapshotId` — 唯一标识
- `segmentHashes` — Layer 1-7 的 SHA-256 hash（用于缓存命中率分析）
- `contextBundleId` / `toolPoolRef` — 引用追踪
- `cacheUsage` — DeepSeek `promptCacheHitTokens` / `promptCacheMissTokens` / `cacheHitRate`
- 脱敏后不包含：API key、OAuth token、connector secret、DB password

## Cache Metrics 观测维度

- by agent（foreground / planner / kernel / connector 哪类命中高）
- by segmentAHash（验证静态前缀是否稳定）
- by toolExposureHash（发现工具投影抖动）

## 新增审计事件

- `model_input_snapshot_created` — 每次 LLM 调用后记录
- `model_input_cache_metrics_recorded` — DeepSeek cache hit/miss 记录
- `model_input_shadow_diff_logged` — ForegroundAgent shadow mode diff

## 实现位置

- `src/kernel/model-input/model-input-snapshot-store.ts`
- `src/kernel/model-input/model-input-redactor.ts`
- `src/observability/model-input-metrics.ts`
