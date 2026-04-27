# 数据存储与索引设计文档 v1

## 1. 文档目的

本文档定义个人助理型 Agent 平台中的核心数据存储、索引、版本化、保留策略、可检索性和跨模块引用关系。

目标是回答：

```text
哪些对象需要持久化？
哪些只是运行态？
哪些需要索引？
哪些支持 replay？
哪些可以删除？
哪些要审计保留？
哪些可以进入长期记忆？
```

---

## 2. 存储总体分层

推荐将存储体系分为十类：

```text
1. Event Store
2. Transcript Store
3. Summary Store
4. Long-term Memory Store
5. Plan Store
6. Runtime State Stores
   - PlannerRun Store
   - KernelRun Store
   - SubagentRun Store
   - BackgroundRun Store
   - WorkflowRun Store
   - RuntimeAction Store
7. Tool Result / Artifact Store
8. Approval / Permission Store
9. Connector State Store
10. Observability Stores
    - Trace Store
    - Audit Store
    - Metrics Store
```

核心原则：

```text
Event Store 保真
Transcript Store 可读
Summary Store 压缩状态
Memory Store 长期结构化记忆
Plan / Runtime Stores 保存可恢复状态
Artifact / Tool Result Store 保存大结果和产物
Audit / Trace Stores 支持审计与复盘
```

---

## 3. 数据对象分类

### 3.1 运行事实类

```text
Event
RuntimeAction
DispatchResult
ToolEvent
WorkflowEvent
PlannerRunEvent
SubagentRunEvent
```

特点：

```text
append-only
用于 replay / audit / debug
通常不直接进入模型上下文
```

### 3.2 用户可读历史类

```text
TurnTranscript
ToolTranscriptSummary
ApprovalTranscriptSummary
AssistantOutputTranscript
```

特点：

```text
用户可检索
可作为 Summary / Memory extraction 来源
敏感信息需可脱敏
```

### 3.3 摘要类

```text
WorkingSummary
SessionMemory
RollingSummary
WorkflowRunSummary
BackgroundSubagentSummary
CompactSummary
```

特点：

```text
可进入模型上下文
可被 supersede
需要 sourceRefs
```

### 3.4 长期记忆类

```text
UserPreference
UserProfile
Relationship
ProjectState
Routine
WorkflowPreference
DurableFact
EpisodicSummary
```

特点：

```text
结构化
多索引
可解释来源
可删除 / tombstone
```

### 3.5 运行状态类

```text
PlannerRun
KernelRun
WorkflowRun
WorkflowStepRun
SubagentRun
BackgroundSubagentRun
WaitCondition
ApprovalRequest
```

特点：

```text
需要恢复
需要状态索引
需要 active projection
```

### 3.6 大结果 / 产物类

```text
Artifact
Attachment
ToolResultBlob
ConnectorResourceSnapshot
FileParseResult
TranscriptBlob
```

特点：

```text
不应直接塞进模型上下文
通过 ref + preview + summary 使用
```

---

## 4. Event Store

### 4.1 职责

Event Store 负责保真记录运行事实：

```text
- inbound_received
- foreground_decision_made
- planner_run_created
- runtime_action_created
- dispatch_started
- tool_execution_started
- approval_requested
- workflow_step_completed
- memory_write_created
- summary_written
```

### 4.2 EventRecord

```ts
type EventRecord = {
  eventId: string
  eventType: string

  sourceModule:
    | "gateway"
    | "foreground_agent"
    | "planner"
    | "dispatcher"
    | "kernel"
    | "tool"
    | "workflow"
    | "subagent"
    | "trigger"
    | "permission"
    | "memory"
    | "connector"
    | "system"

  userId?: string
  sessionId?: string

  correlationId?: string
  causationId?: string
  idempotencyKey?: string

  relatedRefs?: {
    plannerRunId?: string
    planId?: string
    runId?: string
    workflowRunId?: string
    workflowStepRunId?: string
    backgroundRunId?: string
    subagentRunId?: string
    toolCallId?: string
    approvalId?: string
    waitConditionId?: string
    artifactId?: string
    memoryId?: string
  }

  payload: Record<string, unknown>

  sensitivity: "low" | "medium" | "high" | "restricted"
  retentionClass: "short" | "standard" | "long" | "legal_hold"

  createdAt: string
}
```

### 4.3 索引

```text
primary: eventId
by sessionId + createdAt
by userId + createdAt
by correlationId
by causationId
by relatedRefs.*
by eventType + createdAt
by sourceModule + createdAt
```

