# MVP Architecture Cutline v1

> 适用范围：个人助理型 Agent 平台 MVP 架构裁剪  
> 更新时间：2026-04-26  
> 对齐版本：Foreground Conversation Agent 常驻 + Planner Agent Template 按需 fork + Runtime Dispatcher 统一分发

---

## 1. 文档目的

当前总体架构已经覆盖：Gateway、Foreground Conversation Agent、Planner Agent Template、Agent Kernel、Tool Plane、Subagent Runtime、Workflow Runtime、Event Trigger Runtime、Permission Engine、Context Manager、Memory System、Runtime Dispatcher、Connector Runtime、Observability / Audit / Replay 等模块。

这个架构适合长期演进，但如果 MVP 阶段全部实现，会导致范围过大。因此本文档定义：

```text
MVP 必做什么
MVP 可以简化什么
MVP 暂不做什么
哪些接口必须预留
哪些能力可以用 stub / mock / 手动方式替代
```

目标是保证：

```text
1. 架构方向不偏。
2. MVP 能跑通核心用户价值。
3. 不过早实现复杂平台能力。
4. 后续扩展不需要推翻核心边界。
```

---

## 2. MVP 产品目标

MVP 的目标不是一次性做完整个人助理平台，而是验证以下核心闭环：

```text
用户自然语言输入
  → 前台助手理解意图并保持个性化对话
  → 简单任务直接处理或委派
  → 复杂任务创建 PlannerRun
  → 后台任务可以运行、查询、取消、完成通知
  → 工具调用可审批、可审计
  → 会话状态可恢复
```

### 2.1 MVP 必须证明的能力

1. **前台长期可响应**：用户发起长任务后，前台仍可继续对话、查状态、取消或修改任务。
2. **助手形象可定制**：用户可以自定义语气、称呼、背景设定，但不能覆盖系统约束。
3. **简单任务不强制 Plan**：简单问答、读工具、低风险委派可以直接处理。
4. **复杂任务有计划状态**：复杂任务会创建 PlannerRun 和 ExecutionPlan。
5. **后台任务可管理**：BackgroundSubagentRun 可以开始、运行、完成、失败、取消。
6. **外部副作用受控**：写操作、发送、删除、自动化必须经过 Permission Engine。
7. **历史可恢复**：SessionMemory / Transcript / Event 至少支持当前会话恢复。

---

## 3. MVP 非目标

MVP 阶段不追求：

```text
- 完整 Workflow Builder
- 多级 Planner 嵌套
- 大规模 MCP marketplace
- 完整 Replay dry-run
- 高级 LLMPreApprovalJudge
- 全量连接器覆盖
- 多租户企业管理
- 复杂团队协作权限
- 完整长期记忆生命周期评分
- 完整成本计费系统
```

这些能力只需要在接口上预留，不要在 MVP 中完整实现。

---

## 4. MVP 总体架构裁剪

### 4.1 MVP 保留的主链路

```text
Gateway
  ↓
Foreground Conversation Agent
  ├─ answer_directly
  ├─ dispatch_tool / dispatch_kernel / dispatch_subagent
  └─ spawn PlannerRun
        ↓
Planner Runtime
        ↓
Runtime Dispatcher
        ↓
Agent Kernel / Tool Plane / Subagent Runtime
        ↓
Gateway / Notification Center
```

### 4.2 MVP 简化后的模块图

```text
[Channel / API]
    ↓
Gateway
    ↓
Foreground Conversation Agent
    ├─ Persona Controller
    ├─ Intent / Decision
    ├─ Direct Delegation
    ├─ Active Work Status
    └─ Planner Spawn
          ↓
Planner Runtime
    ↓
Runtime Dispatcher
    ├─ Agent Kernel
    ├─ Tool Plane
    ├─ Subagent Runtime
    ├─ Permission Engine
    └─ Notification Center

Memory / State:
  Event Store
  Transcript Store
  Summary Store(SessionMemory / WorkingSummary)
  Plan Store
  BackgroundRun Store
  Approval Store
  Artifact Store
```

