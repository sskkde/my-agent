# Foreground Conversation Agent & Planner Agent 职责边界与输入输出文档 v1

## 1. 文档目的

本文档定义个人助理型 Agent 平台中 **Foreground Conversation Agent** 与 **Planner Agent Template / PlannerRun** 的职责边界、输入输出、生命周期和协作方式。

本次升级解决四个问题：

1. 前台助手需要严格遵循系统约束，同时支持用户自定义对话风格、人格背景和交互偏好。
2. 简单任务不应强制进入 Planner，Foreground Conversation Agent 应具备直接回答和直接委派能力。
3. Planner 应从单一模块升级为可实例化的 Agent Template，复杂任务、长任务、后台任务可创建多个并发 PlannerRun。
4. 推荐采用“常驻 Foreground Conversation Agent + 按需 fork PlannerRun”的混合架构，而不是单个全能前台 Agent，也不是单个全局常驻 Planner。

---

## 2. 推荐总体形态

```text
Gateway
  ↓
Foreground Conversation Agent
  ├─ 直接回答 / 轻量状态查询 / 审批处理 / 取消修改
  ├─ 简单任务：直接生成 RuntimeAction，经 Runtime Dispatcher 委派
  └─ 复杂任务：spawn PlannerRun
        ↓
Planner Agent Template
  ↓
PlannerRun
  ├─ 创建 / 更新 ExecutionPlan
  ├─ 选择执行者
  ├─ 生成 RuntimeAction
  ├─ 接收执行结果后重规划
  └─ 必要时 PlanToWorkflow
        ↓
Runtime Dispatcher
  ├─ Agent Kernel
  ├─ Subagent Runtime
  ├─ Tool Plane
  ├─ Workflow Runtime
  └─ Notification Center / Gateway
```

核心原则：

```text
Foreground Conversation Agent = 前台人格、对话、意图、打断、直接委派、状态展示
Planner Agent Template / PlannerRun = 按复杂任务创建，负责计划、重规划、agent 协调、RuntimeAction 生成
Execution Agents / Subagents = 真正执行长任务、后台任务、专业任务
Runtime Dispatcher = 所有结构化动作的统一分发与治理通道
```

---

## 3. 为什么选择“前台常驻 + Planner 按需 fork”

### 3.1 不推荐单个全能前台 Agent

单个全能前台 Agent 会把以下职责混在一起：

- 用户对话
- 意图判断
- 计划规划
- 工具执行
- 长任务等待
- 后台任务协调
- 状态展示

问题是：

- 长任务容易占住前台。
- 用户打断、改条件、查进度会变难。
- 多任务并发时上下文会互相污染。
- 前台人格和任务执行上下文混杂，后续难以拆分。

### 3.2 不推荐单个全局常驻 Planner

单个全局 Planner 虽然职责清晰，但会带来：

- 多个长任务共享 Planner 上下文，容易污染。
- Planner 成为系统瓶颈。
- 需要 Planner 内部再做复杂多任务调度。
- 后台任务完成后难以自然归档 Planner 上下文。

### 3.3 推荐方案

```text
Foreground Conversation Agent 常驻
Planner Agent Template 按任务创建 PlannerRun
PlannerRun 完成后归档
Plan / Summary / Transcript / Event 保留
```

优点：

- 前台始终响应用户。
- 简单任务不被 Planner 拖慢。
- 每个复杂任务拥有独立规划上下文。
- 多个后台任务可以并发规划和重规划。
- PlannerRun 可绑定 BackgroundSubagentRun / WorkflowRun。
- 更容易做审计、回放、暂停、取消和恢复。

---

## 4. Foreground Conversation Agent 定位

Foreground Conversation Agent 是用户长期面对的个人助手前台 Agent。

它不是 Gateway。Gateway 负责外部渠道接入和输出分发；Foreground Conversation Agent 负责用户会话智能控制。

### 4.1 应承担职责

