# End-to-End Runtime Flows v1

> 适用范围：个人助理型 Agent 平台架构定义阶段  
> 更新时间：2026-04-26  
> 对齐版本：Foreground Conversation Agent 常驻 + Planner Agent Template 按需 fork + Runtime Dispatcher 统一分发

---

## 1. 文档目的

本文档从端到端链路角度串联各模块，定义用户请求、工具调用、复杂计划、后台任务、Workflow、事件触发、审批恢复等典型场景的完整运行流程。

本文件不是新增模块设计，而是回答：

```text
一个请求从哪里进来？
经过哪些模块？
生成哪些对象？
谁负责执行？
谁负责记录？
谁负责通知用户？
失败时如何恢复？
```

---

## 2. 全局运行原则

### 2.1 三类入口

```text
1. 自然语言 / 用户渠道入口
   Gateway → Foreground Conversation Agent

2. 可视化固化流程入口
   Workflow UI → Workflow Runtime

3. 时间 / 外部事件 / 审批入口
   Event Trigger Runtime → Runtime Dispatcher
```

### 2.2 三类执行路径

```text
1. 简单任务：Foreground Conversation Agent 直接回答或直接委派
2. 复杂任务：Foreground Conversation Agent spawn PlannerRun
3. 固化流程：Workflow Runtime 创建 WorkflowRun 并编排 step
```

### 2.3 统一分发原则

跨 Runtime 的结构化动作统一走：

```text
RuntimeAction → Runtime Dispatcher → Target Runtime
```

不得出现以下绕路：

```text
Foreground Agent 直接调用 Tool Plane
PlannerRun 直接调用 Connector
WorkflowStep 直接调用 Subagent 实例
Event Trigger Runtime 直接恢复 Kernel 内部状态
```

### 2.4 记录原则

| 记录类型 | 负责模块 | 记录内容 |
|---|---|---|
| Event Store | 各模块 Event Emitter | 事实事件、状态变化、触发、执行 |
| Transcript Store | Gateway / Kernel / Transcript Committer | 用户可读对话与运行摘要 |
| Summary Store | SummaryManager | WorkingSummary、SessionMemory、Rolling Summary |
| Audit Store | Permission / Tool / Dispatcher / Connector | 权限、审批、外部副作用、敏感访问 |
| Trace Store | Observability | 调用链、延迟、错误、token、成本 |

---

## 3. 通用对象创建顺序

一次自然语言请求的常见对象创建顺序：

```text
InboundEnvelope
  → ForegroundConversationRun
  → ForegroundDecision
  → RuntimeAction? / PlannerRun?
  → DispatchRequest / DispatchResult?
  → KernelRun / ToolCall / SubagentRun / WorkflowRun?
  → OutboundEnvelope
  → Turn Transcript
  → SessionMemoryPatch / WorkingSummary?
```

并不是每条链路都会创建全部对象。

---

# 4. Flow 1：普通聊天 / 问答链路

## 4.1 适用场景

```text
- 普通对话
- 概念解释
- 简单建议
- 不需要外部工具
- 不需要 Planner
- 不需要后台执行
```

示例：

```text
用户：解释一下 Foreground Conversation Agent 和 PlannerRun 的区别。
```

## 4.2 流程

```text
User Message
  ↓
Gateway
  ↓
InboundEnvelope
  ↓
HydratedSessionState
  ↓
Foreground Conversation Agent
  ↓
ForegroundDecision(route = answer_directly)
  ↓
User-visible response
  ↓
Gateway OutboundEnvelope
  ↓
Transcript Store
  ↓
SessionMemory lightweight patch
```

## 4.3 模块职责

| 步骤 | 模块 | 职责 |
|---|---|---|
| 接收输入 | Gateway | 渠道接入、归一化、身份恢复 |
| 会话装载 | Gateway / Context Manager | 装载 SessionMemory、Persona、最近历史 |
| 前台判断 | Foreground Conversation Agent | 判断无需工具和 Planner |
| 生成回答 | Foreground Conversation Agent | 直接回答，遵循 persona 与系统约束 |
| 输出 | Gateway | 发送到用户渠道 |
| 记录 | Transcript Store / Event Store | 记录 turn 与事件 |

