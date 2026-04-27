# 错误 / 恢复 / 打断 / 取消策略文档 v1

## 1. 文档目的

本文档定义个人助理型 Agent 平台在错误、恢复、用户打断、取消、暂停、重试、超时和重复事件场景下的统一处理策略。

覆盖范围：

```text
Foreground Conversation Agent
PlannerRun
Runtime Dispatcher
Agent Kernel
Tool Plane
Subagent Runtime
BackgroundSubagentRun
Workflow Runtime
Event Trigger Runtime
Permission / Approval Engine
Connector Runtime
Memory / Summary System
```

---

## 2. 统一原则

### 2.1 前台必须可响应

长任务、等待、失败恢复不应长期占用 Foreground Conversation Agent。

前台应尽快返回：

```text
- 已开始
- 正在后台执行
- 需要你确认
- 当前失败，是否重试
- 已取消
- 已暂停
```

### 2.2 所有已接受动作必须有终态

尤其是工具调用：

```text
tool_use accepted
  → 必须有 tool_result terminal state
```

即使被取消、中断、超时，也需要 synthetic terminal result。

### 2.3 外部副作用默认不可自动重放

Replay / Recovery 默认只读。

涉及外部写操作时：

```text
必须 dry-run 或重新审批
```

### 2.4 取消应尽力级联，但不能假装成功

取消下游任务时：

```text
可取消则取消
不可取消则标记 cancellation_requested
已产生副作用则记录 partial side effect
```

### 2.5 恢复必须基于 checkpoint + event

不能靠 LLM 猜测恢复状态。

恢复输入应来自：

```text
checkpoint
event range
working summary
runtime store current state
tool terminal result
```

---

## 3. 错误分类

```ts
type RuntimeErrorCategory =
  | "user_input_error"
  | "permission_error"
  | "approval_rejected"
  | "connector_auth_error"
  | "connector_rate_limited"
  | "tool_validation_error"
  | "tool_execution_error"
  | "model_error"
  | "context_overflow"
  | "timeout"
  | "external_event_timeout"
  | "workflow_step_error"
  | "subagent_error"
  | "planner_error"
  | "dispatcher_error"
  | "duplicate_event"
  | "state_conflict"
  | "system_internal_error"
```

---

## 4. 错误可恢复性

```ts
type Recoverability =
  | "recoverable_auto"
  | "recoverable_with_user"
  | "recoverable_with_approval"
  | "retryable_later"
  | "non_recoverable"
```

### 示例

| 错误 | 可恢复性 | 处理 |
|---|---|---|
| connector rate limit | retryable_later | backoff retry |
| OAuth 失效 | recoverable_with_user | 请求重新授权 |
| tool schema validation failed | recoverable_auto / non_recoverable | 修正输入或失败 |
| approval rejected | recoverable_with_user | 重规划或停止 |
| context overflow | recoverable_auto | compact |
| user missing info | recoverable_with_user | 前台提问 |
| external wait timeout | recoverable_with_user / retryable_later | 询问重试或失败 |
| destructive action denied | non_recoverable for that action | 不能绕过，需重规划 |

---

## 5. 统一错误对象

```ts
type RuntimeError = {
  errorId: string
  category: RuntimeErrorCategory
  code: string
  message: string

  recoverability: Recoverability

  source: {
    module: string
    runId?: string
    plannerRunId?: string
    workflowRunId?: string
    workflowStepRunId?: string
    backgroundRunId?: string
    toolCallId?: string
    actionId?: string
    connectorId?: string
  }

  userVisible?: {
    title: string
    summary: string
    suggestedActions?: string[]
  }

  technical?: {
    stackRef?: string
    rawErrorRef?: string
    retryAfterMs?: number
  }

  createdAt: string
}
```

---

## 6. 用户打断策略

用户打断包括：

```text
暂停
取消
修改目标
插入新问题
切换主题
要求查看进度
要求跳过某步
```

### 6.1 Foreground 处理流程

