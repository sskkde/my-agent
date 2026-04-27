# Architecture Glossary & Core Object Dictionary v1

> 适用范围：个人助理型 Agent 平台架构定义阶段  
> 更新时间：2026-04-26  
> 对齐版本：Foreground Conversation Agent 常驻 + Planner Agent Template 按需 fork + Runtime Dispatcher 统一分发 + 分层 Memory / Summary 体系

---

## 1. 文档目的

本文档用于统一当前架构中的核心术语、对象边界、owner、生命周期、持久化要求与上下文可见性。

随着系统从单一 Agent Loop 扩展为：

```text
Gateway
  → Foreground Conversation Agent
  → Planner Agent Template / PlannerRun
  → Runtime Dispatcher
  → Agent Kernel / Subagent Runtime / Tool Plane / Workflow Runtime
  → Memory / Summary / Observability
```

系统中出现了大量容易混淆的对象，例如：`Run`、`Turn`、`Session`、`Plan`、`PlannerRun`、`KernelRun`、`BackgroundSubagentRun`、`WorkflowRun`、`RuntimeAction`、`ContextBundle`、`WorkingSummary`、`SessionMemory` 等。

本文档回答以下问题：

1. 每个对象是什么。
2. 归哪个模块管理。
3. 是否持久化。
4. 是否进入模型上下文。
5. 是否用户可见。
6. 与其他对象是什么关系。
7. 生命周期由谁推进。

---

## 2. 全局对象分层

推荐将平台对象分为 9 类：

```text
1. Identity / Profile Objects
2. Conversation / Channel Objects
3. Foreground Decision Objects
4. Planning Objects
5. Runtime Dispatch Objects
6. Execution Runtime Objects
7. Tool / Connector Objects
8. Context / Memory / Artifact Objects
9. Governance / Observability Objects
```

### 2.1 分层总览

| 层级 | 对象示例 | 主要 owner | 主要用途 |
|---|---|---|---|
| Identity / Profile | User, AssistantPersonaProfile, UserPreference | User Profile / Preference Service | 用户身份、助手形象、偏好 |
| Conversation / Channel | Session, Turn, Message, InboundEnvelope, OutboundEnvelope | Gateway / Transcript Store | 输入输出、会话记录 |
| Foreground Decision | ForegroundConversationRun, ForegroundDecision, ActiveWorkProjection | Foreground Conversation Agent | 前台对话、意图判断、直接委派 |
| Planning | PlannerAgentTemplate, PlannerRun, ExecutionPlan, PlanStep, PlanPatch | Planner Runtime / Plan Store | 复杂任务规划与重规划 |
| Runtime Dispatch | RuntimeAction, DispatchRequest, DispatchResult | Runtime Dispatcher | 结构化动作分发 |
| Execution Runtime | KernelRun, SubagentRun, BackgroundSubagentRun, WorkflowRun, WorkflowStepRun | 对应 Runtime | 实际执行与状态机 |
| Tool / Connector | ToolDefinition, ToolCall, ToolResult, ConnectorInstance, OperationRef | Tool Plane / Connector Runtime | 外部能力与工具调用 |
| Context / Memory / Artifact | ContextBundle, WorkingSummary, SessionMemory, MemoryRecord, Artifact | Context Manager / Memory System | 上下文、摘要、长期记忆、产物 |
| Governance / Observability | PermissionDecision, ApprovalRequest, AuditRecord, RuntimeSpan | Permission / Observability | 权限、审批、审计、追踪 |

---

## 3. ID 与引用命名规范

### 3.1 通用 ID 原则

所有可持久化对象都应该有稳定 ID，并满足：

```text
- 全局唯一或在 owner 范围内唯一
- 可出现在 relatedRefs 中
- 可用于 Event Store / Audit Store / Replay Service 追踪
- 不把外部系统 ID 直接作为内部主键
```

### 3.2 推荐 ID 前缀

| 对象 | 推荐前缀 | 示例 |
|---|---|---|
| Session | `sess_` | `sess_001` |
| Turn | `turn_` | `turn_001` |
| ForegroundConversationRun | `fg_run_` | `fg_run_001` |
| PlannerRun | `pl_run_` | `pl_run_001` |
| ExecutionPlan | `plan_` | `plan_001` |
| RuntimeAction | `act_` | `act_001` |
| KernelRun | `krun_` | `krun_001` |
| SubagentRun | `sa_run_` | `sa_run_001` |
| BackgroundSubagentRun | `bg_run_` | `bg_run_001` |
| WorkflowDefinition | `wf_` | `wf_001` |
| WorkflowRun | `wf_run_` | `wf_run_001` |
| WorkflowStepRun | `step_run_` | `step_run_001` |
| ToolCall | `tool_call_` | `tool_call_001` |
| ApprovalRequest | `appr_` | `appr_001` |
| RuntimeTriggerEvent | `rte_` | `rte_001` |
| WaitCondition | `wait_` | `wait_001` |
| Artifact | `art_` | `art_001` |
| SummaryRecord | `sum_` | `sum_001` |
| MemoryRecord | `mem_` | `mem_001` |
| AuditRecord | `audit_` | `audit_001` |
| RuntimeSpan | `span_` | `span_001` |