## 4.4 创建对象

```text
InboundEnvelope
ForegroundConversationRun
ForegroundDecision
OutboundEnvelope
Turn
TranscriptRecord
SessionMemoryPatch
```

## 4.5 不创建对象

```text
PlannerRun
ExecutionPlan
RuntimeAction
KernelRun
ToolCall
BackgroundSubagentRun
WorkflowRun
```

## 4.6 失败与恢复

| 失败点 | 处理方式 |
|---|---|
| Persona / SessionMemory 装载失败 | 使用最小上下文继续，记录 degraded_context |
| Foreground Agent 输出失败 | 返回简短错误并记录 failed run |
| Transcript 写入失败 | 不阻塞用户输出，但记录 retry job |

---

# 5. Flow 2：简单读工具任务链路

## 5.1 适用场景

```text
- 用户请求明确
- 步骤少
- 只需要一个或少数只读工具
- 无需复杂计划
```

示例：

```text
用户：查一下我明天上午有没有会议。
```

## 5.2 流程

```text
User Message
  ↓
Gateway
  ↓
Foreground Conversation Agent
  ↓
ForegroundDecision(route = dispatch_tool, requiresPlanner = false)
  ↓
RuntimeAction(actionType = execute_tool, targetRuntime = tool_plane)
  ↓
Runtime Dispatcher
  ↓
Permission precheck(read allowed)
  ↓
Tool Plane
  ↓
Connector Runtime / Calendar
  ↓
ToolExecutionResult
  ↓
RuntimeContextDelta
  ↓
Foreground Conversation Agent or Kernel result summarizer
  ↓
Gateway response
  ↓
Transcript / Event / Summary
```

## 5.3 模块职责

| 模块 | 职责 |
|---|---|
| Foreground Conversation Agent | 判断这是简单读任务，生成 RuntimeAction |
| Runtime Dispatcher | 幂等、权限预检查、路由到 Tool Plane |
| Tool Plane | 工具校验、执行、结果标准化 |
| Connector Runtime | 访问 Calendar API / 外部系统 |
| Context Manager | 将工具结果转为可见上下文或摘要 |
| Gateway | 输出结果 |

## 5.4 创建对象

```text
InboundEnvelope
ForegroundConversationRun
ForegroundDecision
RuntimeAction
DispatchRequest
DispatchResult
ToolCall
ToolExecutionResult
RuntimeContextDelta
OutboundEnvelope
Turn
TranscriptRecord
```

## 5.5 权限策略

```text
read/search 类工具默认可在 ask_on_write 模式下自动执行。
如果读取敏感资源，Permission Engine 可升级为 ask。
```

## 5.6 失败与恢复

| 失败点 | 处理方式 |
|---|---|
| Connector 未授权 | ToolResult = auth_required，Foreground Agent 引导用户授权 |
| Calendar API 超时 | ToolResult = timeout，用户可重试 |
| 返回结果过大 | Tool Plane 生成 summary + persistedResultRef |
| Dispatcher 重复请求 | 幂等返回 previous result |

---

# 6. Flow 3：简单写工具 / 直接委派链路

## 6.1 适用场景

```text
- 任务简单
- 可能产生外部副作用
- 不需要 Planner
- 需要权限审批或创建草稿
```

示例：

```text
用户：帮我给张三起草一封邮件，说明我明天下午可以开会。
```

如果只是起草草稿，风险较低。若直接发送，则需要审批。

## 6.2 流程：创建草稿

```text
User Message
  ↓
Gateway
  ↓
Foreground Conversation Agent
  ↓
ForegroundDecision(route = dispatch_tool)
  ↓
RuntimeAction(execute_tool: email.create_draft)
  ↓
Runtime Dispatcher
  ↓
Permission precheck
  ↓
Tool Plane
  ↓
Connector Runtime / Email
  ↓
ToolExecutionResult(artifact/draft ref)
  ↓
Gateway response: 草稿已创建 / 展示草稿摘要
  ↓
Transcript / Audit / Event
```

## 6.3 流程：直接发送邮件