### 4.4 保留策略

```text
安全审计相关：long / legal_hold
普通运行事实：standard
高频 telemetry 类事件：short
```

---

## 5. Transcript Store

### 5.1 职责

Transcript Store 保存用户可读的轮次记录：

```text
用户输入
助手输出
工具调用摘要
审批摘要
后台任务状态摘要
artifact 引用
```

### 5.2 TurnTranscript

```ts
type TurnTranscript = {
  turnId: string
  sessionId: string
  userId: string

  input: {
    inboundEventId?: string
    userMessageSummary?: string
    contentRefs?: string[]
  }

  output: {
    visibleMessages: Array<{
      messageId: string
      role: "assistant" | "system_status"
      content: string
    }>
    artifactRefs?: string[]
  }

  runtimeSummary?: {
    foregroundDecisionId?: string
    plannerRunIds?: string[]
    runtimeActionIds?: string[]
    toolCallSummaries?: string[]
    approvalSummaries?: string[]
  }

  eventRange?: {
    startEventId: string
    endEventId: string
  }

  createdAt: string
}
```

### 5.3 索引

```text
by sessionId + createdAt
by userId + createdAt
full-text on visible content
by artifactRefs
by plannerRunIds
by approvalId
```

### 5.4 进入模型上下文

Transcript 不应默认全文进入上下文。

推荐方式：

```text
recent turns
+ rolling summary
+ selected transcript snippets by retrieval
```

---

## 6. Summary Store

### 6.1 职责

存储所有摘要型状态：

```text
working_summary
session_memory
rolling_5_turns
rolling_10_turns
daily_summary
weekly_summary
workflow_run_summary
background_subagent_summary
planner_run_summary
compact_summary
```

### 6.2 SummaryRecord

```ts
type SummaryRecord = {
  summaryId: string
  summaryType: string

  userId: string
  sessionId?: string
  runId?: string

  relatedRefs?: {
    plannerRunId?: string
    planId?: string
    workflowRunId?: string
    backgroundRunId?: string
    subagentRunId?: string
    artifactId?: string
  }

  sourceRefs: {
    transcriptRefs?: string[]
    eventRange?: {
      startEventId: string
      endEventId: string
    }
    previousSummaryRefs?: string[]
  }

  summary: string
  structuredState?: Record<string, unknown>

  status: "candidate" | "validated" | "active" | "superseded" | "archived" | "expired"

  retrieval: {
    keywords?: string[]
    embeddingRef?: string
    importance?: "low" | "medium" | "high"
  }

  createdAt: string
  updatedAt?: string
}
```

### 6.3 索引

```text
by userId + summaryType + updatedAt
by sessionId + summaryType + updatedAt
by relatedRefs.planId
by relatedRefs.plannerRunId
by relatedRefs.workflowRunId
by status
vector index on summary
keyword index
```

### 6.4 写入保护

```text
sourceRefs 必须存在
LLM 输出必须 schema validation
系统字段由 runtime 写入
优先 patch，不直接覆盖
每次写入生成版本
```

---

## 7. Long-term Memory Store

### 7.1 职责

保存可跨 session 使用的长期结构化记忆。

### 7.2 MemoryRecord

```ts
type MemoryRecord = {
  memoryId: string
  userId: string

  memoryType:
    | "user_profile"
    | "user_preference"
    | "user_rule"
    | "relationship"
    | "project_state"
    | "routine"
    | "workflow_preference"
    | "durable_fact"
    | "episodic_summary"

  content: string
  structuredPayload?: Record<string, unknown>

  sourceRefs: {
    transcriptRefs?: string[]
    summaryRefs?: string[]
    eventRange?: {
      startEventId: string
      endEventId: string
    }
  }

  confidence: number
  sensitivity: "low" | "medium" | "high" | "restricted"

  lifecycle: {
    status:
      | "candidate"
      | "validated"
      | "active"
      | "low_priority"
      | "compressed"
      | "archived"
      | "expired"
      | "deleted"
    createdAt: string
    updatedAt?: string
    expiresAt?: string
    tombstoneId?: string
  }

  retrieval: {
    embeddingRef?: string
    keywords?: string[]
    entities?: string[]
    timeAnchors?: string[]
    importance?: "low" | "medium" | "high"
  }
}
```

### 7.3 索引

```text
vector index
keyword / full-text index
entity index
time index
metadata index
memoryType index
sensitivity index
status index
sourceRefs index
```

### 7.4 删除