---

## 5. 模块裁剪表

| 模块 | MVP 状态 | MVP 实现范围 | 后续增强 |
|---|---|---|---|
| Gateway | P0 必做 | 文本输入输出、文件 ref、审批响应、通知发送 | 多渠道、Email / IM / Webhook 原生适配 |
| Foreground Conversation Agent | P0 必做 | persona、意图判断、直接回答、直接委派、spawn planner、状态查询 | 更复杂对话策略、多 modal 交互 |
| Planner Runtime | P0 必做 | 默认 PlannerAgentTemplate、PlannerRun、ExecutionPlan、PlanPatch | 多 Planner 模板、merge policy、复杂重规划 |
| Runtime Dispatcher | P0 必做 | RuntimeAction 分发、幂等、权限预检查、基础审计 | 队列、优先级、复杂重试、分布式调度 |
| Agent Kernel | P0 必做 | 单次 loop、工具调用、compact 简化、transcript commit | 多模型、复杂中断、advanced compact |
| Tool Plane | P0 必做 | 工具注册、schema、执行、结果标准化、权限协调 | lazy loading、tool search、复杂并发策略 |
| Permission Engine | P0 必做 | ask_on_write、approval request、grant 基础 | LLM judge、细粒度策略、connector policy |
| Subagent Runtime | P0 必做 | BackgroundSubagentRun、checkpoint 简化、完成通知 | watchdog、恢复、并发调度、子 agent template registry |
| Context Manager | P0 必做 | ContextBundle、SessionMemory、recent history、active work | 高级 scoring、token budget、multi-source rank |
| Memory System | P0/P1 | Event / Transcript / Summary 基础；Long-term Memory 可简化 | hybrid retrieval、lifecycle scoring、memory management UI |
| Workflow Runtime | P1 简化 | 线性 workflow 或暂以 PlanToWorkflowDraft stub 存在 | 可视化 Builder、branch、parallel、versioning |
| Event Trigger Runtime | P1 简化 | approval_resolved、schedule、wait_condition 基础 | webhook、connector event、condition polling |
| Connector Runtime | P1 简化 | 少量内置连接器 mock / adapter | OAuth、多 connector、MCP bridge |
| Observability / Audit / Replay | P1 简化 | event、trace、audit 基础日志；timeline 查询 | dry-run replay、failure analysis、dashboard |

---

## 6. MVP P0 必做能力

## 6.1 Gateway 基础版

### 必做

```text
- 接收用户文本输入
- 创建 InboundEnvelope
- 恢复 userId / sessionId
- 装载 AssistantPersonaProfile
- 装载 SessionMemory / ActiveWorkProjection
- 发送 OutboundEnvelope
- 接收 approval_response
- 发送简单通知
```

### 暂不做

```text
- 多 IM 渠道适配
- Email 原生对话入口
- 复杂 webhook 接入
- 音频 / 视频转写
- 富审批 UI 的复杂字段编辑
```

### MVP 接口

```ts
type GatewayMVP = {
  receiveUserMessage(input: RawChannelMessage): Promise<InboundEnvelope>
  hydrateSession(input: InboundEnvelope): Promise<HydratedSessionState>
  sendOutbound(input: OutboundEnvelope): Promise<OutboundSendResult>
  receiveApprovalResponse(input: RawApprovalResponse): Promise<InboundEnvelope>
}
```

---

## 6.2 Foreground Conversation Agent 基础版

### 必做

```text
- 严格遵循系统约束
- 支持 AssistantPersonaProfile
- 支持当前 session 状态读取
- 支持 ActiveWorkProjection
- 判断 answer_directly / dispatch_tool / dispatch_kernel / dispatch_subagent / spawn_planner
- 简单任务直接委派
- 复杂任务 spawn PlannerRun
- 处理状态查询
- 处理取消 / 修改意图
- 处理 approval_response 路由
```

### 暂不做

```text
- 多个前台人格同时在线
- 用户自定义完整 system prompt
- 非文本风格定制的复杂行为脚本
- 多用户团队共享 persona
```