```text
User Message
  ↓
Foreground Conversation Agent
  ↓
RuntimeAction(execute_tool: email.send)
  ↓
Runtime Dispatcher
  ↓
Permission Engine returns ask
  ↓
ApprovalRequest
  ↓
Gateway Approval Card
  ↓
User approval_response
  ↓
Gateway
  ↓
Event Trigger Runtime / Approval Handler
  ↓
Runtime Dispatcher resume
  ↓
Tool Plane executes email.send
  ↓
AuditRecord(external_write)
  ↓
User notification
```

## 6.4 创建对象

```text
ForegroundDecision
RuntimeAction
DispatchResult(waiting_for_approval?)
PermissionDecision
ApprovalRequest?
ToolExecutionResult
AuditRecord
TranscriptRecord
```

## 6.5 关键边界

```text
Foreground Conversation Agent 可以直接委派简单写任务，
但不能绕过 Runtime Dispatcher / Permission Engine / Tool Plane。
```

## 6.6 失败与恢复

| 失败点 | 处理方式 |
|---|---|
| 用户拒绝审批 | ToolExecutionResult = denied，Transcript 记录 |
| 用户修改审批字段 | PermissionDecision.updatedInput 更新最终执行输入 |
| 发送失败 | ToolResult = failed，可建议重试或创建草稿 |
| 重复审批回调 | Runtime Dispatcher 幂等处理 |

---

# 7. Flow 4：复杂任务 spawn PlannerRun 链路

## 7.1 适用场景

```text
- 多步骤
- 多工具域
- 需要依赖管理
- 需要用户确认计划
- 可能重规划
- 可能转 Workflow
```

示例：

```text
用户：帮我准备下周去上海出差的安排，包括行程、会议资料、酒店建议和提醒事项。
```

## 7.2 流程

```text
User Message
  ↓
Gateway
  ↓
Foreground Conversation Agent
  ↓
ForegroundDecision(route = spawn_planner, requiresPlanner = true)
  ↓
RuntimeAction(actionType = start_planner_run or launch_subagent/planner)
  ↓
Runtime Dispatcher
  ↓
Planner Runtime
  ↓
Create PlannerRun from PlannerAgentTemplate
  ↓
PlannerRun creates ExecutionPlan
  ↓
Plan Store writes plan v1
  ↓
Foreground response: 已开始规划 / 展示计划草稿
  ↓
User confirms or modifies plan
  ↓
PlannerRun generates RuntimeActions per step
  ↓
Runtime Dispatcher
  ↓
Kernel / Tool / Subagent / Workflow execution
  ↓
Execution results return as PlanPatch / RuntimeContextDelta
  ↓
PlannerRun replans if needed
```

## 7.3 模块职责

| 模块 | 职责 |
|---|---|
| Foreground Conversation Agent | 识别复杂任务，创建 PlannerRun，不自己规划到底 |
| Planner Runtime | 从 PlannerAgentTemplate 创建 PlannerRun |
| PlannerRun | 创建 / 更新 ExecutionPlan，分配执行者，生成 RuntimeAction |
| Plan Store | 保存 ExecutionPlan 权威状态 |
| Runtime Dispatcher | 分发 Planner 生成的 RuntimeAction |
| Execution Runtime | 执行具体 step |
| SessionMemoryManager | 根据 PlannerStatePatch 更新 session 状态 |

## 7.4 创建对象

```text
ForegroundDecision
PlannerRun
ExecutionPlan
PlanStep[]
PlanPatch[]
RuntimeAction[]
DispatchResult[]
KernelRun / ToolCall / SubagentRun
WorkingSummary
SessionMemoryPatch
TranscriptRecord
```

## 7.5 PlannerRun 状态流转

```text
initializing
  → planning
  → waiting_for_user?      // 如果需要用户确认计划
  → waiting_for_execution_result
  → replanning?            // 结果不满足预期或用户修改目标
  → completed / failed / cancelled
```

## 7.6 失败与恢复

