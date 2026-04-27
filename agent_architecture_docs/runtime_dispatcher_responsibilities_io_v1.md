# Runtime Dispatcher 功能职责与输入输出文档 v3（Foreground / PlannerRun 对齐版）

## 1. 文档目的

本文档定义个人助理型 Agent 平台中的 **Runtime Dispatcher** 模块，包括：

- Runtime Dispatcher 的定位与职责边界
- 参考 Claude Code 后可借鉴的 tool orchestration、AgentTool、permission runtime、MCP 调用和 task runtime 分发思想
- RuntimeAction、DispatchRequest、DispatchResult、TargetRuntime、DispatchPolicy 等核心对象
- 与 Gateway、Planner、Workflow Runtime、Event Trigger Runtime、Agent Kernel、Subagent Runtime、Tool Plane、Permission Engine、Connector Runtime、Gateway / Notification Center 的关系
- 路由、权限、审计、幂等、重试、失败回退、恢复和可观测设计
- MVP 实现建议

---

## 2. 模块定位

Runtime Dispatcher 的推荐定位是：

> **内部结构化运行请求的统一分发层。**

它负责把来自不同入口的结构化请求，路由到正确的运行时模块：

```text
Gateway / Planner / Workflow Runtime / Event Trigger Runtime / Hook / System
        ↓
Runtime Dispatcher
        ↓
Agent Kernel / Subagent Runtime / Tool Plane / Workflow Runtime / Gateway / Notification Center
```

Runtime Dispatcher 是“内部路由器”，不是 Agent 大脑。

它不理解自然语言，不生成 plan，不执行工具，不做最终权限判断，不编排 Workflow step 的内部逻辑。

---

## 3. 参考 Claude Code 的核心启发

Claude Code 中没有一个完全独立、命名为 Runtime Dispatcher 的平台级模块，但它的运行链路中存在多个分发思想：

## 3.1 Query Loop 分发模型输出

Claude Code Query Loop 会解析 assistant 输出。如果是文本，则进入响应路径；如果是 tool use，则进入 tool orchestration / tool execution；如果需要继续，则将 tool result 回灌下一轮。

对本系统的启发：

> 模型输出后的行动必须通过统一分发与治理，而不是模块随意互相调用。

---

## 3.2 Tool Orchestration 是工具分发器

Claude Code 的工具执行会经过 tool orchestration、schema parse、validate、permission、execute、result mapping 等阶段。

对本系统的启发：

> Tool Plane 内部有自己的工具级 dispatcher，但平台层还需要 Runtime Dispatcher 负责跨模块分发。

---

## 3.3 AgentTool 是 Subagent 分发入口

Claude Code 的 Subagent 通过 AgentTool 启动新的 query loop。

对本系统的启发：

> 主 Agent 不应直接实例化 Subagent；应通过结构化 action 交给 Subagent Runtime。

---

## 3.4 Permission Runtime 是动作分发前的护栏

Claude Code 的权限判断在工具执行前发生，决定 allow / ask / deny。

对本系统的启发：

> Runtime Dispatcher 不能绕过 Permission Engine；对于有外部副作用或高风险动作，dispatch 前必须确认权限策略。

---

## 3.5 MCP 是外部能力分发入口

Claude Code 的 MCP 层使外部 server 提供工具 / 资源 / notification。

对本系统的启发：

> Runtime Dispatcher 不直接执行外部系统的业务读写动作。  
> 模型产生的外部资源读写必须通过 Tool Plane，再由 Tool Plane 调用 Connector Runtime / MCP Layer。  
> Dispatcher 只可以把 connector 健康检查、鉴权刷新、事件订阅注册、connector event 接收等**管理类动作**分发给 Connector Runtime。

---

## 4. Runtime Dispatcher 的职责清单

## 4.1 应承担的职责

### 4.1.1 接收结构化 RuntimeAction

输入来源包括：

- Gateway
- Planner / Intent Router
- Workflow Runtime
- Event Trigger Runtime
- Subagent Runtime
- Agent Kernel
- Hooks / Event Bus
- System Scheduler
- Replay Service

---

### 4.1.2 解析目标运行时

根据 `RuntimeAction.targetRuntime` 或 `actionType` 路由到：