```text
User interrupt
  ↓
Gateway
  ↓
Foreground Conversation Agent
  ↓
Resolve target active work
  ↓
Choose action:
  - answer inline
  - pause target
  - cancel target
  - patch PlannerRun
  - query status
  - spawn new task
```

### 6.2 目标消解

Foreground Agent 应通过 ActiveWorkProjection 判断“它”指向谁。

优先级：

```text
1. 用户明确提到的 plannerRunId / task name / artifact
2. 最近 active work
3. pending approval 所属任务
4. 当前 session active plan
5. 如果歧义高，询问用户
```

---

## 7. 取消策略

### 7.1 CancellationRequest

```ts
type CancellationRequest = {
  cancellationId: string
  requestedBy: "user" | "system" | "timeout" | "policy"
  reason: string

  target: {
    targetType:
      | "planner_run"
      | "kernel_run"
      | "tool_execution"
      | "subagent_run"
      | "background_run"
      | "workflow_run"
      | "workflow_step_run"
      | "runtime_action"
      | "wait_condition"

    targetId: string
  }

  cascadePolicy: {
    cancelChildren: boolean
    cancelActiveTools: boolean
    cancelBackgroundRuns: boolean
    cancelWaitConditions: boolean
    notifyUser: boolean
  }

  createdAt: string
}
```

### 7.2 可取消性

| 对象 | 可取消性 |
|---|---|
| PlannerRun | 可取消，需处理 activeExecutionRefs |
| KernelRun | 可取消，需终止 loop |
| ToolExecution | 取决于工具 interruptBehavior |
| BackgroundSubagentRun | 可请求取消，可能需要 watchdog |
| WorkflowRun | 可取消，需取消 active step |
| WorkflowStepRun | 可取消，取决于 step type |
| ApprovalRequest | 可取消 / 过期 |
| WaitCondition | 可取消 |
| Connector async operation | 取决于 connector 能力 |

### 7.3 取消级联

取消 PlannerRun 时：

```text
PlannerRun cancelled
  → active RuntimeAction cancel requested
  → active KernelRun / ToolExecution / BackgroundRun cancel requested
  → WaitCondition cancelled
  → pending ApprovalRequest cancelled if scoped only to this run
  → PlanStep cancelled
  → Transcript commit
  → Summary update
```

取消 WorkflowRun 时：

```text
WorkflowRun cancelled
  → active WorkflowStepRun cancelled
  → step 下游 RuntimeAction cancel requested
  → active WaitCondition cancelled
  → Notification optional
```

### 7.4 取消结果

```ts
type CancellationResult = {
  cancellationId: string
  status:
    | "completed"
    | "partial"
    | "not_cancellable"
    | "already_terminal"
    | "failed"

  cancelledRefs?: string[]
  stillRunningRefs?: string[]

  sideEffectNotice?: {
    externalSideEffectsMayHaveOccurred: boolean
    summary?: string
  }

  userVisibleSummary?: string
}
```

---

## 8. 暂停与恢复策略

### 8.1 Pause

暂停表示：

```text
不再派发新动作
保留状态和 checkpoint
已执行中的不可中断操作可以继续到安全点
```

### 8.2 Resume

恢复必须检查：

```text
目标状态仍可恢复
权限 grant 是否仍有效
connector auth 是否有效
上下文是否需要重新组装
是否有过期 WaitCondition / ApprovalRequest
```

### 8.3 PauseRequest

```ts
type PauseRequest = {
  pauseId: string
  targetType: "planner_run" | "background_run" | "workflow_run"
  targetId: string
  reason: string
  createdAt: string
}
```

---

## 9. Retry 策略

### 9.1 RetryPolicy

```ts
type RetryPolicy = {
  maxAttempts: number
  backoff: "none" | "fixed" | "linear" | "exponential"
  initialDelayMs?: number
  maxDelayMs?: number

  retryOn?: RuntimeErrorCategory[]
  doNotRetryOn?: RuntimeErrorCategory[]

  requireApprovalBeforeRetry?: boolean
}
```

### 9.2 默认规则

