# Agent Kernel 职责功能清单与输入输出文档 v6（Foreground / Planner Agent 对齐版）

## 1. 文档目的

本文档定义个人助理型 Agent 系统中 **Agent Kernel** 的职责、输入输出、状态机、事件、Transcript 提交、Compact、中断恢复，以及与 Planner / Intent Router、Workflow Runtime、Subagent Runtime 的关系。

本版重点对齐新的运行时边界：

```text
自然语言临时任务 → Gateway → Planner / Intent Router → Agent Kernel / Subagent Runtime
可视化固化流程 → Workflow Runtime → Runtime Dispatcher → Agent Kernel / Subagent Runtime / Tool Plane
后台智能执行 → Subagent Runtime BackgroundSubagentRun
触发与唤醒 → Event Trigger Runtime
```

---

## 2. Agent Kernel 的定位

Agent Kernel 的推荐定位是：

> **单次 Agent Loop 的运行时内核，负责驱动模型推理、工具调用、中断恢复、Compact 和 Turn Transcript 提交。**

Agent Kernel 是“单次智能运行”的执行核心，但不是：

- 自然语言渠道入口
- 可视化 Workflow 编排器
- 触发器运行时
- 后台 Subagent 生命周期管理器
- 长期记忆写入器

---

## 3. 核心职责

## 3.1 驱动 Agent Loop

负责：

- 接收 `KernelRunInput`
- 构建模型输入
- 调用模型
- 解析输出
- 调度工具
- 合并工具结果
- 判断继续 / 等待 / 完成 / 失败
- 输出 `KernelRunResult`

## 3.2 管理 Working Context

维护当前 run 内的运行态上下文：

- 当前消息栈
- 工具结果
- 临时 Plan 状态
- SubagentResult
- pending approval
- runtime notes
- compact markers
- artifact refs

## 3.2.1 与 Context Manager 的模型输入边界

Context Manager 负责选择"哪些内容可以进入模型上下文"，并输出 `ContextBundle`。

Agent Kernel 内部的 `Model Input Builder` 只负责把以下内容组装成一次模型请求：

- `ContextBundle`
- system prompt / developer instruction
- runtime instruction
- 当前 tool schema
- 当前 run policy / permission mode

因此，Kernel 不应重新实现 Context Manager 的筛选、去重、裁剪和排序逻辑。

### P9 Update: ModelInputBuilder Integration

P9 引入了统一的 `ModelInputBuilder`，替代了原有的 `buildLLMRequest()` 方法。新架构采用七层模型输入构建：

**七层架构**：
1. Layer 1: Platform (base.md + safety.md) - 平台身份和安全边界
2. Layer 2: Provider (openai.md / deepseek.md) - 提供商特定规则
3. Layer 3: Agent (foreground.md / kernel.md) - Agent 行为定义
4. Layer 4: Output (schema contracts) - JSON 输出契约
5. Layer 5: Instruction (AgentConfig.systemPrompt/routingPrompt) - 租户/项目指令
6. Layer 6: Tool Plane (ToolPlaneProjection) - 工具平面投影
7. Layer 7: Context Bundle (ContextBundleData) - 上下文包 + 动态字段

**四段缓存**：
- Segment A (Layer 1-4): 静态前缀，强缓存
- Segment B (Layer 5): 租户/项目指令，按租户缓存
- Segment C (Layer 6): 工具平面，按工具配置缓存
- Segment D (Layer 7): 上下文包 + 动态字段，不缓存

**缓存键计算**：
```
CacheKey = SHA-256(SegmentA_Hash | SegmentB_Hash | SegmentC_Hash)
```

**三种模式**：
- `routing_json`: ForegroundAgent 使用，不传 tools，只传工具摘要
- `function_calling`: AgentKernel/SearchSubagent 使用，传完整工具 schema
- `structured_json`: MemoryExtractor 使用，JSON 输出模式