- Agent Kernel
- Subagent Runtime
- Tool Plane
- Workflow Runtime
- Event Trigger Runtime
- Gateway / Notification Center
- Permission Engine
- Connector Runtime（仅限管理类动作：health check、auth refresh、event subscription、connector event receive）
- Memory / Summary System（仅限调用 SummaryManager / MemoryExtractionService 标准接口）

#### Connector Runtime 分发限制

Runtime Dispatcher 可以把以下管理类动作分发给 Connector Runtime：

- connector health check
- connector auth refresh
- connector event subscription 注册 / 取消
- connector event receive / normalize
- connector capability refresh

但以下动作不应由 Dispatcher 直接分发到 Connector Runtime：

- 读取邮件 / 日历 / 文档等用户资源
- 发送邮件、修改日历、分享文档等外部写操作
- 由模型 tool use 产生的任何 connector 读写动作

这些动作必须走：

```text
Agent Kernel / Workflow Runtime / Subagent Runtime
  → Runtime Dispatcher
  → Tool Plane
  → Permission Engine
  → Connector Runtime / MCP Layer
```

#### Memory / Summary 分发限制

Runtime Dispatcher 可以分发 `write_summary` / `extract_memory` 这类结构化动作，
但只能调用：

- SummaryManager
- SessionMemoryManager
- MemoryExtractionService
- MemoryWritePolicyService

调用方不能借 Dispatcher 绕过这些管理器，直接写入 Summary Store 或 Long-term Memory Store。

---

### 4.1.3 执行前治理

Dispatch 前执行：

- idempotency check
- authorization context check
- permission precheck
- runtime availability check
- target state check
- budget check
- concurrency limit
- policy check
- audit pre-record

---

### 4.1.4 调用目标 Runtime

调用对应模块的标准接口：

- `AgentKernel.startRun`
- `AgentKernel.resumeRun`
- `SubagentRuntime.launch`
- `SubagentRuntime.resume`
- `ToolPlane.executeTool`
- `WorkflowRuntime.startRun`
- `WorkflowRuntime.resumeStep`
- `EventTriggerRuntime.registerTrigger`
- `Gateway.sendOutbound`
- `NotificationCenter.notify`

---

### 4.1.5 结果标准化

将不同模块的返回结果统一为 `DispatchResult`。

---

### 4.1.6 失败回退

处理：

- target unavailable
- permission required
- permission denied
- invalid target state
- timeout
- duplicate dispatch
- transient connector failure
- runtime exception
- cancel / interrupt

---

### 4.1.7 事件与审计

每次 dispatch 都必须产生：

- DispatchEvent
- Trace span
- AuditRecord
- Optional Event Store entry

---

### 4.1.8 幂等与去重

使用：

- idempotencyKey
- correlationId
- causationId
- targetRef
- actionType

防止 Event Trigger、Webhook、Approval Resolved 等重复唤醒造成重复执行。

---

### 4.1.9 调度策略

支持：

- sync dispatch
- async dispatch
- fire-and-forget
- request-response
- queued dispatch
- priority dispatch
- retryable dispatch

---

## 4.2 不应承担的职责

Runtime Dispatcher 不应承担：

- 不理解自然语言
- 不生成 Plan
- 不编排 Workflow step 内部逻辑
- 不执行 Agent Loop
- 不执行工具具体逻辑
- 不做权限最终判断
- 不直接访问 connector
- 不直接写 Memory
- 不直接操作 Event Store 之外的业务状态
- 不替代 Event Bus

---

## 5. RuntimeAction 设计