---

## 4. 核心对象字典

## 4.1 User

**定义**：平台中的用户主体。  
**Owner**：Identity / Account Service。  
**持久化**：是。  
**模型可见**：通常不可直接注入，只可通过经过筛选的 profile / preference 进入上下文。  
**用户可见**：部分可见。

```ts
type User = {
  userId: string
  accountId?: string
  locale?: string
  timezone?: string
  createdAt: string
}
```

### 关系

```text
User 1 - N Session
User 1 - N AssistantPersonaProfile
User 1 - N PlannerRun
User 1 - N BackgroundSubagentRun
User 1 - N WorkflowDefinition
User 1 - N MemoryRecord
```

---

## 4.2 AssistantPersonaProfile

**定义**：用户可自定义的个人助手形象、语气、背景与行为偏好。  
**Owner**：Preference Service / Foreground Conversation Agent。  
**持久化**：是。  
**模型可见**：可见，但必须低于 Platform System Constraints。  
**用户可见**：是。

```ts
type AssistantPersonaProfile = {
  profileId: string
  userId: string

  displayName?: string
  background?: string
  avatarStyle?: string

  tone: {
    formality?: "casual" | "neutral" | "formal"
    verbosity?: "brief" | "balanced" | "detailed"
    emotionalStyle?: string
    humorLevel?: "none" | "light" | "active"
  }

  behaviorPreferences: {
    proactiveLevel?: "low" | "medium" | "high"
    askBeforePlanning?: boolean
    preferDirectExecutionForSimpleTasks?: boolean
    progressUpdateStyle?: "silent" | "brief" | "detailed"
  }

  boundaries?: {
    userDefinedDo?: string[]
    userDefinedDont?: string[]
  }

  lifecycle: {
    status: "active" | "archived"
    createdAt: string
    updatedAt?: string
  }
}
```

### 不可覆盖规则

`AssistantPersonaProfile` 不能覆盖：

```text
- 系统安全策略
- 权限审批规则
- 隐私保护规则
- 审计记录要求
- 工具执行边界
- Runtime Dispatcher 分发规则
```

---

## 4.3 Session

**定义**：一段连续用户交互上下文。  
**Owner**：Gateway / Session Store。  
**持久化**：是。  
**模型可见**：不直接可见；由 Context Manager 投影为 SessionMemory / recent transcript / active work。  
**用户可见**：间接可见。

```ts
type Session = {
  sessionId: string
  userId: string
  channelType?: string
  threadId?: string
  status: "active" | "idle" | "closed" | "archived"
  startedAt: string
  lastActiveAt: string
}
```

### 关系

```text
Session 1 - N Turn
Session 1 - N ForegroundConversationRun
Session 1 - N PlannerRun
Session 1 - N KernelRun
Session 1 - N SummaryRecord(session_memory)
```

---

## 4.4 Turn

**定义**：一次用户输入到系统输出之间的可读交互单元。  
**Owner**：Transcript Store。  
**持久化**：是。  
**模型可见**：按需通过 Context Manager 召回。  
**用户可见**：是。

```ts
type Turn = {
  turnId: string
  sessionId: string
  userId: string
  userMessageRef: string
  assistantMessageRefs: string[]
  transcriptCommitRef?: string
  startedAt: string
  completedAt?: string
}
```

### 与 Run 的区别

```text
Turn 是用户可理解的对话轮次。
Run 是系统内部的一次运行实例。
一个 Turn 可以包含多个 Run，例如 ForegroundConversationRun + KernelRun + ToolCall。
一个后台 Run 也可以跨多个 Turn 存续。
```

---

## 4.5 InboundEnvelope

**定义**：Gateway 归一化后的外部输入对象。  
**Owner**：Gateway。  
**持久化**：建议写入 Event Store / Transcript Store。  
**模型可见**：由 Context Manager 选择后进入。  
**用户可见**：原始用户输入可见。

```ts
type InboundEnvelope = {
  eventId: string
  eventType:
    | "human_message"
    | "file_upload"
    | "approval_response"
    | "approval_code_response"
    | "external_webhook"
    | "mcp_notification"
    | "connector_event"
    | "remote_runtime_callback"
    | "notification_response"

  sourceType: string
  sourceId: string
  userId?: string
  sessionId?: string
  threadId?: string
  relatedRefs?: RelatedRefs
  correlationId?: string
  causationId?: string
  idempotencyKey?: string
  contentParts: ContentPart[]
  createdAt: string
}
```

---

## 4.6 OutboundEnvelope