```text
可自动 retry：
- connector transient error
- rate limit with retryAfter
- network timeout
- model transient error
- queue timeout

不可自动 retry：
- user rejected approval
- hard policy denied
- destructive action already partially executed
- invalid user input without clarification
- connector auth revoked
```

### 9.3 幂等要求

重试外部写操作前必须确认：

```text
有 idempotencyKey
或 connector 支持幂等
或用户重新确认
```

---

## 10. Recovery 策略

### 10.1 恢复输入

```text
checkpoint
eventRange
workingSummary
runtime state store
tool terminal results
approval state
wait condition state
artifact refs
```

### 10.2 RecoveryRequest

```ts
type RecoveryRequest = {
  recoveryId: string

  target: {
    targetType:
      | "kernel_run"
      | "planner_run"
      | "background_run"
      | "workflow_run"
      | "workflow_step_run"

    targetId: string
  }

  recoveryMode:
    | "resume_from_checkpoint"
    | "rebuild_state_from_events"
    | "retry_failed_step"
    | "skip_failed_step"
    | "manual_user_resolution"

  safetyPolicy: {
    allowExternalWrites: boolean
    requireApprovalForSideEffects: boolean
    dryRunFirst: boolean
  }

  createdAt: string
}
```

### 10.3 RecoveryResult

```ts
type RecoveryResult = {
  recoveryId: string
  status:
    | "completed"
    | "partial"
    | "requires_user"
    | "requires_approval"
    | "failed"

  rebuiltStateRef?: string
  resumedRunId?: string
  userVisibleSummary?: string
}
```

---

## 11. Compact / Context Overflow 恢复

当 KernelRun 或 PlannerRun 遇到上下文压力：

```text
soft limit reached
  → Context Manager compact hints
  → WorkingSummary generation
  → CompactSummary
  → ContextBundle rebuilt
  → continue

hard limit reached
  → emergency compact
  → mustKeep refs
  → if failed, stop with recoverable error
```

Compact 不应丢失：

```text
active tool_use / tool_result pair
pending approval
active PlanStep
artifact ref
last user instruction
permission scope
```

---

## 12. Approval 失败 / 拒绝策略

### 12.1 用户拒绝审批

```text
ApprovalRequest rejected
  → Event Trigger Runtime approval_resolved
  → target runtime resume
  → PlannerRun replanning 或 PlanStep failed/skipped
```

规则：

```text
不能绕过用户拒绝。
只能重规划成不需要该动作的路径，或停止任务。
```

### 12.2 审批超时

```text
ApprovalRequest expired
  → target waiting state timeout
  → Foreground 通知用户
  → 可重新发起 approval 或取消任务
```

---

## 13. WaitCondition 超时策略

```text
WaitCondition timeout
  → RuntimeTriggerEvent condition_timeout
  → RuntimeAction resume target
  → target runtime marks step failed or asks user
```

恢复选项：

```text
重试等待
改用其他检测条件
跳过该步骤
取消任务
```

---

## 14. Connector Auth 失效策略

```text
Connector auth_required
  → ToolExecution failed/auth_required
  → Permission / Connector Runtime 生成 reauth request
  → Gateway 通知用户
  → 目标 run waiting_for_user 或 failed
```

规则：

```text
不能静默要求模型继续猜测。
不能绕过 connector auth。
```

---

## 15. 重复事件 / 幂等策略

高风险重复来源：

```text
webhook retry
scheduler duplicate
approval_resolved duplicate
network retry
user double click
workflow retry
```

Runtime Dispatcher 必须使用 idempotencyKey。

重复行为：

```text
return_previous
drop
fail
```

推荐：

```text
外部事件唤醒：return_previous 或 drop
写操作：return_previous
用户重复点击：return_previous
不安全重复：fail
```

---

## 16. Workflow Step 失败策略

WorkflowStep 的 onFailure：

```text
fail_workflow
continue
retry
ask_user
fallback_step
```

### 16.1 fail_workflow

当前 step 失败导致整个 workflow failed。

