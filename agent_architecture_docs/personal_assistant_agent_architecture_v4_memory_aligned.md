# 个人助理型 Agent 项目背景与总体架构设计文档 v6（Foreground / Planner Agent 对齐版）

> 合并来源：
>
> - 《个人助理型 Agent 项目背景与架构设计文档》
> - 《架构边界更新文档 v2：Gateway / Planner / Workflow / Event Trigger / Subagent Runtime》
>
> 本版重点：在保留项目背景、Claude Code 架构借鉴和 12 个核心模块设计的基础上，合并最新确定的运行时边界：
>
> - Gateway 负责自然语言与外部渠道输入
> - Foreground Conversation Agent 负责前台会话、意图判断、用户自定义助手人格、直接委派和 PlannerRun 创建
> - Planner Agent Template / PlannerRun 负责复杂任务的计划、重规划、agent 协调和 RuntimeAction 生成
> - Workflow Runtime 作为与 Gateway 平行的可视化固化流程入口
> - Event Trigger Runtime 负责触发与唤醒
> - Subagent Runtime 负责同步 / 后台 Subagent 的具体执行、监控、恢复和产物
> - Runtime Dispatcher 负责统一分发结构化运行请求
> - 临时 Plan 可经用户确认转化为 WorkflowDraft，再固化为可复用 WorkflowDefinition
> - Memory System 升级为分层历史与记忆体系：Event Store / Transcript Store / Summary Store / Long-term Memory Store
> - WorkingSummary、SessionMemory、Rolling Summary 等摘要型数据统一进入 Summary Store，并通过 summaryType 区分语义
> - SessionMemory 作为 Planner 的会话状态输入，Planner 通过 PlannerStatePatch 反向更新会话状态

---

## 1. 文档目的

本文档用于沉淀当前个人助理型 Agent 项目的背景、目标、参考对象、源码分析结论，以及基于 Claude Code 架构思路抽象出的系统设计方案。

本合并版主要服务于以下用途：

1. 作为后续系统设计与开发实现的统一参考。
2. 作为给开发 Agent / 工程团队的背景输入材料。
3. 作为后续继续细化模块职责、输入输出、数据结构和开发任务的基础文档。
4. 统一旧版总体架构与新版运行时边界，避免 Task / Workflow / Subagent / Gateway 职责重叠。

---

## 2. 项目背景

当前目标是设计一个**类似 OpenClaw，但更偏“个人助理型”场景的 Agent 平台**。

和传统 coding agent 相比，个人助理型 Agent 更强调：

- 处理个人事务，而不只是代码任务。
- 能读取和管理用户的邮件、日历、联系人、文档、待办事项。
- 支持规划、检索、沟通、执行、提醒等多类任务。
- 具备长期记忆、任务跟踪、权限审批和自动化能力。
- 能通过多轮工具调用完成复杂事务。
- 支持专职 Subagent 协同，但整体仍以主 Agent 调度为核心。
- 支持用户通过可视化界面沉淀可复用 Workflow。

因此，本项目不是简单复刻 Claude Code 或 OpenClaw，而是要：

> **借鉴 Claude Code 的 Agent Runtime 骨架，再替换成适合个人事务场景的工具、连接器、记忆、审批和自动化能力层。**

---

## 3. 参考对象与分析范围

## 3.1 OpenClaw

OpenClaw 更偏通用代理平台视角，适合参考其产品形态与平台定位，但未必适合作为底层运行时的直接模板。

## 3.2 Claude Code

Claude Code 更值得借鉴的不是“代码能力”本身，而是其完整的 Agent 运行时架构，包括：

- 主 Agent Loop
- 工具调用与执行框架
- 权限与审批机制
- Subagent 体系
- Memory / Compact 体系
- Task / Background 运行机制
- Hooks / MCP / 扩展能力

本项目应保留这些运行时思想，但把工具栈从 coding 场景切换到个人事务场景。

---

## 4. 对 Claude Code 架构的核心抽象结论

## 4.1 真正的核心不是单一 Agent 类，而是 Query Loop

Claude Code 的核心不是某个 `Agent` 类，而是一套围绕 Query Loop 的运行链路：

```text
读取当前会话与历史消息
  → 组织上下文、memory、skills、工具定义
  → 发起模型采样
  → 获取 assistant 输出
  → 若触发 tool use，则执行工具
  → 将 tool result 回灌
  → 继续下一轮
  → 停止 / 记忆抽取 / compact / 收尾
```

它的本质是：

> **持续循环的 Agent Loop + 工具运行时 + 权限系统 + 记忆压缩 + 子 Agent 隔离 + 横切事件机制。**

---

## 4.2 多 Agent 体系本质是“主 Agent 调度 Subagent”

Claude Code 的多 Agent 并不是很多平等智能体自发对话，而是：

- 主 Agent 负责总控。
- 在需要时拉起 Subagent。
- 给 Subagent 独立 prompt、独立上下文、独立工具权限。
- Subagent 完成后把摘要或结构化结果返回主 Agent。

其价值在于：

- 上下文隔离
- 任务隔离
- 工具权限隔离
- 噪声控制
- 后台运行与长任务分担

这非常适合个人助理场景。

---

## 4.3 Memory、Summary 和 Compact 是内建能力

复杂 Agent 会话一定会上下文膨胀，因此必须内建分层记忆与压缩体系。

新版 Memory System 不再只等于 Long-term Memory Store，而是包含：

```text
Memory System
  ├─ Event Store              运行事实与审计日志
  ├─ Transcript Store         用户可读轮次记录
  ├─ Summary Store            WorkingSummary / SessionMemory / Rolling Summary / Daily Summary
  └─ Long-term Memory Store   用户画像 / 偏好 / 规则 / 长期事实 / Routine
```

