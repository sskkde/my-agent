# Planner Agent Template & PlannerRun 生命周期文档 v1

## 1. 文档目的

本文档定义个人助理型 Agent 平台中 **Planner Agent Template** 与 **PlannerRun** 的职责边界、生命周期、创建 / 复用 / 合并 / 取消 / 归档规则，以及它与 Foreground Conversation Agent、ExecutionPlan、Runtime Dispatcher、Subagent Runtime、Workflow Runtime、Memory / Summary System 的关系。

本版基于当前架构结论：

```text
Foreground Conversation Agent 常驻前台
Planner Agent Template 按需 fork / spawn PlannerRun
简单任务由 Foreground Agent 直接委派
复杂任务 / 长任务 / 后台任务 / 多 Agent 协同任务创建 PlannerRun
PlannerRun 负责计划与协调，不直接执行工具
```

---

## 2. 核心定位

### 2.1 Planner Agent Template

Planner Agent Template 是一种可复用的规划型 Agent 模板。

它定义：

- 规划能力范围
- 默认 prompt contract
- 可用工具 / 可委派 agent 类型
- 计划复杂度上限
- 重规划策略
- 并发与资源预算
- 与 Workflow 转换的能力边界

它不是一个长期全局常驻 Planner。

### 2.2 PlannerRun

PlannerRun 是由某个 Planner Agent Template 创建出来的**一次规划运行实例**。

它绑定一个具体目标，通常对应：

- 一个复杂临时任务
- 一个后台长任务
- 一个需要持续重规划的目标
- 一个可能转化为 Workflow 的计划
- 一个多 agent 协作任务

PlannerRun 的核心职责是：

```text
理解目标
生成 / 更新 ExecutionPlan
为 PlanStep 选择执行路径
输出 RuntimeAction
接收执行结果
重规划
向 Foreground Conversation Agent 暴露状态摘要
```

PlannerRun 不直接执行工具，不直接访问 Connector，不直接写长期 Memory，不直接管理 BackgroundSubagentRun 生命周期。

---

## 3. 为什么 Planner 需要模板化和实例化

个人助理平台会同时存在多个长期或后台目标：

```text
- 整理过去一个月邮件
- 准备明天会议资料
- 监控某个网站更新
- 规划出差行程
- 执行周期性文档整理
- 等待审批后继续修改日程
```

如果只有一个全局 Planner，会出现：

- 多任务上下文互相污染
- 计划状态混乱
- 单点瓶颈
- 难以独立取消 / 暂停 / 恢复
- 难以做任务级审计和 replay

因此推荐：

```text
PlannerAgentTemplate = 能力模板
PlannerRun = 每个复杂任务自己的计划实例
```

---

## 4. 与其他模块的关系

```text
Gateway
  → Foreground Conversation Agent
      ├─ 简单任务：直接生成 RuntimeAction
      └─ 复杂任务：spawn PlannerRun

PlannerRun
  → Plan Store / ExecutionPlan
  → Runtime Dispatcher
  → Agent Kernel / Subagent Runtime / Tool Plane / Workflow Runtime

Execution Result
  → Runtime Dispatcher / Event Store
  → PlannerRun 接收结果
  → PlanPatch / Replan
  → SummaryManager / SessionMemoryManager
```

### 4.1 与 Foreground Conversation Agent

Foreground Conversation Agent 负责：

- 判断是否需要 PlannerRun
- 创建 / 复用 / 查询 PlannerRun
- 向用户展示 PlannerRun 状态
- 接收用户对 PlannerRun 的打断、修改、取消
- 将用户新指令路由到对应 PlannerRun

PlannerRun 负责：

- 具体计划
- 执行协调
- 重规划
- 输出结构化下一步动作

### 4.2 与 Runtime Dispatcher

PlannerRun 不直接调用执行模块。

PlannerRun 只输出：

```text
RuntimeAction[]
PlanPatch
PlannerRunStatusUpdate
UserVisibleProgressSummary
```

所有结构化动作必须经 Runtime Dispatcher。

### 4.3 与 Subagent Runtime