**依赖注入**：
```typescript
interface KernelConfig {
  // ... existing fields
  modelInputBuilder: ModelInputBuilder;
  defaultModel?: string;
}
```

**关键特性**：
- Segment A hash 在相同 agent+provider 组合下稳定，不随用户消息变化
- DeepSeek KV Cache 优化：相同前缀命中缓存
- 所有 4 条 LLM 请求路径统一使用 ModelInputBuilder

## 3.3 协调工具调用

通过 Tool Plane 执行工具，并与 Permission Engine 协调权限判断。

## 3.4 协调临时 Plan 执行

Agent Kernel 可以消费 Planner / Intent Router 产生的 `ExecutionPlan`，但只负责执行当前需要运行的 plan step，并把执行结果、阻塞状态或建议变更以 `PlanPatch` 返回。

注意：

- 临时 Plan 是当前会话 / 当前任务的运行态对象
- Planner / PlanRuntime 拥有 Plan 状态机，决定当前 step、下一步和是否重规划
- Kernel 不直接改写 Plan Store，只返回 `PlanPatch` / `KernelRunResult.planPatch`
- 固化 Workflow 不由 Kernel 编排
- Plan 经用户确认后可通过 PlanToWorkflowCompiler 转成 WorkflowDraft

## 3.5 接收 Workflow Step 调用

Workflow Runtime 执行固化流程时，可以通过 Runtime Dispatcher 调用 Agent Kernel 执行某个 `agent_run` step。

此时 Kernel 只执行该 step，不管理整个 WorkflowRun。

## 3.6 与 Subagent 协作

Kernel 可以启动前台 Subagent，也可以被 Subagent Runtime 调用作为子 Agent 内部 loop。

后台 Subagent 生命周期归 Subagent Runtime，不归 Kernel。

## 3.7 输出内部事件

Kernel 负责输出 run 内细粒度事件到 Event Store。

## 3.8 生成 Turn Transcript

Kernel 在 run 结束、等待、暂停或重要状态变化时触发 Transcript Committer。

## 3.9 Compact 与恢复

Kernel 负责：

- token 预算监控
- compact 触发
- must-keep items 指定
- working summary / session memory 触发
- failure recovery lane
- run reconciliation
- synthetic terminal result

---

## 4. 不应承担的职责

Agent Kernel 不应承担：

- Gateway 渠道接入
- WorkflowDefinition / WorkflowRun 编排
- Event Trigger 匹配
- BackgroundSubagentRun 生命周期
- 可视化 Workflow UI 状态
- Tool 具体执行实现
- Permission 最终策略实现
- Memory 长期写入决策

---

## 5. 推荐子模块

```text
Agent Kernel
  ├─ Loop Controller
  ├─ Model Input Builder
  ├─ Tool Orchestrator Coordinator
  ├─ Planner Coordinator
  ├─ WorkflowStep Adapter
  ├─ Interrupt Manager
  ├─ Compact Coordinator
  ├─ Event Emitter
  ├─ Transcript Committer
  ├─ Status Publisher
  ├─ Failure Recovery Coordinator
  ├─ Cancellation & Interrupt Coordinator
  ├─ Run Reconciliation
  └─ Recovery Guards
```

### 新增说明

- `Planner Coordinator`：消费临时 ExecutionPlan / PlanPatch。
- `WorkflowStep Adapter`：让 Kernel 作为固化 Workflow 的一个 step executor，而不是 Workflow 编排器。

---

## 6. KernelRunInput v4