## 5.1 RuntimeAction

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
    | "connector_health_check"
    | "connector_auth_refresh"
    | "connector_register_subscription"
    | "connector_receive_event"
    | "replay_run"

  source: {
    sourceModule:
      | "gateway"
      | "planner"
      | "kernel"
      | "workflow"
      | "event_trigger"
      | "subagent"
      | "tool"
      | "permission"
      | "hook"
      | "replay"
      | "system"

    sourceRef?: string
  }

  targetRuntime:
    | "agent_kernel"
    | "subagent_runtime"
    | "tool_plane"
    | "workflow_runtime"
    | "event_trigger_runtime"
    | "permission_engine"
    | "gateway"
    | "notification_center"
    | "connector_runtime"
    | "memory_system"
    | "summary_manager"
    | "replay_service"

  targetRef?: {
    runId?: string
    workflowRunId?: string
    workflowStepRunId?: string
    backgroundRunId?: string
    subagentRunId?: string
    toolCallId?: string
    triggerId?: string
    waitConditionId?: string
    approvalId?: string
    sessionId?: string
    connectorInstanceId?: string
    connectorSubscriptionId?: string
  }

  payload: Record<string, unknown>

  policy?: DispatchPolicy

  correlationId?: string
  causationId?: string
  idempotencyKey?: string

  createdAt: string
}
```

---

## 5.2 DispatchPolicy

```ts
type DispatchPolicy = {
  mode:
    | "sync"
    | "async"
    | "queued"
    | "fire_and_forget"

  priority:
    | "low"
    | "normal"
    | "high"
    | "critical"

  timeoutMs?: number

  retryPolicy?: {
    maxAttempts: number
    backoff:
      | "none"
      | "fixed"
      | "exponential"
    initialDelayMs?: number
    maxDelayMs?: number
  }

  permissionPolicy?: {
    requirePrecheck: boolean
    allowAskUser: boolean
    permissionMode?: string
  }

  idempotency?: {
    enabled: boolean
    key: string
    duplicateBehavior:
      | "return_previous"
      | "drop"
      | "fail"
  }

  concurrency?: {
    groupKey?: string
    maxConcurrent?: number
  }

  audit?: {
    required: boolean
    auditType?: string
  }
}
```

---

## 5.3 DispatchRequest

```ts
type DispatchRequest = {
  requestId: string
  action: RuntimeAction

  context: {
    userId?: string
    sessionId?: string
    traceId?: string
    permissionContext?: PermissionContext
    callerModule: string
  }

  expectedResult?: {
    resultType:
      | "kernel_run_result"
      | "subagent_result"
      | "tool_execution_result"
      | "workflow_step_result"
      | "trigger_registration_result"
      | "notification_result"
      | "approval_request_result"
      | "summary_write_result"
      | "memory_extraction_result"
      | "replay_result"

    waitForCompletion?: boolean
  }
}
```

---

## 5.4 DispatchResult

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

  targetRuntime: RuntimeAction["targetRuntime"]

  targetResultRef?: string

  result?: unknown

  waitingState?: {
    waitingFor:
      | "approval"
      | "external_event"
      | "target_runtime"
      | "queue"
    approvalId?: string
    waitConditionId?: string
  }

  idempotency?: {
    key: string
    duplicateOfActionId?: string
  }

  error?: {
    code: string
    message: string
    recoverable: boolean
  }

  trace?: {
    traceId: string
    spanId: string
  }

  createdAt: string
  completedAt?: string
}
```

---

## 6. 目标 Runtime 接口

## 6.1 Agent Kernel

```ts
type AgentKernelDispatchAdapter = {
  startRun(input: KernelRunInput): Promise<KernelRunResult>
  resumeRun(input: KernelResumeInput): Promise<KernelRunResult>
  cancelRun(input: KernelCancelInput): Promise<KernelCancelResult>
}
```

---

## 6.2 Subagent Runtime

```ts
type SubagentRuntimeDispatchAdapter = {
  launch(input: SubagentLaunchRequest): Promise<SubagentLaunchResult>
  launchBackground(input: BackgroundSubagentLaunchRequest): Promise<BackgroundSubagentRun>
  resume(input: SubagentResumeRequest): Promise<SubagentRunResult>
  cancel(input: SubagentCancelRequest): Promise<SubagentCancelResult>
}
```

---

## 6.3 Tool Plane

```ts
type ToolPlaneDispatchAdapter = {
  executeTool(input: ToolExecutionRequest): Promise<ToolExecutionResult>
  registerTool(input: ToolRegistrationRequest): Promise<ToolRegistrationResult>
}
```

---

## 6.4 Workflow Runtime

```ts
type WorkflowRuntimeDispatchAdapter = {
  startRun(input: WorkflowStartRequest): Promise<WorkflowRunResult>
  resumeStep(input: WorkflowStepResumeRequest): Promise<WorkflowStepRunResult>
  pauseRun(input: WorkflowPauseRequest): Promise<WorkflowControlResult>
  cancelRun(input: WorkflowCancelRequest): Promise<WorkflowControlResult>
}
```

