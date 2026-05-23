# Context Manager 功能职责与输入输出文档 v4（Foreground / PlannerRun 对齐版）

## 1. 文档目的

本文档定义个人助理型 Agent 系统中 **Context Manager** 的职责、输入输出、上下文治理管线、运行时增量摄取、Session Memory、Working Summary，以及在临时 Plan、固化 Workflow、后台 Subagent 三类执行来源下的上下文视图。

---

## 2. Context Manager 的定位

Context Manager 是：

> **统一上下文治理层：负责把来自 Gateway、Planner、Workflow Runtime、Event Trigger Runtime、Memory、Transcript、Tool Plane、Subagent、Artifact 的材料整理成当前模型运行所需的可见视图。**

它不是：

- Gateway 的附属模块
- Agent Kernel 内部函数
- Workflow 编排器
- 长期记忆写入器
- 底层存储层

---

## 3. 新版上下文来源

Context Manager 应支持以下来源：

```text
Gateway HydratedSessionState
ConversationStateProjection
Planner / ExecutionPlan / PlanContextView
Workflow Runtime / WorkflowRunContext / WorkflowStepContext
Event Trigger Runtime / RuntimeTriggerEvent
Subagent Runtime / SubagentResult / BackgroundSubagentRun
Tool Plane / ToolResult
Artifact Store / Attachment Store
Transcript Store
Memory Store
Permission / Approval State
```

旧版中笼统的 `Task State` 应拆细为：

- `plan_state`
- `workflow_state`
- `background_run_state`
- `trigger_state`
- `approval_state`

---

## 4. 职责清单

## 4.1 应承担职责

- 多源上下文标准化
- 上下文筛选、去重、裁剪、排序
- token 预算控制
- 生成不同运行主体视图
- 支持运行中增量摄取
- 为 Subagent 生成隔离上下文
- 为 Workflow step 生成 step 级上下文
- 为临时 Plan 生成 PlanContextView
- 为后台 Subagent 生成 BackgroundRunContextView
- 协助 Compact
- 产出 ContextSelectionReport

## 4.2 不应承担职责

- 外部渠道接入
- Workflow 编排
- Agent Loop 驱动
- Tool 执行
- Permission 最终判断
- 长期 Memory 写入决策

---

## 5. ContextItem

```ts
type ContextItem = {
  itemId: string

  sourceType:
    | "session_history"
    | "conversation_state"
    | "plan_state"
    | "workflow_state"
    | "background_run_state"
    | "trigger_state"
    | "approval_state"
    | "memory"
    | "tool_result"
    | "subagent_result"
    | "artifact"
    | "attachment"
    | "system_note"

  sourceRef?: string

  semanticType:
    | "instruction"
    | "fact"
    | "constraint"
    | "draft"
    | "summary"
    | "entity_state"
    | "search_finding"
    | "tool_output"
    | "attachment_ref"
    | "plan_view"
    | "workflow_step_view"
    | "background_run_view"
    | "trigger_event"

  content: string
  structuredPayload?: Record<string, unknown>

  relatedRefs?: {
    planId?: string
    planStepId?: string
    workflowId?: string
    workflowRunId?: string
    workflowStepId?: string
    backgroundRunId?: string
    subagentRunId?: string
    approvalId?: string
    artifactId?: string
    triggerId?: string
  }

  priority?: number
  recencyScore?: number
  relevanceScore?: number
  authorityScore?: number
  estimatedTokens?: number

  dedupeKey?: string
  freshnessTs?: string

  isPinned?: boolean
  isCompressible?: boolean
  isReplaceableByRef?: boolean
  requiresPairIntegrity?: boolean
  validUntil?: string
  supersedesKey?: string
}
```

---

## 6. ContextAssemblyInput v2

```ts
type ContextAssemblyInput = {
  runId: string
  userId: string
  sessionId?: string

  agentId: string
  agentType:
    | "main"
    | "subagent"
    | "background"
    | "workflow_step"

  invocationSource:
    | "gateway_intent"
    | "planner_execution"
    | "workflow_step"
    | "subagent_runtime"
    | "background_subagent"
    | "event_trigger_resume"
    | "system"

  hydratedState?: HydratedSessionState

  conversationState?: ConversationStateProjection

  planContext?: {
    activePlan?: ExecutionPlan
    planContextView?: PlanContextView
  }

  workflowContext?: {
    workflowId?: string
    workflowRunId?: string
    stepId?: string
    stepRunId?: string
    workflowStepContextView?: WorkflowStepContextView
  }

  backgroundRunContext?: {
    backgroundRunId?: string
    subagentRunId?: string
    backgroundRunContextView?: BackgroundRunContextView
  }

  triggerContext?: {
    triggerId?: string
    triggerEvent?: RuntimeTriggerEvent
  }

  workingContext?: WorkingContext

  selectionPolicy: {
    targetMode:
      | "interactive"
      | "plan"
      | "execute"
      | "workflow_step"
      | "background"
      | "recovery"

    tokenBudget: number
    includeRecentHistoryTurns?: number
    sourceBudgets?: Record<string, number>
    agentView?: string
  }
}
```

