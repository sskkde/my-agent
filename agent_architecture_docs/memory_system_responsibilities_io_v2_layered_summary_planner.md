# Memory System 功能职责与输入输出文档 v3（Foreground Persona / PlannerRun 对齐版）

## 1. 更新目的

本版在 v1 基础上明确四个核心设计：

1. Memory System 不再仅指 Long-term Memory Store，而是完整的分层历史与记忆体系。
2. WorkingSummary、SessionMemory、Rolling Summary、Daily / Weekly Summary 统一进入 Summary Store，通过 `summaryType` 区分语义。
3. Rolling Summary 使用最小 / 最大轮次范围，并在话题切换、Plan 切换、Artifact 切换等边界立即触发。
4. SessionMemory 是 Planner 的会话状态输入，Planner 只输出结构化状态 patch，不直接写 Memory。

---

## 2. 分层记忆体系

推荐将 Memory System 定义为：

```text
Memory System
  ├─ L0 Working Context / Checkpoint
  ├─ L1 Event Store
  ├─ L2 Turn Transcript Store
  ├─ L3 Summary Store
  │    ├─ WorkingSummary
  │    ├─ SessionMemory
  │    ├─ Rolling Summary
  │    ├─ Daily / Weekly Summary
  │    └─ Workflow / Subagent Summary
  └─ L4 Long-term Memory Store
       ├─ Structured MemoryRecord
       ├─ Vector Index
       ├─ Keyword Index
       ├─ Entity Index
       ├─ Time Index
       ├─ Metadata Index
       └─ Lifecycle Scoring
```

关键原则：

> Event Store 和 Transcript Store 逻辑上属于 Memory System 的分层体系，但物理和职责上仍保持独立；Long-term Memory Store 只存抽取后的长期结构化记忆。

---

## 3. 各层职责边界

| 层级 | 职责 | 主要消费者 | 是否直接进模型上下文 |
|---|---|---|---|
| L0 Working Context / Checkpoint | 当前 run 恢复 | Kernel / Subagent / Recovery | 否，通常由 Context Manager 投影 |
| L1 Event Store | 运行事实、审计、replay | Audit / Recovery / Debug | 通常不直接进入 |
| L2 Turn Transcript Store | 用户可读轮次记录 | 用户查询 / Summary / Memory Extraction | 按需进入 |
| L3 Summary Store | 摘要型状态与历史压缩 | Context Manager / Planner / Recall | 常用 |
| L4 Long-term Memory Store | 长期结构化记忆 | Context Manager / Memory Recall | 常用 |

---

## 4. WorkingSummary / SessionMemory / Summary Store 边界

```text
WorkingSummary
  = 当前 run / loop 的运行摘要

SessionMemory
  = 当前 session 的可恢复状态投影

Summary Store
  = 所有摘要型数据的统一存储层
```

三者可以物理统一存放在 Summary Store 中，但必须通过 `summaryType` 区分语义。

### 4.1 WorkingSummary

WorkingSummary 回答：

> 当前 run 如果继续，下一步该怎么做？

特点：

- 属于 `runId`
- 更新频率高
- 与 checkpoint / compact / recovery 强相关
- 偏运行时，不一定给用户看
- 生命周期较短
- 主要由 Agent Kernel / Subagent Runtime / Workflow Step Executor / Compaction Service 触发

### 4.2 SessionMemory

SessionMemory 回答：

> 这个 session 之前在聊什么？当前有哪些未完成状态？

特点：

- 属于 `sessionId`
- 比 WorkingSummary 更稳定
- 跨 turn 使用
- 是 Intent Router / Planner / Context Manager 的重要输入
- 不是长期记忆
- 是当前会话状态投影

### 4.3 Summary Store

Summary Store 是统一摘要存储层。

推荐类型：

```ts
type SummaryType =
  | "working_summary"
  | "session_memory"
  | "rolling_5_turns"
  | "rolling_10_turns"
  | "daily_summary"
  | "weekly_summary"
  | "workflow_run_summary"
  | "background_subagent_summary"
  | "session_close_summary"
  | "compact_summary"
```

---

## 5. SummaryRecord