- 严格遵循系统约束和平台安全规则。
- 加载并遵循用户自定义助手人格、语气、背景和交互偏好。
- 接收 Gateway 归一化后的 HydratedSessionState。
- 读取 SessionMemory、ActiveWorkProjection、PendingApproval、AssistantPersonaProfile。
- 判断用户当前意图。
- 判断是否需要 Planner。
- 对简单任务直接回答或直接委派。
- 对复杂任务 spawn PlannerRun。
- 处理用户打断、暂停、取消、修改任务。
- 查询 PlannerRun / BackgroundRun / WorkflowRun 状态。
- 向用户展示简洁状态、进度和下一步确认。
- 生成前台可见回复。

### 4.2 不应承担职责

- 不直接执行长任务。
- 不绕过 Runtime Dispatcher 调用工具或外部系统。
- 不直接写 Summary Store / Long-term Memory Store。
- 不直接管理 BackgroundSubagentRun 生命周期。
- 不直接管理 WorkflowRun step 编排。
- 不绕过 Permission Engine 审批外部副作用动作。

---

## 5. Prompt Stack 与用户自定义助手人格

Foreground Conversation Agent 的 prompt stack 应明确分层：

```text
1. Platform System Constraints
   - 安全策略
   - 权限边界
   - 隐私约束
   - 工具边界
   - 审计要求
   - 不可越权规则

2. Foreground Runtime Role Contract
   - 你是前台会话 Agent
   - 负责对话、意图、打断、状态展示、委派
   - 不负责长任务实际执行
   - 不直接绕过 Dispatcher / Permission / Tool Plane

3. User Assistant Persona Profile
   - 用户自定义助手名称
   - 性格
   - 背景设定
   - 说话风格
   - 称呼习惯
   - 简洁 / 详细偏好
   - 主动性偏好
   - 进度更新偏好

4. Session State / Active Work
   - 当前会话目标
   - 活跃 PlannerRun
   - 活跃 BackgroundRun
   - 活跃 WorkflowRun
   - Pending approval

5. Current User Message
```

优先级原则：

```text
Platform System Constraints > Runtime Role Contract > User Assistant Persona Profile > Session State > Current User Message
```

用户可以自定义助手形象，但不能覆盖系统安全边界、权限边界和审计规则。

---

## 6. AssistantPersonaProfile

```ts
type AssistantPersonaProfile = {
  profileId: string
  userId: string

  displayName?: string
  avatarStyle?: string
  background?: string

  tone: {
    formality?: "casual" | "neutral" | "formal"
    verbosity?: "brief" | "balanced" | "detailed"
    emotionalStyle?: string
    humorLevel?: "none" | "light" | "active"
  }

  behaviorPreferences: {
    proactiveLevel?: "low" | "medium" | "high"
    askBeforePlanning?: boolean
    preferDirectExecutionForSimpleTasks?: boolean
    progressUpdateStyle?: "silent" | "brief" | "detailed"
  }

  boundaries: {
    userDefinedDo?: string[]
    userDefinedDont?: string[]
  }

  safetyInvariantNotice: {
    cannotOverrideSystemPolicy: true
    cannotBypassPermission: true
    cannotHideAudit: true
  }

  lifecycle: {
    createdAt: string
    updatedAt?: string
    source: "user_config" | "imported" | "default"
  }
}
```

建议存储位置：

```text
User Profile / Preference Store
  + Long-term Memory Store 中可检索的用户偏好索引
  + Context Manager 在前台 turn 中注入当前 AssistantPersonaProfile
```

---

## 7. ForegroundDecision

Foreground Conversation Agent 的核心输出是结构化决策。

```ts
type ForegroundDecision = {
  decisionId: string
  sessionId: string
  userId: string

  intent:
    | "chat"
    | "qa"
    | "status_query"
    | "approval_response"
    | "simple_tool_task"
    | "simple_agent_task"
    | "complex_plan_task"
    | "background_task"
    | "workflow_request"
    | "cancel_or_modify_task"

  route:
    | "answer_directly"
    | "dispatch_kernel"
    | "dispatch_tool"
    | "dispatch_subagent"
    | "spawn_planner"
    | "resume_existing_planner"
    | "handoff_workflow_runtime"
    | "approval_handler"

  requiresPlanner: boolean
  requiresApprovalLikely: boolean

  suggestedRuntimeActions?: RuntimeAction[]

  targetRefs?: {
    plannerRunId?: string
    planId?: string
    backgroundRunId?: string
    workflowRunId?: string
    approvalId?: string
    artifactId?: string
  }

  userVisibleResponse?: string
  reason?: string
  confidence: number
}
```