### MVP 关键输出

```ts
type ForegroundDecision = {
  decisionId: string
  intent: string
  route:
    | "answer_directly"
    | "dispatch_kernel"
    | "dispatch_tool"
    | "dispatch_subagent"
    | "spawn_planner"
    | "resume_existing_planner"
    | "approval_handler"
  requiresPlanner: boolean
  suggestedRuntimeActions?: RuntimeAction[]
  userVisibleResponse?: string
  confidence: number
}
```

---

## 6.3 Planner Runtime 基础版

### 必做

```text
- 默认 PlannerAgentTemplate
- 创建 PlannerRun
- 创建 ExecutionPlan
- 更新 PlanStep 状态
- 生成 RuntimeAction
- 接收执行结果并生成 PlanPatch
- PlannerRun 状态持久化
- PlannerRun 与 BackgroundSubagentRun / KernelRun 关联
```

### MVP 简化

```text
- 只支持一级 PlannerRun
- 不支持 PlannerRun 再创建 PlannerRun
- 不支持复杂 Planner merge
- 不支持多种专业 Planner 模板，先只保留 default_planner
- 重规划规则先采用简单策略
```

### MVP PlannerSpawnPolicy

```ts
type PlannerSpawnPolicy = {
  maxConcurrentPlannerRunsPerUser: 5
  maxConcurrentPlannerRunsPerSession: 3
  maxPlannerDepth: 1
  mergeIfSameObjective: true
  requireUserConfirmationAboveComplexity: false
}
```

### 什么时候创建 PlannerRun

```text
必须 spawn PlannerRun：
- 预估步骤 >= 3
- 涉及多个工具域
- 需要后台执行
- 需要持续跟踪
- 需要多个 agent 协作
- 用户明确要求“规划一下”
- 可能转成 Workflow
```

---

## 6.4 Runtime Dispatcher 基础版

### 必做

```text
- 接收 RuntimeAction
- 校验 schema
- 解析 targetRuntime
- 简单幂等检查
- 权限预检查
- 调用目标 runtime adapter
- 返回 DispatchResult
- 写 DispatchEvent / TraceSpan / AuditRecord 基础记录
```

### MVP 支持 targetRuntime

```text
- agent_kernel
- tool_plane
- subagent_runtime
- permission_engine
- gateway / notification_center
- planner_runtime
```

### 暂不做

```text
- 分布式队列
- 复杂优先级调度
- 多租户 quota
- 高级 retry policy
- dead letter dashboard
```

---

## 6.5 Agent Kernel 基础版

### 必做

```text
- 构建模型输入
- 调用模型
- 解析文本 / tool_use
- 调用 Tool Plane
- 合并 tool result
- 判断完成 / 继续 / 等待审批 / 失败
- 写 Turn Transcript
- 基础 WorkingSummary
```

### MVP 简化

```text
- compact 先只做简单摘要
- maxIterations 固定
- 工具并发先简化为串行或 read 并发
- 不支持复杂中断恢复
```

---

## 6.6 Tool Plane 基础版

### 必做

```text
- Tool Registry
- ToolDefinition
- Tool schema 暴露
- Tool input validation
- Permission Engine 调用
- Tool execution
- ToolExecutionResult
- ToolResultMessage
- RuntimeContextDelta
- 大结果引用化基础
- synthetic terminal result
```

### MVP 首批工具建议

```text
核心：
- ask_user
- artifact.create
- artifact.update
- plan.patch
- status.query

检索 / 读：
- memory.retrieve
- transcript.search
- web.search 或 mock_search
- docs.search 或 mock_docs

个人助理：
- calendar.search_events
- email.search
- email.read_thread
- email.create_draft
- contacts.search

后台 / 自动化：
- subagent.launch_background
- notification.send
```

### 暂不做

```text
- 完整 lazy loading
- 复杂 tool.search / tool.load_schema
- 大规模 MCP tool 动态发现
- 复杂并发分批策略
```

---

## 6.7 Permission Engine 基础版

### 必做