```ts
type SummaryRecord = {
  summaryId: string
  summaryType: SummaryType

  userId: string
  sessionId?: string
  runId?: string

  relatedRefs?: {
    planId?: string
    planStepId?: string
    workflowId?: string
    workflowRunId?: string
    workflowStepId?: string
    backgroundRunId?: string
    subagentRunId?: string
    subagentCode?: string
    artifactId?: string
    checkpointId?: string
  }

  timeRange?: {
    startAt: string
    endAt: string
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

  structuredState?: {
    activePlanId?: string
    currentPlanStepId?: string
    activeArtifactId?: string
    pendingApprovalId?: string
    currentStepId?: string
    currentIntent?: string
    openQuestions?: string[]
    recentDecisions?: string[]
    keyFacts?: string[]
    constraints?: string[]
  }

  lifecycle: {
    createdAt: string
    updatedAt?: string
    expiresAt?: string
    retentionClass:
      | "runtime_short"
      | "session"
      | "medium_term"
      | "long_term"
  }

  retrieval: {
    keywords?: string[]
    embeddingRef?: string
    importance?: "low" | "medium" | "high"
  }
}
```

---

## 6. Rolling Summary 策略

Rolling Summary 不应机械地每 N 轮固定摘要，而应采用：

```text
min / max turn window + topic boundary
```

推荐默认策略：

```ts
type RollingSummaryPolicy = {
  minTurns: number
  maxTurns: number
  triggerOnTopicShift: boolean
  triggerOnPlanSwitch: boolean
  triggerOnArtifactSwitch: boolean
  triggerOnApprovalResolved: boolean
  triggerOnSubagentCompleted: boolean
  triggerOnTokenPressure: boolean
}

const defaultRollingSummaryPolicy: RollingSummaryPolicy = {
  minTurns: 5,
  maxTurns: 10,
  triggerOnTopicShift: true,
  triggerOnPlanSwitch: true,
  triggerOnArtifactSwitch: true,
  triggerOnApprovalResolved: true,
  triggerOnSubagentCompleted: true,
  triggerOnTokenPressure: true
}
```

触发规则：

```text
不足 minTurns：
  通常不摘要，除非发生强 topic switch / plan switch

达到 minTurns：
  如果检测到话题切换、计划切换、产物切换、审批完成，则立即摘要

达到 maxTurns：
  强制摘要，即使话题没有明显切换
```

### 6.1 TopicShiftSignal

```ts
type TopicShiftSignal = {
  topicShiftDetected: boolean
  confidence: number

  reasons?: Array<
    | "new_intent"
    | "new_project"
    | "new_artifact"
    | "new_workflow"
    | "active_plan_changed"
    | "user_explicit_switch"
    | "previous_topic_completed"
  >

  previousTopic?: string
  newTopic?: string
}
```

Topic shift 可由 Intent Router / Planner / Context Manager / SessionMemoryManager 共同判断。

---

## 7. WorkingSummary 和 SessionMemory 写入机制

### 7.1 总原则

WorkingSummary 和 SessionMemory 都不应由 LLM 自由主动写。

推荐采用：

```text
运行时自动触发
  → LLM Summarizer 生成结构化摘要候选
  → SummaryManager 校验、合并、版本化
  → 写入 Summary Store
```

也就是：

> 系统决定什么时候写、写哪一类、输入哪些来源；LLM 负责把来源内容压缩成摘要；系统负责校验、打补丁、版本化、落库。

---

### 7.2 WorkingSummary 写入

触发者：

```text
Agent Kernel
Subagent Runtime
Workflow Step Executor
Compaction Service
Recovery Manager
```

触发时机：

```text
tool result 合并后
subagent result 返回后
plan step 状态变化后
pending approval 前
waiting external event 前
compact 前
compact 后
checkpoint 前
run 结束前
错误恢复前
```

确定性字段由 runtime 写入：

```ts
{
  runId,
  sessionId,
  planId,
  planStepId,
  workflowRunId,
  workflowStepId,
  backgroundRunId,
  subagentRunId,
  pendingToolCalls,
  pendingApprovalId,
  checkpointId,
  lastEventId,
  updatedAt
}
```

LLM 生成字段：

```ts
{
  summary,
  currentObjective,
  keyFindings,
  openQuestions,
  nextSuggestedAction,
  mustKeepRefs
}
```

---

### 7.3 WorkingSummaryGenerationRequest

