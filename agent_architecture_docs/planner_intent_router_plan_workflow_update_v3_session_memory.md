# Planner / Intent Router 更新文档 v5：Foreground Conversation Agent 与 PlannerRun 对齐版

## 1. 更新目的

本版在 v2 基础上补充 Planner / Intent Router 与 SessionMemory、Rolling Summary、SummaryManager 的协作关系。

核心边界：

```text
Intent Router = 自然语言输入后的路由决策
Planner       = 临时 ExecutionPlan 的生成、状态管理、推进决策
SessionMemory = Planner 的当前会话状态输入 / 当前会话地图
SummaryManager = WorkingSummary / SessionMemory / Rolling Summary 的写入控制器
```

Planner 不直接写 Memory，也不直接管理 WorkflowDefinition。

---

## 2. 模块定位

Planner / Intent Router 拆成两个职责：

```text
Intent Router = 自然语言输入后的路由决策
Planner       = 临时 ExecutionPlan 的生成、状态管理、推进决策
```

它不负责 WorkflowDefinition 的长期管理。固化 Workflow 由 Workflow Runtime 执行和版本管理。

---

## 3. IntentRouterDecision

```ts
type IntentRouterDecision = {
  decisionId: string
  sessionId: string
  userId: string

  intent:
    | "chat"
    | "qa"
    | "search"
    | "summarize"
    | "plan"
    | "execute"
    | "revise_artifact"
    | "schedule"
    | "communication"
    | "automation"
    | "approval_response"
    | "continue_plan"
    | "convert_plan_to_workflow"

  route:
    | "direct_kernel"
    | "temporary_plan"
    | "foreground_subagent"
    | "background_subagent"
    | "tool_call"
    | "approval_response"
    | "plan_to_workflow"
    | "handoff_to_workflow_runtime"

  taskComplexity: "simple" | "medium" | "complex"

  requiresPlan: boolean
  requiresTool: boolean
  requiresApprovalLikely: boolean

  suggestedAgent?:
    | "main"
    | "research_agent"
    | "calendar_agent"
    | "communication_agent"
    | "retrieval_agent"
    | "automation_agent"

  targetRefs?: {
    planId?: string
    workflowDraftId?: string
    workflowId?: string
    artifactId?: string
    approvalId?: string
    subagentRunId?: string
  }

  backgroundExecution?: {
    enabled: boolean
    notifyOnComplete: boolean
    reason?: string
  }

  confidence: number
  reason?: string
}
```

---

## 4. 临时 Plan 执行边界

临时 Plan 来源：

```text
User Natural Language
  → Gateway
  → Intent Router
  → Planner
  → ExecutionPlan
```

特点：

- 当前会话 / 当前任务内有效
- 动态生成
- 动态重规划
- 可根据工具结果和用户反馈更新
- 不默认成为可复用 Workflow
- 由 Planner / Agent Kernel 协调执行

---

## 5. Workflow 执行边界

固化 Workflow 不由 Planner 执行。

固化 Workflow 来源：

```text
Visual Workflow UI
或
ExecutionPlan → WorkflowDraft → User Approval
```

执行入口：

```text
Workflow Runtime
  → WorkflowRun
  → Runtime Dispatcher
```

---

## 6. Plan 转 Workflow

Planner 可以触发 Plan 转 Workflow，但不直接管理 Workflow。

流程：

```text
ExecutionPlan
  ↓
PlanToWorkflowCompiler
  ↓
WorkflowDraft
  ↓
Workflow UI
  ↓
User Review / Edit / Confirm
  ↓
WorkflowDefinition
  ↓
Workflow Runtime
```

---

## 7. ExecutionPlan 到 WorkflowDraft 的映射

```text
PlanStep
  → WorkflowStepDraft

Plan objective
  → Workflow name / description

Plan constraints
  → Workflow policy / validation issue

Plan approval requirement
  → approval step

Plan scheduled intent
  → WorkflowTrigger

Plan assigned subagent
  → subagent_run step

Plan tool action
  → tool_call step

Plan artifact output
  → artifact step
```

---

## 8. Planner 与 SessionMemory 的关系

### 8.1 关系定位

```text
SessionMemory
  = Planner 的当前会话地图

Planner
  = 临时 ExecutionPlan 的生成、更新、推进者
```

Planner 不直接写 SessionMemory。Planner 通过 `PlannerStatePatch` 把 Plan 状态变化提交给 `SessionMemoryManager`，由 SessionMemoryManager 统一合并、校验和落库。

---

### 8.1.1 Planner 与 Agent Kernel 的 Plan Ownership

为避免 Planner 和 Kernel 同时“推进 Plan”，采用以下边界：

```text
Planner / PlanRuntime
  owns plan state
  决定当前 step、下一步、是否重规划、是否完成或阻塞

Agent Kernel
  executes current plan step
  运行模型、调用工具、合并结果
  返回 KernelRunResult.planPatch

Planner / PlanRuntime
  applies PlanPatch
  更新 ExecutionPlan / SessionMemory patch
```

因此：