其中：

- **Event Store** 负责保真、审计、replay 和状态恢复。
- **Transcript Store** 负责用户可读历史、历史检索和记忆抽取来源。
- **WorkingSummary** 负责当前 run / loop 如何继续。
- **SessionMemory** 负责当前 session 如何恢复，并作为 Planner 的会话状态输入。
- **Rolling Summary** 负责每 5~10 轮或话题切换时的动态压缩。
- **Daily / Weekly Summary** 负责跨天、跨周历史回顾。
- **Long-term Memory** 负责用户画像、偏好、长期事实、routine、workflow preference 等结构化长期记忆。
- **Compaction Service** 负责当前上下文窗口内的压缩，不等同于长期记忆。

关键原则：

> **Event Store 保真，Transcript Store 可读，WorkingSummary 保证当前 run 能继续，SessionMemory 保证当前 session 能恢复，Long-term Memory 保证未来任务能受益。**

---

## 4.4 权限系统是核心护栏

Claude Code 的权限判断不是简单弹窗，而是分层策略系统：

- permission mode
- allow / deny / ask 规则
- tool-specific checkPermissions
- hooks
- classifier / LLM judge
- interactive approval
- headless fallback

迁移到个人助理场景后，重点保护对象从“文件、命令、代码修改”变为：

- 发邮件
- 修改日历
- 分享文档
- 创建自动化
- 操作联系人
- 访问隐私数据
- 产生持续外部影响的动作

---

## 5. 项目设计目标

## 5.1 面向个人事务的 Agent Runtime

系统需要能处理：

- 邮件阅读与起草
- 日历查看与安排
- 联系人和关系信息管理
- 文档检索与整理
- 出行和日程规划
- 待办与任务跟踪
- 自动提醒与周期性工作
- 资料搜索与归纳
- 多步骤事务执行
- 可视化 Workflow 编排与复用

---

## 5.2 长期可扩展能力

系统要从一开始考虑：

- 多连接器
- 多工具域
- 多 Agent 协作
- 可视化 Workflow
- 任务 / 后台执行
- 事件触发
- 审批机制
- 长期记忆
- 自动化触发
- 观测与审计

---

## 5.3 主 Agent + 专职 Subagent

建议采用：

- 1 个主 Agent 作为总控
- 少量专职 Subagent 承担局部任务
- 明确的上下文、工具、权限和预算边界
- 后台 Subagent 负责长任务执行
- Workflow Runtime 负责编排固化流程

而不是一开始构建复杂的 Agent Society。

---

## 6. 新版总体架构

新版架构需要区分三类输入入口和五类运行时能力。

```text
用户自然语言输入
    │
    ▼
Gateway
    │
    ▼
Foreground Conversation Agent
    │
    ├─ 简单任务
    │     ├─ answer_directly
    │     └─ RuntimeAction → Runtime Dispatcher
    │
    └─ 复杂任务 / 长任务 / 后台任务
          │
          ▼
      Planner Agent Template / PlannerRun
          │
          ├─ ExecutionPlan / PlanPatch
          ├─ RuntimeAction
          └─ PlanToWorkflowCompiler
                └─ WorkflowDraft
                      └─ 用户可视化确认
                            └─ WorkflowDefinition

用户可视化 Workflow 编排
    │
    ▼
Workflow Runtime
    │
    ├─ WorkflowDefinition
    ├─ WorkflowVersion
    ├─ WorkflowRun
    └─ WorkflowStepRun
          │
          ▼
      Runtime Dispatcher
          ├─ Agent Kernel
          ├─ Subagent Runtime
          ├─ Tool Plane
          ├─ Permission Engine
          └─ Gateway / Notification Center

定时 / Webhook / MCP / Connector / Approval
    │
    ▼
Event Trigger Runtime
    │
    ▼
Runtime Dispatcher
        ├─ Workflow Runtime
        ├─ Subagent Runtime
        ├─ Agent Kernel
        └─ Gateway / Notification Center
```

---

## 7. 三类输入入口

## 7.1 自然语言入口

```text
User Natural Language
    ↓
Gateway
    ↓
Intent Router / Planner
    ↓
ExecutionPlan
    ↓
Agent Kernel / Subagent Runtime / Tool Plane
```

特点：

- 临时
- 动态
- 可重规划
- 围绕当前会话 / 当前目标
- 可以通过用户确认转化为 WorkflowDraft

---

## 7.2 可视化 Workflow 入口

```text
Visual Workflow UI
    ↓
Workflow Runtime
    ↓
WorkflowDefinition / WorkflowRun
    ↓
Runtime Dispatcher
    ↓
Agent Kernel / Subagent Runtime / Tool Plane
```

特点：

- 固化
- 可复用
- 可版本化
- 可视化编辑
- 可定时或事件触发
- 可由临时 Plan 转化而来

---

## 7.3 事件触发入口

```text
Scheduler / Webhook / MCP / Connector / Approval
    ↓
Event Trigger Runtime
    ↓
RuntimeTriggerEvent
    ↓
Runtime Dispatcher
    ↓
Workflow Runtime / Subagent Runtime / Agent Kernel
```

特点：

- 非自然语言
- 由事件驱动
- 主要负责唤醒已有 WorkflowRun / BackgroundSubagentRun / KernelRun
- 不负责复杂编排和 Agent loop

---

## 8. Plan 与 Workflow 的关系

## 8.1 ExecutionPlan

由自然语言临时生成。

```text
User Message → Planner → ExecutionPlan
```

特点：

