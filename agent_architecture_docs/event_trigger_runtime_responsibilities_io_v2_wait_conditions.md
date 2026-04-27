# Event Trigger Runtime 功能职责与输入输出文档 v2（含 Runtime Wait Condition）

## 1. 文档目的

本文档定义从原 Task / Workflow Runtime 中收缩出来的 **Event Trigger Runtime**。

它只负责：

> 触发、匹配、唤醒和分发事件。

不负责后台任务生命周期，不负责 Workflow Step 编排，不负责 Subagent loop。

---

## 2. 模块定位

```text
Scheduler / Webhook / MCP / Connector / Approval
  → Event Trigger Runtime
  → RuntimeTriggerEvent
  → Runtime Dispatcher
```

---

## 3. 应承担职责

- TriggerRegistration 管理
- 定时触发
- 周期触发
- Webhook 触发
- MCP notification 触发
- Connector event 触发
- Approval resolved 触发
- 条件轮询
- 事件过滤与匹配
- 生成 RuntimeTriggerEvent
- 唤醒目标 runtime

---

## 4. 不应承担职责

- 不运行 Agent Kernel
- 不运行 Subagent loop
- 不管理 BackgroundSubagentRun 生命周期
- 不管理 WorkflowStepRun 编排
- 不执行工具
- 不做权限判断
- 不渲染用户通知

---

## 5. 核心数据结构

## 5.1 TriggerRegistration

```ts
type TriggerRegistration = {
  triggerId: string
  ownerUserId: string

  triggerType:
    | "schedule"
    | "recurring"
    | "external_event"
    | "mcp_notification"
    | "webhook"
    | "connector_event"
    | "approval_resolved"
    | "condition"

  target: {
    targetType:
      | "start_workflow"
      | "launch_background_subagent"
      | "resume_background_subagent"
      | "resume_kernel_run"
      | "send_notification"

    workflowId?: string
    workflowVersion?: number
    subagentRunId?: string
    kernelRunId?: string
    notificationTemplateId?: string

    agentType?: string
    taskSpec?: SubagentTaskSpec
  }

  filter?: Record<string, unknown>

  schedule?: {
    kind: "once" | "recurring"
    runAt?: string
    cron?: string
    timezone?: string
  }

  condition?: {
    expression: Record<string, unknown>
    checkIntervalMs?: number
    expiresAt?: string
  }

  status: "active" | "paused" | "disabled"

  createdAt: string
  updatedAt: string
}
```

## 5.2 RuntimeTriggerEvent

```ts
type RuntimeTriggerEvent = {
  eventId: string
  triggerId?: string

  source:
    | "scheduler"
    | "gateway"
    | "connector"
    | "mcp"
    | "webhook"
    | "approval_center"
    | "system"

  eventType: string

  userId?: string
  sessionId?: string

  payload: Record<string, unknown>

  occurredAt: string
}
```

## 5.3 RuntimeAction

```ts
type RuntimeAction = {
  actionId: string
  sourceEventId: string

  actionType:
    | "start_workflow"
    | "launch_background_subagent"
    | "resume_background_subagent"
    | "resume_kernel_run"
    | "send_notification"

  targetRef?: string

  payload: Record<string, unknown>

  createdAt: string
}
```

---

## 6. 触发流程

```text
External / Scheduled Event
  ↓
Event Trigger Runtime
  ↓
Match TriggerRegistration
  ↓
Create RuntimeTriggerEvent
  ↓
Create RuntimeAction
  ↓
Runtime Dispatcher
  ↓
Target Runtime
```

---

## 7. 与其他模块关系

## 7.1 与 Gateway

- Gateway 接收外部渠道原始事件。
- Gateway 可将标准化事件交给 Event Trigger Runtime 匹配。
- Event Trigger Runtime 不替代 Gateway 的渠道适配。

## 7.2 与 Workflow Runtime

- Workflow Runtime 注册 workflow trigger。
- Event Trigger Runtime 触发 `start_workflow`。
- Workflow 等待事件时，Event Trigger Runtime 负责唤醒。

## 7.3 与 Subagent Runtime

- Event Trigger Runtime 可触发 `launch_background_subagent`。
- Event Trigger Runtime 可唤醒 `resume_background_subagent`。
- BackgroundSubagentRun 生命周期归 Subagent Runtime。

## 7.4 与 Permission Engine

- Approval resolved 事件进入 Event Trigger Runtime。
- 它负责匹配并唤醒等待的 run。
- 不负责审批判断。

## 7.5 与 Runtime Dispatcher