**定义**：系统向外部渠道输出的统一对象。  
**Owner**：Gateway / Notification Center。  
**持久化**：写 Event Store，必要时写 Transcript Store。  
**模型可见**：通常不再进入模型，除非作为 lastUserVisibleOutput。  
**用户可见**：是。

---

## 4.7 ForegroundConversationRun

**定义**：前台会话 Agent 对一次用户输入进行处理的短生命周期运行实例。  
**Owner**：Foreground Conversation Agent。  
**持久化**：建议持久化运行摘要与事件。  
**模型可见**：当前 run 内可见；结束后通过 Transcript / SessionMemory 投影。  
**用户可见**：用户看到其输出，不直接看到 run 对象。

```ts
type ForegroundConversationRun = {
  foregroundRunId: string
  sessionId: string
  userId: string
  inboundEventId: string

  status:
    | "initializing"
    | "deciding"
    | "answering"
    | "dispatching"
    | "spawning_planner"
    | "waiting_for_approval"
    | "completed"
    | "failed"
    | "cancelled"

  decisionRef?: string
  createdRuntimeActionIds?: string[]
  spawnedPlannerRunId?: string
  startedAt: string
  completedAt?: string
}
```

### 核心原则

```text
ForegroundConversationRun 必须短循环。
它可以直接回答、直接委派或 spawn PlannerRun。
它不应该长时间占用前台执行复杂任务。
```

---

## 4.8 ForegroundDecision

**定义**：Foreground Conversation Agent 对当前用户输入做出的结构化路由决策。  
**Owner**：Foreground Conversation Agent。  
**持久化**：建议写 Event Store / Audit Store。  
**模型可见**：可作为后续 Planner / Kernel 输入。  
**用户可见**：通常不可直接见，但可生成用户可见摘要。

```ts
type ForegroundDecision = {
  decisionId: string
  sessionId: string
  userId: string

  intent:
    | "chat"
    | "qa"
    | "status_query"
    | "approval_response"
    | "simple_tool_task"
    | "simple_agent_task"
    | "complex_plan_task"
    | "background_task"
    | "workflow_request"
    | "cancel_or_modify_task"

  route:
    | "answer_directly"
    | "dispatch_kernel"
    | "dispatch_tool"
    | "dispatch_subagent"
    | "spawn_planner"
    | "resume_existing_planner"
    | "handoff_workflow_runtime"
    | "approval_handler"

  requiresPlanner: boolean
  requiresApprovalLikely: boolean
  confidence: number
  reason?: string

  targetRefs?: RelatedRefs
  suggestedRuntimeActions?: RuntimeAction[]
  userVisibleResponse?: string
}
```

---

## 4.9 ActiveWorkProjection

**定义**：当前用户 / session 下活跃工作状态的聚合视图。  
**Owner**：Projection Builder / Context Manager。  
**持久化**：可持久化为 projection，也可按需构建。  
**模型可见**：Foreground Agent 常用。  
**用户可见**：可展示为任务中心。

```ts
type ActiveWorkProjection = {
  userId: string
  sessionId?: string

  activePlannerRuns: Array<{
    plannerRunId: string
    planId: string
    objective: string
    status: string
    lastUpdateSummary?: string
    pendingApprovalId?: string
    boundBackgroundRunId?: string
  }>

  activeBackgroundRuns: Array<{
    backgroundRunId: string
    subagentRunId: string
    objective: string
    status: string
    progressSummary?: string
  }>

  activeWorkflowRuns: Array<{
    workflowRunId: string
    workflowId: string
    workflowName: string
    status: string
    currentStepSummary?: string
  }>

  pendingApprovals: Array<{
    approvalId: string
    actionSummary: string
    sourceRef: string
  }>
}
```

---

## 4.10 PlannerAgentTemplate

**定义**：Planner Agent 的模板定义，用于按任务创建 PlannerRun。  
**Owner**：Planner Runtime / Agent Template Registry。  
**持久化**：是。  
**模型可见**：模板 prompt / policy 进入 PlannerRun，不直接进入 Foreground Agent。  
**用户可见**：通常不可见。

```ts
type PlannerAgentTemplate = {
  plannerTemplateId: string
  name: string
  description?: string

  capabilities: {
    canCreatePlan: boolean
    canPatchPlan: boolean
    canAssignAgents: boolean
    canGenerateRuntimeActions: boolean
    canCompileWorkflowDraft: boolean
  }

  defaultPolicy: {
    maxPlanSteps: number
    maxSubagentFanout: number
    maxReplanCount: number
    allowBackgroundExecution: boolean
  }
}
```

---

## 4.11 PlannerRun

**定义**：由 PlannerAgentTemplate 创建的一个规划运行实例，绑定一个复杂任务或长任务。  
**Owner**：Planner Runtime。  
**持久化**：是。  
**模型可见**：作为 plan state / active work projection 被选择性注入。  
**用户可见**：通过任务状态摘要间接可见。