---

## 6.5 Event Trigger Runtime

```ts
type EventTriggerRuntimeDispatchAdapter = {
  registerTrigger(input: TriggerRegistrationRequest): Promise<TriggerRegistrationResult>
  registerWaitCondition(input: RegisterWaitConditionRequest): Promise<RegisterWaitConditionResult>
  receiveExternalEvent(input: RuntimeTriggerEvent): Promise<RuntimeTriggerResult>
}
```

---

## 6.6 Gateway / Notification Center

```ts
type GatewayDispatchAdapter = {
  sendOutbound(input: OutboundEnvelope): Promise<OutboundSendResult>
}

type NotificationCenterDispatchAdapter = {
  notify(input: NotificationRequest): Promise<NotificationResult>
}
```

---

## 7. Dispatch 流程

## 7.1 标准流程

```text
Receive DispatchRequest
  ↓
Validate RuntimeAction schema
  ↓
Resolve target runtime
  ↓
Check idempotency
  ↓
Check target state
  ↓
Apply dispatch policy
  ↓
Permission precheck if required
  ↓
Create trace span
  ↓
Audit pre-record
  ↓
Invoke target adapter
  ↓
Normalize DispatchResult
  ↓
Emit DispatchEvent
  ↓
Audit post-record
  ↓
Return DispatchResult
```

---

## 7.2 Event Trigger 唤醒流程

```text
RuntimeTriggerEvent
  ↓
Event Trigger Runtime resolves target
  ↓
RuntimeAction: resume_workflow_step / resume_subagent / resume_agent_run
  ↓
Runtime Dispatcher
  ↓
Idempotency check
  ↓
Target runtime state check
  ↓
Resume target
```

---

## 7.3 Workflow Step 执行流程

```text
Workflow Runtime
  ↓
RuntimeAction: execute_tool / launch_subagent / start_agent_run
  ↓
Runtime Dispatcher
  ↓
Permission precheck
  ↓
Target runtime invoke
  ↓
DispatchResult
  ↓
Workflow Runtime updates step state
```

---

## 7.4 Natural Language Plan 执行流程

```text
Gateway
  ↓
Planner / Intent Router
  ↓
RuntimeAction: start_agent_run / launch_subagent / execute_tool
  ↓
Runtime Dispatcher
  ↓
Target runtime
```

---

## 8. 权限与安全

Runtime Dispatcher 不是 Permission Engine，但必须确保高风险 action 不绕过权限检查。

### 8.1 需要权限预检查的动作

- execute_tool
- launch_background_subagent
- start_workflow_run with write steps
- resume_workflow_step after approval
- send_notification to external channel
- write_summary if sensitive
- extract_memory if sensitive source
- connector_auth_refresh / connector_register_subscription when touching private connector scopes
- replay_run with resume_from_checkpoint
- register_trigger with external side effects

---

## 8.2 Permission Precheck

```ts
type DispatchPermissionPrecheck = {
  actionId: string
  actionType: RuntimeAction["actionType"]
  permissionContext: PermissionContext

  riskHints?: {
    riskLevel?: "low" | "medium" | "high" | "critical"
    externalSideEffect?: boolean
    readsSensitiveData?: boolean
    writesExternalState?: boolean
  }
}
```

如果 Permission Engine 返回 ask：

```text
DispatchResult.status = waiting_for_approval
```

如果 deny：

```text
DispatchResult.status = denied
```

---

## 9. 幂等设计

Runtime Dispatcher 必须处理重复请求。

高风险重复来源：

- webhook 重试
- MCP notification 重复
- approval resolved 重复
- scheduler 重复触发
- workflow retry
- user double click
- network retry

幂等键建议：

```text
sourceModule + actionType + targetRuntime + targetRef + causationId
```

例如：

```text
event_trigger:resume_workflow_step:wf_run_1:step_2:event_999
```

---

## 10. 失败回退

## 10.1 失败类型

```ts
type DispatchFailureCode =
  | "invalid_action"
  | "target_runtime_unavailable"
  | "target_state_invalid"
  | "permission_denied"
  | "approval_required"
  | "idempotency_duplicate"
  | "timeout"
  | "queue_full"
  | "concurrency_limited"
  | "target_runtime_error"
  | "policy_violation"
  | "cancelled"
```