```ts
type KernelRunInput = {
  runId: string
  userId: string
  sessionId?: string

  agentId: string
  agentType:
    | "main"
    | "subagent"
    | "background"
    | "workflow_step"
    | "remote"

  invocationSource:
    | "gateway_intent"
    | "planner_execution"
    | "workflow_step"
    | "subagent_runtime"
    | "background_subagent"
    | "event_trigger_resume"
    | "system"

  hydratedStateRef?: string
  contextBundle: ContextBundle

  planContext?: {
    planId?: string
    planVersion?: number
    currentStepId?: string
  }

  workflowStepContext?: {
    workflowId: string
    workflowRunId: string
    stepId: string
    stepRunId: string
    inputMapping?: Record<string, unknown>
    expectedOutput?: Record<string, unknown>
  }

  backgroundRunContext?: {
    backgroundRunId?: string
    subagentRunId?: string
  }

  executionPolicy: {
    mode:
      | "interactive"
      | "plan_only"
      | "auto_execute"
      | "background"
      | "workflow_step"
      | "recovery"

    permissionMode: string

    interruptPolicy: {
      allowUserPreempt: boolean
      allowSystemCancel: boolean
      allowApprovalPause: boolean
    }

    compactPolicy: {
      enabled: boolean
      softTokenLimit: number
      hardTokenLimit: number
    }
  }

  runtimeConfig: {
    model: string
    maxIterations: number
    maxToolCallsPerTurn?: number
    maxSubagentDepth?: number
    timeoutMs?: number
  }

  intentDecision?: IntentRouterDecision
  conversationState?: ConversationStateProjection
  plannerControlEvent?: PlannerControlEvent

  resumeState?: KernelCheckpoint
}
```

---

## 7. KernelRunResult v4

```ts
type KernelRunResult = {
  runId: string
  sessionId?: string
  agentId: string

  invocationSource:
    | "gateway_intent"
    | "planner_execution"
    | "workflow_step"
    | "subagent_runtime"
    | "background_subagent"
    | "event_trigger_resume"
    | "system"

  finalStatus:
    | "completed"
    | "waiting_for_user"
    | "waiting_for_approval"
    | "waiting_for_external_event"
    | "interrupted"
    | "failed"
    | "cancelled"
    | "partial_success"
    | "max_iterations_reached"

  terminationReason?: KernelTerminationReason

  finalResponse?: {
    visibleMessages?: Array<MessageLike>
    artifacts?: Array<{ artifactRef: string; artifactType: string }>
    structuredOutput?: Record<string, unknown>
  }

  planPatch?: PlanPatch
  workflowStepOutput?: {
    workflowRunId: string
    stepRunId: string
    outputRef?: string
    structuredOutput?: Record<string, unknown>
  }

  checkpoint?: KernelCheckpoint
  transcriptCommitRef?: string

  eventRange?: {
    startEventId: string
    endEventId: string
  }

  metrics?: {
    iterationCount: number
    toolCallCount: number
    subagentCount: number
    compactCount?: number
    totalInputTokens?: number
    totalOutputTokens?: number
    totalLatencyMs?: number
  }
}
```

---

## 8. Kernel 状态机

```ts
type KernelStage =
  | "initializing"
  | "routing_intent"
  | "building_model_input"
  | "sampling_model"
  | "parsing_model_output"
  | "planning"
  | "updating_plan"
  | "dispatching_todo"
  | "dispatching_tools"
  | "waiting_tool_results"
  | "merging_tool_results"
  | "checking_permissions"
  | "launching_subagent"
  | "waiting_subagent"
  | "checking_compact"
  | "compacting"
  | "committing_transcript"
  | "waiting_user"
  | "waiting_approval"
  | "waiting_external_event"
  | "completed"
  | "interrupted"
  | "failed"
```

---

## 9. 与 Planner / Intent Router 的关系

Planner / Intent Router 负责自然语言临时任务：

```text
Gateway
  → Intent Router
  → Planner
  → ExecutionPlan
  → Agent Kernel / Subagent Runtime
```

Kernel 负责消费临时 Plan，但不负责固化 Workflow 编排。

Plan 可以转 Workflow：

```text
ExecutionPlan
  → PlanToWorkflowCompiler
  → WorkflowDraft
  → 用户确认
  → WorkflowDefinition
```

---

## 10. 与 Workflow Runtime 的关系