PlannerRun 可以请求启动 foreground / background subagent，但不直接管理 SubagentRun / BackgroundSubagentRun 生命周期。

```text
PlannerRun
  → RuntimeAction: launch_subagent / launch_background_subagent
  → Runtime Dispatcher
  → Subagent Runtime
```

### 4.4 与 Workflow Runtime

PlannerRun 可以触发 PlanToWorkflowCompiler，生成 WorkflowDraft。

PlannerRun 不直接管理 WorkflowDefinition / WorkflowRun。

### 4.5 与 Memory / Summary System

PlannerRun 不直接写 SessionMemory 或 Long-term Memory。

它输出：

```text
PlannerStatePatch
PlannerSummarySignal
PlanPatch
```

由 SessionMemoryManager / SummaryManager 合并和落库。

---

## 5. PlannerAgentTemplate

```ts
type PlannerAgentTemplate = {
  plannerTemplateId: string

  name:
    | "default_planner"
    | "research_planner"
    | "communication_planner"
    | "calendar_planner"
    | "workflow_planner"
    | "automation_planner"

  description?: string

  supportedObjectives?: Array<
    | "general_complex_task"
    | "research"
    | "communication"
    | "schedule"
    | "document_work"
    | "workflow_creation"
    | "automation"
  >

  capabilities: {
    canCreatePlan: boolean
    canPatchPlan: boolean
    canAssignAgents: boolean
    canGenerateRuntimeActions: boolean
    canRequestApproval: boolean
    canLaunchSubagents: boolean
    canLaunchBackgroundRuns: boolean
    canCompileWorkflowDraft: boolean
  }

  defaultPolicy: PlannerRunPolicy

  promptContractRef: string
  toolProfileRef?: string
  allowedAgentTypes?: string[]

  createdAt: string
  updatedAt: string
}
```

---

## 6. PlannerRun

```ts
type PlannerRun = {
  plannerRunId: string
  plannerTemplateId: string

  userId: string
  sessionId?: string

  objective: string
  objectiveHash?: string

  status:
    | "initializing"
    | "planning"
    | "waiting_for_user"
    | "waiting_for_approval"
    | "waiting_for_execution_result"
    | "waiting_for_external_event"
    | "replanning"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled"
    | "archived"

  planId?: string
  planVersion?: number

  boundRefs?: {
    foregroundRunId?: string
    parentKernelRunId?: string
    backgroundRunId?: string
    workflowRunId?: string
    artifactId?: string
    approvalId?: string
  }

  activeExecutionRefs?: Array<{
    actionId: string
    targetRuntime: string
    targetRef?: string
    status: string
  }>

  checkpointRef?: string
  contextBundleRef?: string

  metrics?: {
    planStepCount?: number
    replanCount?: number
    dispatchedActionCount?: number
    spawnedSubagentCount?: number
    userClarificationCount?: number
  }

  createdAt: string
  updatedAt: string
  completedAt?: string
  archivedAt?: string
}
```

---

## 7. PlannerRunPolicy

```ts
type PlannerRunPolicy = {
  maxPlanSteps: number
  maxReplanCount: number
  maxSubagentFanout: number
  maxConcurrentActions: number

  allowBackgroundExecution: boolean
  allowWorkflowCompilation: boolean

  userInteractionPolicy: {
    askWhenObjectiveAmbiguous: boolean
    askBeforeHighRiskPlan: boolean
    askBeforeBackgroundExecution: boolean
    progressUpdateMode: "silent" | "brief" | "detailed"
  }

  executionPolicy: {
    defaultExecutionMode: "foreground" | "background" | "workflow_step"
    requireDispatcher: true
    requirePermissionPrecheck: true
  }

  timeoutPolicy: {
    planningTimeoutMs?: number
    idleTimeoutMs?: number
    maxLifetimeMs?: number
  }
}
```

---

## 8. 创建 PlannerRun 的条件

Foreground Conversation Agent 应根据 DirectDelegationPolicy 判断是否创建 PlannerRun。

### 8.1 必须创建 PlannerRun

满足任一条件时建议创建：