```ts
type PlannerRun = {
  plannerRunId: string
  plannerTemplateId: string
  userId: string
  sessionId?: string

  planId: string
  objective: string

  status:
    | "initializing"
    | "planning"
    | "waiting_for_user"
    | "waiting_for_execution_result"
    | "replanning"
    | "completed"
    | "failed"
    | "cancelled"
    | "archived"

  boundRefs?: {
    backgroundRunId?: string
    workflowRunId?: string
    parentForegroundRunId?: string
  }

  checkpointRef?: string
  lastPlanVersion?: number
  createdAt: string
  updatedAt: string
}
```

### 与 ExecutionPlan 的区别

```text
PlannerRun 是一个 agent run 实例。
ExecutionPlan 是计划状态对象。
一个 PlannerRun 通常绑定一个 active ExecutionPlan。
Plan 的权威状态应在 Plan Store，而不是只存在 PlannerRun 内存中。
```

---

## 4.12 ExecutionPlan

**定义**：自然语言临时任务生成的结构化计划。  
**Owner**：Plan Store / Planner Runtime。  
**持久化**：是。  
**模型可见**：按需进入 Planner / Kernel / Foreground Agent。  
**用户可见**：可以可视化展示。

```ts
type ExecutionPlan = {
  planId: string
  version: number
  userId: string
  sessionId?: string
  objective: string
  status:
    | "draft"
    | "approved"
    | "in_execution"
    | "blocked"
    | "completed"
    | "abandoned"

  steps: PlanStep[]
  constraints?: string[]
  createdByPlannerRunId?: string
  createdAt: string
  updatedAt: string
}
```

---

## 4.13 PlanStep

**定义**：ExecutionPlan 中的一个可执行或可判断步骤。  
**Owner**：Plan Store / Planner Runtime。  
**持久化**：是。

```ts
type PlanStep = {
  stepId: string
  title: string
  description?: string
  status: "pending" | "running" | "waiting" | "completed" | "failed" | "skipped"
  assignedRuntime?:
    | "agent_kernel"
    | "subagent_runtime"
    | "tool_plane"
    | "workflow_runtime"
    | "manual_user"
  assignedAgentType?: string
  dependsOn?: string[]
  outputRef?: string
}
```

---

## 4.14 PlanPatch

**定义**：对 ExecutionPlan 的结构化修改。  
**Owner**：Planner Runtime / Plan Store。  
**持久化**：作为事件与版本差异保存。  
**模型可见**：可作为 Planner 重规划输入。

```ts
type PlanPatch = {
  planId: string
  baseVersion: number
  operations: Array<{
    op: "add_step" | "update_step" | "remove_step" | "reorder_step" | "update_status" | "set_constraint"
    path?: string
    value?: unknown
    reason?: string
  }>
  createdBy: "planner" | "kernel" | "user" | "workflow" | "system"
}
```

---

## 4.15 RuntimeAction

**定义**：跨模块执行请求的标准结构。  
**Owner**：Runtime Dispatcher。  
**持久化**：是。  
**模型可见**：通常不可直接注入，只可作为状态摘要。  
**用户可见**：不可直接见。

```ts
type RuntimeAction = {
  actionId: string
  actionType:
    | "start_agent_run"
    | "resume_agent_run"
    | "launch_subagent"
    | "resume_subagent"
    | "execute_tool"
    | "start_workflow_run"
    | "resume_workflow_step"
    | "register_trigger"
    | "register_wait_condition"
    | "send_notification"
    | "request_approval"
    | "update_plan_state"
    | "write_summary"
    | "extract_memory"
    | "replay_run"

  source: {
    sourceModule: string
    sourceRef?: string
  }

  targetRuntime: string
  targetRef?: RelatedRefs
  payload: Record<string, unknown>
  policy?: DispatchPolicy
  correlationId?: string
  causationId?: string
  idempotencyKey?: string
  createdAt: string
}
```

### 核心原则

```text
跨 Runtime 的结构化动作必须通过 RuntimeAction 表达。
Foreground Agent / Planner Agent 不应直接调用 Tool / Connector / Subagent。
```

---

## 4.16 DispatchRequest / DispatchResult

**定义**：Runtime Dispatcher 的输入输出对象。  
**Owner**：Runtime Dispatcher。  
**持久化**：DispatchEvent / Trace / Audit 持久化。

```ts
type DispatchResult = {
  requestId: string
  actionId: string
  status:
    | "accepted"
    | "completed"
    | "queued"
    | "waiting_for_approval"
    | "denied"
    | "duplicate"
    | "failed"
    | "timeout"
    | "cancelled"
  targetRuntime: string
  targetResultRef?: string
  result?: unknown
  waitingState?: {
    waitingFor: "approval" | "external_event" | "target_runtime" | "queue"
    approvalId?: string
    waitConditionId?: string
  }
}
```

---