- Event Trigger Runtime 不直接调用执行模块。
- 它输出 RuntimeAction 给 Runtime Dispatcher。

---

## 8. 关键原则

1. Event Trigger Runtime 只做触发与唤醒。
2. 不管理后台任务生命周期。
3. 不编排 Workflow Step。
4. 不执行工具。
5. 不判断权限。
6. 所有触发都必须事件化。
7. 触发目标通过 Runtime Dispatcher 分发。

---

# 23. Runtime Wait Condition：外部事件等待与唤醒机制

## 23.1 设计背景

Event Trigger Runtime 不仅要支持定时触发、Webhook、MCP notification、Connector event，也需要支持一类更常见的运行时等待场景：

- 等待项目依赖安装完成
- 等待命令执行结束
- 等待某个服务重启完成
- 等待进程启动
- 等待端口开放
- 等待 HTTP health check 成功
- 等待日志中出现某个关键模式
- 等待文件生成或变更

这类场景本质上属于：

```text
Runtime Wait Condition
```

它不是自然语言输入，也不是普通 Workflow 编排，而是：

> **某个运行时已经发起了外部动作，现在需要等待外部状态满足某个条件后继续执行。**

---

## 23.2 职责边界

Event Trigger Runtime 不负责执行安装、重启、启动进程等动作。

正确边界是：

```text
Tool Plane / Subagent Runtime / Workflow Runtime
  负责发起外部动作

Event Trigger Runtime
  负责监听外部动作状态，并在条件满足后唤醒目标运行时
```

例如：

```text
Tool Plane 启动 npm install
  → 返回 OperationRef
  → Event Trigger Runtime 注册 WaitCondition
  → ProcessWatcher 监听进程退出
  → exitCode = 0 后生成 RuntimeTriggerEvent
  → Runtime Dispatcher 恢复 WorkflowRun / BackgroundSubagentRun
```

---

## 23.3 总体流程

```text
Workflow Runtime / Subagent Runtime
        │
        │ 发起安装 / 重启动作
        ▼
Tool Plane
        │
        │ 返回 OperationRef
        ▼
Event Trigger Runtime
        │
        │ 注册 WaitCondition
        ▼
Event Source Adapter / Local Worker
        │
        │ 监听进程、日志、端口、health endpoint、service 状态
        ▼
Condition Evaluator
        │
        │ 判断条件满足 / 失败 / 超时
        ▼
RuntimeTriggerEvent
        │
        ▼
Runtime Dispatcher
        │
        ▼
恢复 WorkflowRun / BackgroundSubagentRun / KernelRun
```

---

## 23.4 OperationRef

长耗时工具在异步模式下启动外部动作后，应返回 `OperationRef`。

```ts
type OperationRef = {
  operationId: string

  operationType:
    | "process"
    | "command"
    | "service_restart"
    | "container_restart"
    | "install"
    | "deployment"
    | "migration"
    | "custom"

  source: {
    adapterType:
      | "local_worker"
      | "mcp_server"
      | "docker"
      | "systemd"
      | "kubernetes"
      | "remote_connector"

    hostId?: string
    workspaceId?: string
    cwd?: string
  }

  process?: {
    pid?: number
    processGroupId?: string
    command?: string
    args?: string[]
  }

  service?: {
    serviceName?: string
    serviceType?: "systemd" | "docker" | "kubernetes" | "custom"
  }

  logs?: {
    logStreamRef?: string
    logFileRef?: string
  }

  startedAt: string
}
```

### 示例：npm install

```ts
{
  operationId: "op_install_123",
  operationType: "install",
  source: {
    adapterType: "local_worker",
    workspaceId: "project_x",
    cwd: "/repo/app"
  },
  process: {
    pid: 39281,
    processGroupId: "pg_39281",
    command: "npm install"
  },
  logs: {
    logStreamRef: "log_install_123"
  },
  startedAt: "2026-04-25T00:00:00Z"
}
```

---

## 23.5 WaitCondition

Event Trigger Runtime 注册的不是模糊的“等一下”，而是明确的等待条件。