- 临时
- 当前任务内有效
- 可动态重规划
- 可根据工具结果和用户反馈更新
- 不默认可复用
- 由 Planner / PlanRuntime 拥有状态机，Agent Kernel 只执行当前 step 并返回 PlanPatch

---

## 8.2 WorkflowDraft

由临时 Plan 或可视化界面生成。

```text
ExecutionPlan → PlanToWorkflowCompiler → WorkflowDraft
```

特点：

- 可编辑
- 未必完整
- 可展示在可视化界面
- 需要用户确认、补全和发布

---

## 8.3 WorkflowDefinition

用户确认后的固化流程。

```text
WorkflowDraft → User Review → WorkflowDefinition
```

特点：

- 可复用
- 可版本化
- 可触发
- 由 Workflow Runtime 执行
- 高风险步骤仍需运行时权限检查

---

## 8.4 PlanToWorkflowCompiler

`PlanToWorkflowCompiler` 负责把临时 `ExecutionPlan` 编译成可视化 `WorkflowDraft`。

```ts
type PlanToWorkflowCompileRequest = {
  sourcePlanId: string
  sourcePlanVersion: number
  userId: string
  sessionId?: string
  compileMode: "draft_only" | "ready_for_review"
}
```

```ts
type WorkflowDraft = {
  workflowDraftId: string
  sourcePlanId?: string
  sourcePlanVersion?: number

  name: string
  description?: string

  trigger?: WorkflowTrigger
  steps: WorkflowStepDraft[]

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

  status: "draft" | "ready_for_review" | "approved"
}
```

---

## 9. 模块定位与职责

## 9.1 Gateway

> Gateway 是用户自然语言与外部渠道输入入口。

负责：

- 用户聊天输入
- App / Web / IM / Email 等渠道输入
- 文件、图片、音频、视频等会话输入
- 用户自然语言审批、修改、继续、取消
- 将外部渠道输入标准化为 `InboundEnvelope`
- 装载会话恢复态和初始上下文候选
- 输出系统通知、审批卡片、授权码、状态更新

不负责：

- 可视化 Workflow 编排
- WorkflowStep 执行
- WorkflowDefinition 版本管理
- 后台 Subagent 生命周期
- 临时 Plan 执行细节
- 触发器匹配

---

## 9.2 Planner / Intent Router

> Planner / Intent Router 负责自然语言输入后的临时意图识别、计划生成、Plan 状态管理和推进决策。

负责：

- 判断用户意图
- 判断是否需要 Plan
- 生成临时 `ExecutionPlan`
- 管理临时 Plan 状态机
- 决定当前 step、下一步、是否重规划、是否完成或阻塞
- 处理 Plan 更新和重规划
- 判断是否需要 Subagent、Tool、Approval
- 将临时 Plan 转换为 WorkflowDraft 的入口
- 读取 `SessionMemory` 作为当前会话状态输入
- 输出 `PlannerStatePatch`，由 SessionMemoryManager 合并到 SessionMemory
- 输出 `TopicShiftSignal`，协助 Rolling Summary 在话题切换时立即摘要

不负责：

- 可视化 Workflow 的长期版本管理
- 固化 Workflow 的调度执行
- 外部事件触发器维护
- 后台 Subagent 的底层运行管理
- 直接写入长期 Memory Store
- 直接写入 SessionMemory / WorkingSummary

Planner 与 SessionMemory 的关系：

```text
SessionMemory
  = Planner 的当前会话地图

Planner
  = 临时 ExecutionPlan 的创建、更新、推进者
```

Planner 与 Agent Kernel 的关系：

```text
Planner / PlanRuntime
  owns plan state
  决定当前 step、下一步、是否重规划

Agent Kernel
  executes current plan step
  返回 KernelRunResult.planPatch

Planner / PlanRuntime
  applies PlanPatch
  更新 ExecutionPlan / SessionMemory patch
```

数据流：

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

## 9.3 Workflow Runtime

> Workflow Runtime 是与 Gateway 平行的结构化输入入口，负责用户在可视化界面中编排、保存、版本化和执行固化 Workflow。

负责：

- Workflow Builder 提交的结构化 Workflow
- WorkflowDraft 审核和发布
- WorkflowDefinition 版本管理
- WorkflowRun 生命周期
- WorkflowStepRun 状态管理
- Step 编排、分支、条件、并行、等待、审批
- 固化流程的运行审计和恢复
- 将 Step 执行请求交给 Runtime Dispatcher

不负责：

- 自然语言输入理解
- 临时 Plan 的动态重规划
- 子 Agent 内部 loop
- 工具执行细节
- 权限最终判断
- 渠道输入输出适配

---

## 9.4 Event Trigger Runtime

> Event Trigger Runtime 是触发与唤醒系统，负责把时间、外部事件和审批结果转换为系统内部 RuntimeTriggerEvent。

负责：

- Schedule trigger
- Recurring trigger
- Webhook trigger
- MCP notification trigger
- Connector event trigger
- Approval resolved trigger
- Condition polling
- TriggerRegistration 管理
- RuntimeTriggerEvent 生成
- 唤醒 WorkflowRun / BackgroundSubagentRun / KernelRun

不负责：

- 后台任务生命周期
- 子 Agent loop
- Workflow step 编排
- 自然语言理解
- 工具执行
- 用户渠道通知渲染

---

## 9.5 Agent Kernel

> Agent Kernel 是单次 Agent Loop 的运行时内核。

负责：

- 驱动主 Query Loop
- 组装模型输入（ContextBundle + system prompt + runtime instruction + tool schema）
- 调用模型
- 解析输出
- 调度工具调用
- 合并工具结果
- 判断继续 / 等待 / 完成 / 失败
- 处理中断与恢复
- 触发 Compact
- 提交 Turn Transcript