## 4.17 KernelRun

**定义**：Agent Kernel 的一次模型推理 / 工具协调循环实例。  
**Owner**：Agent Kernel。  
**持久化**：状态、checkpoint、transcript、events 持久化。  
**模型可见**：当前 run 内可见。  
**用户可见**：输出可见，内部状态不可见。

```ts
type KernelRun = {
  runId: string
  userId: string
  sessionId?: string
  agentId: string
  agentType: "main" | "subagent" | "background" | "workflow_step" | "remote"
  invocationSource: string
  status:
    | "running"
    | "waiting_for_user"
    | "waiting_for_approval"
    | "waiting_for_external_event"
    | "completed"
    | "failed"
    | "cancelled"
  checkpointRef?: string
}
```

### 与 ForegroundConversationRun 的区别

```text
ForegroundConversationRun 负责前台意图、对话、委派。
KernelRun 负责一次具体模型 loop 与工具协调。
简单问答可能只有 ForegroundConversationRun，不一定创建 KernelRun。
复杂执行通常由 ForegroundDecision 或 PlannerRun 通过 Dispatcher 创建 KernelRun。
```

---

## 4.18 SubagentRun

**定义**：一个子 Agent 的一次运行实例。  
**Owner**：Subagent Runtime。  
**持久化**：是。  
**模型可见**：结果摘要进入父 run。  
**用户可见**：通常只看结果或状态。

---

## 4.19 BackgroundSubagentRun

**定义**：后台长任务型子 Agent 运行生命周期对象。  
**Owner**：Subagent Runtime。  
**持久化**：是。  
**模型可见**：通过 ActiveWorkProjection / BackgroundRunContextView 进入。  
**用户可见**：可作为任务中心状态展示。

```ts
type BackgroundSubagentRun = {
  backgroundRunId: string
  subagentRunId: string
  agentType: string
  userId: string
  sessionId?: string
  status:
    | "queued"
    | "running"
    | "waiting_for_user"
    | "waiting_for_approval"
    | "waiting_for_external_event"
    | "sleeping"
    | "recovering"
    | "completed"
    | "failed"
    | "cancelled"
    | "expired"
  taskSpec: SubagentTaskSpec
  checkpointId?: string
  artifactRefs?: string[]
  createdAt: string
  updatedAt: string
}
```

---

## 4.20 WorkflowDraft / WorkflowDefinition

**WorkflowDraft**：未发布的可视化流程草稿，可由 PlanToWorkflowCompiler 或 Visual Builder 生成。  
**WorkflowDefinition**：用户确认发布后的固化流程定义。  
**Owner**：Workflow Runtime。  
**持久化**：是。  
**模型可见**：通常只以摘要或当前 step view 进入。  
**用户可见**：是。

---

## 4.21 WorkflowRun / WorkflowStepRun

**定义**：固化 Workflow 的运行实例与步骤运行实例。  
**Owner**：Workflow Runtime。  
**持久化**：是。  
**模型可见**：通过 WorkflowStepContextView 进入。  
**用户可见**：可作为 workflow 状态展示。

```ts
type WorkflowRun = {
  workflowRunId: string
  workflowId: string
  workflowVersion: number
  ownerUserId: string
  status:
    | "queued"
    | "running"
    | "waiting_for_user"
    | "waiting_for_approval"
    | "waiting_for_external_event"
    | "sleeping"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled"
    | "timeout"
  currentStepIds: string[]
  checkpointId?: string
}
```

---

## 4.22 ToolDefinition / ToolCall / ToolExecutionResult

**ToolDefinition**：工具能力定义。  
**ToolCall**：模型或 runtime 发出的具体工具调用。  
**ToolExecutionResult**：工具执行结果终态。  
**Owner**：Tool Plane。  
**持久化**：工具事件、结果摘要、artifact/ref 持久化。  
**模型可见**：工具 schema 与 tool_result 可见。  
**用户可见**：按需展示 userVisibleSummary。

核心原则：

```text
任何已被接受执行的 tool call 都必须有 terminal result。
大结果必须引用化。
写操作必须经过 Permission Engine。
```

---

## 4.23 ConnectorInstance / ConnectorResourceRef

**ConnectorInstance**：用户已连接的外部系统实例。  
**ConnectorResourceRef**：外部资源在内部系统中的标准引用。  
**Owner**：Connector Runtime / MCP Layer。  
**模型可见**：只通过 Tool Plane 标准化结果进入。  
**用户可见**：部分可见。

核心原则：

```text
Connector 不直接暴露给模型。
Connector 能力通过 Tool Plane 桥接成 ToolDefinition。
```

---

## 4.24 OperationRef / WaitCondition

**OperationRef**：长耗时外部操作的引用，如命令执行、安装、部署、服务重启。  
**WaitCondition**：等待某个外部条件满足后唤醒目标 Runtime。  
**Owner**：OperationRef 由 Tool Plane / Connector Runtime 产生；WaitCondition 由 Event Trigger Runtime 管理。  
**持久化**：是。  
**模型可见**：通常只以状态摘要进入。