```text
- read_only
- ask_on_write
- background_limited
- PermissionCheckRequest
- PermissionDecision allow / ask / deny
- ApprovalRequest
- ApprovalResponse
- PermissionGrant one_shot / session / background_run
- AuditRecord
```

### 暂不做

```text
- llm_preapprove_full
- 复杂 LLMPreApprovalJudge
- 复杂 connector policy
- bypass_permissions UI
- 高级 editable approval form
```

---

## 6.8 Subagent Runtime 基础版

### 必做

```text
- BackgroundSubagentRun 创建
- 状态：queued / running / waiting_for_approval / waiting_for_external_event / completed / failed / cancelled
- 调用 Agent Kernel 执行子任务
- checkpointRef 简化保存
- artifactRefs
- notifyOnComplete / notifyOnFailure
- cancel 支持
```

### MVP 简化

```text
- subagent 类型固定少量模板
- watchdog 简化为 timeout
- recovery 先从 checkpoint 重新启动或标记 failed
- 不支持递归 subagent
```

---

## 6.9 Context Manager 基础版

### 必做

```text
- 生成 Foreground Agent ContextBundle
- 生成 Kernel ContextBundle
- 生成 PlannerRun ContextBundle
- 读取 AssistantPersonaProfile
- 读取 SessionMemory
- 读取 recent transcript
- 读取 ActiveWorkProjection
- 读取 PlanContextView
- 读取 BackgroundRunContextView
- 简单 token budget
```

### MVP 简化

```text
- scoring 先用规则 + recency
- 不做复杂 embedding rerank
- 不做复杂 source budget
- 不做复杂 pair integrity 之外的高级保护
```

---

## 6.10 Memory / Summary 基础版

### 必做

```text
- Event Store
- Transcript Store
- Summary Store
- WorkingSummary
- SessionMemory
- Rolling Summary 简化版
```

### Long-term Memory MVP

MVP 可以先做非常轻量的 Long-term Memory：

```text
- 用户明确保存的偏好
- 助手 persona
- 少量 durable facts
- 手动删除
```

暂不做：

```text
- 自动大规模 memory extraction
- lifecycle scoring
- hybrid retrieval
- entity index
```

---

## 7. MVP P1 简化能力

## 7.1 Workflow Runtime 简化版

### 支持

```text
- WorkflowDraft 保存
- WorkflowDefinition 发布
- 手动启动 WorkflowRun
- 线性 step 执行
- stepType: tool_call / agent_run / approval / notification
```

### 暂不支持

```text
- branch
- parallel
- condition graph
- complex retry
- version diff UI
- visual builder 完整拖拽
```

---

## 7.2 Event Trigger Runtime 简化版

### 支持

```text
- approval_resolved
- schedule once / recurring 简化
- wait_condition process_exit / manual_complete
```

### 暂不支持

```text
- 复杂 webhook matcher
- MCP notification 完整订阅
- connector event filter DSL
- condition polling DSL
```

---

## 7.3 Connector Runtime 简化版

### 支持

```text
- 连接器接口抽象
- 少量 mock connector
- 少量真实 connector adapter 可选
- ConnectorResponse 标准化
```

### 暂不支持

```text
- 完整 OAuth 管理
- 多账号绑定
- MCP server marketplace
- 高级 rate limit / circuit breaker
```

---

## 7.4 Observability / Audit / Replay 简化版

### 支持

```text
- Event logging
- Trace span logging
- AuditRecord for permission / external_write
- Run timeline query
```

### 暂不支持

```text
- dry-run replay
- failure analysis 自动诊断
- dashboard
- cost analytics
```

---

## 8. MVP 暂不做能力

明确暂不做：

```text
1. 多级 Planner 嵌套
2. Agent society / 多 agent 自发协商
3. 完整 Workflow Builder
4. 复杂 Workflow branch / parallel
5. 大规模 MCP marketplace
6. LLMPreApprovalJudge full mode
7. 自动长期记忆大规模抽取
8. 完整用户记忆管理 UI
9. 复杂组织权限 / RBAC
10. 完整 replay dry-run
11. 跨设备本地 runtime worker
12. 高级成本计费和预算系统
```