```ts
type WaitCondition = {
  waitConditionId: string

  conditionType:
    | "process_exit"
    | "command_completed"
    | "service_ready"
    | "port_open"
    | "http_health_ok"
    | "log_pattern_matched"
    | "file_changed"
    | "file_exists"
    | "connector_event_received"
    | "mcp_notification_received"
    | "custom_probe"

  operationRef?: OperationRef

  match: Record<string, unknown>

  successCriteria?: {
    requiredConsecutiveSuccesses?: number
    stabilizationWindowMs?: number
    exitCode?: number
    timeoutMs?: number
  }

  failureCriteria?: {
    exitCodeNotIn?: number[]
    logPattern?: string
    maxFailures?: number
    timeoutMs?: number
  }

  pollingPolicy?: {
    enabled: boolean
    intervalMs: number
    backoff?: "none" | "linear" | "exponential"
    maxIntervalMs?: number
  }

  target: {
    targetType:
      | "resume_workflow_run"
      | "resume_background_subagent"
      | "resume_kernel_run"
      | "notify_user"

    workflowRunId?: string
    stepRunId?: string
    backgroundRunId?: string
    subagentRunId?: string
    kernelRunId?: string
  }

  createdAt: string
  expiresAt?: string
}
```

---

## 23.6 示例：等待项目安装完成

Workflow Step：

```text
安装项目依赖
```

执行链路：

```text
WorkflowStep: install_dependencies
  ↓
Tool Plane: command.run_background("npm install")
  ↓
返回 OperationRef
  ↓
Event Trigger Runtime 注册 WaitCondition
  ↓
ProcessEventAdapter 监听进程退出
  ↓
exitCode = 0 → 唤醒下一步
  ↓
exitCode != 0 → 标记 step failed
```

WaitCondition 示例：

```ts
{
  conditionType: "process_exit",
  operationRef: {
    operationId: "op_install_123",
    operationType: "install"
  },
  match: {
    processGroupId: "pg_39281"
  },
  successCriteria: {
    exitCode: 0,
    timeoutMs: 1800000
  },
  failureCriteria: {
    exitCodeNotIn: [0],
    timeoutMs: 1800000
  },
  target: {
    targetType: "resume_workflow_run",
    workflowRunId: "wf_run_001",
    stepRunId: "step_install"
  }
}
```

注意：

```text
安装完成 ≠ 项目可运行
```

因此更稳妥的 Workflow 应该拆成：

```text
Step 1: npm install 完成，exitCode = 0
Step 2: npm test / npm run build / health check 通过
```

---

## 23.7 示例：等待服务重启完成

服务重启不能只看 restart 命令退出。

更稳妥的条件组合：

```text
restart command exitCode = 0
AND service status = active
AND port is open
AND health endpoint 连续成功 N 次
AND stabilization window 已经过
```

WaitCondition 示例：

```ts
{
  conditionType: "service_ready",
  operationRef: {
    operationId: "op_restart_api_001",
    operationType: "service_restart"
  },
  match: {
    serviceName: "api-server",
    serviceType: "systemd"
  },
  successCriteria: {
    requiredConsecutiveSuccesses: 3,
    stabilizationWindowMs: 10000,
    timeoutMs: 120000
  },
  pollingPolicy: {
    enabled: true,
    intervalMs: 2000,
    backoff: "linear",
    maxIntervalMs: 10000
  },
  target: {
    targetType: "resume_background_subagent",
    backgroundRunId: "bg_run_001",
    subagentRunId: "sa_run_001"
  }
}
```

可用 probe：

```text
systemctl is-active api-server
curl http://localhost:8080/health
检查端口 8080 是否监听
检查日志中是否出现 "Server started"
```

---

## 23.8 RuntimeTriggerEvent 扩展

条件满足、失败或超时后，Event Trigger Runtime 生成统一事件。

```ts
type RuntimeTriggerEvent = {
  eventId: string
  triggerId?: string
  waitConditionId?: string

  source:
    | "process_watcher"
    | "service_watcher"
    | "log_watcher"
    | "file_watcher"
    | "health_checker"
    | "scheduler"
    | "connector"
    | "mcp"
    | "webhook"
    | "approval_center"

  eventType:
    | "operation_completed"
    | "operation_failed"
    | "service_ready"
    | "service_failed"
    | "condition_timeout"
    | "log_pattern_matched"
    | "file_changed"
    | "port_open"

  correlation: {
    operationId?: string
    workflowRunId?: string
    stepRunId?: string
    backgroundRunId?: string
    subagentRunId?: string
    kernelRunId?: string
  }

  payload: {
    success: boolean
    exitCode?: number
    matchedCondition?: string
    outputRef?: string
    errorSummary?: string
    rawEventRef?: string
    lastObservedState?: Record<string, unknown>
  }

  occurredAt: string
}
```

---

## 23.9 Event Source Adapter

Event Trigger Runtime 不直接读取操作系统、Docker、Kubernetes、日志文件，而是通过适配器接入外部状态。

推荐适配器：

