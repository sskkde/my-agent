# 全局状态机与生命周期文档 v1

## 1. 文档目的

本文档定义个人助理型 Agent 平台中主要运行对象的生命周期、状态机、状态映射关系以及跨模块等待 / 恢复 / 完成 / 失败的统一语义。

覆盖对象：

```text
ForegroundConversationRun
PlannerRun
ExecutionPlan
RuntimeAction
KernelRun
ToolCall / ToolExecution
SubagentRun
BackgroundSubagentRun
WorkflowRun
WorkflowStepRun
ApprovalRequest
WaitCondition
RuntimeTriggerEvent
Summary / Memory lifecycle
```

---

## 2. 全局生命周期分层

系统中运行状态可以分为五层：

```text
L1 前台会话层
  ForegroundConversationRun / Turn

L2 计划协调层
  PlannerRun / ExecutionPlan / PlanStep

L3 执行运行层
  KernelRun / SubagentRun / BackgroundSubagentRun / WorkflowRun / WorkflowStepRun / ToolExecution

L4 等待与恢复层
  ApprovalRequest / WaitCondition / RuntimeTriggerEvent

L5 历史沉淀层
  Event / Transcript / Summary / Memory / Artifact
```

核心原则：

```text
前台不等待长任务完成。
计划层不直接执行动作。
执行层通过 Dispatcher 统一进入。
等待层统一事件化唤醒。
历史层只记录事实、摘要和可恢复投影。
```

---

## 3. 全局状态语义

### 3.1 Active 状态

```text
queued
initializing
planning
running
executing
replanning
recovering
```

表示对象正在推进中。

### 3.2 Waiting 状态

```text
waiting_for_user
waiting_for_approval
waiting_for_execution_result
waiting_for_external_event
sleeping
paused
```

表示对象没有结束，但暂时不能继续。

### 3.3 Terminal 状态

```text
completed
partial_success
failed
cancelled
timeout
expired
archived
```

表示当前对象生命周期已结束，除非通过 replay / recovery 创建新 run。

---

## 4. ForegroundConversationRun 生命周期

ForegroundConversationRun 是前台对话处理的一轮智能运行，不应长时间阻塞。

```text
received
  ↓
hydrating
  ↓
classifying
  ↓
deciding
  ├─ responding
  ├─ direct_delegating
  ├─ spawning_planner
  ├─ querying_status
  ├─ handling_approval
  └─ handling_interrupt
  ↓
completed / failed
```

### 状态定义

| 状态 | 含义 |
|---|---|
| received | Gateway 接收到用户输入 |
| hydrating | 装载 SessionMemory / ActiveWorkProjection / Persona |
| classifying | 判断意图、目标、是否引用已有任务 |
| deciding | 选择直接回答、直接委派、spawn Planner、状态查询等 |
| responding | 生成用户可见文本 |
| direct_delegating | 生成 RuntimeAction 并交给 Dispatcher |
| spawning_planner | 创建 PlannerRun |
| querying_status | 查询 PlannerRun / WorkflowRun / BackgroundRun |
| handling_approval | 处理审批回复 |
| handling_interrupt | 处理暂停、取消、修改 |
| completed | 前台本轮完成 |
| failed | 前台处理失败 |

### 关键约束

```text
ForegroundConversationRun 不等待后台任务整体完成。
如果任务耗时，应返回已开始 / 进度 / 等待确认等前台响应。
```

---

## 5. PlannerRun 生命周期

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

### 状态映射

| PlannerRun 状态 | 可能对应的下游状态 |
|---|---|
| waiting_for_execution_result | KernelRun running / ToolExecution running / BackgroundSubagentRun running |
| waiting_for_approval | ApprovalRequest pending |
| waiting_for_external_event | WaitCondition active |
| replanning | 收到失败 / 用户修改 / 审批拒绝后的重新规划 |
| completed | 所有目标完成，Plan completed |
| cancelled | 用户或系统取消，级联取消下游可取消任务 |

---

## 6. ExecutionPlan 生命周期

ExecutionPlan 是计划状态对象，权威状态应在 Plan Store。

```text
draft
  ↓
approved
  ↓
in_execution
  ├─ blocked
  ├─ waiting_for_user
  ├─ waiting_for_approval
  ├─ replanning
  ├─ completed
  ├─ failed
  └─ abandoned
```

### PlanStep 状态

```ts
type PlanStepStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "waiting_for_external_event"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
```

### Plan 与 PlannerRun 关系

```text
PlannerRun owns planning process
ExecutionPlan owns task state
PlanStep owns step state
RuntimeAction owns execution dispatch
```

---

## 7. RuntimeAction 生命周期

RuntimeAction 是所有结构化动作的统一分发对象。

```text
created
  ↓
validated
  ↓
accepted / duplicate / denied
  ↓
queued / dispatching
  ↓
waiting_for_approval / waiting_for_target / completed / failed / timeout / cancelled
```

### 状态定义