| 失败点 | 处理方式 |
|---|---|
| Planner 生成计划失败 | Foreground Agent 请求用户缩小范围或提供信息 |
| 用户不确认计划 | PlannerRun waiting_for_user，可修改或取消 |
| 某个 step 执行失败 | PlannerRun 接收 failure result，决定重试 / fallback / ask_user |
| PlannerRun 崩溃 | 从 checkpoint + Plan Store 恢复 |
| 多个 PlannerRun 冲突 | ActiveWorkProjection 辅助 Foreground Agent 澄清 |

---

# 8. Flow 5：后台长任务链路

## 8.1 适用场景

```text
- 耗时较长
- 不需要用户持续盯着
- 可异步完成
- 可能需要中途审批
- 完成后通知用户
```

示例：

```text
用户：帮我整理过去三个月的重要邮件，生成一份待办清单，完成后通知我。
```

## 8.2 流程

```text
User Message
  ↓
Gateway
  ↓
Foreground Conversation Agent
  ↓
ForegroundDecision(route = spawn_planner or dispatch_subagent)
  ↓
PlannerRun?  // 如果需要计划
  ↓
RuntimeAction(launch_background_subagent)
  ↓
Runtime Dispatcher
  ↓
Permission precheck(background_limited)
  ↓
Subagent Runtime
  ↓
Create BackgroundSubagentRun
  ↓
Foreground response: 已开始后台执行
  ↓
Background Subagent executes via Kernel / Tool Plane
  ↓
Checkpoint / progress / artifact updates
  ↓
Needs approval? → ApprovalRequest → waiting_for_approval
  ↓
External wait? → WaitCondition → waiting_for_external_event
  ↓
Completed / Failed
  ↓
NotificationRequest
  ↓
Gateway / Notification Center
  ↓
User receives result summary + artifact refs
```

## 8.3 创建对象

```text
PlannerRun? 
ExecutionPlan?
RuntimeAction(launch_background_subagent)
BackgroundSubagentRun
SubagentRun
KernelRun[]
ToolCall[]
Checkpoint[]
Artifact[]
WorkingSummary[]
BackgroundSubagentSummary
NotificationRequest
TranscriptRecord
AuditRecord
```

## 8.4 前台不被占用的关键机制

```text
ForegroundConversationRun 在 BackgroundSubagentRun 创建后即可完成。
后续进度通过 ActiveWorkProjection / Notification / Status Query 暴露。
用户可以随时发起新 turn 查询、修改、取消该后台任务。
```

## 8.5 状态查询链路

```text
用户：刚才那个邮件整理到哪了？
  ↓
Gateway
  ↓
Foreground Conversation Agent
  ↓
读取 ActiveWorkProjection
  ↓
必要时 dispatch status query
  ↓
返回进度摘要
```

## 8.6 取消链路

```text
用户：取消刚才那个邮件整理任务。
  ↓
Foreground Agent resolves target BackgroundSubagentRun
  ↓
RuntimeAction(cancel_subagent)
  ↓
Runtime Dispatcher
  ↓
Subagent Runtime cancel
  ↓
Tool Plane cancels active tools if needed
  ↓
Synthetic terminal results
  ↓
Transcript / Notification
```

## 8.7 失败与恢复

| 失败点 | 处理方式 |
|---|---|
| Subagent 卡死 | Watchdog 标记 recovering / failed |
| 工具调用被取消 | Tool Plane 生成 synthetic terminal result |
| 需要用户审批 | BackgroundSubagentRun waiting_for_approval |
| Connector 授权失效 | 通知用户重新授权，任务 waiting_for_user |
| 系统重启 | 从 checkpoint 恢复 BackgroundSubagentRun |

---

# 9. Flow 6：Workflow 创建、发布、执行链路

## 9.1 适用场景

```text
- 用户希望固化可复用流程
- 可视化 Workflow Builder 创建流程
- 临时 Plan 转成 WorkflowDraft
- 定时或事件触发执行
```

示例：

```text
用户：把这个每周邮件总结任务保存成一个每周一自动执行的流程。
```

## 9.2 Plan 转 Workflow 链路