```text
- 预计步骤数 >= 3
- 涉及多个工具域，例如 Calendar + Email + Docs
- 需要长时间后台执行
- 需要等待外部事件或审批后继续
- 需要多 agent / subagent 协作
- 需要持续重规划
- 需要生成可复用 WorkflowDraft
- 用户明确要求“制定计划”“分步骤执行”“后台帮我做”
```

### 8.2 不应创建 PlannerRun

以下任务通常不创建：

```text
- 普通聊天
- 简单问答
- 简单总结 / 改写
- 单次只读查询
- 单个写动作且可一次审批完成
- 单个专业 subagent 可直接完成的任务
```

### 8.3 可选创建 PlannerRun

以下任务可根据用户偏好和复杂度判断：

```text
- 简单邮件起草
- 单次会议安排
- 单文档整理
- 小型调研
```

---

## 9. PlannerRun 创建请求

```ts
type PlannerRunCreateRequest = {
  requestId: string
  userId: string
  sessionId?: string

  source: {
    sourceModule: "foreground_conversation_agent" | "workflow_runtime" | "event_trigger" | "system"
    sourceRunId?: string
    sourceMessageId?: string
  }

  plannerTemplateId?: string

  objective: string

  initialContext: {
    foregroundDecisionId?: string
    sessionMemoryRef?: string
    activeWorkProjectionRef?: string
    attachmentRefs?: string[]
    artifactRefs?: string[]
    userConstraints?: string[]
  }

  spawnPolicy?: PlannerSpawnPolicy
  runPolicyOverrides?: Partial<PlannerRunPolicy>

  createdAt: string
}
```

---

## 10. PlannerSpawnPolicy

```ts
type PlannerSpawnPolicy = {
  maxConcurrentPlannerRunsPerUser: number
  maxConcurrentPlannerRunsPerSession: number

  mergeIfSameObjective: boolean
  mergeSimilarityThreshold?: number

  resumeExistingIfTargetRefsMatch: boolean

  requireUserConfirmationAboveComplexity?: "medium" | "high"

  defaultIdleTimeoutMs: number
  archiveAfterCompletedMs: number
}
```

推荐默认值：

```ts
const defaultPlannerSpawnPolicy: PlannerSpawnPolicy = {
  maxConcurrentPlannerRunsPerUser: 10,
  maxConcurrentPlannerRunsPerSession: 5,
  mergeIfSameObjective: true,
  mergeSimilarityThreshold: 0.86,
  resumeExistingIfTargetRefsMatch: true,
  requireUserConfirmationAboveComplexity: "high",
  defaultIdleTimeoutMs: 30 * 60 * 1000,
  archiveAfterCompletedMs: 7 * 24 * 60 * 60 * 1000
}
```

---

## 11. PlannerRun 生命周期

```text
initializing
  ↓
planning
  ├─ waiting_for_user
  ├─ waiting_for_approval
  ├─ waiting_for_execution_result
  ├─ waiting_for_external_event
  ├─ replanning
  ├─ paused
  ├─ completed
  ├─ failed
  └─ cancelled
        ↓
      archived
```

### 11.1 initializing

创建 PlannerRun，装载初始上下文，选择 PlannerAgentTemplate。

进入条件：

```text
Foreground Conversation Agent 决定 spawn_planner
Workflow Runtime 请求 planning step
Event Trigger Runtime 恢复某个计划目标
```

输出：

```text
planner_run_created event
PlannerRun status = initializing
```

### 11.2 planning

PlannerRun 生成初始 ExecutionPlan 或 PlanPatch。

输出：

```text
ExecutionPlan
PlanPatch
RuntimeAction[]
UserVisiblePlanSummary
```

### 11.3 waiting_for_user

目标不明确、缺少关键参数、需要用户选择策略时进入。

要求：

```text
Foreground Conversation Agent 负责向用户提问
PlannerRun 只记录等待状态和问题
```

### 11.4 waiting_for_approval

某个计划动作需要审批时进入。

要求：

```text
Permission Engine 创建 ApprovalRequest
Gateway / Notification Center 渲染给用户
Event Trigger Runtime 在 approval_resolved 后唤醒
```