- Planner 是临时 Plan 状态机 owner。
- Kernel 是当前 step 的智能执行器。
- Kernel 不直接写 Plan Store。
- Planner 接收 `PlanPatch` 后决定是否接受、合并、重规划或请求用户确认。

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
    status:
      | "draft"
      | "approved"
      | "in_execution"
      | "blocked"
      | "completed"
      | "abandoned"
    objective: string
  }

  activeArtifact?: {
    artifactId: string
    artifactType: string
    status:
      | "draft"
      | "presented"
      | "awaiting_revision"
      | "approved"
  }

  pendingApproval?: {
    approvalId: string
    actionSummary: string
  }

  unresolvedQuestions?: string[]
  recentDecisions?: string[]
  currentConstraints?: string[]

  lastUserVisibleOutput?: {
    outputType:
      | "answer"
      | "draft"
      | "plan"
      | "approval_request"
      | "file"
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

## 9. Planner 读取 SessionMemory 的场景

Planner 应在这些场景读取 SessionMemory：

- 判断用户是在延续当前 Plan，还是开启新任务
- 判断用户是否在修改之前输出的 artifact
- 判断用户是否在回应 pending approval
- 判断是否需要 continue_plan
- 判断当前 Plan 是否已经被打断，需要从某个 step 恢复
- 判断是否应触发 PlanToWorkflowCompiler
- 判断是否存在未解决问题或用户约束

---

## 10. Planner 更新 SessionMemory 的场景

Planner 不直接更新 SessionMemory Store，而是输出 PlannerStatePatch。

常见触发：

- 创建新 ExecutionPlan
- Plan 当前 step 变化
- Plan 被用户批准
- Plan 被阻塞
- Plan 完成
- 用户切换目标
- 用户要求转换 Plan 为 Workflow
- 产生新的 unresolved question
- 确认新的决策

---

## 11. Topic Shift 与 Rolling Summary 协作

Intent Router / Planner 应输出话题切换信号，供 SummaryManager 判断是否立即生成 Rolling Summary。

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

Planner / Intent Router 在以下情况应产生该信号：

- 用户明确说“先不说这个”
- 用户切换到新模块 / 新项目 / 新文档
- activePlanId 变化
- activeArtifactId 变化
- 当前 Plan 完成后用户提出新目标
- 用户请求回到历史主题

---

## 12. Planner 不拥有 Summary，但提供摘要输入

Planner 不负责写 WorkingSummary、SessionMemory 或 Rolling Summary。

但 Planner 需要提供这些输入：

```ts
type PlannerSummarySignal = {
  decisionId: string
  sessionId: string
  userId: string

  intent: IntentRouterDecision["intent"]
  route: IntentRouterDecision["route"]

  topicShift?: TopicShiftSignal

  plannerStatePatch?: PlannerStatePatch

  summaryHints?: {
    currentUserGoal?: string
    keyDecision?: string
    unresolvedQuestion?: string
    planStatusChanged?: boolean
    artifactStatusChanged?: boolean
  }
}
```

这些信号交给：

```text
SessionMemoryManager
SummaryManager
RollingSummaryJob
```

由它们决定是否生成或更新摘要。

---

## 13. Planner 与 Summary / Memory 的最终边界

```text
Planner
  负责临时 Plan 生成、状态管理、推进决策，是 Plan 状态机 owner

SessionMemory
  负责当前会话状态投影，作为 Planner 输入

WorkingSummary
  负责当前 run 如何继续，由 Kernel/Subagent 触发生成

Rolling Summary
  负责最近 5~10 轮或 topic boundary 的摘要

Long-term Memory
  负责长期结构化记忆，不由 Planner 直接写
```

核心原则：

> Planner 不直接写 memory；Planner 只输出结构化状态 patch 和 summary signal。Memory / Summary 系统负责校验、合并、版本化和落库。


---

# 16. Foreground Conversation Agent 与 PlannerRun 升级

## 16.1 新定位

原 `Intent Router` 不再作为一个孤立模块暴露，而是成为 **Foreground Conversation Agent** 的内部能力之一。

原 `Planner` 升级为：

```text
Planner Agent Template
  + PlannerRunManager
  + PlanRuntime
```

其中：

```text
Foreground Conversation Agent
  负责前台会话、意图判断、直接委派、打断、状态查询、PlannerRun 创建

PlannerRun
  负责复杂任务的计划生成、计划更新、执行协调、重规划和 RuntimeAction 生成
```

## 16.2 ForegroundDecision

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
  suggestedRuntimeActions?: RuntimeAction[]
  targetRefs?: {
    plannerRunId?: string
    planId?: string
    backgroundRunId?: string
    workflowRunId?: string
    approvalId?: string
    artifactId?: string
  }
  userVisibleResponse?: string
  confidence: number
}
```

## 16.3 PlannerAgentTemplate

```ts
type PlannerAgentTemplate = {
  plannerTemplateId: string
  name:
    | "default_planner"
    | "travel_planner"
    | "communication_planner"
    | "workflow_planner"
    | "research_planner"

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
    allowWorkflowCompilation: boolean
  }
}
```

## 16.4 PlannerRun

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
    parentSessionId?: string
  }

  checkpointRef?: string
  lastPlanVersion?: number
  createdAt: string
  updatedAt: string
  completedAt?: string
}
```

## 16.5 直接委派与 Planner 创建规则

Foreground Conversation Agent 可以直接委派：

- 普通问答、解释、总结、改写。
- 简单读工具。
- 简单写工具，但必须经 Permission Engine。
- 单次前台 Subagent 任务。

必须创建 PlannerRun：

- 多步骤任务。
- 多工具域任务。
- 后台长任务。
- 需要持续重规划。
- 需要多个 agent 协同。
- 可能转成 Workflow。

## 16.6 PlannerRun 与 SessionMemory

SessionMemory 应新增 activePlannerRuns 投影，用于 Foreground Conversation Agent 判断用户是在延续旧任务、修改旧任务还是发起新任务。

PlannerRun 不直接写 SessionMemory，而是输出 PlannerStatePatch / PlannerSummarySignal，由 SessionMemoryManager / SummaryManager 合并。