| 状态 | 含义 |
|---|---|
| created | Planner / Foreground / Trigger / Workflow 创建 action |
| validated | schema / targetRuntime / policy 校验通过 |
| duplicate | 幂等检查发现重复 |
| denied | 权限预检查拒绝 |
| accepted | Dispatcher 接受 |
| queued | 等待执行资源 |
| dispatching | 调用目标 Runtime |
| waiting_for_approval | 权限需要用户审批 |
| waiting_for_target | 目标 Runtime 异步执行 |
| completed | 目标 Runtime 返回成功 |
| failed | 分发失败或目标失败 |
| timeout | 分发超时 |
| cancelled | 分发前或分发中被取消 |

---

## 8. KernelRun 生命周期

KernelRun 是单次 Agent Loop。

```text
initializing
  ↓
building_context
  ↓
building_model_input
  ↓
sampling_model
  ↓
parsing_model_output
  ├─ dispatching_tools
  ├─ launching_subagent
  ├─ waiting_for_approval
  ├─ waiting_for_user
  ├─ checking_compact
  ├─ compacting
  ├─ completed
  ├─ failed
  └─ cancelled
```

### 关键终态

```text
completed
waiting_for_user
waiting_for_approval
waiting_for_external_event
interrupted
failed
cancelled
partial_success
max_iterations_reached
```

### 与 ToolExecution 的关系

KernelRun 如果接受了 tool_use，必须保证每个 tool_use 都有 terminal tool_result，包括 synthetic terminal result。

---

## 9. ToolExecution 生命周期

```text
received
  ↓
schema_validating
  ↓
permission_checking
  ├─ waiting_for_approval
  ├─ denied
  └─ executing
        ↓
      mapping_result
        ↓
      completed / failed / timeout / cancelled / aborted / discarded
```

### Tool terminal states

```text
completed
failed
denied
aborted
cancelled
discarded
timeout
```

### 规则

```text
任何已进入 executing 或被 Kernel 接受的 tool call，都必须生成终态。
大结果必须生成 persistedResultRef 或 artifactRef。
```

---

## 10. SubagentRun 生命周期

同步 SubagentRun：

```text
created
  ↓
context_isolated
  ↓
running
  ├─ waiting_for_user
  ├─ waiting_for_approval
  ├─ waiting_for_external_event
  ├─ completed
  ├─ failed
  └─ cancelled
```

### 特点

```text
SubagentRun 通常由 Kernel / PlannerRun / WorkflowStep 创建。
SubagentRun 可以拥有自己的 KernelRun。
SubagentRun 结束后返回 SubagentResult。
```

---

## 11. BackgroundSubagentRun 生命周期

```text
queued
  ↓
running
  ├─ waiting_for_user
  ├─ waiting_for_approval
  ├─ waiting_for_external_event
  ├─ sleeping
  ├─ recovering
  ├─ completed
  ├─ failed
  ├─ cancelled
  └─ expired
```

### 状态说明

| 状态 | 含义 |
|---|---|
| queued | 已创建，等待执行 |
| running | 后台执行中 |
| waiting_for_user | 需要用户补充输入 |
| waiting_for_approval | 需要审批 |
| waiting_for_external_event | 等待 WaitCondition / Trigger |
| sleeping | 定时等待或主动休眠 |
| recovering | checkpoint 恢复中 |
| completed | 完成 |
| failed | 失败 |
| cancelled | 取消 |
| expired | 超过保留或最大生命周期 |

### 与 PlannerRun 的关系

```text
PlannerRun waiting_for_execution_result
  ↔ BackgroundSubagentRun running / waiting / completed / failed
```

---

## 12. WorkflowRun 生命周期

```text
queued
  ↓
running
  ├─ waiting_for_user
  ├─ waiting_for_approval
  ├─ waiting_for_external_event
  ├─ sleeping
  ├─ paused
  ├─ completed
  ├─ failed
  ├─ cancelled
  └─ timeout
```

WorkflowRun 是固化流程运行实例，由 Workflow Runtime owner。

---

## 13. WorkflowStepRun 生命周期

```text
queued
  ↓
running
  ├─ waiting_for_user
  ├─ waiting_for_approval
  ├─ waiting_for_external_event
  ├─ sleeping
  ├─ completed
  ├─ failed
  ├─ cancelled
  └─ skipped
```

### Step type 与目标 runtime

| stepType | 目标 runtime |
|---|---|
| agent_run | Agent Kernel |
| subagent_run | Subagent Runtime |
| tool_call | Tool Plane |
| approval | Permission / Approval Engine |
| wait | Event Trigger Runtime |
| condition | Event Trigger Runtime |
| notification | Gateway / Notification Center |
| branch / parallel | Workflow Runtime 内部编排 |

---

## 14. ApprovalRequest 生命周期

```text
pending
  ├─ approved
  ├─ rejected
  ├─ expired
  └─ cancelled
```

### 唤醒流程

```text
ApprovalRequest pending
  → 用户响应
  → Gateway 接收 approval_response
  → Permission Engine 记录结果
  → Event Trigger Runtime 生成 approval_resolved event
  → Runtime Dispatcher resume target
```

### 规则

