# Workflow Runtime 功能职责与输入输出文档 v3：可视化固化流程运行时（PlannerRun 对齐版）

## 1. 文档目的

本文档定义重构后的 **Workflow Runtime**。

本版将 Workflow Runtime 从原 Task / Workflow Runtime 中拆出，明确为：

> 与 Gateway 平行的结构化输入入口，负责用户在可视化界面中编排、保存、版本化和执行固化 Workflow。

---

## 2. 模块定位

Workflow Runtime 负责的是 **固化流程**，不是自然语言临时任务。

```text
Visual Workflow UI
  → Workflow Runtime
  → WorkflowDefinition
  → WorkflowRun
  → Runtime Dispatcher
```

---

## 3. 与 Gateway 的关系

| 模块 | 输入类型 | 主要职责 |
|---|---|---|
| Gateway | 自然语言、聊天、文件、外部渠道 | 会话输入入口 |
| Workflow Runtime | 可视化编排的结构化 Workflow | 固化流程入口 |

Workflow Runtime 与 Gateway 平行，但二者都可以向 Runtime Dispatcher 发送执行请求。

---

## 4. 与 Planner / Intent Router 的关系

| 对象 | 来源 | 负责模块 |
|---|---|---|
| ExecutionPlan | 自然语言临时生成 | Planner |
| WorkflowDraft | Plan 编译或可视化新建 | PlanToWorkflowCompiler / Workflow Runtime |
| WorkflowDefinition | 用户确认发布 | Workflow Runtime |
| WorkflowRun | Workflow 触发执行 | Workflow Runtime |

Planner 可以生成 WorkflowDraft，但不执行固化 Workflow。

---

## 5. 职责清单

## 5.1 应承担职责

### 5.1.1 WorkflowDefinition 管理

- 创建 WorkflowDefinition
- 编辑 WorkflowDefinition
- 发布 WorkflowDefinition
- 禁用 / 归档 WorkflowDefinition
- 版本化管理

### 5.1.2 WorkflowDraft 管理

- 接收可视化界面草稿
- 接收 PlanToWorkflowCompiler 输出
- 校验 WorkflowDraft
- 输出可视化编辑所需结构
- 将 approved draft 发布为 WorkflowDefinition

### 5.1.3 WorkflowRun 管理

- 创建 WorkflowRun
- 执行 WorkflowStep
- 管理 step 状态
- 处理等待、审批、失败、重试
- 记录 WorkflowRun 事件
- 输出 WorkflowRunResult

### 5.1.4 Step 编排

支持：

- agent_run
- subagent_run
- tool_call
- approval
- wait
- condition
- branch
- parallel
- notification
- artifact

### 5.1.5 Workflow 级恢复

- WorkflowRun checkpoint
- StepRun checkpoint
- 从 Event Store 回放
- 恢复等待状态
- 恢复 active step

### 5.1.6 Workflow 审计

记录：

- workflow_created
- workflow_published
- workflow_run_started
- workflow_step_started
- workflow_step_completed
- workflow_step_failed
- workflow_run_completed
- workflow_run_failed

---

## 5.2 不应承担职责

Workflow Runtime 不负责：

- 自然语言理解
- Intent Router
- 临时 Plan 动态重规划
- 子 Agent 内部 loop
- 工具执行细节
- 权限最终判断
- Gateway 渠道适配
- Event Trigger 匹配

---

## 6. 推荐子模块

```text
Workflow Runtime
  ├─ WorkflowDraftManager
  ├─ WorkflowRegistry
  ├─ WorkflowVersionManager
  ├─ WorkflowValidator
  ├─ WorkflowPublisher
  ├─ WorkflowRunManager
  ├─ WorkflowStepExecutor
  ├─ WorkflowCheckpointManager
  ├─ WorkflowRecoveryManager
  ├─ WorkflowEventEmitter
  ├─ WorkflowProjectionBuilder
  └─ WorkflowTemplateManager
```

---

## 7. 核心数据结构

## 7.1 WorkflowDraft

```ts
type WorkflowDraft = {
  workflowDraftId: string

  source: "visual_builder" | "plan_compiler"

  sourcePlan?: {
    planId: string
    version: number
  }

  ownerUserId: string

  name: string
  description?: string

  trigger?: WorkflowTrigger

  steps: WorkflowStepDraft[]

  defaultPolicy?: WorkflowExecutionPolicy

  missingFields?: Array<{
    field: string
    reason: string
    suggestedValue?: unknown
  }>

  validationIssues?: Array<{
    level: "warning" | "error"
    message: string
    stepId?: string
  }>

  status:
    | "draft"
    | "ready_for_review"
    | "approved"
    | "published"

  createdAt: string
  updatedAt: string
}
```