```ts
type WorkingSummaryGenerationRequest = {
  requestId: string
  runId: string
  sessionId?: string

  source: {
    eventRange?: {
      startEventId: string
      endEventId: string
    }
    recentTranscriptRefs?: string[]
    toolResultRefs?: string[]
    subagentResultRefs?: string[]
    previousWorkingSummaryRef?: string
  }

  runtimeState: {
    currentStage: string
    planId?: string
    planStepId?: string
    workflowRunId?: string
    workflowStepId?: string
    backgroundRunId?: string
    subagentRunId?: string
    pendingToolCalls?: string[]
    pendingApprovalId?: string
    checkpointId?: string
  }

  purpose:
    | "checkpoint"
    | "compact_before"
    | "compact_after"
    | "tool_result_merged"
    | "waiting_approval"
    | "waiting_external_event"
    | "run_completed"
    | "recovery"
}
```

---

### 7.4 WorkingSummaryPatch

```ts
type WorkingSummaryPatch = {
  summary: string
  currentObjective?: string
  currentStateSummary?: string
  keyFindings?: string[]
  openQuestions?: string[]
  nextSuggestedAction?: string
  mustKeepRefs?: string[]
  confidence: number
}
```

---

### 7.5 SessionMemory 写入

触发者：

```text
SessionMemoryManager
```

输入来源：

```text
Turn Transcript
Rolling Summary
PlannerStatePatch
WorkingSummary
Event Store Projection
Artifact State
Approval State
BackgroundSubagentRun State
```

触发时机：

```text
每个用户 turn 完成后轻量 patch
每次 Rolling Summary 生成后重写 session summary
话题切换后立即重写
active plan 改变后立即 patch
active artifact 改变后立即 patch
approval 状态改变后立即 patch
background subagent 状态改变后 patch
session idle / close 前最终更新
```

确定性字段由系统写入：

```ts
{
  sessionId,
  activePlanId,
  currentPlanStepId,
  activeArtifactId,
  pendingApprovalId,
  workflowRunId,
  backgroundRunId,
  subagentRunId,
  lastTurnId,
  updatedAt
}
```

LLM 生成字段：

```ts
{
  sessionTopic,
  sessionSummary,
  currentUserGoal,
  keyDecisions,
  unresolvedQuestions,
  userPreferencesInSession,
  topicHistory
}
```

---

### 7.6 SessionMemoryGenerationRequest

```ts
type SessionMemoryGenerationRequest = {
  requestId: string
  sessionId: string
  userId: string

  source: {
    recentTurnTranscriptRefs?: string[]
    rollingSummaryRefs?: string[]
    previousSessionMemoryRef?: string
    workingSummaryRefs?: string[]
  }

  statePatch: {
    activePlanId?: string
    currentPlanStepId?: string
    activeArtifactId?: string
    pendingApprovalId?: string
    workflowRunId?: string
    backgroundRunId?: string
    subagentRunId?: string
  }

  trigger:
    | "turn_completed"
    | "rolling_summary_created"
    | "topic_shift"
    | "plan_state_changed"
    | "artifact_state_changed"
    | "approval_state_changed"
    | "session_idle"
    | "session_close"
}
```

---

### 7.7 SessionMemoryPatch

```ts
type SessionMemoryPatch = {
  sessionSummary?: string
  currentUserGoal?: string
  sessionTopic?: string
  keyDecisionsToAdd?: string[]
  unresolvedQuestionsToAdd?: string[]
  resolvedQuestions?: string[]
  userPreferencesInSession?: string[]
  topicShift?: {
    previousTopic?: string
    newTopic?: string
  }
  confidence: number
}
```

---

### 7.8 写入保护机制

必须具备：

1. Source-bound：没有 sourceRefs，不允许写入。
2. Schema validation：LLM 输出必须符合 schema。
3. Deterministic state fields：activePlanId / pendingApprovalId / currentStepId 只能由系统写。
4. Diff-based update：优先 patch，不直接整份覆盖。
5. Versioning：每次写入生成版本。
6. Confidence fallback：低置信度时只写结构化 activeState，不更新自然语言 summary。

---

## 8. SessionMemory 与 Planner 的关系

### 8.1 关系定位

```text
SessionMemory
  = Planner 的会话状态输入 / 当前会话地图

Planner
  = 临时 ExecutionPlan 的创建、更新、推进者
```

Planner 不直接拥有 SessionMemory，也不直接写 SessionMemory。Planner 通过 `PlannerStatePatch` 把 Plan 状态变化交给 SessionMemoryManager。

---

### 8.2 数据流