```text
ExecutionPlan
  ↓
PlannerRun decides convert_plan_to_workflow
  ↓
RuntimeAction(plan_to_workflow)
  ↓
PlanToWorkflowCompiler
  ↓
WorkflowDraft
  ↓
Workflow Runtime validates draft
  ↓
User review / edit / confirm
  ↓
WorkflowDefinition published
```

## 9.3 可视化创建链路

```text
Visual Workflow UI
  ↓
WorkflowDraftCreateRequest
  ↓
Workflow Runtime
  ↓
WorkflowValidator
  ↓
WorkflowDraft
  ↓
User publish
  ↓
WorkflowDefinition
```

## 9.4 Workflow 执行链路

```text
Manual / Schedule / Event Trigger
  ↓
WorkflowStartRequest
  ↓
Workflow Runtime creates WorkflowRun
  ↓
WorkflowStepRun queued
  ↓
RuntimeAction per step
  ↓
Runtime Dispatcher
  ├─ agent_run → Agent Kernel
  ├─ subagent_run → Subagent Runtime
  ├─ tool_call → Tool Plane
  ├─ approval → Permission Engine
  ├─ wait / condition → Event Trigger Runtime
  └─ notification → Gateway / Notification Center
  ↓
Workflow Runtime updates step state
  ↓
WorkflowRun completed / failed / waiting
```

## 9.5 创建对象

```text
WorkflowDraft
WorkflowDefinition
WorkflowRun
WorkflowStepRun[]
RuntimeAction[]
DispatchResult[]
ApprovalRequest?
WaitCondition?
ToolExecutionResult?
WorkflowRunSummary
AuditRecord
```

## 9.6 权限原则

```text
Workflow 被发布不代表永久免审批。
高风险 step 每次运行仍需 Permission Engine 判断。
Workflow 级 grant 只能在明确 scope / expiresAt / riskLevelMax 内生效。
```

## 9.7 失败与恢复

| 失败点 | 处理方式 |
|---|---|
| Draft 校验失败 | WorkflowDraft.validationIssues 返回给 UI |
| Step 失败 | 根据 onFailure：fail / continue / retry / ask_user / fallback_step |
| Approval 超时 | step failed 或 waiting_for_user，按 policy 处理 |
| WaitCondition 超时 | step failed / timeout |
| Workflow Runtime 重启 | 从 checkpoint + Event Store 恢复 active step |

---

# 10. Flow 7：Event Trigger 唤醒链路

## 10.1 适用场景

```text
- 定时任务
- recurring trigger
- webhook
- connector event
- MCP notification
- approval resolved
- wait condition satisfied
```

示例：

```text
每周一 9 点自动运行邮件总结 Workflow。
```

## 10.2 定时触发 Workflow

```text
TriggerRegistration(schedule)
  ↓
Scheduler fires
  ↓
Event Trigger Runtime
  ↓
RuntimeTriggerEvent
  ↓
RuntimeAction(start_workflow_run)
  ↓
Runtime Dispatcher
  ↓
Workflow Runtime
  ↓
WorkflowRun
```

## 10.3 外部事件触发后台 Subagent

```text
Connector EventBridge receives email_received
  ↓
ConnectorEvent normalized
  ↓
Event Trigger Runtime matches trigger
  ↓
RuntimeTriggerEvent
  ↓
RuntimeAction(launch_background_subagent)
  ↓
Runtime Dispatcher
  ↓
Subagent Runtime
  ↓
BackgroundSubagentRun
```

## 10.4 WaitCondition 唤醒

```text
Tool Plane starts async operation
  ↓
OperationRef
  ↓
RuntimeAction(register_wait_condition)
  ↓
Event Trigger Runtime stores WaitCondition
  ↓
Watcher observes condition success / failure / timeout
  ↓
RuntimeTriggerEvent(operation_completed)
  ↓
RuntimeAction(resume_workflow_step / resume_subagent / resume_agent_run)
  ↓
Runtime Dispatcher
  ↓
Target Runtime resumes
```

## 10.5 创建对象

```text
TriggerRegistration
RuntimeTriggerEvent
RuntimeAction
DispatchResult
WaitCondition?
OperationRef?
WorkflowRun / BackgroundSubagentRun / KernelRun
EventRecord
TraceSpan
```