## 7.2 WorkflowDefinition

```ts
type WorkflowDefinition = {
  workflowId: string
  workflowVersion: number

  ownerUserId: string

  name: string
  description?: string

  status:
    | "draft"
    | "active"
    | "paused"
    | "disabled"
    | "archived"

  trigger?: WorkflowTrigger

  steps: WorkflowStep[]

  defaultPolicy: WorkflowExecutionPolicy

  createdFrom?: {
    workflowDraftId?: string
    sourcePlanId?: string
  }

  createdAt: string
  updatedAt: string
}
```

## 7.3 WorkflowTrigger

```ts
type WorkflowTrigger =
  | { type: "manual" }
  | {
      type: "schedule"
      schedule: {
        kind: "once" | "recurring"
        runAt?: string
        cron?: string
        timezone?: string
      }
    }
  | {
      type: "external_event"
      eventType: string
      source: "gateway" | "connector" | "mcp" | "webhook" | "system"
      filter?: Record<string, unknown>
    }
  | {
      type: "approval_resolved"
      approvalId?: string
    }
  | {
      type: "condition"
      condition: WorkflowCondition
      checkIntervalMs?: number
    }
```

## 7.4 WorkflowStepDraft

```ts
type WorkflowStepDraft = {
  draftStepId: string
  title: string
  stepType?:
    | "agent_run"
    | "subagent_run"
    | "tool_call"
    | "approval"
    | "wait"
    | "condition"
    | "branch"
    | "parallel"
    | "notification"
    | "artifact"

  config?: Record<string, unknown>

  missingFields?: string[]

  validationIssues?: Array<{
    level: "warning" | "error"
    message: string
  }>
}
```

## 7.5 WorkflowStep

```ts
type WorkflowStep = {
  stepId: string
  title: string
  description?: string

  stepType:
    | "agent_run"
    | "subagent_run"
    | "tool_call"
    | "approval"
    | "wait"
    | "condition"
    | "branch"
    | "parallel"
    | "notification"
    | "artifact"

  dependsOn?: string[]

  inputMapping?: Record<string, unknown>
  outputMapping?: Record<string, unknown>

  config: Record<string, unknown>

  retryPolicy?: RetryPolicy
  timeoutMs?: number
  permissionMode?: string

  onFailure?:
    | "fail_workflow"
    | "continue"
    | "retry"
    | "ask_user"
    | "fallback_step"

  fallbackStepId?: string
}
```

## 7.6 WorkflowRun

```ts
type WorkflowRun = {
  workflowRunId: string
  workflowId: string
  workflowVersion: number

  ownerUserId: string

  triggerEventId?: string

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
  completedStepIds: string[]
  failedStepIds?: string[]

  checkpointId?: string
  resultRef?: string

  startedAt?: string
  completedAt?: string
}
```

## 7.7 WorkflowStepRun

```ts
type WorkflowStepRun = {
  stepRunId: string
  workflowRunId: string
  stepId: string

  status:
    | "queued"
    | "running"
    | "waiting_for_user"
    | "waiting_for_approval"
    | "waiting_for_external_event"
    | "sleeping"
    | "completed"
    | "failed"
    | "cancelled"
    | "skipped"

  attemptIndex: number

  kernelRunId?: string
  subagentRunId?: string
  toolCallId?: string
  approvalId?: string
  artifactId?: string

  outputRef?: string
  checkpointId?: string

  startedAt?: string
  completedAt?: string
}
```

---

## 8. WorkflowStep 执行方式

## 8.1 agent_run

```text
Workflow Runtime
  → Runtime Dispatcher
  → Agent Kernel
```

## 8.2 subagent_run

```text
Workflow Runtime
  → Runtime Dispatcher
  → Subagent Runtime
```

## 8.3 tool_call

```text
Workflow Runtime
  → Runtime Dispatcher
  → Tool Plane
  → Permission Engine
```

## 8.4 approval

```text
Workflow Runtime
  → Permission / Approval Engine
  → waiting_for_approval
  → Event Trigger Runtime 唤醒
```

## 8.5 wait / condition

```text
Workflow Runtime
  → Event Trigger Runtime 注册等待条件
```

