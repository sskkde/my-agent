# Subagent Runtime 更新补充 v4：后台 Subagent 与 PlannerRun 边界

## 1. 更新目的

本补充用于对齐新的架构边界：

- Task Runtime 的后台任务能力并入 Subagent Runtime
- Subagent Runtime 正式管理 BackgroundSubagentRun
- Workflow Runtime 只负责固化 Workflow 编排
- Event Trigger Runtime 只负责触发与唤醒

---

## 2. 新增 BackgroundSubagentRun

```ts
type BackgroundSubagentRun = {
  backgroundRunId: string

  subagentCode: string
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

  launchSource:
    | "intent_router"
    | "event_trigger"
    | "main_agent"
    | "workflow"
    | "system"

  taskSpec: SubagentTaskSpec

  triggerRef?: {
    triggerId?: string
    eventId?: string
  }

  checkpointId?: string

  artifactRefs?: string[]

  notificationPolicy?: {
    notifyOnStart?: boolean
    notifyOnProgress?: boolean
    notifyOnComplete?: boolean
    notifyOnFailure?: boolean
  }

  createdAt: string
  updatedAt: string
  completedAt?: string
}
```

---

## 3. Subagent Runtime 新增职责

- 创建 BackgroundSubagentRun
- 管理后台 Subagent 状态
- 持久化后台 Subagent checkpoint
- Watchdog 监控后台 Subagent
- 恢复后台 Subagent
- 归档后台 Subagent artifact
- 完成后生成 NotificationRequest
- 接收 Event Trigger Runtime 的 resume 事件

---

## 4. Subagent Runtime 不负责

- 可视化 Workflow 编排
- WorkflowDefinition 版本管理
- WorkflowStepRun 编排
- TriggerRegistration 管理
- Scheduler
- Webhook 匹配
- MCP notification 匹配

---

## 5. 与 Workflow Runtime 的关系

Workflow 的 `subagent_run` step 可以启动 Subagent。

```text
Workflow Runtime
  → Runtime Dispatcher
  → Subagent Runtime
  → BackgroundSubagentRun 或 Sync SubagentRun
```

Workflow Runtime 只记录：

- stepRunId
- subagentRunId
- status
- outputRef

Subagent 的 loop、checkpoint、watchdog、artifact 归 Subagent Runtime。

---

## 6. 与 Event Trigger Runtime 的关系

Event Trigger Runtime 可触发：

```text
launch_background_subagent
resume_background_subagent
```

但 BackgroundSubagentRun 生命周期归 Subagent Runtime。

---

## 7. 与 Planner / Intent Router 的关系

自然语言产生的临时任务如果需要后台执行：

```text
Gateway
  → Intent Router
  → route = background_subagent
  → Runtime Dispatcher
  → Subagent Runtime
  → BackgroundSubagentRun
```

Intent Router 不直接执行后台任务，只输出路由决策。

---

## 8. 与 Gateway / Notification Center 的关系

Subagent Runtime 可以在后台 Subagent 完成、失败、阻塞时生成通知请求：

```ts
type BackgroundSubagentNotificationRequest = {
  backgroundRunId: string
  subagentCode: string
  subagentRunId: string
  userId: string
  notificationType:
    | "completed"
    | "failed"
    | "blocked"
    | "needs_approval"
  summary: string
  artifactRefs?: string[]
}
```

通知实际发送仍由 Gateway / Notification Center 负责。

---

## 9. 关键结论

1. 后台 Subagent 生命周期归 Subagent Runtime。
2. Workflow Runtime 只编排固化 Workflow。
3. Event Trigger Runtime 只触发和唤醒。
4. Subagent Runtime 是后台智能执行单元的 owner。
5. Gateway 只负责自然语言入口和通知渠道，不负责后台 Subagent 状态。


---

# 10. 与 PlannerRun 的关系

PlannerRun 可以为复杂任务选择和启动 Subagent，但不拥有 Subagent 生命周期。

推荐链路：

```text
PlannerRun
  → RuntimeAction: launch_subagent / launch_background_subagent
  → Runtime Dispatcher
  → Subagent Runtime
  → SubagentRun / BackgroundSubagentRun
```

边界：

- PlannerRun 负责决定是否需要 Subagent、选择 agentType、定义 taskSpec。
- Runtime Dispatcher 负责分发、幂等、权限预检查和审计。
- Subagent Runtime 负责创建、运行、checkpoint、watchdog、恢复、artifact 和完成通知。
- Foreground Conversation Agent 通过 ActiveWorkProjection 查看 PlannerRun 与 BackgroundSubagentRun 状态。

PlannerRun 与 BackgroundSubagentRun 可以绑定，但二者不是同一个对象：

```text
PlannerRun = 计划与重规划实例
BackgroundSubagentRun = 后台执行实例
```