## 10.6 幂等要求

Event Trigger 链路必须设置：

```text
correlationId
causationId
idempotencyKey
source event id
trigger id
```

防止：

```text
webhook 重试
scheduler 重复触发
approval 重复回调
watcher 重复上报
```

## 10.7 失败与恢复

| 失败点 | 处理方式 |
|---|---|
| Trigger 匹配失败 | 记录 unmatched event，不执行 |
| 目标 Runtime 不存在 | DispatchResult failed，记录 dead letter |
| 重复触发 | Dispatcher duplicate handling |
| WaitCondition 超时 | RuntimeTriggerEvent(condition_timeout) 唤醒目标处理失败分支 |
| Event Trigger Runtime 重启 | 从 Trigger Store / WaitCondition Store 恢复 |

---

# 11. Flow 8：Approval 申请、用户响应、恢复执行链路

## 11.1 适用场景

```text
- 写操作
- 删除操作
- 发送邮件
- 修改日历
- 创建自动化
- 高风险 Workflow step
- Background task 中途需要用户授权
```

## 11.2 标准链路

```text
Tool / Workflow / Subagent / Dispatcher requests permission
  ↓
Permission Engine
  ↓
PermissionDecision(ask)
  ↓
ApprovalRequest
  ↓
Gateway Approval Card / Approval Code
  ↓
Target Run enters waiting_for_approval
  ↓
User approves / rejects / modifies
  ↓
Gateway receives approval_response
  ↓
Approval Handler validates response
  ↓
Event Trigger Runtime emits approval_resolved
  ↓
RuntimeAction(resume_agent_run / resume_subagent / resume_workflow_step)
  ↓
Runtime Dispatcher
  ↓
Target Runtime resumes
  ↓
Tool executes or action cancelled
  ↓
AuditRecord + Transcript
```

## 11.3 创建对象

```text
PermissionCheckRequest
PermissionDecision
ApprovalRequest
ApprovalCodeGrant?
PermissionGrant?
RuntimeTriggerEvent(approval_resolved)
RuntimeAction(resume_*)
DispatchResult
AuditRecord
TranscriptRecord
```

## 11.4 用户修改审批输入

如果用户在审批卡片中修改字段：

```text
ApprovalResponse(modify)
  ↓
Permission Engine validates updatedInput
  ↓
updatedInput recorded with originalInput
  ↓
Tool Plane executes proposedInput
  ↓
AuditRecord includes diffSummary
```

## 11.5 失败与恢复

| 失败点 | 处理方式 |
|---|---|
| Approval expired | Target run remains failed / waiting_user by policy |
| User rejects | Runtime resumes with denied terminal result |
| User modifies invalid input | Ask user again or fail approval |
| Duplicate approval response | Idempotency returns previous decision |
| Target run already cancelled | Ignore approval, notify user if needed |

---

# 12. Flow 9：用户打断、修改、取消链路

## 12.1 适用场景

```text
用户：等等，先别发。
用户：把刚才那个任务取消。
用户：邮件整理只看上个月，不要看三个月。
用户：刚才的计划里酒店预算改成 1000 元以内。
```

## 12.2 流程

```text
User Message
  ↓
Gateway
  ↓
Foreground Conversation Agent
  ↓
Read ActiveWorkProjection
  ↓
Resolve target work item
  ↓
If ambiguous → ask clarification
  ↓
If clear:
    cancel / modify / pause / resume decision
  ↓
RuntimeAction(cancel_subagent / update_plan_state / pause_workflow / resume_planner)
  ↓
Runtime Dispatcher
  ↓
Target Runtime
  ↓
State updated
  ↓
User-visible confirmation
```

## 12.3 关键规则

```text
Foreground Agent 负责理解用户打断意图。
目标 Runtime 负责实际取消 / 暂停 / 修改。
PlannerRun 负责计划层重规划。
Subagent Runtime 负责后台任务取消。
Workflow Runtime 负责 workflow run 暂停或取消。
Tool Plane 负责 active tool cancellation 和 synthetic terminal result。
```

---

# 13. Flow 10：状态查询链路

## 13.1 适用场景