### 16.2 continue

记录失败，但继续后续可执行 step。

### 16.3 retry

按 RetryPolicy 重试。

### 16.4 ask_user

进入 waiting_for_user，由 Foreground / Gateway 请求用户决定。

### 16.5 fallback_step

跳到 fallbackStepId。

---

## 17. PlannerRun 失败策略

PlannerRun 失败时应区分：

```text
planning_failed
dispatch_failed
execution_failed
replan_failed
max_replan_reached
user_cancelled
policy_denied
```

处理：

```text
可恢复：replanning
需要用户：waiting_for_user
需要审批：waiting_for_approval
不可恢复：failed
用户取消：cancelled
```

---

## 18. BackgroundSubagentRun 卡死策略

Watchdog 应检测：

```text
heartbeat missing
no progress timeout
stuck on same stage
resource exceeded
child tool timeout
```

处理：

```text
1. 标记 recovering
2. 尝试从 checkpoint 恢复
3. 失败则 failed 或 waiting_for_user
4. 通知 Foreground / Gateway
```

---

## 19. ToolExecution 中断策略

### 19.1 interruptBehavior

```text
cancel
block
finish_current
```

### 19.2 synthetic terminal result

如果工具被取消或 sibling failure 影响：

```ts
type SyntheticToolResult = {
  toolCallId: string
  status: "cancelled" | "aborted" | "timeout"
  isSynthetic: true
  modelFacingContent: string
  userVisibleSummary?: string
}
```

---

## 20. 用户可见沟通策略

失败和等待状态必须用户可理解。

推荐格式：

```text
发生了什么
影响是什么
我已经做了什么
你可以选择什么
```

示例：

```text
我在整理邮件时遇到 Gmail 授权失效，因此后台任务已暂停。
已经完成的邮件摘要已保存。
你可以重新授权后继续，或取消这个任务。
```

---

## 21. Transcript / Summary 写入规则

以下情况必须提交 Transcript：

```text
用户可见回复
审批请求
审批结果
任务完成
任务失败
任务取消
需要用户操作
重要进度更新
```

以下情况应触发 Summary：

```text
PlannerRun completed / failed / cancelled
BackgroundSubagentRun completed / failed / cancelled
WorkflowRun completed / failed
KernelRun compact / completed
用户修改长期目标
```

---

## 22. 审计要求

以下必须写 AuditRecord：

```text
外部写操作
权限 allow / ask / deny
审批请求和响应
用户取消高风险任务
bypass permission
connector resource access
memory write / delete
workflow definition change
planner dispatch background run
replay recovery action
```

---

## 23. MVP 实现建议

MVP 必做：

```text
- RuntimeError schema
- CancellationRequest / Result
- RetryPolicy 基础版
- Dispatcher idempotency
- Tool synthetic terminal result
- Kernel checkpoint recovery 基础版
- BackgroundSubagent watchdog 基础版
- WorkflowStep onFailure 基础版
- Approval rejected / expired 处理
- WaitCondition timeout 处理
```

MVP 可简化：

```text
- Recovery 只支持 resume_from_checkpoint
- Replay 只支持 timeline_only
- 取消只做 best-effort
- Workflow fallback_step 后置
```

暂不做：

```text
- 完整自动事故分析
- 多版本状态重建
- 复杂 side-effect compensation
- 跨系统事务回滚
```

---

## 24. 关键结论

```text
1. 前台打断必须优先响应。
2. 已接受的工具调用必须有终态。
3. 外部写操作不能默认自动重放。
4. 取消是 best-effort，不保证撤销已发生副作用。
5. PlannerRun 失败优先重规划，其次询问用户，最后失败。
6. Workflow 失败策略由 step onFailure 决定。
7. Approval 拒绝不能被绕过。
8. WaitCondition 超时必须事件化唤醒目标。
9. Recovery 必须基于 checkpoint + event，而不是模型猜测。
10. 所有失败、取消、恢复都必须进入 Event / Transcript / Audit 的对应链路。
```