```text
Event Trigger Runtime
  ├─ ProcessEventAdapter
  ├─ CommandOperationAdapter
  ├─ FileWatcherAdapter
  ├─ LogWatcherAdapter
  ├─ PortProbeAdapter
  ├─ HttpHealthCheckAdapter
  ├─ SystemdAdapter
  ├─ DockerAdapter
  ├─ KubernetesAdapter
  └─ MCPNotificationAdapter
```

如果 Agent 平台在云端，而需要观察用户本地项目安装，则必须通过：

```text
Local Runtime Worker / Local Connector / MCP Server
```

云端 Event Trigger Runtime 本身不能直接观察用户本地进程。

---

## 23.10 触发方式分类

### Push-based

外部系统主动推送：

```text
Webhook
MCP notification
Connector event
Process supervisor callback
Docker event stream
Kubernetes watch
```

### Polling-based

系统定期检查：

```text
curl /health
systemctl is-active
docker inspect
ps / pid check
端口探测
文件是否存在
```

### Stream-based

持续监听流：

```text
stdout / stderr
log file tail
Docker logs
Kubernetes pod logs
```

---

## 23.11 静默等待失败防护

所有 WaitCondition 都必须有：

- timeout
- heartbeat
- progress event
- failure criteria
- max polling failures
- last observed state

### 安装等待

```text
如果 30 分钟没有退出 → timeout
如果 5 分钟没有任何日志 → no_progress
如果日志出现 "ERR!" → possible_failure
如果 exitCode != 0 → failed
```

### 服务 ready 等待

```text
如果 2 分钟内 health 一直失败 → timeout
如果端口一直不开 → failed
如果服务状态变 failed → failed
如果 health 连续 3 次成功 → ready
```

---

## 23.12 幂等与恢复

WaitCondition 必须持久化，系统重启后可以恢复等待。

```text
WaitConditionRegistry / EventTriggerStore
```

同一个外部事件可能重复到达，因此唤醒必须幂等：

```text
idempotencyKey = waitConditionId + operationId + eventType
```

重复事件不应导致 Workflow step 或 BackgroundSubagentRun 被重复恢复。

---

## 23.13 与 Workflow Runtime 的关系

如果是固化 Workflow：

```text
WorkflowStep: run_install
  ↓
Tool Plane 启动安装
  ↓
Workflow Runtime 将 step 状态设为 waiting_for_external_event
  ↓
Event Trigger Runtime 注册 WaitCondition
  ↓
条件满足
  ↓
Workflow Runtime resume step
```

Workflow Runtime 负责：

- step 状态
- step input / output
- step retry
- step failure policy
- workflow 是否继续

Event Trigger Runtime 负责：

- 等待条件
- 外部状态观察
- 唤醒事件

---

## 23.14 与 Subagent Runtime 的关系

如果是后台 Subagent：

```text
BackgroundSubagentRun
  ↓
Subagent 调用 Tool Plane 启动安装
  ↓
Subagent Runtime 进入 waiting_for_external_event
  ↓
Event Trigger Runtime 注册 WaitCondition
  ↓
安装完成事件触发
  ↓
Subagent Runtime 恢复 subagent loop
```

Subagent Runtime 负责：

- BackgroundSubagentRun 状态
- checkpoint
- watchdog
- 子 Agent 继续执行

Event Trigger Runtime 只负责：

- 判断外部事件是否发生
- 触发 resume

---

## 23.15 与 Tool Plane 的关系

Tool Plane 是外部动作的发起者。

每个长耗时工具都应支持：

```ts
type ToolExecutionMode = "sync" | "async"
```

异步模式下，Tool Result 应返回：

```ts
type AsyncToolResult = {
  status: "started"
  operationRef: OperationRef
  suggestedWaitConditions?: WaitCondition[]
  logRef?: string
}
```

这样 Event Trigger Runtime 才知道应该等待什么。

---

## 24. Runtime Wait Condition 关键原则

1. Event Trigger Runtime 不负责执行安装、重启或启动进程，只负责等待和唤醒。
2. 长耗时工具必须返回 `OperationRef`。
3. 等待条件必须显式建模为 `WaitCondition`。
4. 服务重启不应只看进程退出，应判断 readiness。
5. 所有等待必须有 timeout。
6. 等待状态必须能前台展示。
7. WaitCondition 必须可恢复。
8. 唤醒必须幂等。
9. 云端平台观察本地进程时必须依赖 Local Worker / Connector / MCP Server。
10. 条件满足后统一生成 `RuntimeTriggerEvent`，由 Runtime Dispatcher 唤醒目标运行时。