不负责：

- 自然语言渠道入口
- 固化 Workflow 编排
- Event Trigger 匹配
- BackgroundSubagentRun 生命周期
- 长期记忆写入决策

---

## 9.6 Tool Plane

> Tool Plane 是 Agent 的行动能力层与工具运行时系统。

负责：

- 工具注册
- 工具池构建
- 工具 schema 暴露
- 工具调用解析
- 工具执行编排
- 权限校验协调
- 结果标准化
- 上下文增量生成
- 工具事件输出
- Connector / MCP Adapter 对接

工具类别包括：

- Read Tools
- Search Tools
- Write Tools
- Automation Tools
- Planning Tools
- Workflow Tools
- Subagent Tools

---

## 9.7 Permission & Approval Engine

> Permission & Approval Engine 是 Agent 行动安全与用户授权护栏。

负责：

- 对工具调用、Plan step、Workflow step、BackgroundSubagentRun 动作进行风险判断
- 应用平台级、用户级、连接器级、Workflow 级和运行时策略
- 必要时触发审批
- 支持 Approval Code 授权码
- 支持 LLMPreApprovalJudge
- 支持 bypass_permissions 作用域
- 管理授权结果与生命周期
- 记录权限审计事件

关键原则：

> 固化 Workflow 不是免审批通道，高风险 step 仍必须经过权限判断。

---

## 9.8 Subagent Runtime

> Subagent Runtime 是具体子任务执行运行时，负责同步 / 后台 Subagent 的创建、隔离、运行、监控、恢复和结果回传。

负责：

- SubagentDefinition
- SubagentRun
- BackgroundSubagentRun
- subagentCode / lineagePath
- 子 Agent ContextBundle
- 子 Agent ToolPool
- 子 Agent PermissionContext
- 子 Agent Watchdog
- 子 Agent Checkpoint
- 子 Agent Artifact
- 子 Agent 结构化结果表单
- 可控递归创建子 Agent

不负责：

- WorkflowDefinition 可视化编排
- 定时触发器注册
- Gateway 渠道接入
- 固化 Workflow 的 step-level 编排

---

## 9.9 Context Manager / Compaction Service

Context Manager 负责：

- 从 Gateway、Planner、Workflow Runtime、Event Trigger Runtime、Subagent Runtime、Memory、Transcript、Tool Result、Artifact 中收集候选上下文
- 对多源上下文做筛选、去重、裁剪、排序
- 生成 `ContextBundle`
- 为主 Agent / Subagent / Workflow step 生成不同视图
- 支持运行时增量上下文摄取
- 从 Summary Store 中按需读取 WorkingSummary、SessionMemory、Rolling Summary、Daily / Weekly Summary
- 从 Long-term Memory Store 中按需召回用户画像、偏好、长期事实、routine 等结构化记忆

Compaction Service 负责：

- 执行 compact
- 生成 WorkingSummary / compact_summary 候选
- 支持 SessionMemory 复用
- 保留 must-keep items
- 防止 compact thrashing
- 将 compact 结果交给 SummaryManager 校验、版本化并写入 Summary Store

关键边界：

```text
Context Manager
  决定哪些内容进入模型上下文

Compaction Service
  决定如何压缩当前运行上下文

Memory / Summary System
  提供可召回的历史、摘要和长期记忆
```

---

## 9.10 Memory System

> Memory System 是分层历史与记忆体系，负责运行事实、用户可读历史、摘要型记忆、长期结构化记忆的管理、召回、抽取、遗忘和轮换。

Memory System 不再只等于 Long-term Memory Store，而应拆为：

```text
Memory System
  ├─ Event Store
  ├─ Transcript Store
  ├─ Summary Store
  │    ├─ WorkingSummary
  │    ├─ SessionMemory
  │    ├─ Rolling Summary
  │    ├─ Daily / Weekly Summary
  │    └─ Workflow / Subagent Summary
  └─ Long-term Memory Store
       ├─ User Profile
       ├─ User Preference
       ├─ User Safety Rule
       ├─ Relationship
       ├─ Project State
       ├─ Routine
       ├─ Workflow Preference
       ├─ Durable Fact
       └─ Episodic Summary
```

### 9.10.1 Event Store

负责：

- 记录运行事实
- 审计
- replay
- debug
- 状态恢复
- 追溯来源

不建议直接注入模型上下文。

### 9.10.2 Transcript Store

负责：

- 用户可读轮次记录
- 工具调用摘要
- approval 记录摘要
- 历史检索入口
- memory extraction 来源
- rolling summary 来源

### 9.10.3 Summary Store

统一存储摘要型数据：

- `working_summary`
- `session_memory`
- `rolling_5_turns`
- `rolling_10_turns`
- `daily_summary`
- `weekly_summary`
- `workflow_run_summary`
- `background_subagent_summary`
- `session_close_summary`
- `compact_summary`

其中：

```text
WorkingSummary
  = 当前 run / loop 的运行摘要，回答“当前 run 如何继续”

SessionMemory
  = 当前 session 的可恢复状态投影，回答“当前会话如何恢复”

Rolling Summary
  = 最近 5~10 轮或话题边界的动态摘要

Daily / Weekly Summary
  = 跨天、跨周历史回顾摘要
```

### 9.10.4 Rolling Summary 策略

Rolling Summary 不应机械地每 N 轮固定摘要，而应采用：

```text
min / max turn window + topic boundary
```

推荐策略：