---

## 4.25 TriggerRegistration / RuntimeTriggerEvent

**TriggerRegistration**：注册的触发规则。  
**RuntimeTriggerEvent**：触发器匹配后生成的运行时事件。  
**Owner**：Event Trigger Runtime。  
**持久化**：是。  
**模型可见**：通过 TriggerContextView 按需进入。

---

## 4.26 PermissionContext / PermissionDecision

**定义**：权限判断的输入上下文与输出决策。  
**Owner**：Permission & Approval Engine。  
**持久化**：决策写 Audit Store / Event Store。  
**模型可见**：通常不可见，只可见需要用户确认的摘要。  
**用户可见**：审批请求可见。

---

## 4.27 ApprovalRequest / PermissionGrant

**ApprovalRequest**：等待用户确认的授权请求。  
**PermissionGrant**：用户批准后形成的授权作用域。  
**Owner**：Permission & Approval Engine / Approval Center。  
**持久化**：是。  
**模型可见**：pending approval 摘要可见。  
**用户可见**：是。

核心原则：

```text
固化 Workflow 不是免审批通道。
后台任务需要审批时进入 waiting_for_approval。
```

---

## 4.28 ContextItem / ContextBundle

**ContextItem**：上下文候选项。  
**ContextBundle**：某次模型运行最终可见上下文包。  
**Owner**：Context Manager。  
**持久化**：ContextBundle 可引用化保存；ContextItem 多来源。  
**模型可见**：ContextBundle 可见。  
**用户可见**：通常不可直接见。

核心原则：

```text
Context Manager 决定哪些内容进入模型上下文。
Agent Kernel 的 Model Input Builder 只负责组装模型请求。
```

---

## 4.29 WorkingSummary

**定义**：当前 run / loop 的运行摘要，回答“当前 run 如果继续，下一步该怎么做”。  
**Owner**：SummaryManager；由 Kernel / Subagent / Workflow Step / Compaction 触发。  
**持久化**：Summary Store。  
**模型可见**：常用。  
**用户可见**：通常不可直接见。

---

## 4.30 SessionMemory

**定义**：当前 session 的可恢复状态投影，回答“这个 session 之前在聊什么、有哪些未完成状态”。  
**Owner**：SessionMemoryManager / SummaryManager。  
**持久化**：Summary Store。  
**模型可见**：Foreground Agent / Planner / Context Manager 常用。  
**用户可见**：可通过摘要形式展示。

---

## 4.31 MemoryRecord

**定义**：长期结构化记忆记录。  
**Owner**：Long-term Memory Store。  
**持久化**：是。  
**模型可见**：通过 Memory Recall + Context Manager 进入。  
**用户可见**：用户应可查看、删除、管理。

---

## 4.32 Artifact / Attachment

**Artifact**：系统生成或编辑的产物，如文档、草稿、报告、代码片段。  
**Attachment**：用户上传或外部引用的文件 / 图片 / 音频 / 视频。  
**Owner**：Artifact Store / Attachment Store。  
**模型可见**：通过 artifact ref / preview / summary 进入。  
**用户可见**：是。

---

## 4.33 EventRecord

**定义**：系统发生的事实事件。  
**Owner**：Event Store。  
**持久化**：是。  
**模型可见**：通常不直接进入。  
**用户可见**：通常不可见，可通过审计 / timeline 展示。

核心原则：

```text
Event Store 保真。
Transcript Store 可读。
Summary Store 压缩。
Long-term Memory Store 结构化长期记忆。
```

---

## 4.34 TranscriptRecord

**定义**：用户可读的轮次记录和运行摘要。  
**Owner**：Transcript Store。  
**持久化**：是。  
**模型可见**：按需召回。  
**用户可见**：是。

---

## 4.35 RuntimeSpan / AuditRecord

**RuntimeSpan**：运行追踪 span，记录性能和调用链。  
**AuditRecord**：高可信审计记录，记录授权、外部写操作、敏感访问等。  
**Owner**：Observability / Audit / Replay。  
**持久化**：是。  
**模型可见**：通常不可见。  
**用户可见**：审计视图中可见。

---

## 5. 对象 owner 总表