用户明确删除时：

```text
MemoryRecord.status = deleted
写入 tombstone
从 vector / keyword / entity index purge
保留最小审计记录
```

---

## 8. Plan Store

### 8.1 职责

保存 ExecutionPlan、PlanStep、PlanPatch 历史。

### 8.2 ExecutionPlanRecord

```ts
type ExecutionPlanRecord = {
  planId: string
  userId: string
  sessionId?: string

  objective: string
  status:
    | "draft"
    | "approved"
    | "in_execution"
    | "blocked"
    | "waiting_for_user"
    | "waiting_for_approval"
    | "replanning"
    | "completed"
    | "failed"
    | "abandoned"

  currentVersion: number

  plannerRunIds?: string[]

  steps: PlanStep[]

  constraints?: string[]
  assumptions?: string[]

  createdAt: string
  updatedAt: string
}
```

### 8.3 索引

```text
by userId + updatedAt
by sessionId + updatedAt
by status
by plannerRunIds
by objectiveHash
full-text on objective
```

### 8.4 版本化

每个 PlanPatch 应保存：

```text
planId
fromVersion
toVersion
patch
sourcePlannerRunId
reason
createdAt
```

---

## 9. PlannerRun Store

### 9.1 职责

保存 PlannerRun 运行状态、checkpoint、active refs。

### 9.2 索引

```text
by userId + status
by sessionId + status
by planId
by backgroundRunId
by workflowRunId
by updatedAt
```

### 9.3 ActiveWorkProjection 来源

PlannerRun Store 是 ActiveWorkProjection 的主要来源之一。

---

## 10. RuntimeAction Store

### 10.1 职责

保存所有结构化动作，支持幂等、审计和 replay。

### 10.2 索引

```text
by actionId
by idempotencyKey
by source.sourceModule + createdAt
by targetRuntime + createdAt
by targetRef.*
by status
by correlationId
```

---

## 11. KernelRun Store

保存 KernelRun checkpoint、final result、metrics、event range。

索引：

```text
by runId
by sessionId + createdAt
by agentId
by invocationSource
by finalStatus
by parentRunId / rootRunId
```

---

## 12. Tool Result / Artifact Store

### 12.1 ToolResultStore

保存工具原始输出、大结果 preview、persistedResultRef。

```ts
type ToolResultBlob = {
  resultRef: string
  toolCallId: string
  toolName: string
  userId: string
  sessionId?: string

  preview?: string
  rawBlobRef?: string
  structuredContent?: Record<string, unknown>

  sensitivity: "low" | "medium" | "high" | "restricted"

  createdAt: string
}
```

索引：

```text
by toolCallId
by toolName + createdAt
by sessionId + createdAt
by sensitivity
```

### 12.2 ArtifactStore

保存用户可见产物：

```text
文档
草稿
图片
报告
表格
代码文件
workflow draft
```

索引：

```text
by artifactId
by userId + updatedAt
by sessionId
by artifactType
by status
full-text / vector on content summary
```

---

## 13. Workflow Store

### 13.1 WorkflowDefinition Store

索引：

```text
by workflowId + version
by ownerUserId + status
by trigger.type
by name full-text
```

### 13.2 WorkflowRun Store

索引：

```text
by workflowRunId
by workflowId + startedAt
by ownerUserId + status
by triggerEventId
by currentStepIds
```

### 13.3 WorkflowStepRun Store

索引：

```text
by stepRunId
by workflowRunId + status
by stepId
by kernelRunId
by subagentRunId
by toolCallId
by approvalId
```

---

## 14. Subagent / BackgroundRun Store

### 14.1 SubagentRun Store

```text
by subagentRunId
by parentRunId
by rootRunId
by agentType
by status
```

### 14.2 BackgroundRun Store

```text
by backgroundRunId
by userId + status
by sessionId + status
by subagentRunId
by launchSource
by updatedAt
```

---

## 15. Approval / Permission Store

### 15.1 Approval Store

索引：

```text
by approvalId
by userId + status
by sessionId + status
by sourceContext.planId
by sourceContext.workflowRunId
by sourceContext.backgroundRunId
by expiresAt
```

### 15.2 PermissionGrant Store

索引：

```text
by grantId
by userId
by scope
by sourceContext
by expiresAt
by riskLevelMax
```

---

## 16. Connector State Store

保存：

```text
ConnectorDefinition
ConnectorInstance
ConnectorAuthState
ConnectorCapability
ConnectorEventSubscription
ConnectorResourceRef
OperationRef
```