```ts
type RollingSummaryPolicy = {
  minTurns: number
  maxTurns: number
  triggerOnTopicShift: boolean
  triggerOnPlanSwitch: boolean
  triggerOnArtifactSwitch: boolean
  triggerOnApprovalResolved: boolean
  triggerOnSubagentCompleted: boolean
  triggerOnTokenPressure: boolean
}
```

默认建议：

```text
minTurns = 5
maxTurns = 10
```

规则：

```text
不足 minTurns：
  通常不摘要，除非发生强 topic switch / plan switch

达到 minTurns：
  如果检测到话题切换、计划切换、产物切换、审批完成，则立即摘要

达到 maxTurns：
  强制摘要，即使话题没有明显切换
```

### 9.10.5 WorkingSummary 和 SessionMemory 写入机制

WorkingSummary 和 SessionMemory 都不应由 LLM 自由主动写。

推荐机制：

```text
运行时自动触发
  → LLM Summarizer 生成结构化摘要候选
  → SummaryManager 校验、合并、版本化
  → 写入 Summary Store
```

也就是：

> 系统决定什么时候写、写哪一类、输入哪些来源；LLM 负责把来源内容压缩成摘要；系统负责校验、打补丁、版本化、落库。

WorkingSummary 由以下模块触发：

- Agent Kernel
- Subagent Runtime
- Workflow Step Executor
- Compaction Service
- Recovery Manager

SessionMemory 由 `SessionMemoryManager` 触发，输入来源包括：

- Turn Transcript
- Rolling Summary
- PlannerStatePatch
- WorkingSummary
- Event Store Projection
- Artifact State
- Approval State
- BackgroundSubagentRun State

### 9.10.6 Long-term Memory Store

长期记忆采用结构化记录、多索引和生命周期评分组织。

应包含：

- Vector Index
- Keyword / Full-text Index
- Entity Index
- Time Index
- Metadata Index

召回应采用 hybrid retrieval：

```text
semantic search
+ keyword search
+ entity match
+ time filter
+ metadata filter
+ rerank
```

长期记忆应支持生命周期轮换：

```text
active
  → low_priority
  → compressed
  → archived
  → expired
```

用户明确删除时：

```text
deleted + tombstone + index purge
```

关键原则：

> Memory System 是分层历史与记忆体系；Memory Store 只存长期结构化记忆；Event Store、Transcript Store、Summary Store 和 Long-term Memory Store 各自承担不同层级职责。

---

## 9.11 Connector Runtime / MCP Layer

负责统一管理连接器：

- Gmail
- Google Calendar
- Contacts
- Google Drive / Docs
- Notion
- Browser / Search
- Slack
- Local OS
- MCP servers

连接器层负责鉴权、能力发现、资源访问和写操作调用。\n\n边界修复：模型产生的外部资源读写必须经 Tool Plane 调用 Connector Runtime / MCP Layer；Runtime Dispatcher 只可把 connector health check、auth refresh、event subscription、connector event receive 等管理类动作直达 Connector Runtime。外部事件可由 Gateway 或 Connector EventBridge 接入，但进入 Event Trigger Runtime 前必须统一标准化并携带 correlationId / causationId / idempotencyKey。

---

## 9.12 Hooks / Event Bus

负责在系统关键节点插入横切逻辑：

- before_sampling
- after_sampling
- before_tool
- after_tool
- on_permission_required
- on_permission_denied
- on_stop
- on_memory_extract
- on_workflow_step_complete
- on_background_subagent_complete

---

## 9.13 Observability / Audit / Replay

负责记录：

- 每次 turn 输入输出
- 每次 tool use
- 每次 permission decision
- 每个 subagent 生命周期
- 每个 workflow run / step run
- 每次 event trigger
- 每次 compact
- 每次 memory write
- 每次外部写操作

对于个人助理型 Agent，审计能力应尽早纳入设计。

---

## 9.14 Runtime Dispatcher

> Runtime Dispatcher 是内部执行分发层，接收来自 Gateway、Workflow Runtime、Event Trigger Runtime、Planner 的结构化执行请求，并路由到对应运行时。

负责：

- 根据 `RuntimeAction` 调用 Agent Kernel
- 根据 `RuntimeAction` 调用 Subagent Runtime
- 根据 `RuntimeAction` 调用 Tool Plane
- 根据 `RuntimeAction` 调用 Workflow Runtime
- 根据 `RuntimeAction` 调用 Gateway / Notification Center
- 对 connector 管理类动作调用 Connector Runtime
- 对 summary / memory extraction 动作调用 SummaryManager / MemoryExtractionService
- 统一记录 dispatch 事件
- 保证模块间调用不绕过权限与审计链路

边界修复：Dispatcher 不直接执行 connector 业务读写，不直接写 Summary Store / Long-term Memory Store。模型触发的外部资源读写必须经 Tool Plane；摘要和记忆写入必须经 SummaryManager / MemoryExtractionService。

---

## 10. 上下文装载、组装与压缩边界

推荐规则：

> **Gateway 管“进来时有什么”，Context Manager 管“哪些该被模型看见”，Agent Kernel 管“跑起来后长出什么以及怎么瘦身”，Compaction Service 管“具体怎么压缩”。**

### Gateway

负责：

- 装载用户、会话、审批、触发器等初始运行态
- 装载 SessionMemory / active state 等会话恢复态
- 调用 Memory Recall Service 获取初始候选记忆
- 输出 HydratedSessionState

不负责最终 prompt 组装。

### Context Manager

负责：

- 多源上下文治理
- 读取 Summary Store / Long-term Memory Store 的候选内容
- 基于 token budget、相关性、敏感级别和运行来源筛选上下文
- 生成 ContextBundle
- 为主 Agent / Subagent / Workflow step 生成不同视图