| 对象 | Owner | 权威状态位置 | 是否持久化 | 模型是否可见 |
|---|---|---|---|---|
| AssistantPersonaProfile | Preference Service | Profile Store | 是 | 是，低于系统约束 |
| Session | Gateway / Session Store | Session Store | 是 | 否，需投影 |
| Turn | Transcript Store | Transcript Store | 是 | 按需 |
| ForegroundConversationRun | Foreground Agent | Foreground Run Store / Event Store | 建议 | 当前 run 内 |
| ForegroundDecision | Foreground Agent | Event Store / Decision Store | 建议 | 可传给 Planner / Dispatcher |
| ActiveWorkProjection | Projection Builder | Projection Store / On-demand | 可选 | 是 |
| PlannerAgentTemplate | Planner Runtime | Template Registry | 是 | PlannerRun 内 |
| PlannerRun | Planner Runtime | PlannerRun Store | 是 | 摘要可见 |
| ExecutionPlan | Planner / Plan Store | Plan Store | 是 | 是 |
| RuntimeAction | Runtime Dispatcher | Dispatch Store / Event Store | 是 | 通常否 |
| KernelRun | Agent Kernel | KernelRun Store / Event Store | 是 | 当前 run 内 |
| BackgroundSubagentRun | Subagent Runtime | BackgroundRun Store | 是 | 摘要可见 |
| WorkflowRun | Workflow Runtime | WorkflowRun Store | 是 | 摘要可见 |
| ToolExecutionResult | Tool Plane | Tool Result Store | 是 | tool_result 可见 |
| ApprovalRequest | Permission Engine | Approval Store | 是 | pending 摘要可见 |
| ContextBundle | Context Manager | Context Store / ephemeral | 可选 | 是 |
| WorkingSummary | SummaryManager | Summary Store | 是 | 是 |
| SessionMemory | SummaryManager | Summary Store | 是 | 是 |
| MemoryRecord | Memory System | Long-term Memory Store | 是 | 召回后可见 |
| EventRecord | Event Store | Event Store | 是 | 通常否 |
| TranscriptRecord | Transcript Store | Transcript Store | 是 | 按需 |
| AuditRecord | Audit Store | Audit Store | 是 | 通常否 |

---

## 6. 常见混淆对象澄清

### 6.1 Session vs Turn vs Run

```text
Session：一段连续会话。
Turn：用户输入到系统输出的一轮可读交互。
Run：系统内部一次运行实例。
```

一个 session 有多个 turn。  
一个 turn 可以包含多个 run。  
一个后台 run 可以跨多个 turn 存续。

---

### 6.2 ForegroundConversationRun vs KernelRun

```text
ForegroundConversationRun：负责前台对话、意图判断、直接委派、spawn planner。
KernelRun：负责具体模型 loop、工具协调、compact、transcript commit。
```

简单对话可能只需要 ForegroundConversationRun。  
复杂执行通常需要 KernelRun / PlannerRun / SubagentRun。

---

### 6.3 PlannerRun vs ExecutionPlan

```text
PlannerRun：规划 agent 的运行实例。
ExecutionPlan：计划状态对象。
```

PlannerRun 可以生成或更新 ExecutionPlan。  
ExecutionPlan 的权威状态归 Plan Store。  
PlannerRun 可以完成、失败或归档，但 Plan 仍可保留。

---

### 6.4 BackgroundSubagentRun vs WorkflowRun

```text
BackgroundSubagentRun：后台智能执行单元的生命周期。
WorkflowRun：固化流程的运行实例。
```

Workflow 的某个 step 可以启动 BackgroundSubagentRun，但不拥有其内部 loop、checkpoint、watchdog。

---

### 6.5 ToolCall vs ConnectorCall

```text
ToolCall：平台内部工具调用，面向 Tool Plane。
ConnectorCall：Tool Plane 内部调用外部系统的请求，面向 Connector Runtime。
```

模型不能直接调用 ConnectorCall。  
模型只能通过 Tool Plane 暴露的 ToolDefinition 产生 tool use。

---

### 6.6 WorkingSummary vs SessionMemory vs Long-term Memory

```text
WorkingSummary：当前 run 怎么继续。
SessionMemory：当前 session 怎么恢复。
Long-term Memory：未来任务可复用的长期结构化事实 / 偏好 / routine。
```

---

## 7. relatedRefs 标准

所有跨对象引用建议统一使用：

```ts
type RelatedRefs = {
  sessionId?: string
  turnId?: string
  foregroundRunId?: string
  plannerRunId?: string
  planId?: string
  planStepId?: string
  workflowId?: string
  workflowRunId?: string
  workflowStepId?: string
  workflowStepRunId?: string
  kernelRunId?: string
  backgroundRunId?: string
  subagentRunId?: string
  toolCallId?: string
  approvalId?: string
  triggerId?: string
  waitConditionId?: string
  artifactId?: string
  memoryId?: string
  summaryId?: string
  auditId?: string
}
```

### 使用规则

```text
- 不强制所有字段都存在。
- 每个事件 / 审计 / transcript 尽量携带足够的 relatedRefs。
- Replay / Timeline / ActiveWorkProjection 都依赖 relatedRefs 重建链路。
```

---

## 8. 模型上下文可见性规则