---

## 7. 视图对象

## 7.1 PlanContextView

```ts
type PlanContextView = {
  planId: string
  version: number
  objective: string

  currentStep?: {
    stepId: string
    title: string
    description?: string
    owner?: string
    assignedAgentType?: string
  }

  completedSummary?: string[]
  blockedItems?: string[]
  nextCandidateActions?: string[]

  todoSummary?: Array<{
    todoListId: string
    ownerAgentType: string
    status: string
  }>
}
```

## 7.2 WorkflowStepContextView

```ts
type WorkflowStepContextView = {
  workflowId: string
  workflowRunId: string
  stepId: string
  stepRunId: string

  workflowName?: string
  stepTitle: string
  stepType:
    | "agent_run"
    | "subagent_run"
    | "tool_call"
    | "approval"
    | "wait"
    | "condition"
    | "notification"
    | "branch"
    | "parallel"

  inputSummary?: string
  requiredOutput?: Record<string, unknown>

  previousStepSummaries?: Array<{
    stepId: string
    status: string
    outputRef?: string
    summary?: string
  }>

  workflowConstraints?: string[]
  permissionMode?: string
}
```

## 7.3 BackgroundRunContextView

```ts
type BackgroundRunContextView = {
  backgroundRunId: string
  subagentRunId: string
  subagentCode: string
  agentType: string

  objective: string
  status: string

  progressSummary?: string
  artifactRefs?: string[]
  pendingApprovalId?: string
  lastCheckpointRef?: string
}
```

## 7.4 TriggerContextView

```ts
type TriggerContextView = {
  triggerId?: string
  eventId: string
  eventType: string
  source:
    | "scheduler"
    | "gateway"
    | "connector"
    | "mcp"
    | "webhook"
    | "approval_center"
    | "system"

  payloadSummary?: string
  target?: {
    targetType:
      | "start_workflow"
      | "launch_background_subagent"
      | "resume_background_subagent"
      | "resume_kernel_run"
      | "send_notification"
    targetRef?: string
  }
}
```

---

## 8. ContextBundle

```ts
type ContextBundle = {
  bundleId: string
  runId: string
  agentId: string
  agentType: string

  invocationSource:
    | "gateway_intent"
    | "planner_execution"
    | "workflow_step"
    | "subagent_runtime"
    | "background_subagent"
    | "event_trigger_resume"
    | "system"

  pinnedItems: ContextItem[]
  orderedItems: ContextItem[]
  summaryBlocks?: ContextItem[]

  planView?: PlanContextView
  workflowStepView?: WorkflowStepContextView
  backgroundRunView?: BackgroundRunContextView
  triggerView?: TriggerContextView

  artifactRefs?: Array<{ artifactRef: string; artifactType: string }>
  attachmentRefs?: Array<{ fileRef: string; mimeType: string }>

  tokenEstimate: number

  compactHints?: {
    shouldCompactSoon: boolean
    candidateItemIds?: string[]
    mustKeepItemIds?: string[]
  }
}
```

---

## 9. RuntimeContextDelta v2

```ts
type RuntimeContextDelta = {
  runId: string
  iteration?: number

  source:
    | "tool_result"
    | "subagent_result"
    | "workflow_step_result"
    | "trigger_event"
    | "approval_result"
    | "runtime_note"

  items: ContextItem[]
  replaceKeys?: string[]
}
```

---

## 10. Pipeline

Context Manager 仍采用五阶段管线：

```text
Normalize
  → Filter
  → Dedup
  → Score & Rank
  → Budgeted Selection
```

### 必须保护的结构关系

- tool_use 与 terminal result
- approval request 与 approval response
- artifact summary 与 artifact ref
- workflow step input 与 step output
- backgroundRun 与 subagentRun
- plan step 与 todo list
- trigger event 与 target runtime

---

## 11. 与各模块的关系

### Gateway

提供自然语言入口的 HydratedSessionState。

### Planner / Intent Router

提供临时 Plan、PlanContextView 和 ConversationStateProjection。

### Workflow Runtime

提供 WorkflowRun / WorkflowStepRun 的结构化上下文。  
Context Manager 为 Workflow step 生成最小可执行上下文。

### Event Trigger Runtime

提供 RuntimeTriggerEvent / TriggerContextView。

### Subagent Runtime

提供 SubagentResult、BackgroundRunContextView，并请求子 Agent 专属上下文。

### Agent Kernel

消费 ContextBundle，产生 RuntimeContextDelta，并触发 compact / working summary。

边界约束：

- Context Manager 负责上下文选择：Normalize / Filter / Dedup / Score / Budgeted Selection。
- Agent Kernel 的 Model Input Builder 负责模型请求组装：ContextBundle + system prompt + runtime instruction + tool schema。
- Kernel 不应绕过 Context Manager 直接从 Memory / Transcript / Tool Result 中自行拼接上下文。
- Context Manager 不负责模型采样，也不驱动 Agent Loop。