### Agent Kernel

负责：

- 基于 ContextBundle 组装当前 run 的模型输入
- 合并运行中新产生的 tool result / subagent result
- 判断何时 compact

### Compaction Service

负责：

- 执行摘要、裁剪、历史替换
- 生成 compact_summary / WorkingSummary 候选
- 输出 post-compact context
- 将摘要候选交给 SummaryManager 校验后写入 Summary Store

---

## 11. 核心数据对象概览

## 11.1 InboundEnvelope

Gateway 标准输入。

```ts
type InboundEnvelope = {
  eventId: string
  eventType:
    | "human_message"
    | "file_upload"
    | "approval_response"
    | "approval_code_response"
    | "external_webhook"
    | "mcp_notification"
    | "connector_event"
    | "remote_runtime_callback"
    | "notification_response"

  sourceType:
    | "chat_channel"
    | "app"
    | "email"
    | "webhook"
    | "mcp"
    | "connector"
    | "notification"
    | "system"

  userId?: string
  sessionId?: string
  threadId?: string

  relatedRefs?: {
    planId?: string
    workflowId?: string
    workflowRunId?: string
    backgroundRunId?: string
    subagentRunId?: string
    approvalId?: string
    artifactId?: string
    triggerId?: string
  }

  contentParts: Array<
    | { type: "text"; text: string }
    | { type: "file"; fileRef: string; mimeType?: string }
    | { type: "structured_data"; payload: Record<string, unknown> }
  >

  createdAt: string
}
```

---

## 11.2 ExecutionPlan

```ts
type ExecutionPlan = {
  planId: string
  version: number
  ownerAgentId: string

  status:
    | "draft"
    | "approved"
    | "in_execution"
    | "blocked"
    | "completed"
    | "abandoned"

  objective: string
  assumptions?: string[]
  constraints?: string[]
  successCriteria?: string[]

  steps: PlanStep[]
  currentStepId?: string

  createdAt: string
  updatedAt: string
}
```

---

## 11.3 WorkflowDefinition

```ts
type WorkflowDefinition = {
  workflowId: string
  name: string
  description?: string

  ownerUserId: string
  version: number

  status:
    | "draft"
    | "active"
    | "disabled"
    | "archived"

  trigger?: WorkflowTrigger
  steps: WorkflowStep[]

  defaultPolicy?: WorkflowExecutionPolicy

  createdAt: string
  updatedAt: string
}
```

---

## 11.4 RuntimeTriggerEvent

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

---

## 11.5 BackgroundSubagentRun

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

  createdAt: string
  updatedAt: string
  completedAt?: string
}
```

---

## 11.6 SummaryRecord

```ts
type SummaryType =
  | "working_summary"
  | "session_memory"
  | "rolling_5_turns"
  | "rolling_10_turns"
  | "daily_summary"
  | "weekly_summary"
  | "workflow_run_summary"
  | "background_subagent_summary"
  | "session_close_summary"
  | "compact_summary"

type SummaryRecord = {
  summaryId: string
  summaryType: SummaryType

  userId: string
  sessionId?: string
  runId?: string

  relatedRefs?: {
    planId?: string
    planStepId?: string
    workflowId?: string
    workflowRunId?: string
    workflowStepId?: string
    backgroundRunId?: string
    subagentRunId?: string
    subagentCode?: string
    artifactId?: string
    checkpointId?: string
  }

  timeRange?: {
    startAt: string
    endAt: string
  }

  sourceRefs: {
    transcriptRefs?: string[]
    eventRange?: {
      startEventId: string
      endEventId: string
    }
    previousSummaryRefs?: string[]
  }

  summary: string

  structuredState?: {
    activePlanId?: string
    currentPlanStepId?: string
    activeArtifactId?: string
    pendingApprovalId?: string
    currentStepId?: string
    currentIntent?: string
    openQuestions?: string[]
    recentDecisions?: string[]
    keyFacts?: string[]
    constraints?: string[]
  }

  lifecycle: {
    createdAt: string
    updatedAt?: string
    expiresAt?: string
    retentionClass:
      | "runtime_short"
      | "session"
      | "medium_term"
      | "long_term"
  }

  retrieval: {
    keywords?: string[]
    embeddingRef?: string
    importance?: "low" | "medium" | "high"
  }
}
```

---

## 11.7 PlannerStatePatch

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

## 11.8 TopicShiftSignal

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

---

## 11.9 LongTermMemoryRecord

```ts
type LongTermMemoryRecord = {
  memoryId: string
  userId: string

  memoryType:
    | "user_profile"
    | "user_preference"
    | "user_safety_rule"
    | "relationship"
    | "project_state"
    | "routine"
    | "workflow_preference"
    | "durable_fact"
    | "episodic_summary"

  content: {
    text: string
    structured?: Record<string, unknown>
  }

  entities?: Array<{
    entityType:
      | "person"
      | "project"
      | "workflow"
      | "artifact"
      | "organization"
      | "connector_resource"
    entityId?: string
    displayName: string
  }>

  sourceRefs: {
    transcriptRefs?: string[]
    summaryRefs?: string[]
    eventRange?: {
      startEventId: string
      endEventId: string
    }
    workflowRunId?: string
    backgroundRunId?: string
    artifactId?: string
  }

  scope: {
    visibility: "private_user" | "workspace" | "project" | "workflow"
    projectId?: string
    workflowId?: string
    connector?: string
  }

  confidence: number
  importance: "low" | "medium" | "high" | "critical"
  sensitivity: "low" | "medium" | "high" | "restricted"

  lifecycle: {
    status:
      | "active"
      | "low_priority"
      | "archived"
      | "expired"
      | "superseded"
      | "deleted"
    createdAt: string
    updatedAt: string
    lastAccessedAt?: string
    expiresAt?: string
    supersededBy?: string
  }

  retrieval: {
    keywords: string[]
    embeddingRef?: string
    entityIndexRefs?: string[]
    recallCount: number
    lastRecalledAt?: string
  }
}
```

---

## 12. 推荐目录结构 v3

```text
src/
  app/
    bootstrap/
    config/
    container/

  gateway/
    adapters/
    normalization/
    hydration/
    routing/
    outbound/

  planner/
    intent-router/
    plan-store/
    plan-runtime/
    plan-to-workflow/

  kernel/
    query-loop/
    model-input/
    turn-machine/
    recovery/
    compact-coordinator/

  workflow/
    builder/
    runtime/
    definitions/
    versions/
    runs/
    steps/
    drafts/

  event-trigger/
    registry/
    scheduler/
    matchers/
    runtime-events/

  dispatcher/
    RuntimeDispatcher.ts
    RuntimeAction.ts

  tools/
    registry/
    runtime/
    exposure/
    schemas/
    categories/

  permissions/
    engine/
    policies/
    approvals/
    preapproval/
    bypass/
    grants/

  agents/
    main-agent/
    subagent-runtime/
    builtins/
      research-agent/
      calendar-agent/
      communication-agent/
      retrieval-agent/
      automation-agent/

  memory/
    event-store/
    transcript-store/
    summary-store/
      working-summary/
      session-memory/
      rolling-summary/
      periodic-summary/
    long-term-memory/
      records/
      vector-index/
      keyword-index/
      entity-index/
      time-index/
      metadata-index/
      lifecycle-scoring/
    extraction/
    recall/
    policy/
    review/

  context/
    manager/
    attachments/
    compaction/
    summarization/

  connectors/
    core/
    gmail/
    calendar/
    contacts/
    drive/
    notion/
    browser/
    slack/
    mcp/

  hooks/
    bus/
    lifecycle/

  observability/
    telemetry/
    audit/
    replay/

  ui/
    chat/
    approval-center/
    workflow-builder/
    workflow-runs/
    subagent-center/