| 对象 | 默认是否进模型 | 进入方式 |
|---|---:|:---:|
| AssistantPersonaProfile | 是 | Prompt Stack，低于系统约束 |
| Session | 否 | SessionMemory / recent transcript |
| Turn | 按需 | Transcript recall |
| ForegroundDecision | 按需 | Planner / Kernel 输入 |
| ActiveWorkProjection | 是 | Foreground Agent 常用 |
| ExecutionPlan | 是 | PlanContextView |
| PlannerRun | 摘要 | ActiveWorkProjection / PlannerRunContext |
| RuntimeAction | 否 | 状态摘要 |
| KernelRun | 当前 run 内 | WorkingContext |
| BackgroundSubagentRun | 摘要 | BackgroundRunContextView |
| WorkflowRun | 摘要 | WorkflowStepContextView |
| ToolExecutionResult | 是 | ToolResultMessage / RuntimeContextDelta |
| Connector raw response | 否 | Normalized output / artifact ref |
| EventRecord | 否 | Projection / Summary |
| TranscriptRecord | 按需 | Context Manager 召回 |
| WorkingSummary | 是 | Summary Store |
| SessionMemory | 是 | Summary Store |
| MemoryRecord | 按需 | Memory Recall |
| AuditRecord | 否 | 审计 UI / replay |

---

## 9. 用户可见性规则

| 对象 | 用户是否可见 | 展示方式 |
|---|---:|:---:|
| AssistantPersonaProfile | 是 | 设置页 |
| Session / Turn | 是 | 会话历史 |
| ForegroundDecision | 否 | 只展示自然语言解释 |
| ExecutionPlan | 是 | 计划卡片 / 任务详情 |
| PlannerRun | 间接 | 任务状态 |
| RuntimeAction | 否 | 不直接展示 |
| BackgroundSubagentRun | 是 | 后台任务中心 |
| WorkflowDefinition | 是 | Workflow Builder |
| WorkflowRun | 是 | Workflow 运行记录 |
| ToolCall | 按需 | 审计 / 工具活动摘要 |
| ApprovalRequest | 是 | 审批卡片 |
| WorkingSummary | 通常否 | 调试 / 高级视图 |
| SessionMemory | 可选 | 用户可查看的会话摘要 |
| MemoryRecord | 是 | 记忆管理页 |
| AuditRecord | 是 | 审计 / 安全记录 |

---

## 10. 对象生命周期 owner 规则

1. **谁创建对象，不一定谁拥有对象。**  
   例如 Foreground Agent 可以请求创建 PlannerRun，但 Planner Runtime 拥有 PlannerRun 生命周期。

2. **跨 Runtime 动作必须通过 RuntimeAction。**  
   Foreground Agent / PlannerRun 不直接启动 Tool / Subagent / Workflow。

3. **状态 owner 是唯一的。**  
   ExecutionPlan 的权威状态在 Plan Store；WorkflowRun 在 Workflow Runtime；BackgroundSubagentRun 在 Subagent Runtime。

4. **上下文可见性由 Context Manager 决定。**  
   模块不能直接把所有内部状态塞入模型。

5. **长期记忆写入必须经过 SummaryManager / MemoryExtractionService。**  
   Planner / Kernel / Tool Plane 不能直接写 Long-term Memory。

---

## 11. MVP 阶段最小对象集合

MVP 必须实现：

```text
User
AssistantPersonaProfile
Session
Turn
InboundEnvelope
OutboundEnvelope
ForegroundConversationRun
ForegroundDecision
ActiveWorkProjection
PlannerAgentTemplate
PlannerRun
ExecutionPlan
PlanStep
PlanPatch
RuntimeAction
DispatchResult
KernelRun
BackgroundSubagentRun
ToolDefinition
ToolExecutionResult
PermissionDecision
ApprovalRequest
ContextBundle
WorkingSummary
SessionMemory
EventRecord
TranscriptRecord
Artifact
```

MVP 可延后：

```text
复杂 WorkflowDefinition 版本树
复杂 ReplayRequest / ReplayResult
高级 Memory lifecycle scoring
多级 Planner 嵌套
复杂 MCP Server trust policy
完整 Audit Dashboard
```

---

## 12. 关键结论

当前架构中最重要的对象边界是：

```text
ForegroundConversationRun = 前台短循环
PlannerRun = 复杂任务规划实例
ExecutionPlan = 计划状态
RuntimeAction = 跨模块动作
KernelRun = 单次智能执行 loop
BackgroundSubagentRun = 后台智能任务生命周期
WorkflowRun = 固化流程生命周期
ContextBundle = 模型可见上下文
WorkingSummary = run 级恢复摘要
SessionMemory = session 级恢复状态
MemoryRecord = 长期结构化记忆
```

后续开发中应优先保证：

```text
- 每个对象 owner 唯一
- 跨模块引用统一使用 relatedRefs
- 所有执行动作可被 Event / Trace / Audit 串联
- 所有长任务都有可恢复状态
- 所有用户可见输出进入 Transcript
- 所有长期记忆都有 sourceRefs
```