---

## 8. 直接委派策略

Foreground Conversation Agent 可以直接委派简单任务，但外部动作必须走 Runtime Dispatcher。

```ts
type DirectDelegationPolicy = {
  allowDirectAnswer: boolean
  allowDirectReadTool: boolean
  allowDirectWriteToolWithApproval: boolean
  allowDirectForegroundSubagent: boolean
  allowDirectBackgroundSubagent: boolean

  mustSpawnPlannerWhen: {
    estimatedStepsGte: number
    requiresMultipleDomains: boolean
    requiresLongRunningExecution: boolean
    requiresDependencyManagement: boolean
    requiresReplanningLikely: boolean
    requiresWorkflowConversion: boolean
  }
}
```

推荐默认规则：

```text
直接回答：
  普通问答、解释、简单总结、简单改写

直接读工具：
  查日历、查邮件、查文件、查任务状态

直接写工具，但必须权限检查：
  创建草稿、创建日程、创建提醒

直接前台 Subagent：
  单次研究、单次检索、单个专业问题

必须 spawn Planner：
  多步骤任务
  多工具域任务
  长耗时任务
  后台任务
  需要持续重规划的任务
  需要多个 agent 协同的任务
  可能转成 Workflow 的任务
```

---

## 9. Planner Agent Template 定位

Planner 不再只是一个静态模块，而是一个可实例化的 Agent Template。

```text
PlannerAgentTemplate
  ↓ spawn
PlannerRun instance
```

### 9.1 应承担职责

- 根据 ForegroundDecision 创建或恢复 PlannerRun。
- 创建 ExecutionPlan。
- 更新 ExecutionPlan。
- 管理 Plan 状态机。
- 判断当前 step、下一步、阻塞、完成、失败、重规划。
- 为 step 选择 Agent Kernel、Subagent Runtime、Tool Plane 或 Workflow Runtime。
- 生成 RuntimeAction。
- 接收执行结果并生成 PlanPatch。
- 判断是否需要用户确认。
- 判断是否需要 PlanToWorkflow。

### 9.2 不应承担职责

- 不直接执行工具。
- 不直接访问 Connector。
- 不直接管理 BackgroundSubagentRun 生命周期。
- 不直接编排 WorkflowStepRun。
- 不直接写 SessionMemory / Long-term Memory。
- 不绕过 Runtime Dispatcher。

---

## 10. PlannerAgentTemplate

```ts
type PlannerAgentTemplate = {
  plannerTemplateId: string

  name:
    | "default_planner"
    | "travel_planner"
    | "communication_planner"
    | "workflow_planner"
    | "research_planner"

  capabilities: {
    canCreatePlan: boolean
    canPatchPlan: boolean
    canAssignAgents: boolean
    canGenerateRuntimeActions: boolean
    canCompileWorkflowDraft: boolean
  }

  defaultPolicy: {
    maxPlanSteps: number
    maxSubagentFanout: number
    maxReplanCount: number
    allowBackgroundExecution: boolean
    allowWorkflowCompilation: boolean
  }

  allowedToolProfiles?: string[]
  allowedAgentTypes?: string[]
}
```

---

## 11. PlannerRun

```ts
type PlannerRun = {
  plannerRunId: string
  plannerTemplateId: string

  userId: string
  sessionId?: string

  planId: string
  objective: string

  status:
    | "initializing"
    | "planning"
    | "waiting_for_user"
    | "waiting_for_execution_result"
    | "replanning"
    | "completed"
    | "failed"
    | "cancelled"
    | "archived"

  boundRefs?: {
    backgroundRunId?: string
    workflowRunId?: string
    parentForegroundRunId?: string
    parentSessionId?: string
  }

  checkpointRef?: string
  lastPlanVersion?: number

  metrics?: {
    replanCount?: number
    dispatchedActionCount?: number
    spawnedSubagentCount?: number
  }

  createdAt: string
  updatedAt: string
  completedAt?: string
}
```