```

---

## 13. 与参考项目相比，哪些保留，哪些替换

## 13.1 建议保留的设计思想

- Query Loop 核心机制
- Tool Registry / Tool Runtime 分层
- 权限与审批系统
- Subagent 隔离机制
- Background Runtime 思想
- Memory + Compaction 双体系
- Hooks 机制
- Connector / MCP 抽象
- 事件化审计和 replay

## 13.2 建议替换或弱化的部分

- CLI / REPL / Terminal UI
- Bash / Git / Worktree 等 coding 工具
- coding-centric prompt
- 以本地代码仓库为中心的上下文组织方式
- 单纯 coding task 视角的 Task Runtime

## 13.3 建议新增的能力

- 用户 profile / preference / relationship 上下文
- 审批中心
- Workflow Builder
- PlanToWorkflowCompiler
- Event Trigger Runtime
- Routine 与主动提醒
- Calendar / Email / Communication 专用 Agent
- 长期个人知识图谱
- 自动化触发面板
- 后台 Subagent 管理中心

---

## 14. MVP 实现建议

## Phase 1：可运行 Agent Runtime 骨架

1. Gateway
2. Intent Router / Planner 基础版
3. Agent Kernel / Query Loop
4. Context Manager
5. Tool Registry / Tool Runtime
6. Permission Engine 基础版
7. Calendar / Email 只读连接器
8. Research Subagent
9. Event Store / Transcript Store 基础版
10. Summary Store 基础版
11. SessionMemoryManager 基础版

目标：

> 用户可以通过自然语言发起任务，系统能规划、调用工具、返回结果，并记录运行轨迹。

---

## Phase 2：后台 Subagent + 审批闭环

1. Subagent Runtime v2
2. BackgroundSubagentRun
3. Subagent Watchdog
4. Subagent Checkpoint
5. Subagent Artifact
6. Email / Calendar 写操作
7. Approval Center
8. Approval Code
9. Gateway 通知输出

目标：

> 用户可以让系统后台处理任务，完成后通知；写操作必须审批。

---

## Phase 3：Workflow Runtime 与可视化编排

1. Workflow Builder
2. WorkflowDraft
3. WorkflowDefinition / WorkflowVersion
4. WorkflowRun / WorkflowStepRun
5. PlanToWorkflowCompiler
6. Runtime Dispatcher
7. Workflow step 执行
8. Workflow 权限策略

目标：

> 用户可以把临时 Plan 转成可视化 Workflow，也可以手动编排固化 Workflow。

---

## Phase 4：Event Trigger Runtime 与 Routine

1. TriggerRegistration
2. Schedule / Recurring trigger
3. Webhook / MCP / Connector event
4. Approval resolved trigger
5. Condition polling
6. Routine template
7. Workflow 定时 / 事件触发

目标：

> 固化 Workflow 和后台 Subagent 可以被事件、时间和审批结果自动唤醒。

---

## Phase 5：长期记忆、审计和产品化

1. Long-term Structured Memory Store
2. Hybrid Retrieval：向量召回 + 关键词匹配 + 实体索引 + 时间索引 + 元数据过滤
3. Rolling Summary / Daily Summary / Weekly Summary
4. Memory Extractor
5. Memory Lifecycle Scoring：时间衰减、命中率、召回次数、重要性、置信度
6. Memory Forgetting：delete + tombstone + index purge
7. Audit / Replay
8. Cost / latency observability
9. 多端通知和移动审批
10. Workflow marketplace / template library

---

## 15. 当前阶段总体结论

本项目的核心思路可以总结为：

> 保留 Claude Code 在运行时层面的骨架能力，包括主循环、工具运行时、权限、记忆、压缩、子 Agent 隔离和事件化审计；
> 再将其从“代码工具栈”切换为“个人事务工具栈”；
> 同时增加 Gateway / Workflow Runtime 双入口、临时 Plan 到固化 Workflow 的转换、Event Trigger Runtime 和后台 Subagent Runtime。

换句话说，本项目不是做一个“会调用几个 API 的聊天机器人”，而是在做一个：

> **以主 Agent 为大脑，以工具层为手脚，以记忆层为经验系统，以权限系统为护栏，以 Workflow 和 Event Trigger 为自动化入口，以 Subagent Runtime 为后台执行底座的个人事务操作系统。**

---

## 16. 下一步建议

在这份合并版架构文档基础上，下一步建议继续细化：

1. Runtime Dispatcher 设计文档
2. Workflow Runtime 输入输出与状态机
3. Event Trigger Runtime 输入输出与 TriggerRegistration
4. PlanToWorkflowCompiler 转换规则
5. BackgroundSubagentRun 正式 schema
6. Context Manager 对 WorkflowStep / BackgroundRun 的视图生成
7. Event Store / Transcript Store / Summary Store / Long-term Memory Store 的统一索引关系
8. SummaryManager、SessionMemoryManager、RollingSummaryJob 设计文档
9. Memory Hybrid Retrieval 与 Lifecycle Scoring 设计文档

---

# 16. Foreground Conversation Agent / Planner Agent 架构升级补充

## 16.1 升级结论

自然语言入口不再直接进入 `Intent Router / Planner`，而是先进入 **Foreground Conversation Agent**。

推荐架构：

```text
Gateway
  ↓