索引：

```text
by userId + connectorId
by connectorInstanceId
by status
by capabilityId
by eventSourceId
by operationId
```

敏感信息如 OAuth token 不应直接存业务数据库，应放入 CredentialVault，仅保存 authStateRef。

---

## 17. WaitCondition / Trigger Store

保存：

```text
TriggerRegistration
WaitCondition
RuntimeTriggerEvent
```

索引：

```text
by triggerId
by waitConditionId
by target.targetType + targetRef
by operationRef.operationId
by conditionType
by status
by expiresAt
```

---

## 18. Observability Stores

### 18.1 Trace Store

索引：

```text
by traceId
by rootRunId
by parentSpanId
by runId
by workflowRunId
by backgroundRunId
by spanType
by status
```

### 18.2 Audit Store

索引：

```text
by auditId
by userId + createdAt
by auditType + createdAt
by actor.actorType
by target.targetType + targetId
by decision.behavior
by sensitivity
by retentionClass
```

### 18.3 Metrics Store

索引：

```text
by metricName + timestamp
by dimensions.userId
by dimensions.module
by dimensions.toolName
by dimensions.workflowId
```

---

## 19. ActiveWorkProjection

ActiveWorkProjection 不一定是主存储，可以由多个 store 投影生成：

```text
PlannerRun Store
BackgroundRun Store
WorkflowRun Store
Approval Store
Plan Store
Event Store
```

建议缓存：

```ts
type ActiveWorkProjectionCache = {
  userId: string
  sessionId?: string
  activePlannerRuns: unknown[]
  activeBackgroundRuns: unknown[]
  activeWorkflowRuns: unknown[]
  pendingApprovals: unknown[]
  updatedAt: string
}
```

索引：

```text
by userId
by sessionId
by updatedAt
```

---

## 20. 数据进入模型上下文规则

### 20.1 可直接进入

```text
SessionMemory
WorkingSummary
RollingSummary
Selected MemoryRecord
Selected Transcript Snippet
PlanContextView
WorkflowStepContextView
BackgroundRunContextView
ToolResult preview
Artifact summary
```

### 20.2 不应直接进入

```text
Event Store 全量事件
Tool 原始大结果
完整审计记录
OAuth token / credential
Connector raw response
完整文件 / 视频 / 音频
高敏感原文
```

### 20.3 进入方式

必须通过 Context Manager：

```text
Store / Index
  → Retrieval / Projection
  → ContextItem
  → ContextBundle
```

---

## 21. 数据保留策略

| 数据类型 | 默认保留 |
|---|---|
| Event Store 普通事件 | 90-180 天，可配置 |
| Audit 高风险记录 | 长期或 legal_hold |
| Transcript | 用户可控，默认长期 |
| Summary | session / medium-term |
| Long-term Memory | 生命周期评分控制 |
| Tool raw result | 短期，必要时长期 artifact |
| Artifact | 用户可控 |
| Trace metrics | 短期聚合 |
| WorkflowDefinition | 长期 |
| WorkflowRun | 中长期 |
| Approval | 标准审计期 |

---

## 22. MVP 实现建议

MVP 必做存储：

```text
Event Store
Transcript Store
Summary Store 基础版
Plan Store
PlannerRun Store
RuntimeAction Store
KernelRun Store
ToolResultStore
Approval Store
BackgroundRun Store
WorkflowDefinition / WorkflowRun Store 基础版
Artifact Store
```

MVP 可简化：

```text
Long-term Memory 先做结构化 JSON + keyword index，后续加 vector
Trace Store 先记录基础 span
Audit Store 可先和 Event Store 共享底层表，但保留 AuditRecord schema
Connector State Store 先支持少量 built-in connector
```

暂不做：

```text
复杂多租户分片
高级数据湖
长期冷存储
复杂 legal hold workflow
跨设备增量同步
```

---

## 23. 关键结论

```text
1. Event Store 保真，不替代 Transcript。
2. Transcript 可读，不替代 Summary。
3. Summary 可进上下文，不替代 Long-term Memory。
4. Long-term Memory 必须结构化、多索引、可删除。
5. Plan / PlannerRun / BackgroundRun / WorkflowRun 必须独立持久化。
6. 大结果必须引用化，不能直接进上下文。
7. RuntimeAction 必须持久化，支撑幂等与审计。
8. ActiveWorkProjection 应由多个运行时 Store 投影生成。
9. 所有进入模型上下文的数据必须通过 Context Manager。
```