这些能力在数据结构中保留扩展字段即可。

---

## 9. MVP 数据存储裁剪

## 9.1 必须有的 Store

| Store | MVP 内容 |
|---|---|
| Session Store | sessionId、userId、lastActiveAt |
| Event Store | 核心事件追加写 |
| Transcript Store | turn / message / tool summary |
| Summary Store | WorkingSummary / SessionMemory |
| Plan Store | ExecutionPlan / PlanStep / PlanPatch |
| PlannerRun Store | PlannerRun 状态 |
| BackgroundRun Store | BackgroundSubagentRun 状态 |
| ToolResult Store | ToolExecutionResult / persistedResultRef |
| Approval Store | ApprovalRequest / ApprovalResponse / Grant |
| Artifact Store | 文档、草稿、结果文件 ref |
| Audit Store | permission / external_write |

## 9.2 可延后 Store

```text
- Full Trace Store 可以先和 Event Store 合并
- Long-term Memory Store 可以先简单实现
- Workflow Store 可以先只保存 draft / linear workflow
- Connector State Store 可以先 mock
```

---

## 10. MVP 权限裁剪

### 10.1 默认模式

```text
ask_on_write
```

规则：

```text
read/search：默认 allow，敏感资源可 ask
write/send/delete/automation：默认 ask
destructive：默认 ask 或 deny
background_limited：后台只执行预授权或低风险动作，需要审批时挂起
```

### 10.2 Grant scope

MVP 支持：

```text
one_shot
session
background_run
workflow_run（如果 P1 Workflow 启用）
```

暂不支持：

```text
connector 长期 grant
policy grant
bypass_permissions 复杂配置
```

---

## 11. MVP 任务类型裁剪

| 用户任务 | MVP 路由 | 是否需要 Planner |
|---|---|---:|
| 普通问答 | answer_directly | 否 |
| 简单总结 / 改写 | answer_directly / dispatch_kernel | 否 |
| 查日历 / 查邮件 | dispatch_tool | 否 |
| 创建草稿 | dispatch_tool | 否 |
| 直接发送邮件 | dispatch_tool + approval | 否 |
| 多步骤行程规划 | spawn_planner | 是 |
| 整理大量邮件 | spawn_planner + background_subagent | 是 |
| 监控事件并通知 | workflow 或 trigger 简化 | 可能 |
| 保存可复用流程 | PlanToWorkflowDraft | 是 |
| 取消后台任务 | direct dispatch cancel | 否 |
| 查询任务状态 | ActiveWorkProjection | 否 |

---

## 12. MVP 开发阶段建议

## Phase 0：基础对象与 Store

```text
- ID 规范
- Session Store
- Event Store
- Transcript Store
- Summary Store
- Plan Store
- RuntimeAction schema
```

验收：可以保存一次用户输入、前台决策、输出和 transcript。

---

## Phase 1：Gateway + Foreground Conversation Agent

```text
- 文本入口
- AssistantPersonaProfile
- ForegroundDecision
- answer_directly
- dispatch_tool stub
- spawn_planner stub
- ActiveWorkProjection 基础
```

验收：普通问答、状态查询、persona 风格生效。

---

## Phase 2：Runtime Dispatcher + Tool Plane + Permission

```text
- RuntimeAction dispatch
- Tool Registry
- Tool Execution
- Permission ask_on_write
- ApprovalRequest
- ToolResultMessage
```

验收：简单读工具、创建草稿、写操作审批链路跑通。

---

## Phase 3：PlannerRun + ExecutionPlan

```text
- PlannerAgentTemplate
- PlannerRun
- ExecutionPlan
- PlanPatch
- Planner 生成 RuntimeAction
- Plan 状态展示
```

验收：复杂任务可以生成计划，用户可确认，计划 step 可执行。

---

## Phase 4：Subagent Runtime + Background Task

```text
- BackgroundSubagentRun
- 后台执行
- checkpoint 简化
- 完成 / 失败通知
- 取消后台任务
```