---

## 10.2 回退策略

```text
permission_required
  → create approval request

target unavailable
  → retry / queue / fail

target state invalid
  → state reconciliation / fail

timeout
  → retry / mark waiting / fail

duplicate
  → return previous result / drop

runtime error
  → emit failure event / dead letter / ask user
```

---

## 11. DispatchEvent

```ts
type DispatchEvent = {
  eventId: string
  eventType:
    | "dispatch_requested"
    | "dispatch_accepted"
    | "dispatch_queued"
    | "dispatch_started"
    | "dispatch_completed"
    | "dispatch_failed"
    | "dispatch_denied"
    | "dispatch_waiting_approval"
    | "dispatch_duplicate"
    | "dispatch_cancelled"

  actionId: string
  requestId: string

  sourceModule: RuntimeAction["source"]["sourceModule"]
  targetRuntime: RuntimeAction["targetRuntime"]
  actionType: RuntimeAction["actionType"]

  userId?: string
  sessionId?: string
  runId?: string

  relatedRefs?: RuntimeAction["targetRef"]

  correlationId?: string
  causationId?: string
  idempotencyKey?: string

  timestamp: string
  payload?: Record<string, unknown>
}
```

---

## 12. 与其他模块关系

## 12.1 Gateway

Gateway 将自然语言输入交给 Planner / Intent Router。  
当需要执行结构化动作时，由 Planner 或 Gateway 产生 RuntimeAction 给 Dispatcher。

---

## 12.2 Planner / Intent Router

Planner 不直接调用 Kernel / Subagent / Tool。  
Planner 输出 RuntimeAction 或 ExecutionPlan step，由 Dispatcher 统一分发。

---

## 12.3 Workflow Runtime

Workflow Runtime 是 Dispatcher 的主要调用方之一。  
Workflow step 不直接调用 Tool Plane / Subagent Runtime，应通过 Dispatcher。

---

## 12.4 Event Trigger Runtime

Event Trigger Runtime 负责触发与唤醒，Dispatcher 负责执行唤醒目标调用。

---

## 12.5 Agent Kernel

Kernel 可以通过 Dispatcher 请求：

- execute_tool
- launch_subagent
- request_approval
- send_notification

但 Kernel 不应直接绕过 Dispatcher 调用外部模块。

---

## 12.6 Tool Plane

Tool Plane 是具体工具执行目标。  
Dispatcher 负责前置治理，Tool Plane 负责工具执行流水线。

---

## 12.7 Permission Engine

Dispatcher 使用 Permission Engine 做 action precheck。  
最终细粒度工具权限仍由 Tool Plane / Permission Engine 处理。

---

## 12.8 Observability / Audit / Replay

Dispatcher 每次分发必须可观测、可审计、可回放。

---

## 13. MVP 实现建议

## Phase 1：基础 Dispatcher

实现：

- RuntimeAction
- DispatchRequest
- DispatchResult
- RuntimeAdapterRegistry
- Target runtime resolution
- idempotency check
- basic dispatch events
- Agent Kernel / Tool Plane / Subagent Runtime adapter

---

## Phase 2：Workflow / Event Trigger 集成

实现：

- WorkflowRuntime adapter
- EventTriggerRuntime adapter
- Gateway / Notification adapter
- register_wait_condition
- resume_workflow_step
- resume_background_subagent

---

## Phase 3：权限和审计

实现：

- DispatchPermissionPrecheck
- Permission Engine integration
- AuditRecord
- Trace span
- Dispatch timeline
- failure analysis

---

## Phase 4：高级治理

实现：

- queued dispatch
- retry manager
- dead letter queue
- concurrency limiter
- circuit breaker
- dispatch dashboard
- replay integration

---

## 14. 推荐目录结构