```text
用户：现在有哪些任务在跑？
用户：上海出差规划做完了吗？
用户：刚才那个后台任务卡在哪一步？
```

## 13.2 流程

```text
User Message
  ↓
Gateway
  ↓
Foreground Conversation Agent
  ↓
Read ActiveWorkProjection
  ↓
If enough → answer directly
  ↓
If stale → RuntimeAction(query_status)
  ↓
Runtime Dispatcher
  ↓
Target Runtime status adapter
  ↓
Return status summary
  ↓
Gateway response
```

## 13.3 状态来源

```text
PlannerRun Store
Plan Store
BackgroundSubagentRun Store
WorkflowRun Store
Approval Store
Event Store Projection
Artifact Store
```

---

## 14. Transcript / Summary 写入时机

| 场景 | Transcript | WorkingSummary | SessionMemory | Long-term Memory |
|---|---|---|---|---|
| 普通问答 | 写 turn | 通常不写 | 轻量 patch | 通常不写 |
| 简单工具 | 写工具摘要 | 可选 | patch active state | 通常不写 |
| 复杂 PlannerRun | 写计划展示 | PlannerRun checkpoint | activePlan patch | 计划完成后可抽取 |
| 后台任务开始 | 写开始摘要 | 写 background summary | activeBackgroundRun patch | 否 |
| 后台任务完成 | 写结果摘要 | run_completed | activeBackgroundRun cleared | 可抽取重要事实 |
| WorkflowRun | 写运行摘要 | step 级可写 | workflow state patch | 可抽取 routine |
| Approval | 写审批摘要 | waiting_approval | pendingApproval patch | 否 |
| 用户取消 | 写取消摘要 | cancellation summary | active state patch | 否 |

---

## 15. 统一失败处理原则

### 15.1 所有已开始执行的动作必须有终态

```text
ToolCall → ToolExecutionResult
KernelRun → KernelRunResult
SubagentRun → SubagentRunResult
WorkflowStepRun → completed / failed / cancelled / skipped
RuntimeAction → DispatchResult
```

### 15.2 失败必须可追踪

每个失败至少记录：

```text
EventRecord
TraceSpan
error.code
error.message
recoverable
relatedRefs
```

高风险外部动作失败还需要：

```text
AuditRecord
```

### 15.3 用户可见失败需要转译

内部错误不能直接暴露：

```text
connector_timeout → “日历服务暂时没有响应，我可以稍后重试。”
permission_denied → “这个操作没有获得授权，已停止执行。”
max_iterations_reached → “任务已达到本轮执行上限，我保留了当前进度。”
```

---

## 16. 最小 MVP 需要支持的链路

MVP 必须跑通：

```text
1. 普通问答
2. 简单读工具
3. 简单写工具 + 审批
4. 复杂任务 spawn PlannerRun
5. 后台 SubagentRun 开始 / 完成 / 失败通知
6. Approval resolved resume
7. 状态查询
8. 用户取消后台任务
```

MVP 可以简化：

```text
- Workflow Runtime 只支持线性 workflow
- Event Trigger 只支持 schedule / approval_resolved / wait_condition
- PlannerRun 不支持多级嵌套
- Replay 只支持 timeline_only
```

---

## 17. 关键结论

端到端链路的核心收口如下：

```text
Foreground Conversation Agent 负责前台判断和用户体验。
PlannerRun 负责复杂任务计划和重规划。
Runtime Dispatcher 负责所有结构化动作分发。
Agent Kernel / Subagent Runtime / Tool Plane / Workflow Runtime 负责实际执行。
Event Trigger Runtime 负责触发和唤醒。
Permission Engine 负责授权护栏。
Context Manager 负责模型可见上下文。
Memory / Summary 负责历史与状态沉淀。
Observability / Audit / Replay 负责解释系统做了什么、为什么做、如何恢复。
```

最重要的设计目标是：

```text
前台不被长任务占用；
后台任务可并发、可恢复、可取消；
所有外部副作用可审批、可审计；
所有复杂任务都有计划状态；
所有用户可见结果都有 Transcript；
所有长期记忆都有来源。
```