### P9 Update: ContextBundleProjection

P9 引入 `ContextBundleProjection` 模块，负责将 `ContextBundle` 正确投影为 LLM 可消费的消息格式：

**SemanticType 到 Role 映射**：
- `constraint` -> `system`（约束性内容作为系统消息）
- `draft` -> `assistant`（草稿作为助手消息）
- `summary` -> `assistant`（摘要作为助手消息）
- `plan_view` -> `system`（计划视图作为系统消息）
- `workflow_step_view` -> `system`（工作流步骤视图作为系统消息）
- `background_run_view` -> `system`（后台运行视图作为系统消息）
- `trigger_view` -> `user`（触发事件视图作为用户消息）

**未消费字段投影**：
ContextBundle 中有 5 个字段原未被 AgentKernel 消费，现已通过 ContextBundleProjection 正确投影：
- `summaryBlocks` -> assistant 消息
- `planView` -> system 消息
- `workflowStepView` -> system 消息
- `backgroundRunView` -> system 消息
- `triggerView` -> user 消息

**确定性排序**：
可选字段的投影顺序是确定性的：
```
planView -> workflowStepView -> backgroundRunView -> triggerView -> summaryBlocks
```

**Pair Integrity 保护**：
- tool_use 与 tool_result 必须成对出现
- approval request 与 approval response 必须成对
- 通过 `context-pair-integrity.ts` 实现保护逻辑

---

## 12. Session Memory / Working Summary 更新

### Session Memory

Session Memory 仍是会话恢复摘要，但其内容应包含：

- active plan
- active artifact
- pending approval
- recent workflow run summary
- recent background subagent status

### Working Summary

Working Summary 是运行中工作便签，应支持：

- 当前 Plan step
- 当前 Workflow step
- 当前 BackgroundSubagentRun
- 最近工具结果
- 最近 SubagentResult
- 当前 pending action

---

## 13. 推荐数据流

```text
Gateway / Planner / Workflow Runtime / Event Trigger / Subagent Runtime
        │
        ▼
Context Manager
  ├─ Normalize
  ├─ Filter
  ├─ Dedup
  ├─ Score & Rank
  └─ Budgeted Selection
        │
        ▼
ContextBundle
        │
        ▼
Agent Kernel / Subagent Runtime / Workflow Step Executor
```

---

## 14. 关键结论

- Context Manager 不只服务对话，也服务 Workflow step 和 BackgroundSubagentRun。
- 旧的 Task State 应拆成 Plan / Workflow / BackgroundRun / Trigger 等更明确的上下文来源。
- Workflow Runtime 负责固化流程，Context Manager 只为其 step 提供模型可见视图。
- Event Trigger Runtime 负责触发事件，Context Manager 将触发事件转为最小上下文视图。
- Subagent Runtime 负责后台子任务，Context Manager 为其生成隔离视图。

---

# 16. Foreground Conversation Agent / PlannerRun 上下文视图

Context Manager 需要新增两类专用上下文视图。

## 16.1 ForegroundConversationContextView

```ts
type ForegroundConversationContextView = {
  sessionId: string
  userId: string

  assistantPersona?: AssistantPersonaProfile

  sessionMemory?: SessionMemoryForPlanner

  activeWork?: ActiveWorkProjection

  pendingApproval?: {
    approvalId: string
    actionSummary: string
    sourceRef: string
  }

  recentUserVisibleTurns?: Array<{
    turnId: string
    role: "user" | "assistant"
    summary: string
  }>

  directDelegationPolicy?: DirectDelegationPolicy
}
```

Foreground Conversation Agent View 应优先包含：

- Platform System Constraints ref
- AssistantPersonaProfile
- SessionMemory
- ActiveWorkProjection
- Pending approvals
- 最近用户可见对话
- DirectDelegationPolicy

不应包含大量工具原始结果、长文档全文或无关后台执行细节。

## 16.2 PlannerRunContextView

```ts
type PlannerRunContextView = {
  plannerRunId: string
  plannerTemplateId: string
  planId: string
  objective: string

  planContextView?: PlanContextView

  constraints?: string[]

  availableAgentProfiles?: string[]
  availableToolProfiles?: string[]

  priorStepSummaries?: Array<{
    stepId: string
    status: string
    summary?: string
    outputRef?: string
  }>

  boundRefs?: {
    backgroundRunId?: string
    workflowRunId?: string
  }
}
```

PlannerRun View 应包含任务目标、计划状态、约束、已完成步骤、可用 agent / tool profile 和相关执行结果摘要。

## 16.3 ActiveWorkProjection 来源

ActiveWorkProjection 由以下来源投影：

- Plan Store
- PlannerRun Store
- BackgroundRun Store
- WorkflowRun Store
- Approval Store
- Event Store
- SessionMemory

Context Manager 负责把该投影裁剪后注入 Foreground Conversation Agent。