Workflow Runtime 负责可视化固化流程：

- WorkflowDefinition
- WorkflowDraft
- WorkflowRun
- Step DAG
- Step retry / branch / condition / parallel
- Workflow versioning

当 Workflow step 是智能推理步骤时：

```text
Workflow Runtime
  → Runtime Dispatcher
  → Agent Kernel
  → KernelRunResult.workflowStepOutput
  → Workflow Runtime
```

Kernel 不管理 WorkflowRun，只返回 step output。

---

## 11. 与 Subagent Runtime 的关系

Subagent Runtime 负责：

- Subagent identity
- BackgroundSubagentRun
- checkpoint
- watchdog
- recovery
- artifacts
- structured communication

Kernel 负责 Subagent 内部的一次 loop。  
后台 Subagent 的长期状态不放在 Kernel。

---

## 12. 与 Event Trigger Runtime 的关系

Event Trigger Runtime 负责：

- schedule
- recurring
- webhook
- MCP notification
- connector event
- approval resolved
- condition polling

它通过 Runtime Dispatcher 唤醒 Kernel 或 Workflow / Subagent Runtime。

Kernel 只处理被唤醒后的 run，不负责 trigger 匹配。

---

## 13. TurnTranscript v4 扩展

TurnTranscript 应记录 run 来源与计划 / workflow 状态：

```ts
type TurnTranscriptV4Extension = {
  invocationSource:
    | "gateway_intent"
    | "planner_execution"
    | "workflow_step"
    | "subagent_runtime"
    | "background_subagent"
    | "event_trigger_resume"
    | "system"

  planState?: {
    planId?: string
    currentStepId?: string
    status?: string
  }

  workflowState?: {
    workflowId?: string
    workflowRunId?: string
    stepId?: string
    stepRunId?: string
    status?: string
  }

  backgroundRunState?: {
    backgroundRunId?: string
    subagentRunId?: string
    status?: string
  }

  continuationHints?: {
    likelyNextIntents?: string[]
    activeArtifactId?: string
    activePlanId?: string
    pendingApprovalId?: string
    workflowRunId?: string
    backgroundRunId?: string
  }
}
```

---

## 14. 关键结论

- Agent Kernel 是单次 loop 内核，不是 Workflow 编排器。
- 自然语言产生的临时 Plan 由 Planner / Intent Router 管，Kernel 负责执行其中的当前步骤。
- 可视化固化 Workflow 由 Workflow Runtime 管，Kernel 只作为 step executor。
- 后台 Subagent 生命周期归 Subagent Runtime。
- 触发和唤醒归 Event Trigger Runtime。
- Runtime Dispatcher 负责统一分发结构化运行请求。

---

# 24. Foreground / Planner Agent Kernel 运行说明

Foreground Conversation Agent 和 PlannerRun 可以复用 Agent Kernel 的单次 loop 能力，但 Kernel 不拥有它们的生命周期。

## 24.1 新增 agentType 建议

```ts
type AgentTypeExtension =
  | "foreground"
  | "planner"
```

## 24.2 Foreground KernelRun

Foreground KernelRun 的特点：

- 短循环。
- 主要输出 ForegroundDecision。
- 允许 answer_directly。
- 允许生成 RuntimeAction。
- 不执行长任务。
- 不直接访问 Connector。

## 24.3 Planner KernelRun

Planner KernelRun 的特点：

- 绑定 plannerRunId / planId。
- 主要输出 ExecutionPlan / PlanPatch / RuntimeAction。
- 可以进行重规划。
- 不直接执行工具。
- 不直接管理 BackgroundSubagentRun / WorkflowRun。

## 24.4 生命周期边界

```text
Foreground Conversation Agent lifecycle
  owned by ForegroundConversationRuntime / Session layer

PlannerRun lifecycle
  owned by PlannerRuntime / PlannerRunManager

Agent Kernel
  only executes one run / one loop segment
```