验收：长任务启动后前台可继续对话；用户可查询和取消。

---

## Phase 5：Workflow / Trigger 简化

```text
- WorkflowDraft
- Linear WorkflowRun
- schedule trigger
- approval resolved trigger
- wait condition
```

验收：一个计划可以保存为线性 workflow，并按 schedule 运行。

---

## 13. MVP 验收标准

### 13.1 前台体验验收

```text
- 用户能自定义助手名称和语气。
- 前台回答风格符合 persona。
- 系统约束高于 persona。
- 启动后台任务后，用户可以继续提问。
- 用户可以询问任务状态。
- 用户可以取消后台任务。
```

### 13.2 执行链路验收

```text
- 简单读工具无需 Planner。
- 简单写工具触发审批。
- 复杂任务创建 PlannerRun。
- PlannerRun 创建 ExecutionPlan。
- PlannerRun 可以分派至少一个 Tool 或 Subagent。
- BackgroundSubagentRun 可以完成并通知。
```

### 13.3 数据与恢复验收

```text
- 每个用户 turn 有 Transcript。
- 每个 RuntimeAction 有 DispatchResult。
- 每个 ToolCall 有 terminal ToolExecutionResult。
- 每个 BackgroundSubagentRun 有最终状态。
- SessionMemory 能恢复当前活跃任务。
- ApprovalRequest 可恢复等待状态。
```

### 13.4 安全验收

```text
- 发送邮件 / 修改日历等写操作必须审批。
- 用户拒绝审批后不会执行。
- 审批通过后 AuditRecord 可查。
- Persona 不能覆盖权限规则。
```

---

## 14. 主要风险与裁剪策略

| 风险 | 表现 | MVP 策略 |
|---|---|---|
| 架构过大 | 开发周期失控 | 严格按 P0 / P1 / P2 切分 |
| Planner 过重 | 简单任务变慢 | Foreground Agent 支持直接委派 |
| 前台被占用 | 用户无法打断 | 长任务必须 BackgroundSubagentRun |
| 权限过复杂 | 审批链路难实现 | 先实现 ask_on_write |
| Memory 过早复杂化 | 抽取错误、难解释 | 先做 SessionMemory / explicit memory |
| Workflow 过早复杂化 | Builder 工作量过大 | 先做线性 workflow / draft stub |
| Connector 过多 | 适配成本高 | 先 mock + 少量核心 connector |
| Replay 过重 | 平台化成本高 | 先做 timeline 查询 |

---

## 15. MVP 后的扩展路线

### V1.1

```text
- 多 Planner 模板
- 更稳定的 background watchdog
- Workflow linear editor
- 更完整 ActiveWorkProjection
- connector OAuth
```

### V1.2

```text
- Workflow branch / condition
- Tool lazy loading
- Memory hybrid retrieval
- LLMPreApprovalJudge guarded mode
- Replay timeline UI
```

### V2

```text
- 完整 Workflow Builder
- MCP marketplace
- 多级 Subagent / Planner 协作
- Advanced audit dashboard
- Long-term Memory lifecycle scoring
- Cross-device local worker
```

---

## 16. 最终结论

MVP 阶段应该坚持：

```text
先跑通个人助理核心体验，后补平台复杂度。
```

MVP 最小闭环是：

```text
Gateway
  → Foreground Conversation Agent
  → 简单任务直接处理 / 复杂任务 PlannerRun
  → Runtime Dispatcher
  → Tool Plane / Agent Kernel / BackgroundSubagentRun
  → Permission / Transcript / Summary / Notification
```

MVP 必须保留的架构边界是：

```text
Foreground Agent 不做长任务。
PlannerRun 不直接执行工具。
所有外部动作走 Runtime Dispatcher。
所有写操作走 Permission Engine。
所有用户可见结果写 Transcript。
所有恢复态写 Summary / Store。
```

只要这些边界不破，MVP 可以大胆简化 Workflow、Trigger、Connector、Replay 和 Long-term Memory。