## 8.6 notification

```text
Workflow Runtime
  → Gateway / Notification Center
```

---

## 9. Workflow 输入输出

## 9.1 WorkflowDraftCreateRequest

```ts
type WorkflowDraftCreateRequest = {
  requestId: string
  ownerUserId: string
  source: "visual_builder" | "plan_compiler"
  sourcePlanId?: string
  name: string
  description?: string
  trigger?: WorkflowTrigger
  steps: WorkflowStepDraft[]
}
```

## 9.2 WorkflowPublishRequest

```ts
type WorkflowPublishRequest = {
  workflowDraftId: string
  ownerUserId: string
  publishMode: "new_workflow" | "new_version"
  targetWorkflowId?: string
}
```

## 9.3 WorkflowStartRequest

```ts
type WorkflowStartRequest = {
  workflowId: string
  workflowVersion?: number
  ownerUserId: string
  triggerEvent?: RuntimeTriggerEvent
  input?: Record<string, unknown>
  requestedBy: "user" | "event_trigger" | "workflow" | "system"
}
```

## 9.4 WorkflowRunResult

```ts
type WorkflowRunResult = {
  workflowRunId: string
  workflowId: string
  workflowVersion: number

  status:
    | "completed"
    | "partial_success"
    | "failed"
    | "cancelled"

  summary: string

  stepResults: Array<{
    stepId: string
    stepRunId: string
    status: string
    outputRef?: string
    summary?: string
  }>

  artifacts?: Array<{
    artifactId: string
    artifactType: string
  }>

  completedAt: string
}
```

---

## 10. 与其他模块关系

## 10.1 与 Gateway

- Gateway 负责自然语言输入。
- Workflow Runtime 负责可视化 Workflow 输入。
- Workflow Runtime 可通过 Gateway / Notification Center 向用户发送通知。
- 用户对 Workflow 审批、修改、取消的自然语言反馈仍经 Gateway 输入。

## 10.2 与 Planner

- Planner 负责临时 ExecutionPlan。
- Planner 可调用 PlanToWorkflowCompiler 生成 WorkflowDraft。
- 固化 Workflow 的发布和执行归 Workflow Runtime。

## 10.3 与 Event Trigger Runtime

- Workflow Runtime 注册 trigger。
- Event Trigger Runtime 触发 WorkflowRun。
- Approval resolved 事件由 Event Trigger Runtime 唤醒 WorkflowRun。

## 10.4 与 Subagent Runtime

- Workflow 的 `subagent_run` step 调用 Subagent Runtime。
- BackgroundSubagentRun 的生命周期由 Subagent Runtime 管。
- Workflow Runtime 只追踪 step 状态和 subagentRunId。

## 10.5 与 Tool Plane

- Workflow 的 `tool_call` step 通过 Tool Plane 执行。
- Workflow Runtime 不绕过工具 schema、权限、审计。

## 10.6 与 Permission Engine

- Workflow step 的高风险动作必须走 Permission Engine。
- Workflow 可以设置 default permission mode。
- Approval step 由 Permission Engine 生成审批请求。

---

## 11. 关键原则

1. Workflow Runtime 是可视化固化流程入口。
2. Workflow Runtime 与 Gateway 平行。
3. Workflow Runtime 不处理自然语言输入。
4. Workflow Runtime 不执行临时 Plan。
5. Workflow Runtime 不直接运行工具和模型，而是通过 Runtime Dispatcher。
6. WorkflowDefinition 必须版本化。
7. WorkflowRun 必须可恢复、可审计。
8. Plan 转 Workflow 必须先生成 WorkflowDraft，经用户确认后发布。


---

# 14. 与 Foreground Conversation Agent / PlannerRun 的关系

Foreground Conversation Agent 可以把用户的 workflow 相关自然语言请求路由为：

```text
workflow_request
  → spawn PlannerRun 或 handoff_workflow_runtime
```

PlannerRun 可以在用户确认后触发 PlanToWorkflowCompiler，生成 WorkflowDraft。

边界保持：

- PlannerRun 负责把临时 ExecutionPlan 编译成 WorkflowDraft。
- Workflow Runtime 负责 WorkflowDraft 校验、发布、版本化和 WorkflowRun 执行。
- Foreground Conversation Agent 负责向用户解释、确认、展示 WorkflowDraft 状态。
- 高风险 Workflow step 仍需 Permission Engine 审批。