```text
src/
  dispatcher/
    core/
      RuntimeDispatcher.ts
      RuntimeAction.ts
      DispatchRequest.ts
      DispatchResult.ts

    adapters/
      AgentKernelDispatchAdapter.ts
      SubagentRuntimeDispatchAdapter.ts
      ToolPlaneDispatchAdapter.ts
      WorkflowRuntimeDispatchAdapter.ts
      EventTriggerRuntimeDispatchAdapter.ts
      GatewayDispatchAdapter.ts
      NotificationCenterDispatchAdapter.ts

    registry/
      RuntimeAdapterRegistry.ts
      TargetRuntimeResolver.ts

    policy/
      DispatchPolicyEngine.ts
      DispatchPermissionPrecheck.ts
      DispatchConcurrencyLimiter.ts
      DispatchBudgetGuard.ts

    idempotency/
      DispatchIdempotencyStore.ts
      DispatchDeduplicator.ts

    retry/
      DispatchRetryManager.ts
      DispatchDeadLetterQueue.ts

    observability/
      DispatchEventEmitter.ts
      DispatchTraceAdapter.ts
      DispatchAuditAdapter.ts

    recovery/
      DispatchStateReconciler.ts
      DispatchFailureAnalyzer.ts
```

---

## 15. 关键原则

1. Dispatcher 是内部结构化动作路由器，不是 Agent 大脑。
2. 自然语言先经过 Gateway / Planner，不能直接进入 Dispatcher。
3. Workflow step、Event Trigger wakeup、Planner action 都应通过 Dispatcher 调用运行时。
4. Dispatcher 不能绕过 Permission Engine。
5. Dispatcher 不直接执行 Connector 业务读写；模型触发的外部资源读写必须经 Tool Plane，只有 connector 管理类动作可直达 Connector Runtime。\n6. Dispatcher 不直接写 Summary Store / Long-term Memory Store；只能调用 SummaryManager / MemoryExtractionService 等标准接口。
7. 每次 dispatch 都必须有 trace / event / audit。
8. 所有 Event Trigger / Webhook / Approval Resume 类 action 必须幂等。
9. Dispatcher 不应编排 Workflow 内部逻辑，只负责调用目标运行时。
10. Dispatcher 的失败必须标准化为 DispatchResult。
11. Replay / resume 必须通过 Dispatcher，避免绕过安全链路。

---

## 16. 最终结论

Runtime Dispatcher 的核心价值是：

```text
让所有结构化运行请求走同一条治理、权限、幂等、审计和可观测路径。
```

一句话总结：

> **Planner 负责决定要做什么，Workflow Runtime 负责固化流程怎么推进，Event Trigger Runtime 负责何时唤醒，Runtime Dispatcher 负责把这些结构化动作安全、可审计、可幂等地送到正确运行时。**


---

# 13. Foreground Conversation Agent / PlannerRun 分发扩展

Runtime Dispatcher 需要支持 Foreground Conversation Agent 和 PlannerRun 相关结构化动作。

## 13.1 新增 RuntimeAction.actionType

```ts
type ForegroundPlannerRuntimeActionType =
  | "start_foreground_turn"
  | "complete_foreground_turn"
  | "spawn_planner_run"
  | "resume_planner_run"
  | "cancel_planner_run"
  | "archive_planner_run"
  | "query_active_work"
```

## 13.2 新增 targetRuntime

```ts
type ForegroundPlannerTargetRuntime =
  | "foreground_conversation_agent"
  | "planner_runtime"
```

## 13.3 Foreground turn 流程

```text
Gateway
  → RuntimeAction: start_foreground_turn
  → Runtime Dispatcher
  → Foreground Conversation Agent
  → ForegroundDecision
  → answer_directly / dispatch_tool / spawn_planner_run / approval_handler
```

## 13.4 spawn PlannerRun 流程

```text
Foreground Conversation Agent
  → RuntimeAction: spawn_planner_run
  → Runtime Dispatcher
  → PlannerRuntime
  → PlannerRun
  → PlannerRun emits RuntimeAction
  → Runtime Dispatcher
  → Target Runtime
```

## 13.5 直接委派权限要求

Foreground Conversation Agent 的直接委派不等于绕过权限。

以下动作必须经过 Dispatcher permission precheck：

- dispatch_tool
- dispatch_subagent
- spawn_planner_run with auto_execute
- register_trigger
- handoff_workflow_runtime
- send_notification
- write_summary / extract_memory

## 13.6 幂等建议

PlannerRun 创建幂等键建议：

```text
userId + sessionId + normalizedObjectiveHash + sourceTurnId
```

同一目标重复请求时，Dispatcher 应优先返回已有 PlannerRun 或交给 Foreground Conversation Agent 确认是否新开任务。