```text
ApprovalRequest 不能直接恢复执行。
必须通过 Event Trigger Runtime / Runtime Dispatcher 唤醒目标 runtime。
```

---

## 15. WaitCondition 生命周期

```text
registered
  ↓
active
  ├─ satisfied
  ├─ failed
  ├─ timeout
  └─ cancelled
```

### 对应等待目标

```text
WorkflowStepRun waiting_for_external_event
BackgroundSubagentRun waiting_for_external_event
KernelRun waiting_for_external_event
PlannerRun waiting_for_external_event
```

### 规则

```text
WaitCondition 不执行外部动作，只监听外部状态。
外部动作由 Tool Plane / Subagent Runtime / Workflow Runtime 发起。
```

---

## 16. RuntimeTriggerEvent 生命周期

```text
created
  ↓
matched
  ↓
action_created
  ↓
dispatched
  ↓
handled / failed / duplicate
```

RuntimeTriggerEvent 代表触发事实，RuntimeAction 代表后续动作。

---

## 17. Summary 生命周期

SummaryRecord 状态建议：

```text
candidate
  ↓
validated
  ↓
active
  ├─ superseded
  ├─ archived
  └─ expired
```

### 类型

```text
working_summary
session_memory
rolling_5_turns
rolling_10_turns
daily_summary
weekly_summary
workflow_run_summary
background_subagent_summary
compact_summary
```

---

## 18. Long-term Memory 生命周期

```text
candidate
  ↓
validated
  ↓
active
  ├─ low_priority
  ├─ compressed
  ├─ archived
  ├─ expired
  └─ deleted
```

### 删除规则

用户明确删除时：

```text
deleted + tombstone + index purge
```

---

## 19. 跨对象状态映射

### 19.1 后台任务链路

```text
ForegroundConversationRun completed
PlannerRun waiting_for_execution_result
BackgroundSubagentRun running
ToolExecution running
```

用户前台已收到响应，但后台仍在执行。

### 19.2 审批等待链路

```text
ToolExecution waiting_for_approval
Permission ApprovalRequest pending
KernelRun waiting_for_approval
PlannerRun waiting_for_approval
ForegroundConversationRun completed
```

用户下一次响应审批后：

```text
ApprovalRequest approved
RuntimeTriggerEvent approval_resolved
RuntimeAction resume_agent_run / resume_planner_run
KernelRun / PlannerRun running
```

### 19.3 外部事件等待链路

```text
WorkflowStepRun waiting_for_external_event
WaitCondition active
RuntimeTriggerEvent operation_completed
RuntimeAction resume_workflow_step
WorkflowStepRun running
```

### 19.4 用户取消链路

```text
ForegroundConversationRun handling_interrupt
RuntimeAction cancel_target
PlannerRun cancelled
BackgroundSubagentRun cancelled
ToolExecution cancelled / synthetic terminal result
PlanStep cancelled
Transcript committed
Summary updated
```

---

## 20. 状态持久化规则

| 对象 | 是否持久化 | Owner Store |
|---|---|---|
| ForegroundConversationRun | 可选，至少事件化 | Event / Transcript |
| PlannerRun | 是 | PlannerRun Store / Event Store |
| ExecutionPlan | 是 | Plan Store |
| RuntimeAction | 是 | RuntimeAction Store / Event Store |
| KernelRun | 是 | Run Store / Event Store |
| ToolExecution | 是 | Tool Result Store / Event Store |
| SubagentRun | 是 | SubagentRun Store |
| BackgroundSubagentRun | 是 | BackgroundRun Store |
| WorkflowRun | 是 | WorkflowRun Store |
| ApprovalRequest | 是 | Approval Store |
| WaitCondition | 是 | Trigger / Wait Store |
| SummaryRecord | 是 | Summary Store |
| MemoryRecord | 是 | Long-term Memory Store |

---

## 21. 统一状态事件命名

推荐事件命名：

```text
<object>_created
<object>_started
<object>_status_changed
<object>_waiting
<object>_resumed
<object>_completed
<object>_failed
<object>_cancelled
<object>_archived
```

例如：

```text
planner_run_created
planner_run_status_changed
background_subagent_run_waiting
workflow_step_run_completed
approval_request_approved
wait_condition_timeout
```

---

## 22. MVP 实现建议

MVP 只需要强制统一以下状态：

```text
queued
running
waiting_for_user
waiting_for_approval
waiting_for_external_event
completed
failed
cancelled
```

复杂状态如 `sleeping`、`recovering`、`partial_success`、`archived` 可以先作为扩展状态。

---

## 23. 关键结论

```text
1. 前台状态和后台状态必须分离。
2. PlannerRun 是计划执行协调状态，不是实际工具执行状态。
3. RuntimeAction 是跨模块执行请求的统一状态对象。
4. Approval 和 WaitCondition 都通过 Event Trigger Runtime 唤醒目标。
5. 每个被接受的工具调用必须有终态。
6. 所有 terminal state 都应提交 Transcript / Event，并按需触发 Summary。
7. 全局状态机的目标不是统一所有细节，而是统一等待、恢复、取消、失败和完成的语义。
```