Plan 的权威状态不应只存在 PlannerRun 内部，而应进入 Plan Store / Event Store / SessionMemory projection。PlannerRun 是负责规划和重规划的 agent 执行实例。

---

## 12. PlannerSpawnPolicy

```ts
type PlannerSpawnPolicy = {
  maxConcurrentPlannerRunsPerUser: number
  maxConcurrentPlannerRunsPerSession: number
  maxPlannerDepth: number
  defaultIdleTimeoutMs: number
  archiveAfterCompletedMs: number

  mergeIfSameObjective: boolean
  requireUserConfirmationAboveComplexity: boolean
}
```

推荐规则：

```text
简单任务不创建 PlannerRun
同一目标优先 resume existing PlannerRun
复杂新目标才创建 PlannerRun
后台长任务绑定一个 PlannerRun
任务完成后 PlannerRun 归档，但 Plan / Summary / Transcript 保留
```

---

## 13. ActiveWorkProjection

多 Planner 并发后，Foreground Conversation Agent 需要一个统一的活跃工作视图。

```ts
type ActiveWorkProjection = {
  userId: string
  sessionId?: string

  activePlannerRuns: Array<{
    plannerRunId: string
    planId: string
    objective: string
    status: string
    priority?: "low" | "normal" | "high"
    lastUpdateSummary?: string
    pendingApprovalId?: string
    boundBackgroundRunId?: string
  }>

  activeBackgroundRuns: Array<{
    backgroundRunId: string
    subagentRunId: string
    objective: string
    status: string
    progressSummary?: string
  }>

  activeWorkflowRuns: Array<{
    workflowRunId: string
    workflowId: string
    workflowName: string
    status: string
    currentStepSummary?: string
  }>

  pendingApprovals: Array<{
    approvalId: string
    actionSummary: string
    sourceRef: string
  }>
}
```

ActiveWorkProjection 可由 Event Store、Plan Store、PlannerRun Store、BackgroundRun Store、WorkflowRun Store、Approval Store 投影生成，由 Context Manager 注入 Foreground Conversation Agent。

---

## 14. 与 Runtime Dispatcher 的关系

Foreground Conversation Agent 和 PlannerRun 都不应直接调用目标运行时。

推荐链路：

```text
Foreground Conversation Agent
  → RuntimeAction
  → Runtime Dispatcher
  → Target Runtime

PlannerRun
  → RuntimeAction
  → Runtime Dispatcher
  → Target Runtime
```

新增建议动作：

```ts
type RuntimeActionTypeExtension =
  | "start_foreground_turn"
  | "complete_foreground_turn"
  | "spawn_planner_run"
  | "resume_planner_run"
  | "cancel_planner_run"
  | "query_active_work"
```

新增建议 target runtime：

```ts
type TargetRuntimeExtension =
  | "foreground_conversation_agent"
  | "planner_runtime"
```

---

## 15. 与 Agent Kernel 的关系

Foreground Conversation Agent 和 PlannerRun 可以复用 Agent Kernel 的单次 loop 能力，但必须使用受限 agent type：

```text
agentType = "foreground" | "planner"
```

Agent Kernel 仍然只负责一次 run 的模型调用、工具协调、compact 和 transcript，不拥有前台会话生命周期，也不拥有 PlannerRun 生命周期。

---

## 16. 与 Context Manager 的关系

Context Manager 需要为不同 agent 生成不同上下文视图：

```text
Foreground Conversation Agent View:
  - AssistantPersonaProfile
  - SessionMemory
  - ActiveWorkProjection
  - PendingApproval
  - Recent user-visible transcript
  - DirectDelegationPolicy

PlannerRun View:
  - Objective
  - ExecutionPlan / PlanContextView
  - Relevant constraints
  - Available agent / tool profiles
  - Prior step results
  - Bound BackgroundRun / WorkflowRun refs
```