Foreground Conversation Agent
  ├─ 简单任务：直接回答 / 直接生成 RuntimeAction
  └─ 复杂任务：spawn PlannerRun
        ↓
Planner Agent Template / PlannerRun
        ↓
Runtime Dispatcher
        ↓
Agent Kernel / Subagent Runtime / Tool Plane / Workflow Runtime
```

## 16.2 Foreground Conversation Agent

Foreground Conversation Agent 是用户长期面对的个人助手前台 Agent，负责：

- 严格遵循系统约束。
- 加载并遵循用户自定义助手人格、语气、背景和交互偏好。
- 判断用户意图。
- 处理审批、取消、修改、打断和状态查询。
- 简单任务直接回答或直接委派。
- 复杂任务创建 PlannerRun。
- 向用户展示任务开始、进度、阻塞、完成和失败状态。

它不负责：

- 长任务实际执行。
- 直接访问 Connector。
- 直接执行工具。
- 直接写 Memory。
- 绕过 Dispatcher / Permission Engine。

## 16.3 Prompt Stack 与 persona 优先级

```text
Platform System Constraints
  > Foreground Runtime Role Contract
  > User Assistant Persona Profile
  > Session State / ActiveWorkProjection
  > Current User Message
```

用户可以自定义助手形象，但不能覆盖系统约束、权限边界、隐私边界和审计规则。

## 16.4 简单任务直接委派

Foreground Conversation Agent 可以对简单任务直接生成 RuntimeAction：

```text
简单问答 / 总结 / 改写 → answer_directly
简单读操作 → dispatch_tool via Runtime Dispatcher
简单写操作 → dispatch_tool + Permission Engine
单次专业任务 → dispatch_subagent
```

必须创建 PlannerRun 的情况：

- 多步骤任务
- 多工具域任务
- 后台长任务
- 需要持续重规划
- 需要多个 agent 协同
- 可能转成 Workflow

## 16.5 Planner Agent Template / PlannerRun

Planner 不再是单个全局模块，而是可实例化的 agent template。

```text
PlannerAgentTemplate
  ↓ spawn
PlannerRun
```

每个复杂任务、长任务或后台任务可以拥有独立 PlannerRun。PlannerRun 负责：

- 创建 / 更新 ExecutionPlan。
- 管理 Plan 状态机。
- 判断当前 step、下一步、阻塞、完成、失败和重规划。
- 选择执行者。
- 生成 RuntimeAction。
- 接收执行结果并重规划。
- 必要时触发 PlanToWorkflow。

PlannerRun 不直接执行工具，不直接管理 BackgroundSubagentRun，不直接编排 WorkflowStepRun，不直接写 Memory。

## 16.6 ActiveWorkProjection

Foreground Conversation Agent 需要读取 ActiveWorkProjection，以便在多个后台任务并发时回答：

- 现在有哪些任务在跑？
- 哪个任务需要确认？
- 用户说“暂停它”指的是哪一个？
- 新请求是修改旧任务还是新任务？

ActiveWorkProjection 应由 Event Store、Plan Store、PlannerRun Store、BackgroundRun Store、WorkflowRun Store、Approval Store 投影生成，并通过 Context Manager 注入 Foreground Conversation Agent。

## 16.7 与原 Planner / Intent Router 的兼容

原 `Intent Router` 下沉为 Foreground Conversation Agent 内部能力。

原 `Planner` 升级为：

```text
Planner Agent Template + PlannerRunManager + PlanRuntime
```

边界保持：

```text
Foreground Conversation Agent：前台对话、意图、直接委派、PlannerRun 创建
PlannerRun：复杂任务规划、重规划、执行协调
Runtime Dispatcher：结构化动作分发
Subagent / Kernel / Tool / Workflow：具体执行
```