```text
Turn Transcript / Event Store / Plan Store
        ↓
SessionMemoryManager
        ↓
SessionMemory
        ↓
Intent Router / Planner
        ↓
ExecutionPlan / PlanPatch
        ↓
Agent Kernel / Subagent Runtime / Tool Plane
        ↓
PlannerStatePatch
        ↓
SessionMemoryManager
```

---

### 8.3 SessionMemoryForPlanner

```ts
type SessionMemoryForPlanner = {
  sessionId: string
  sessionTopic?: string
  currentUserGoal?: string

  activePlan?: {
    planId: string
    currentStepId?: string
    status: "draft" | "approved" | "in_execution" | "blocked" | "completed"
    objective: string
  }

  activeArtifact?: {
    artifactId: string
    artifactType: string
    status: "draft" | "presented" | "awaiting_revision" | "approved"
  }

  pendingApproval?: {
    approvalId: string
    actionSummary: string
  }

  unresolvedQuestions?: string[]
  recentDecisions?: string[]
  currentConstraints?: string[]

  lastUserVisibleOutput?: {
    outputType: "answer" | "draft" | "plan" | "approval_request" | "file"
    artifactRef?: string
    turnId: string
  }
}
```

---

### 8.4 PlannerStatePatch

```ts
type PlannerStatePatch = {
  planPatch?: PlanPatch

  sessionStatePatch?: {
    currentUserGoal?: string
    activePlanId?: string
    currentPlanStepId?: string
    activeArtifactId?: string
    pendingApprovalId?: string
    unresolvedQuestionsToAdd?: string[]
    recentDecisionsToAdd?: string[]
  }
}
```

---

## 9. Long-term Memory 组织方式

Long-term Memory 不应只是纯文本记忆条目，而应采用：

```text
结构化 MemoryRecord
+ 多索引
+ 生命周期评分
+ 可解释来源
+ 可删除 / 可归档 / 可轮换
```

### 9.1 LongTermMemoryRecord

```ts
type LongTermMemoryRecord = {
  memoryId: string
  userId: string

  memoryType:
    | "user_profile"
    | "user_preference"
    | "user_safety_rule"
    | "relationship"
    | "project_state"
    | "routine"
    | "workflow_preference"
    | "durable_fact"
    | "episodic_summary"

  content: {
    text: string
    structured?: Record<string, unknown>
  }

  entities?: Array<{
    entityType:
      | "person"
      | "project"
      | "workflow"
      | "artifact"
      | "organization"
      | "connector_resource"
    entityId?: string
    displayName: string
  }>

  sourceRefs: {
    transcriptRefs?: string[]
    summaryRefs?: string[]
    eventRange?: {
      startEventId: string
      endEventId: string
    }
    workflowRunId?: string
    backgroundRunId?: string
    artifactId?: string
  }

  scope: {
    visibility: "private_user" | "workspace" | "project" | "workflow"
    projectId?: string
    workflowId?: string
    connector?: string
  }

  confidence: number
  importance: "low" | "medium" | "high" | "critical"
  sensitivity: "low" | "medium" | "high" | "restricted"

  lifecycle: {
    status:
      | "active"
      | "low_priority"
      | "archived"
      | "expired"
      | "superseded"
      | "deleted"
    createdAt: string
    updatedAt: string
    lastAccessedAt?: string
    expiresAt?: string
    supersededBy?: string
  }

  retrieval: {
    keywords: string[]
    embeddingRef?: string
    entityIndexRefs?: string[]
    recallCount: number
    lastRecalledAt?: string
  }
}
```

### 9.2 多索引

Long-term Memory 至少需要：

```text
Vector Index
Keyword / Full-text Index
Entity Index
Time Index
Metadata Index
```

召回策略：

```text
semantic search
+ keyword search
+ entity match
+ time filter
+ metadata filter
+ rerank
```

### 9.3 生命周期评分

```ts
type MemoryLifecycleScore = {
  recencyScore: number
  accessScore: number
  usefulnessScore: number
  importanceScore: number
  confidenceScore: number
  sourceAuthorityScore: number
  userPinnedBoost: number

  decayPenalty: number
  redundancyPenalty: number
  conflictPenalty: number
  sensitivityPenalty: number

  finalScore: number
}
```

轮换策略：

```text
active
  → low_priority
  → compressed
  → archived
  → expired
```

用户明确删除时：

```text
deleted + tombstone + index purge
```

---

## 10. Hybrid Retrieval 与多维检索

Memory Search 应支持：