### 11.5 waiting_for_execution_result

PlannerRun 已派发 RuntimeAction，等待执行模块返回结果。

可能等待：

```text
KernelRunResult
ToolExecutionResult
BackgroundSubagentRun result
WorkflowStepRun result
```

### 11.6 waiting_for_external_event

计划需要等待外部状态，例如文件生成、服务启动、定时触发。

等待条件由 Event Trigger Runtime 管理。

### 11.7 replanning

执行结果导致计划需要调整时进入。

触发条件：

```text
- tool failed but recoverable
- subagent partial_success
- user changed objective
- approval rejected
- external event payload changed assumption
- plan step output differs from expected
```

### 11.8 paused

用户或系统暂停 PlannerRun。

暂停后：

```text
不再派发新 RuntimeAction
保留 checkpoint
允许继续接收状态查询
```

### 11.9 completed

Plan 目标完成。

要求：

```text
生成 planner_run_summary
提交 PlannerStatePatch
通知 Foreground Conversation Agent
必要时触发 SessionMemory 更新
```

### 11.10 failed

PlannerRun 无法继续，且不可自动恢复。

要求：

```text
记录 failure reason
生成用户可见摘要
保留 checkpoint / event range
```

### 11.11 cancelled

用户或系统取消。

要求：

```text
尝试取消 activeExecutionRefs
记录 cancellation reason
生成 terminal event
必要时生成 synthetic result
```

### 11.12 archived

完成、失败或取消后的历史归档状态。

归档后：

```text
默认不可继续执行
可被 replay / recall / summary 检索
```

---

## 12. PlannerRun 状态转移表

| 当前状态 | 事件 | 下一个状态 | 说明 |
|---|---|---|---|
| initializing | context_ready | planning | 初始上下文装载完成 |
| planning | plan_created | waiting_for_execution_result | 已派发执行动作 |
| planning | need_user_input | waiting_for_user | 缺少用户信息 |
| planning | approval_required | waiting_for_approval | 计划或动作需要审批 |
| waiting_for_user | user_replied | planning | 用户补充信息 |
| waiting_for_approval | approval_approved | planning | 继续计划或派发动作 |
| waiting_for_approval | approval_rejected | replanning | 尝试绕开被拒动作或结束 |
| waiting_for_execution_result | result_received_success | planning / completed | 继续下一步或完成 |
| waiting_for_execution_result | result_received_failure | replanning / failed | 视可恢复性决定 |
| waiting_for_external_event | runtime_trigger_event | planning | 外部条件满足 |
| replanning | replan_success | waiting_for_execution_result / completed | 新计划成功 |
| replanning | max_replan_reached | failed | 超出重规划次数 |
| any active | user_pause | paused | 用户暂停 |
| paused | user_resume | planning | 用户恢复 |
| any active | user_cancel | cancelled | 用户取消 |
| completed / failed / cancelled | archive_due | archived | 自动归档 |

---

## 13. PlannerRun 复用与合并

### 13.1 复用已有 PlannerRun

Foreground Conversation Agent 在创建前应先查询 ActiveWorkProjection。

复用条件：

```text
- 用户新消息明确引用已有任务
- targetRefs 匹配已有 plannerRunId / planId / backgroundRunId
- objectiveHash 高度相似
- 任务状态仍为 active / paused / waiting
```

### 13.2 合并 PlannerRun

如果新目标和已有 PlannerRun 高度重叠，可合并：

```ts
type PlannerRunMergeRequest = {
  sourcePlannerRunId: string
  targetPlannerRunId: string
  mergeReason:
    | "same_objective"
    | "user_requested"
    | "duplicate_spawn"
    | "overlapping_plan"

  mergePolicy: {
    preserveSourceEvents: boolean
    mergeOpenQuestions: boolean
    mergePendingApprovals: boolean
    cancelSourceAfterMerge: boolean
  }
}
```

合并要求：

```text
不能丢失 Event Store 记录
不能丢失 ApprovalRequest
不能合并不兼容的 permission scope
必须生成 planner_run_merged event
```