---

## 17. 与 Memory / Summary System 的关系

- AssistantPersonaProfile 属于用户配置和长期偏好，不是普通 session memory。
- Foreground Conversation Agent 读取 AssistantPersonaProfile，但不直接写长期记忆。
- PlannerRun 可以输出 PlannerStatePatch / PlannerSummarySignal。
- SummaryManager 负责合并、校验和写入 Summary Store。
- SessionMemory 应记录 activePlannerRuns、activeBackgroundRuns、pendingApprovals 等当前会话状态投影。

---

## 18. 与 Permission Engine 的关系

直接委派不等于绕过权限。

```text
Foreground Conversation Agent 直接委派
  → Runtime Dispatcher permission precheck
  → Permission Engine
  → allow / ask / deny
  → Tool Plane / Subagent / Workflow
```

需要权限检查的前台动作包括：

- 直接执行写工具
- 直接启动后台 Subagent
- spawn PlannerRun 后自动执行高风险 step
- 创建 WorkflowDraft / WorkflowDefinition
- 注册触发器或自动化

---

## 19. MVP 建议

MVP 阶段建议先实现：

1. Foreground Conversation Agent 作为常驻前台 agent。
2. AssistantPersonaProfile 最小字段：名称、语气、简洁程度、主动性偏好。
3. ForegroundDecision 结构化输出。
4. DirectDelegationPolicy。
5. PlannerAgentTemplate 一个 default_planner。
6. PlannerRun 生命周期：created / planning / waiting / completed / failed / archived。
7. ActiveWorkProjection 最小实现：activePlannerRuns、activeBackgroundRuns、pendingApprovals。
8. Runtime Dispatcher 支持 spawn_planner_run、resume_planner_run、query_active_work。

---

## 20. 关键结论

1. Foreground Conversation Agent 是用户面对的长期助手人格，必须强化系统约束和用户自定义 persona 的分层优先级。
2. Foreground Conversation Agent 应支持简单任务直接回答和直接委派，不应所有任务都强制走 Planner。
3. Planner 应升级为 Agent Template，可按复杂任务创建多个 PlannerRun。
4. 推荐架构是：常驻 Foreground Conversation Agent + 按需 fork PlannerRun + Subagent / Workflow / Tool 执行。
5. PlannerRun 负责任务规划和重规划，具体执行仍必须通过 Runtime Dispatcher。

---

## P9 Update: ModelInputBuilder Integration

P9 引入了 `ModelInputBuilder`，将 Section 5 的 5 层 Prompt Stack 扩展为 7 层 Cache-aware Model Input Architecture：

```text
Section 5 的 5 层         →  P9 的 7 层
1. Platform System         →  Layer 1: Platform Base + Layer 2: Provider/Model
2. Foreground Runtime Role →  Layer 3: Agent Role + Layer 4: Output Contract
3. User Assistant Persona  →  Layer 5: Tenant/Project Instruction
4. Session State / Active  →  Layer 6: Tool Plane Projection
5. Current User Message    →  Layer 7: ContextBundle Projection
```

关键变化：
- ForegroundAgent 保持 JSON routing contract，不使用 function calling
- ForegroundAgent 已完全迁移到 ModelInputBuilder（迁移标志已移除）
  - ~~`MODEL_INPUT_BUILDER_ENABLED`~~ - 已移除（Task 4, 2026-06-01）
  - ~~`MODEL_INPUT_SHADOW_MODE`~~ - 已移除（Task 4, 2026-06-01）
  - ~~`MODEL_INPUT_LEGACY_FALLBACK`~~ - 已移除（Task 4, 2026-06-01）
- `prompt-builder.ts` 的 `buildRoutingMessages()` 将在 Task 8 中删除
- 优先级原则不变：Layer 1-4 > Layer 5 > Layer 6 > Layer 7 > User Message