- 关键词
- 语义向量
- 实体
- 时间
- 会话
- Workflow
- Plan
- BackgroundSubagentRun
- subagentCode
- Artifact
- memoryType
- sourceType
- sensitivity
- connector

### 10.1 MemorySearchRequest

```ts
type MemorySearchRequest = {
  requestId: string
  userId: string

  query?: string

  searchModes?: Array<
    | "keyword"
    | "semantic"
    | "entity"
    | "time"
    | "session"
    | "workflow"
    | "plan"
    | "artifact"
    | "event"
  >

  filters?: {
    timeRange?: {
      startAt?: string
      endAt?: string
    }

    sessionId?: string
    workflowId?: string
    workflowRunId?: string
    planId?: string
    backgroundRunId?: string
    subagentRunId?: string
    subagentCode?: string
    artifactId?: string

    memoryTypes?: MemoryType[]
    sourceTypes?: Array<
      | "event"
      | "turn_transcript"
      | "working_summary"
      | "session_memory"
      | "rolling_summary"
      | "daily_summary"
      | "weekly_summary"
      | "long_term_memory"
    >

    sensitivityMax?: "low" | "medium" | "high" | "restricted"
  }

  retrievalPolicy: {
    maxResults: number
    includeSourceRefs: boolean
    includeEvidence: boolean
    rerank: boolean
  }
}
```

### 10.2 MemorySearchResult

```ts
type MemorySearchResult = {
  requestId: string

  results: Array<{
    resultId: string

    resultType:
      | "event"
      | "turn_transcript"
      | "working_summary"
      | "session_memory"
      | "rolling_summary"
      | "daily_summary"
      | "weekly_summary"
      | "long_term_memory"

    title?: string
    snippet: string
    sourceRef: string
    score: number

    matchedBy: Array<
      | "keyword"
      | "semantic"
      | "entity"
      | "time"
      | "session"
      | "workflow"
      | "plan"
      | "artifact"
    >

    evidenceRefs?: string[]
  }>
}
```

---

## 11. 更新后的关键结论

1. Memory System 是分层历史与记忆体系，不等于 Long-term Memory Store。
2. Event Store 和 Transcript Store 纳入 Memory System 的逻辑架构，但保持独立职责。
3. WorkingSummary、SessionMemory、Rolling Summary、Daily / Weekly Summary 统一进入 Summary Store，以 `summaryType` 区分。
4. Rolling Summary 使用 min/max turn window + topic boundary 动态触发。
5. WorkingSummary 由运行时高频触发，SessionMemory 由 SessionMemoryManager 中频更新。
6. LLM 只生成摘要候选，最终由 SummaryManager 校验、合并、版本化和落库。
7. SessionMemory 是 Planner 的状态输入，Planner 通过 PlannerStatePatch 反向更新会话状态。
8. Long-term Memory 使用结构化记录、多索引、生命周期评分和轮换机制。
9. 召回应采用 hybrid retrieval，而不是单一向量召回。
10. 用户删除必须执行 tombstone + index purge。


---

# 15. AssistantPersonaProfile 与 ActiveWorkProjection

## 15.1 AssistantPersonaProfile

AssistantPersonaProfile 是用户可配置的助手人格和交互偏好，不等同于普通聊天记忆。

推荐存储位置：

```text
User Profile / Preference Store
  + Long-term Memory Store 中的可检索偏好索引
```

它可以被 Context Manager 注入 Foreground Conversation Agent，但不能覆盖系统约束、权限边界或审计规则。

## 15.2 SessionMemory 扩展

SessionMemory 应增加以下当前会话状态投影：

```ts
type SessionMemoryForegroundExtension = {
  activePlannerRuns?: Array<{
    plannerRunId: string
    planId: string
    objective: string
    status: string
    lastUpdateSummary?: string
  }>

  activeBackgroundRuns?: Array<{
    backgroundRunId: string
    objective: string
    status: string
    progressSummary?: string
  }>

  activeWorkflowRuns?: Array<{
    workflowRunId: string
    workflowId: string
    status: string
    currentStepSummary?: string
  }>
}
```

## 15.3 PlannerRun Summary

PlannerRun 可以触发新的 summaryType：

```ts
type SummaryTypeExtension =
  | "planner_run_summary"
  | "foreground_turn_summary"
```

PlannerRun 不直接写 Summary Store，而是输出 PlannerSummarySignal，由 SummaryManager 统一校验、合并和落库。