---

## 14. PlannerRun 输出

```ts
type PlannerRunResult = {
  plannerRunId: string
  planId?: string

  status:
    | "plan_created"
    | "plan_updated"
    | "actions_dispatched"
    | "waiting_for_user"
    | "waiting_for_approval"
    | "waiting_for_execution_result"
    | "completed"
    | "failed"
    | "cancelled"

  planPatch?: PlanPatch

  runtimeActions?: RuntimeAction[]

  userVisibleSummary?: string

  foregroundUpdate?: {
    message?: string
    progressSummary?: string
    suggestedUserActions?: string[]
  }

  plannerStatePatch?: PlannerStatePatch

  checkpointRef?: string
}
```

---

## 15. PlannerRun 与 ExecutionPlan 的 ownership

必须明确：

```text
PlannerRun 是规划运行实例。
ExecutionPlan 是计划状态对象。
Plan Store 是计划权威存储。
```

推荐边界：

```text
PlannerRun owns planning process
Plan Store owns plan state
SessionMemory owns session projection
Foreground Conversation Agent owns user-facing dialogue state
```

PlannerRun 可以输出 PlanPatch，但 PlanPatch 的应用应由 PlanRuntime / PlanStore 管理。

---

## 16. PlannerRun 与 Foreground Conversation Agent 的交互

### 16.1 创建后即时响应

Foreground Conversation Agent 创建 PlannerRun 后，应尽快向用户返回：

```text
我已开始规划这个任务。
接下来会先拆分步骤，并在需要你确认时提醒你。
```

不应等待 PlannerRun 完成全部规划才回复。

### 16.2 查询状态

用户问“现在做到哪了”时：

```text
Foreground Agent
  → ActiveWorkProjection
  → PlannerRun / BackgroundRun / WorkflowRun summary
  → 用户可见进度
```

### 16.3 修改目标

用户说“先不要订酒店，先整理会议资料”时：

```text
Foreground Agent
  → 定位 PlannerRun
  → PlannerRunPatchRequest
  → PlannerRun replanning
```

---

## 17. PlannerRun 事件

推荐事件：

```text
planner_run_created
planner_run_started
planner_plan_created
planner_plan_patched
planner_action_dispatched
planner_waiting_for_user
planner_waiting_for_approval
planner_execution_result_received
planner_replanning_started
planner_replanning_completed
planner_run_paused
planner_run_resumed
planner_run_completed
planner_run_failed
planner_run_cancelled
planner_run_archived
planner_run_merged
```

---

## 18. PlannerRun 审计要求

以下动作必须审计：

```text
- 创建 PlannerRun
- 派发 RuntimeAction
- 申请审批
- 修改 Plan
- 启动 BackgroundSubagentRun
- 编译 WorkflowDraft
- 合并 / 取消 PlannerRun
- 用户修改目标
```

---

## 19. MVP 实现建议

MVP 中 PlannerRun 可以简化为：

```text
- 只支持 default_planner
- 只支持单层 PlannerRun，不支持 PlannerRun 嵌套
- 只支持 plan create / patch / dispatch / replan
- 最多并发 3 个 PlannerRun / session
- 不支持复杂 merge，只支持 resume existing 或 create new
- 失败恢复只支持从 checkpoint 重试
```

不建议 MVP 一开始实现：

```text
- 多模板自动选择
- 多 Planner 协作
- PlannerRun tree
- 高级合并策略
- 自动 workflow optimization
```

---

## 20. 关键结论

```text
1. Planner 不应是单个全局常驻 Agent。
2. Planner 应是 Agent Template，可以按任务创建 PlannerRun。
3. Foreground Conversation Agent 负责判断是否创建 PlannerRun。
4. PlannerRun 负责计划与协调，不直接执行工具。
5. PlannerRun 输出 RuntimeAction，通过 Dispatcher 执行。
6. Plan Store 是计划状态权威来源。
7. 多 PlannerRun 并发需要 ActiveWorkProjection 汇总给前台。
8. PlannerRun 完成后归档，保留 summary / transcript / event 以供 recall 和 replay。
```
