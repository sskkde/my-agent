# Task / Workflow Runtime 重构说明 v2

## 1. 重构背景

原 Task / Workflow Runtime v1 同时承担了：

- TaskDefinition
- TaskInstance
- TaskRun
- WorkflowDefinition
- WorkflowRun
- JobQueue
- 后台任务
- Subagent 后台管理
- Trigger
- Scheduler
- Checkpoint
- Recovery
- Notification

该设计完整但过宽，容易与 Subagent Runtime 和 Workflow Runtime 产生重复。

---

## 2. 重构结论

原 Task / Workflow Runtime 拆为：

```text
Event Trigger Runtime
  负责触发与唤醒

Workflow Runtime
  负责可视化固化 Workflow

Subagent Runtime
  负责后台 Subagent 生命周期

Planner / Intent Router
  负责自然语言临时 Plan
```

---

## 3. 被移除 / 迁移的职责

## 3.1 后台任务管理

迁移到：

```text
Subagent Runtime / BackgroundSubagentRun
```

## 3.2 触发器管理

迁移到：

```text
Event Trigger Runtime
```

## 3.3 固化 Workflow 编排

迁移到：

```text
Workflow Runtime
```

## 3.4 临时自然语言 Plan

归属：

```text
Planner / Intent Router / Agent Kernel
```

---

## 4. 不再单独保留宽泛 Task Runtime

MVP 阶段不再保留一个宽泛的 Task Runtime。

如果后续需要，可以在 Workflow Runtime 之上增加：

- Task Center
- Routine Dashboard
- Workflow Template
- User Goal Tracking

但不建议重新引入与 Subagent Runtime 重复的后台任务生命周期。

---

## 5. 新职责映射表

| 原职责 | 新归属 |
|---|---|
| scheduled trigger | Event Trigger Runtime |
| recurring trigger | Event Trigger Runtime |
| webhook trigger | Event Trigger Runtime |
| approval resolved wakeup | Event Trigger Runtime |
| background subagent task | Subagent Runtime |
| subagent checkpoint | Subagent Runtime |
| subagent artifact | Subagent Runtime |
| workflow definition | Workflow Runtime |
| workflow run | Workflow Runtime |
| workflow step | Workflow Runtime |
| temporary plan | Planner / Agent Kernel |
| plan to workflow | PlanToWorkflowCompiler |
| notification channel | Gateway / Notification Center |

---

## 6. 重构后的推荐目录结构

```text
src/
  gateway/
    channel-adapters/
    inbound-normalizer/
    notification-center/

  planner/
    intent-router/
    plan-runtime/
    plan-to-workflow-compiler/

  workflows/
    drafts/
    registry/
    versions/
    runtime/
    steps/
    recovery/
    templates/

  triggers/
    registry/
    scheduler/
    webhook/
    mcp/
    connectors/
    approval/
    dispatcher/

  agents/
    subagent-runtime/
    background-runs/
    checkpoints/
    artifacts/

  runtime-dispatcher/
```

---

## 7. 最终原则

> 不再用一个 Task Runtime 同时管理所有长期状态，而是按输入来源和执行形态拆分。

- 自然语言临时任务：Planner
- 可视化固化流程：Workflow Runtime
- 定时与事件触发：Event Trigger Runtime
- 后台智能执行：Subagent Runtime


---

# 8. Foreground / PlannerRun 架构补充

在原重构结论基础上，新增前台与规划层拆分：

```text
Foreground Conversation Agent
  负责自然语言前台会话、意图判断、直接委派、任务状态展示、用户打断处理

Planner Agent Template / PlannerRun
  负责复杂任务计划、重规划、执行者选择和 RuntimeAction 生成
```

原 `Planner / Intent Router` 进一步拆分为：

```text
Intent Router
  下沉为 Foreground Conversation Agent 的内部能力

Planner
  升级为 Planner Agent Template + PlannerRunManager + PlanRuntime
```
