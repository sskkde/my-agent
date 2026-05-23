# Tool Plane 功能职责与输入输出文档 v3（Foreground / PlannerRun 对齐版）

## 1. 文档目的

本文档用于定义个人助理型 Agent 系统中的 **Tool Plane** 模块，包括：

- Tool Plane 的定位与职责边界
- 参考 Claude Code 源码后可借鉴的工具层设计
- Tool Registry / Tool Runtime / Tool Orchestrator / Tool Executor 的拆分
- 工具输入输出对象设计
- 工具权限、Hook、进度、错误、结果映射、上下文增量的处理方式
- MCP / Connector 工具接入方式
- 与 Agent Kernel、Context Manager、Permission Engine、Event Store、Transcript Store 的关系

---

## 2. Tool Plane 的定位

Tool Plane 的推荐定位是：

> **Agent 的行动能力层**：负责将模型产生的 tool use 转换为可验证、可审批、可执行、可观测、可回放的真实操作。

它不只是“工具函数集合”，而是一套完整的工具运行时系统。

在整体架构中，Tool Plane 位于：

```text
Agent Kernel
    │
    ▼
Tool Plane
    ├─ Tool Registry
    ├─ Tool Schema Provider
    ├─ Tool Orchestrator
    ├─ Tool Executor
    ├─ Tool Result Mapper
    ├─ Tool Hook Adapter
    └─ Connector / MCP Tool Adapter
```

---

## 3. 参考 Claude Code 的核心发现

通过 Claude Code 源码可以看到，其工具层不是简单工具列表，而是由多层机制组合而成：

## 3.1 Tool 是一个完整能力对象

Claude Code 的 `Tool` 类型不仅包含 `name`、`inputSchema` 和 `call()`，还包含：

- 参数 schema
- 输出 schema
- 输入校验
- 权限检查
- 是否只读
- 是否破坏性
- 是否可并发
- 是否 MCP 工具
- 是否 deferred loading
- 工具进度上报
- 工具结果映射
- 工具 UI 渲染
- 工具结果是否截断
- interrupt 行为
- 工具结果搜索文本提取
- context modifier

这说明 Tool Plane 应该把每个工具视为“可治理的能力单元”，而不是普通函数。

---

## 3.2 工具池不是静态列表，而是动态组装结果

Claude Code 通过工具总表、feature flag、permission deny rules、MCP tools、ToolSearch 等机制动态组装工具池。

关键思想：

- 内置工具和 MCP 工具需要统一合并
- 被全局 deny 的工具不应暴露给模型
- 工具顺序要稳定，避免破坏 prompt cache
- 工具可根据环境、模式、权限动态启用/隐藏
- 部分工具可 deferred loading，减少初始上下文负担

---

## 3.3 工具编排会区分并发安全和非并发安全

Claude Code 的 `toolOrchestration` 逻辑会将同一轮 tool use 分批：

- 并发安全工具可以批量并发执行
- 非并发安全工具串行执行
- 串行工具可以逐步修改上下文
- 并发工具的 context modifier 需要先排队，批次完成后再统一应用

这对个人助理场景非常重要，因为：

- 多个只读查询可以并发
- 写操作、发送邮件、修改日历等必须串行
- 会改变上下文/状态的工具不能随意并发

---

## 3.4 工具执行是完整流水线

Claude Code 的工具执行大致包括：

1. 查找工具
2. schema 解析
3. 工具自定义输入校验
4. pre-tool hooks
5. 权限决策
6. 输入可能被 hook / permission 更新
7. 执行 tool.call()
8. 上报 progress
9. 映射 tool result
10. 存储/压缩大结果
11. post-tool hooks
12. 生成 tool_result message
13. 错误处理
14. failure hooks
15. telemetry / tracing

这说明 Tool Plane 应该是一条受控执行流水线，而不是直接调用工具函数。

---

## 3.5 工具结果需要标准化和引用化

Claude Code 每个工具都负责把内部输出映射成模型可消费的 `tool_result`。  
同时，大结果会通过 result storage 转成：

- preview
- persisted ref
- tool result block

这个思路对个人助理尤其重要。

例如：

- 长邮件线程不应直接塞全文
- 视频转写不应直接塞全文
- 搜索结果不应全部塞入上下文
- 文档解析结果应优先返回摘要 + ref

---

## 3.6 中断与失败要补终态

Claude Code 的 StreamingToolExecutor 会在工具被中断、并发 sibling error、streaming fallback 时生成 synthetic tool_result，避免出现 tool_use 没有 tool_result 的脏状态。

该原则应直接迁移：

> 任何已经被 Agent Kernel 接受并开始执行的 tool call，都必须有 terminal state。

---

## 4. Tool Plane 的职责清单

## 4.1 应承担的职责

### 4.1.1 工具注册
负责注册系统内所有可用工具，包括：

- 内置工具
- Connector 工具
- MCP 工具
- Plan / Todo 工具
- Memory / Retrieval 工具
- Task / Workflow 工具
- Subagent 工具

---

### 4.1.2 工具池组装
根据当前上下文动态生成本轮可暴露给模型的工具池。

需要考虑：

- 用户权限
- 当前 permission mode
- 当前 agent 类型
- 当前 plan / task 状态
- 当前连接器可用性
- MCP server 状态
- 是否 deferred loading
- subagent 工具白名单

---

### 4.1.3 工具 schema 暴露
向 Agent Kernel / Model Input Builder 提供当前轮工具 schema。

需要支持：

- 全量 schema
- deferred schema
- tool search / capability discovery
- schema 版本
- schema token 预算
- strict schema 模式

---

### 4.1.4 工具调用解析与校验
负责解析模型输出中的 tool use，并进行：

- 工具名匹配
- alias 匹配
- input schema 校验
- 工具自定义 validateInput
- 工具是否启用检查
- 工具是否对当前 agent 可见

---

### 4.1.5 工具权限协调
Tool Plane 不应替代 Permission Engine，但应在正确位置调用它。

需要协调：

- 工具自身 `checkPermissions`
- 通用 Permission Engine
- pre-tool hook 的 permission result
- read / write / destructive 分类
- approval request
- updated input

---

### 4.1.6 工具编排
负责决定多个 tool use 如何执行：

- 并发执行
- 串行执行
- 分批执行
- 互斥执行
- 等待审批
- 中断取消
- sibling failure 取消

---

### 4.1.7 工具执行
负责真正调用工具实现，并传入：

- 工具输入
- ToolExecutionContext
- cancellation token
- progress callback
- permission context
- agent / task / run 信息

---

### 4.1.8 工具进度管理
支持工具在执行中持续上报：

- progress
- streaming partial result
- waiting state
- external operation status
- long-running task status

---

### 4.1.9 工具结果标准化
将工具内部输出统一映射成：

- `ToolExecutionResult`
- `ToolResultMessage`
- `RuntimeContextDelta`
- `ArtifactRef`
- `EventStore` 事件
- `Transcript` 摘要

---

### 4.1.10 大结果处理
对大工具结果执行：

- 截断
- 摘要
- 存储引用
- preview 生成
- context delta 生成
- attachment/artifact ref 绑定

---

### 4.1.11 错误与中断处理
负责把工具异常、中断、取消转换成统一终态：

- completed
- failed
- denied
- aborted
- cancelled
- discarded
- timeout

并为未完成工具生成 synthetic terminal result。

---

### 4.1.12 Hook 接入
提供工具执行前后 Hook 点：

- before_tool_validate
- before_tool_permission
- before_tool_execute
- after_tool_success
- after_tool_failure
- after_tool_result_mapped

---

### 4.1.13 观测与审计
输出工具事件到 Event Store，例如：

- tool_call_received
- tool_validation_failed
- tool_permission_requested
- tool_permission_denied
- tool_execution_started
- tool_progress
- tool_execution_succeeded
- tool_execution_failed
- tool_terminal_state_synthesized

---

## 4.2 不应承担的职责

Tool Plane 不应承担以下职责：

### 4.2.1 不负责驱动 Agent Loop
Loop 控制由 Agent Kernel 负责。

### 4.2.2 不负责最终上下文选择
工具结果是否进入下一轮上下文，应交给 Context Manager 处理。

### 4.2.3 不负责长期 Memory 写入
工具结果可成为 Memory Extractor 的输入，但 Tool Plane 不直接决定长期记忆。

### 4.2.4 不负责外部渠道适配
外部输入输出由 Gateway / Channel Adapter 负责。

### 4.2.5 不负责审批 UI
Tool Plane 可发起 permission / approval request，但审批交互由 Permission Engine / Gateway / Approval Center 负责。

---

## 5. Tool Plane 的推荐子模块

## 5.1 Tool Registry

负责注册和查询工具定义。

### 职责
- 注册工具
- 根据工具名 / alias 查找工具
- 管理工具版本
- 管理工具元数据
- 提供工具分类信息

---

## 5.2 Tool Pool Assembler

负责根据当前上下文生成可用工具池。

### 输入
- user
- agent type
- permission context
- connector state
- MCP tools
- task / plan mode
- feature flags
- policy

### 输出
- `ToolPool`

---

## 5.3 Tool Schema Provider

负责生成模型可见的工具 schema。

### 职责
- 提供 full schema
- 提供 deferred schema
- 控制 schema token budget
- 支持 Tool Search
- 支持 strict schema

---

## 5.4 Tool Orchestrator

负责同一轮多个 tool call 的调度。

### 职责
- 分析并发安全性
- 分批执行
- 串行执行写操作
- 并发执行只读操作
- 合并 context modifier
- 处理 sibling failure

---

## 5.5 Tool Executor

负责执行单个工具调用。

### 职责
- schema parse
- validateInput
- pre-tool hooks
- permission decision
- tool.call
- progress streaming
- post-tool hooks
- failure hooks
- result mapping
- error normalization

---

## 5.6 Tool Result Processor

负责处理工具结果。

### 职责
- 映射成模型可消费结果
- 生成 artifact / attachment ref
- 大结果引用化
- 生成 runtime context delta
- 生成 transcript 摘要
- 标记是否可压缩

---

## 5.7 Tool Event Emitter

负责向 Event Store 输出工具事件。

---

## 5.8 Connector / MCP Tool Adapter

负责将外部连接器能力包装成标准工具。

### 适配对象
- Gmail
- Calendar
- Contacts
- Docs
- Browser
- Search
- MCP tools
- Internal workflow tools

---

## 6. Tool 类型设计

## 6.1 ToolDefinition

```ts
type ToolDefinition<Input = unknown, Output = unknown> = {
  name: string
  aliases?: string[]
  description: string
  category:
    | "read"
    | "search"
    | "write"
    | "destructive"
    | "automation"
    | "subagent"
    | "planning"
    | "memory"
    | "system"

  inputSchema: JSONSchema
  outputSchema?: JSONSchema

  capabilityTags?: string[]
  connector?: string
  mcpInfo?: {
    serverName: string
    toolName: string
  }

  visibility: {
    defaultVisible: boolean
    shouldDefer?: boolean
    alwaysLoad?: boolean
    allowedAgentTypes?: string[]
  }

  execution: {
    isConcurrencySafe: boolean | ((input: Input) => boolean)
    isReadOnly: boolean | ((input: Input) => boolean)
    isDestructive?: boolean | ((input: Input) => boolean)
    interruptBehavior?: "cancel" | "block"
    timeoutMs?: number
    maxResultSizeChars?: number
  }

  permissions: {
    requiresApproval?: boolean | ((input: Input) => boolean)
    permissionScope?: string[]
    riskLevel?: "low" | "medium" | "high" | "critical"
  }

  validateInput?: (
    input: Input,
    context: ToolExecutionContext
  ) => Promise<ValidationResult>

  checkPermissions?: (
    input: Input,
    context: ToolExecutionContext
  ) => Promise<ToolPermissionDecision>

  call: (
    input: Input,
    context: ToolExecutionContext,
    onProgress?: ToolProgressCallback
  ) => Promise<ToolCallResult<Output>>

  mapResult?: (
    output: Output,
    context: ToolExecutionContext
  ) => ToolResultMessage
}
```

---

## 6.2 ToolExecutionContext

```ts
type ToolExecutionContext = {
  runId: string
  sessionId: string
  userId: string
  taskId?: string
  agentId: string
  agentType: "main" | "subagent" | "background" | "remote"

  toolCallId: string
  parentAssistantMessageId?: string

  permissionContext: PermissionContext
  connectorContext?: ConnectorContext
  planContext?: {
    planId?: string
    currentStepId?: string
    todoListId?: string
  }

  cancellationToken: CancellationToken

  workingContextRef?: string

  emitEvent: (event: ToolEvent) => void
  emitProgress: (progress: ToolProgressEvent) => void

  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>
}
```

---

## 6.3 ToolPool

```ts
type ToolPool = {
  poolId: string
  runId: string
  agentId: string
  tools: ToolDefinition[]
  deferredTools?: ToolDefinition[]
  hiddenTools?: Array<{
    toolName: string
    reason: "denied" | "disabled" | "not_allowed_for_agent" | "deferred"
  }>
  schemaTokenEstimate?: number
}
```

---

## 7. Tool Plane 输入文档

## 7.1 ToolDispatchRequest

Agent Kernel 向 Tool Plane 发起工具执行请求。

```ts
type ToolDispatchRequest = {
  runId: string
  sessionId: string
  taskId?: string
  agentId: string
  agentType: "main" | "subagent" | "background" | "remote"

  assistantMessageId: string

  toolUses: Array<{
    toolCallId: string
    toolName: string
    input: Record<string, unknown>
  }>

  toolPoolRef?: string
  permissionContext: PermissionContext
  executionPolicy: {
    maxConcurrency: number
    allowParallelReadOnly: boolean
    allowWriteConcurrency: boolean
    timeoutMs?: number
    abortOnSiblingFailure?: boolean
  }

  workingContextRef?: string
}
```

---

## 7.2 ToolSchemaRequest

用于 Agent Kernel / Model Input Builder 请求当前轮工具 schema。

```ts
type ToolSchemaRequest = {
  runId: string
  userId: string
  sessionId: string
  agentId: string
  agentType: string

  permissionContext: PermissionContext
  connectorStateRefs?: string[]
  mcpToolRefs?: string[]

  mode:
    | "interactive"
    | "plan_only"
    | "plan_then_execute"
    | "auto_execute"
    | "background"

  tokenBudget?: number
}
```

---

## 7.3 RuntimeToolRegistration

用于动态注册工具，如 MCP tools、connector tools、workflow tools。

```ts
type RuntimeToolRegistration = {
  source: "builtin" | "connector" | "mcp" | "workflow" | "plugin"
  tool: ToolDefinition
  scope: {
    userId?: string
    workspaceId?: string
    sessionId?: string
    agentType?: string
  }
}
```

---

## 8. Tool Plane 输出文档

## 8.1 ToolDispatchResult

```ts
type ToolDispatchResult = {
  runId: string
  sessionId: string
  agentId: string

  status: "completed" | "partial" | "failed" | "cancelled"

  results: ToolExecutionResult[]

  contextDeltas?: RuntimeContextDelta[]
  events?: ToolEvent[]

  updatedWorkingContextRef?: string
}
```

---

## 8.2 ToolExecutionResult

```ts
type ToolExecutionResult = {
  toolCallId: string
  toolName: string

  status:
    | "completed"
    | "failed"
    | "denied"
    | "aborted"
    | "cancelled"
    | "discarded"
    | "timeout"

  output?: unknown

  error?: {
    code: string
    message: string
    recoverable: boolean
  }

  resultMessage: ToolResultMessage

  artifacts?: Array<{
    artifactId: string
    artifactType: string
    version?: number
  }>

  attachments?: Array<{
    fileRef: string
    mimeType: string
  }>

  contextDelta?: RuntimeContextDelta

  metrics?: {
    startedAt: string
    completedAt: string
    durationMs: number
    outputSizeBytes?: number
  }
}
```

---

## 8.3 ToolResultMessage

```ts
type ToolResultMessage = {
  toolCallId: string
  isError: boolean
  modelFacingContent: string | Record<string, unknown>
  transcriptSummary?: string
  userVisibleSummary?: string
  persistedResultRef?: string
  structuredContent?: Record<string, unknown>
  meta?: Record<string, unknown>
}
```

---

## 8.4 ToolProgressEvent

```ts
type ToolProgressEvent = {
  runId: string
  sessionId: string
  agentId: string
  toolCallId: string
  toolName: string

  progressType:
    | "started"
    | "progress"
    | "waiting_for_permission"
    | "waiting_external"
    | "stream_chunk"
    | "completed"
    | "failed"

  message?: string
  payload?: Record<string, unknown>
  timestamp: string
}
```

---

## 8.5 ToolEvent

```ts
type ToolEvent = {
  eventId: string
  runId: string
  sessionId: string
  taskId?: string
  agentId: string
  toolCallId: string
  toolName: string

  eventType:
    | "tool_call_received"
    | "tool_schema_validation_failed"
    | "tool_custom_validation_failed"
    | "tool_permission_requested"
    | "tool_permission_allowed"
    | "tool_permission_denied"
    | "tool_execution_started"
    | "tool_progress"
    | "tool_execution_succeeded"
    | "tool_execution_failed"
    | "tool_execution_cancelled"
    | "tool_terminal_state_synthesized"
    | "tool_result_mapped"
    | "tool_context_delta_created"

  timestamp: string
  payload?: Record<string, unknown>
}
```

---

## 9. 工具执行流水线

推荐 Tool Executor 使用以下执行顺序：

```text
tool_use received
  │
  ▼
find tool definition
  │
  ▼
schema parse
  │
  ▼
custom validateInput
  │
  ▼
pre-tool hooks
  │
  ▼
permission decision
  │
  ▼
input finalization
  │
  ▼
tool.call()
  │
  ▼
progress streaming
  │
  ▼
result mapping
  │
  ▼
result storage / preview / ref
  │
  ▼
post-tool hooks
  │
  ▼
context delta creation
  │
  ▼
event + transcript summary
```

---

## 10. 工具并发策略

## 10.1 并发原则

参考 Claude Code：

- 并发安全工具可以并发
- 非并发安全工具必须串行
- 写操作默认串行
- 会改变上下文的工具默认串行
- 并发工具产生的 context modifier 应延迟到批次完成后应用

---

## 10.2 推荐分批规则

```text
连续 read/search 工具 → 并发批次
write/destructive 工具 → 单独串行批次
automation / external mutation → 单独串行批次
subagent launch → 根据 subagent runtime 策略执行
```

---

## 10.3 sibling failure 策略

如果同一并发批次中某个工具失败，可根据策略：

- 继续其他只读工具
- 取消 sibling 工具
- 为被取消工具生成 synthetic terminal result
- 将 partial results 返回 Kernel

---

## 11. 权限与审批策略

Tool Plane 应在工具执行前调用 Permission Engine。

## 11.1 权限判定顺序

推荐顺序：

1. Tool 自身快速判定
2. Pre-tool hooks
3. Rule-based permission
4. Runtime classifier
5. User approval
6. Task-level grant
7. Final decision

---

## 11.2 权限结果

```ts
type ToolPermissionDecision = {
  behavior: "allow" | "deny" | "ask" | "passthrough"
  reason?: string
  updatedInput?: Record<string, unknown>
  userModified?: boolean
  approvalId?: string
}
```

---

## 11.3 权限与输入更新

与 Claude Code 类似，Hook 或权限系统可返回 `updatedInput`。

但必须保证：

- 原始模型输入保留用于审计
- 最终执行输入单独记录
- Transcript 中可解释用户是否修改过输入
- Event Store 记录 input_updated 事件

---

## 12. 大结果处理与上下文增量

## 12.1 为什么需要大结果处理

个人助理工具经常返回大内容：

- 邮件线程
- 文档全文
- 网页抓取
- 音视频转写
- 图片 OCR
- 搜索结果列表

这些内容不应直接进入下一轮上下文。

---

## 12.2 推荐处理方式

```text
大结果
  │
  ├─ 存入 Artifact / Attachment / Result Store
  ├─ 生成 preview
  ├─ 生成 summary
  ├─ 生成 persistedResultRef
  └─ 生成 RuntimeContextDelta
```

---

## 12.3 RuntimeContextDelta

工具结果进入上下文时，应走 Context Manager 的增量摄取路径。

```ts
type RuntimeContextDelta = {
  runId: string
  iteration?: number
  source: "tool_result" | "subagent_result" | "runtime_note"

  items: Array<{
    itemId: string
    sourceType: "tool_result"
    semanticType:
      | "fact"
      | "summary"
      | "entity_state"
      | "search_finding"
      | "tool_output"
      | "attachment_ref"
      | "draft"
    content: string
    sourceRef?: string
    relatedEntities?: string[]
    isCompressible?: boolean
    isReplaceableByRef?: boolean
    priority?: number
  }>

  replaceKeys?: string[]
}
```

---

## 13. MCP / Connector 工具接入

## 13.1 统一抽象

所有外部连接器能力都应包装为标准 `ToolDefinition`。

```text
Connector Capability
        │
        ▼
Connector Tool Adapter
        │
        ▼
ToolDefinition
        │
        ▼
Tool Registry / Tool Pool
```

---

## 13.2 MCP 工具

MCP 工具应支持：

- serverName / toolName 元数据
- 动态 schema
- 动态权限
- server 状态检查
- auth error 标记
- structuredContent / meta 透传
- output normalization

---

## 13.3 Connector 工具分类示例

### Gmail
- `gmail.search_messages`
- `gmail.read_thread`
- `gmail.create_draft`
- `gmail.send_draft`
- `gmail.archive_message`

### Calendar
- `calendar.search_events`
- `calendar.find_availability`
- `calendar.create_event`
- `calendar.update_event`

### Docs / Drive
- `drive.search_files`
- `docs.read_document`
- `docs.create_document`
- `docs.update_document`

### Memory / Transcript
- `memory.retrieve`
- `transcript.search`
- `conversation.archive_lookup`

### Plan / Todo
- `plan.write`
- `plan.patch`
- `todo.write`
- `todo.patch`

---

## 14. 与 Agent Kernel 的关系

Agent Kernel 负责：

- 从模型输出中识别 tool use
- 向 Tool Plane 发起 `ToolDispatchRequest`
- 接收 `ToolDispatchResult`
- 将结果并入 Working Context
- 决定是否继续 loop、compact、等待审批或结束

Tool Plane 负责：

- 工具执行本身
- 工具结果闭环
- 工具事件输出
- 工具结果标准化
- 工具上下文增量生成

---

## 15. 与 Context Manager 的关系

Tool Plane 不直接决定工具结果是否进入下一轮上下文。

推荐流程：

```text
Tool Plane
  └─ 生成 RuntimeContextDelta
        │
        ▼
Context Manager
  └─ Normalize / Filter / Dedup / Rank / Budget
        │
        ▼
ContextBundle
```

---

## 16. 与 Event Store / Transcript Store 的关系

## 16.1 Event Store

Tool Plane 应写入或通过 Kernel 写入工具级事件：

- validation
- permission
- execution
- progress
- failure
- terminal state
- result mapping

## 16.2 Transcript Store

Transcript 中不应保存所有工具原始输出。  
应保存：

- 工具用途
- 关键结果摘要
- 产生的 artifact/ref
- 用户可理解的状态变化
- 错误摘要

---

## 17. 与 Permission Engine 的关系

Tool Plane 调用 Permission Engine，但不替代 Permission Engine。

推荐边界：

- Tool Plane 负责提出“这个工具调用需要判断”
- Permission Engine 负责判断“是否允许、是否审批、是否拒绝”
- Gateway / Approval Center 负责用户交互
- Tool Plane 根据结果执行或生成 denied result

---

## 18. 与 Subagent Runtime 的关系

Subagent 不是特殊工具函数，而是可由 Tool Plane 调起的一类能力。

推荐做法：

- `subagent.launch` 或 `agent.run` 作为工具入口
- Subagent Runtime 负责真正运行子 agent
- Tool Plane 负责启动、进度、结果、失败终态
- Context Manager 负责给 subagent 生成专属 ContextBundle

---

## 19. 个人助理版 Tool Plane 首批工具建议

## 19.1 基础工具
- `ask_user`
- `create_artifact`
- `update_artifact`
- `plan.write`
- `plan.patch`
- `todo.write`
- `todo.patch`

## 19.2 检索工具
- `memory.retrieve`
- `transcript.search`
- `web.search`
- `docs.search`
- `email.search`
- `calendar.search`

## 19.3 通信工具
- `email.read_thread`
- `email.create_draft`
- `email.update_draft`
- `email.send_draft`

## 19.4 日程工具
- `calendar.find_availability`
- `calendar.create_event`
- `calendar.update_event`
- `calendar.cancel_event`

## 19.5 自动化工具
- `task.create`
- `task.update`
- `task.pause`
- `task.resume`
- `schedule.create`
- `schedule.delete`

## 19.6 Subagent 工具
- `agent.run_research`
- `agent.run_calendar`
- `agent.run_communication`
- `agent.run_retrieval`

---

## 20. 推荐目录结构

```text
src/
  tools/
    registry/
      ToolRegistry.ts
      ToolDefinition.ts
      ToolPoolAssembler.ts
      ToolSchemaProvider.ts
    runtime/
      ToolOrchestrator.ts
      ToolExecutor.ts
      ToolResultProcessor.ts
      ToolEventEmitter.ts
      StreamingToolExecutor.ts
    adapters/
      mcp/
      connectors/
        gmail/
        calendar/
        drive/
        memory/
        transcript/
      subagent/
    hooks/
      ToolHooks.ts
    permissions/
      ToolPermissionAdapter.ts
    results/
      ToolResultStore.ts
      ToolResultMapper.ts
      ToolResultSummarizer.ts
```

---

## 21. 关键结论

### 21.1 Tool Plane 的本质
Tool Plane 不是工具函数集合，而是完整的工具运行时系统。

### 21.2 最值得参考 Claude Code 的部分
- Tool 是完整能力对象
- 工具池动态组装
- 工具执行流水线
- 并发安全分批执行
- pre/post/failure hooks
- 权限与输入更新
- 大结果引用化
- synthetic terminal result
- MCP 工具统一适配

### 21.3 个人助理版重点差异
Claude Code 的工具主要围绕代码、文件和 shell。  
个人助理版应将工具层替换为：

- 邮件
- 日历
- 文档
- 记忆
- 搜索
- 自动化
- artifact
- subagent
- workflow

### 21.4 关键设计原则
- 读操作可以并发
- 写操作默认串行
- 高风险操作必须审批
- 工具结果必须闭环
- 大结果必须引用化
- 工具结果进入上下文必须经过 Context Manager
- 工具执行全过程必须可观测、可审计、可回放

---

## 21.5 P9 Update: ToolPlaneProjection

P9 引入 `ToolPlaneProjection` 模块，负责生成模型可见的工具投影：

**投影模式**：
- `routing_json` 模式：只提供工具 ID 列表和能力摘要，不提供完整 schema
- `function_calling` 模式：提供完整工具 schema，放入 `LLMRequest.tools`
- `structured_json` 模式：只提供工具 ID 列表

**暴露级别**：
```typescript
type ExposureLevel =
  | 'always_on'        // 始终暴露
  | 'intent_loaded'    // 按意图加载
  | 'agent_loaded'     // 按 Agent 类型加载
  | 'lazy_discoverable' // 懒加载可发现
  | 'hidden';          // 隐藏
```

**Schema 暴露模式**：
```typescript
type SchemaMode =
  | 'full'       // 完整 schema
  | 'simplified' // 简化 schema
  | 'card_only'; // 只有卡片信息
```

**过滤规则**：
- `hidden` 和 `denied` 工具不进入 prompt 或 tools
- 工具按 stable key 排序，确保缓存稳定性
- Schema 使用 canonical JSON 序列化，属性按字母排序

**缓存优化**：
- 工具列表顺序稳定，避免破坏 prompt cache
- `toolExposureHash` 用于跟踪工具配置变化
- 相同工具配置产生相同的 Segment C hash

**文件位置**：
- `src/tools/tool-plane-prompt-projection.ts` - 投影生成
- `src/tools/tool-exposure-plan.ts` - 暴露计划
- `src/tools/tool-schema-canonicalizer.ts` - 规范化序列化
- `src/kernel/model-input/tool-plane-projection-renderer.ts` - Layer 6 渲染器

---

# 22. Tool Exposure / Lazy Loading 设计补充

## 22.1 补充目的

本节将“工具暴露策略、懒加载、schema 预算、工具使用统计”合并进 Tool Plane 设计中，用于解决工具数量增长后的上下文占用、模型误用、权限风险和 schema 污染问题。

核心原则：

> **模型不需要一开始知道所有工具怎么用，只需要知道当前任务能用哪些工具，以及如何发现更多工具。**

---

## 22.2 总体策略

推荐采用五层工具暴露机制：

```text
Always-on Core Tools
        │
        ▼
Intent-based Tool Mapping
        │
        ▼
Capability Manifest for Unloaded Tools
        │
        ▼
Schema Budget / Simplified Schema
        │
        ▼
Usage-based Tool Promotion / Demotion
```

最终工具暴露由以下因素共同决定：

```text
核心工具
+ 意图映射
+ Agent 工具集
+ 当前计划步骤
+ 能力目录
+ Schema 预算
+ 使用统计
- 权限限制
- 风险限制
- 连接器不可用
```

---

## 23. 为什么需要工具暴露策略

如果所有工具都直接暴露给模型，会带来以下问题：

### 23.1 上下文占用过高

每个工具都包含 name、description、input schema、参数说明、枚举值和使用约束。  
当系统拥有邮件、日历、文档、记忆、搜索、自动化、workflow、subagent、MCP 插件等工具后，工具 schema 会快速膨胀。

### 23.2 模型更容易选错工具

工具越多，模型越容易在类似工具之间混淆，或者忽略当前任务真正需要的工具。

### 23.3 影响 Prompt Cache

工具列表过大或频繁变化，会影响 prompt cache 稳定性。

### 23.4 权限风险增加

模型看到不该用或高风险的工具，会增加误调用概率。

### 23.5 工具文档污染模型输入

如果把完整 API 文档当作工具 schema 暴露，会让模型输入变成“工具手册”，挤压真正任务上下文。

---

## 24. 初始上下文应该暴露哪些工具信息

初始上下文中，模型只需要知道足够它“选择工具”的最小信息。

```ts
type ToolModelSchema = {
  name: string
  description: string
  inputSchema: JSONSchema
  category:
    | "read"
    | "search"
    | "write"
    | "automation"
    | "planning"
    | "memory"
    | "subagent"
  riskLevel?: "low" | "medium" | "high" | "critical"
}
```

### 应暴露

- 工具名
- 简短描述
- 必要参数 schema
- 工具风险等级
- 当前是否需要审批
- 当前 agent 是否可用
- 工具返回结果类型提示

### 不应默认暴露

- 完整外部 API 文档
- 罕见参数
- 大量错误码
- connector 内部鉴权细节
- 长篇使用教程
- 内部权限规则实现
- 工具实现细节

---

## 25. 工具暴露分层

```ts
type ToolExposureLevel =
  | "always_on"
  | "intent_loaded"
  | "agent_loaded"
  | "lazy_discoverable"
  | "hidden"
```

---

## 25.1 Always-on Core Tools

### 定义

核心工具始终暴露给模型。

### 适合条件

- 高频
- schema 较短
- 风险较低
- 对 loop 推进很关键
- 几乎所有任务都可能用到

### 示例

```text
ask_user
memory.retrieve
transcript.search
artifact.create
artifact.update
plan.write
plan.patch
todo.write
todo.patch
tool.search
tool.load_schema
```

### 设计注意

核心工具不等于必须暴露完整 schema。  
如果核心工具 schema 较长，也可以默认暴露简化 schema。

---

## 25.2 Intent-loaded Tools

### 定义

根据本轮会话类型 / intent 自动加载的工具。

由 Intent Router 输出本轮意图后，Tool Plane 根据映射关系加载对应工具。

### 示例：schedule 会话类型

```text
默认暴露：
- calendar.search_events
- calendar.find_availability
- contacts.search
- ask_user

懒加载：
- calendar.create_event
- calendar.update_event
- email.create_draft

高风险 / 需审批：
- calendar.delete_event
```

### 示例：communication 会话类型

```text
默认暴露：
- email.search
- email.read_thread
- email.create_draft
- contacts.search
- memory.retrieve

懒加载：
- email.send_draft
- email.bulk_archive
```

---

## 25.3 Agent-loaded Tools

### 定义

某个 agent / subagent 专属的工具池。

### 示例

```text
research_agent:
- web.search
- docs.search
- docs.read
- transcript.search

calendar_agent:
- calendar.search_events
- calendar.find_availability
- calendar.create_event

communication_agent:
- email.read_thread
- email.create_draft
- email.update_draft
```

### 设计意义

- 减少主 Agent 工具数量
- 提高子 Agent 专业性
- 限制子 Agent 权限范围
- 降低误调用概率

---

## 25.4 Lazy-discoverable Tools

### 定义

工具不在初始完整 schema 中暴露，但会通过能力目录或工具搜索暴露其存在。

### 适合条件

- 低频
- schema 较长
- 参数复杂
- 高风险
- connector 专属
- 多数任务不需要

### 示例

```text
docs.batch_update
calendar.update_recurring_event
email.bulk_archive
drive.permission_update
workflow.create_complex_trigger
browser.automation
```

---

## 25.5 Hidden Tools

### 定义

当前上下文中完全不应暴露给模型的工具。

### 典型原因

- 权限禁止
- connector 未授权
- 当前 agent 不允许使用
- 当前模式不允许写操作
- 风险策略禁止
- 工具被系统禁用

---

## 26. 会话类型与工具映射关系

## 26.1 ToolProfile

建立一张会话类型到工具集的映射表：

```ts
type ToolProfile = {
  profileName: string
  intentType:
    | "qa"
    | "research"
    | "schedule"
    | "communication"
    | "doc_work"
    | "automation"
    | "planning"
    | "artifact_revision"

  alwaysInclude: string[]
  intentTools: string[]
  lazyTools: string[]
  hiddenTools?: string[]
}
```

---

## 26.2 Intent Router 的作用

Intent Router 负责输出本轮 intent：

```ts
type IntentRouterDecision = {
  intent:
    | "qa"
    | "research"
    | "schedule"
    | "communication"
    | "doc_work"
    | "automation"
    | "planning"
    | "artifact_revision"

  taskComplexity: "simple" | "medium" | "complex"
  requiresPlan: boolean
  requiresTool: boolean
  suggestedToolProfile?: string
}
```

Tool Plane 根据 `suggestedToolProfile` 选择工具池。

---

## 26.3 最终暴露结果不应只由 intent 决定

最终工具暴露应叠加以下因素：

```text
tool exposure =
  core tools
  + intent profile tools
  + agent-specific tools
  + active plan step tools
  + usage-promoted tools
  - denied tools
  - disconnected connector tools
  - risk-blocked tools
```

---

## 27. 未加载工具的能力目录

## 27.1 为什么需要能力目录

如果未加载工具完全不可见，模型可能不知道系统有某些能力。

因此初始上下文应暴露轻量能力目录，而不是完整工具列表。

---

## 27.2 能力目录内容

推荐常驻以下形式：

```text
Available capability domains:
- Email: search/read/create drafts/send with approval
- Calendar: search/find availability/create/update with approval
- Contacts: resolve people and organizations
- Docs: search/read/summarize/update with approval
- Memory: retrieve user preferences and prior context
- Transcript: search previous conversations
- Automation: create scheduled or event-triggered tasks
```

---

## 27.3 能力目录分级

### Level 1：能力域目录

常驻，非常短。

```text
Email / Calendar / Docs / Memory / Automation / Browser
```

### Level 2：工具卡片目录

通过 `tool.search` 返回。

```ts
type ToolCapabilityCard = {
  toolName: string
  domain: string
  shortDescription: string
  riskLevel: "low" | "medium" | "high" | "critical"
  schemaMode: "card_only" | "simplified" | "full_available"
  requiresSchemaLoad: boolean
  keywords?: string[]
}
```

---

## 28. Schema 长度上限与简化 Schema

## 28.1 为什么需要 schema budget

有些工具 schema 非常长，例如：

- calendar recurring event
- docs batch update
- browser automation
- workflow trigger creation
- drive permission update
- email advanced search

这些工具不应默认完整暴露。

---

## 28.2 Schema Exposure Mode

```ts
type SchemaExposureMode =
  | "full"
  | "simplified"
  | "card_only"
  | "hidden"
```

---

## 28.3 推荐规则

```text
schema token <= 300       → full
300 < schema <= 1200      → simplified
schema > 1200             → card_only + load_schema
高风险写操作              → simplified / card_only，执行前再完整加载
低频复杂工具              → card_only
```

具体阈值可按模型上下文和产品阶段调整。

---

## 28.4 简化 Schema 应包含什么

```ts
type SimplifiedToolSchema = {
  name: string
  description: string
  requiredFields: Array<{
    name: string
    type: string
    description?: string
  }>
  commonOptionalFields?: string[]
  examples?: Array<Record<string, unknown>>
  fullSchemaAvailable: boolean
}
```

### 简化 Schema 不应包含

- 全量复杂嵌套对象
- 所有罕见可选参数
- 低频枚举
- 外部 API 原始文档

---

## 28.5 完整 Schema 何时加载

完整 schema 可在以下情况按需加载：

- 模型调用 `tool.load_schema`
- 当前 step 明确需要该工具
- 用户明确要求复杂操作
- 简化 schema 不足以构造合法参数
- 工具执行前需要严格校验
- 高风险操作进入审批前需要完整展示

---

## 29. 工具调用统计与动态暴露

## 29.1 方案价值

记录“会话类型 → 工具调用次数”映射，可以帮助系统逐步优化不同会话类型下默认暴露的工具。

---

## 29.2 不能只看调用次数

调用次数只能作为加权因素，不能直接决定工具暴露。

### 风险 1：历史偏见

模型早期误用某工具，可能导致该工具被持续提升。

### 风险 2：新工具冷启动困难

新工具因为调用次数低，可能长期无法被发现。

### 风险 3：高频不等于高价值

有些高频工具只是辅助工具，不一定值得完整暴露。

### 风险 4：高风险工具不应因高频自动暴露

例如 `email.send_draft` 或 `calendar.delete_event`，不能因为使用频率高就默认完整暴露。

---

## 29.3 推荐统计结构

```ts
type ToolUsageStats = {
  intentType: string
  toolName: string
  callCount: number
  successCount: number
  failureCount: number
  approvalDeniedCount: number
  lastUsedAt?: string
  averageResultUsefulness?: number
}
```

---

## 29.4 推荐加权公式

调用次数只作为 exposure score 的一部分：

```text
exposureScore =
  intentRelevance * 0.35
  + successRate * 0.2
  + usageFrequency * 0.15
  + recency * 0.1
  + userPreferenceBoost * 0.1
  - schemaCostPenalty * 0.05
  - riskPenalty * 0.05
```

---

## 29.5 使用统计的作用方式

使用统计不应越过安全边界，只能做有限提升：

```text
card_only -> simplified
simplified -> full
hidden -> card_only
```

但禁止：

```text
permission_denied -> exposed
connector_unavailable -> exposed
high_risk -> full_schema without approval
```

---

## 30. Tool Exposure Policy

## 30.1 决策流程

推荐 Tool Plane 按以下顺序生成工具暴露计划：

```text
Step 1: 加载 Always-on Core Tools
Step 2: 根据 Intent Router 加载 Tool Profile
Step 3: 根据 Agent 类型加载 Agent Toolset
Step 4: 根据 active plan step 加载相关工具
Step 5: 应用权限与连接器过滤
Step 6: 应用 schema budget
Step 7: 叠加工具使用统计
Step 8: 输出 ToolExposurePlan
```

---

## 30.2 ToolExposurePlan

```ts
type ToolExposurePlan = {
  runId: string
  sessionId: string
  intentType: string
  agentId: string
  agentType: string

  exposedTools: Array<{
    toolName: string
    exposureLevel:
      | "full_schema"
      | "simplified_schema"
      | "capability_card"
    reason:
      | "always_on"
      | "intent_profile"
      | "agent_toolset"
      | "active_plan_step"
      | "usage_promoted"
      | "manual_loaded"
  }>

  hiddenTools: Array<{
    toolName: string
    reason:
      | "not_relevant"
      | "permission_denied"
      | "connector_unavailable"
      | "schema_budget_exceeded"
      | "risk_policy"
  }>

  capabilityManifest: Array<{
    domain: string
    summary: string
    loadHint?: string
  }>

  schemaBudget: {
    maxTokens: number
    estimatedTokens: number
  }
}
```

---

## 30.3 ToolExposureDecision

单个工具的暴露决策：

```ts
type ToolExposureDecision = {
  toolName: string
  exposureLevel:
    | "full_schema"
    | "simplified_schema"
    | "capability_card"
    | "hidden"
  reason: string
  riskLevel?: "low" | "medium" | "high" | "critical"
  schemaTokenEstimate?: number
}
```

---

## 31. Tool Search / Load Schema

## 31.1 tool.search

用于搜索未加载工具或能力。

### 输入

```ts
type ToolSearchInput = {
  query: string
  domain?: string
  intentType?: string
  riskLevelMax?: "low" | "medium" | "high" | "critical"
}
```

### 输出

```ts
type ToolSearchResult = {
  tools: ToolCapabilityCard[]
}
```

---

## 31.2 tool.load_schema

用于按需加载完整工具 schema。

### 输入

```ts
type ToolSchemaLoadRequest = {
  runId: string
  agentId: string
  toolNames: string[]
  reason: string
}
```

### 输出

```ts
type ToolSchemaLoadResult = {
  loadedSchemas: Array<{
    toolName: string
    schemaRef: string
    schema: JSONSchema
    expiresAfterIterations?: number
  }>
}
```

---

## 31.3 Schema 有效期

按需加载的完整 schema 不应永久留在上下文中。

```ts
type LoadedToolSchemaState = {
  toolName: string
  schemaRef: string
  loadedAtIteration: number
  expiresAfterIterations: number
}
```

---

## 32. 工具 Schema 与 Context Manager 的关系

工具 schema 虽然通常通过模型 API 的 `tools` 字段传入，而不是普通文本上下文，但它同样占用模型上下文预算。

因此，Context Manager 应参与决定：

- 哪些工具 schema 进入本轮模型输入
- 哪些工具降级为简化 schema
- 哪些工具仅保留能力卡片
- 懒加载 schema 何时过期
- compact 后哪些工具 schema 需要回注

---

## 32.1 ToolSchemaContextItem

```ts
type ToolSchemaContextItem = {
  itemId: string
  sourceType: "tool_schema"
  semanticType: "capability_schema"
  toolName: string
  schemaRef?: string
  visibility: "always_on" | "intent_loaded" | "lazy_loaded"
  expiresAtIteration?: number
  estimatedTokens: number
  isPinned: boolean
  isCompressible: false
}
```

---

## 33. 权限与风险优先级

工具暴露必须受权限、风险、连接器状态约束。

优先级应为：

```text
权限 / 风险 / 连接器可用性
    >
Intent 映射
    >
使用统计
    >
Schema 预算
```

### 规则

- 被 deny 的工具不暴露
- connector 未授权的工具不暴露为可调用
- 高风险工具不因调用频率高而自动 full schema
- destructive 工具默认隐藏或仅 capability card
- 写操作即使暴露，也应注明需要审批

---

## 34. 与 Agent Kernel 的关系补充

Agent Kernel 负责：

- 在构建模型输入前请求工具池
- 将 `IntentRouterDecision`、agent type、permission mode 传给 Tool Plane
- 接收 `ToolExposurePlan`
- 将可用工具 schema 交给 Model Input Builder
- 在工具 schema 变化时写入 Event Store
- 在 loop 中处理 `tool.search` / `tool.load_schema` 工具调用结果

Tool Plane 负责：

- 根据策略生成工具暴露计划
- 提供 full / simplified / card schema
- 管理懒加载 schema
- 记录工具暴露决策
- 提供工具能力目录

---

## 35. 与 Intent Router 的关系

Intent Router 负责识别本轮 intent。

Tool Plane 根据 intent 加载 Tool Profile。

```text
IntentRouterDecision
        │
        ▼
ToolProfile Selection
        │
        ▼
ToolExposurePlan
```

示例：

```text
intent = schedule
        → schedule_tool_profile

intent = communication
        → communication_tool_profile

intent = document_work
        → docs_tool_profile
```

---

## 36. 与 Subagent 的关系补充

Subagent 工具池应比主 Agent 更窄。

推荐规则：

- 主 Agent 不默认拿所有工具
- Subagent 只拿完成自己 step 所需工具
- Subagent 不直接拿高风险写工具，除非主 plan 明确授权
- Subagent 可通过 tool.search 请求更多工具，但仍受 agent policy 过滤

---

## 37. 与 Event Store / Observability 的关系补充

工具暴露本身也应可观测。

建议记录事件：

- `tool_exposure_plan_created`
- `tool_schema_simplified`
- `tool_schema_loaded`
- `tool_schema_expired`
- `tool_hidden_by_permission`
- `tool_hidden_by_budget`
- `tool_promoted_by_usage`
- `tool_demoted_by_risk`

---

## 38. 推荐新增 Tool Plane 子模块

## 38.1 Tool Exposure Policy

负责计算工具暴露级别。

### 输入

- intent decision
- agent type
- permission context
- connector state
- schema budget
- usage stats
- active plan step

### 输出

- `ToolExposurePlan`

---

## 38.2 Tool Capability Index

负责存储工具能力卡片和轻量检索信息。

```ts
type ToolCapabilityIndex = {
  cards: ToolCapabilityCard[]
}
```

---

## 38.3 Tool Schema Loader

负责按需加载完整 schema。

### 职责

- load schema
- cache schema
- set expiration
- validate tool visibility
- record schema load event

---

## 38.4 Tool Usage Analytics

负责统计不同会话类型下的工具调用表现。

### 统计维度

- intent type
- tool name
- success rate
- failure rate
- approval denied rate
- result usefulness
- last used time

---

## 39. 推荐目录结构补充

在原有目录结构基础上，建议增加：

```text
src/
  tools/
    exposure/
      ToolExposurePolicy.ts
      ToolExposurePlan.ts
      ToolProfileRegistry.ts
      ToolCapabilityIndex.ts
      ToolSchemaLoader.ts
      ToolUsageAnalytics.ts
      SchemaSimplifier.ts
```

---

## 40. 工具暴露策略的关键结论

### 40.1 核心工具始终暴露

但复杂核心工具可以只暴露简化 schema。

### 40.2 会话类型与工具映射非常适合 MVP

Intent Router 输出会话类型后，Tool Plane 自动加载对应 Tool Profile。

### 40.3 未加载工具需要能力目录

否则模型不知道系统还能做什么。

### 40.4 Schema 长度必须受控

超过预算的工具默认降级为简化 schema 或 capability card。

### 40.5 使用统计可以优化工具暴露，但不能直接决定暴露

调用次数只能参与加权，不能越过权限、风险、连接器可用性。

### 40.6 最终规则

工具暴露应由以下因素共同决定：

```text
核心工具
+ 意图映射
+ Agent 工具集
+ 当前计划步骤
+ 能力目录
+ Schema 预算
+ 使用统计
- 权限限制
- 风险限制
- 连接器不可用
```

---

## 41. 合并后的最终结论

Tool Plane 应同时承担两层职责：

### 第一层：工具运行时

负责：

- 工具注册
- 工具调用
- 权限校验
- 编排执行
- 结果标准化
- 中断与失败闭环
- Event / Transcript 输出

### 第二层：工具暴露治理

负责：

- 本轮工具池选择
- 工具 schema 暴露级别
- 懒加载
- 能力目录
- schema token 预算
- 使用统计加权
- 权限 / 风险过滤

最终目标是：

> **既让模型拥有足够行动能力，又避免工具 schema 污染上下文，同时保证权限、安全、审计和可恢复性。**

---

# 42. 异步工具、长耗时操作与 Event Trigger Runtime 协作

## 42.1 补充目的

个人助理型 Agent 不只会调用短平快工具，还会发起长耗时外部动作，例如：

- 安装项目依赖
- 执行构建命令
- 启动进程
- 重启服务
- 等待容器启动
- 触发部署
- 等待迁移完成
- 等待外部系统处理完成

这类动作不适合让 Agent Kernel 或 Tool Executor 一直阻塞等待。

因此 Tool Plane 需要支持：

> **异步工具执行：工具启动外部动作后返回 OperationRef，由 Event Trigger Runtime 负责等待条件满足并唤醒后续运行时。**

---

## 42.2 职责边界

```text
Tool Plane
  负责发起外部动作，并返回 OperationRef / suggestedWaitConditions

Event Trigger Runtime
  负责注册 WaitCondition，监听外部状态，满足条件后生成 RuntimeTriggerEvent

Workflow Runtime / Subagent Runtime / Agent Kernel
  负责进入 waiting_for_external_event，并在被唤醒后继续执行
```

Tool Plane 不应自己管理长时间等待循环，也不应直接实现复杂触发器。

---

## 42.3 ToolExecutionMode

工具定义中应增加执行模式。

```ts
type ToolExecutionMode = "sync" | "async"
```

同步模式：

```text
工具执行完成后直接返回 completed / failed
```

异步模式：

```text
工具启动外部动作后立即返回 started + operationRef
后续由 Event Trigger Runtime 等待条件
```

---

## 42.4 ToolDefinition 扩展

建议在 `ToolDefinition.execution` 中增加：

```ts
type ToolDefinition<Input = unknown, Output = unknown> = {
  // ... existing fields

  execution: {
    isConcurrencySafe: boolean | ((input: Input) => boolean)
    isReadOnly: boolean | ((input: Input) => boolean)
    isDestructive?: boolean | ((input: Input) => boolean)
    interruptBehavior?: "cancel" | "block"
    timeoutMs?: number
    maxResultSizeChars?: number

    supportedExecutionModes?: Array<"sync" | "async">
    defaultExecutionMode?: "sync" | "async"

    asyncOperation?: {
      returnsOperationRef: boolean
      supportsWaitConditionSuggestion: boolean
      defaultTimeoutMs?: number
    }
  }

  // ... existing fields
}
```

---

## 42.5 OperationRef

异步工具启动外部动作后必须返回可追踪引用。

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

---

## 42.6 AsyncToolResult

异步工具的输出应包含 `operationRef` 和可选的 `suggestedWaitConditions`。

```ts
type AsyncToolResult = {
  status: "started"

  operationRef: OperationRef

  suggestedWaitConditions?: WaitCondition[]

  logRef?: string

  userVisibleSummary?: string

  modelFacingSummary?: string
}
```

`modelFacingSummary` 应告诉模型：

- 外部动作已经启动
- 当前需要等待什么
- 后续会由 Event Trigger Runtime 唤醒
- 当前 run 是否进入 waiting_for_external_event

---

## 42.7 WaitCondition 建议

异步工具可以根据工具类型提供默认等待条件。

例如 `command.run_background("npm install")`：

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

服务重启类工具应建议 readiness 条件，而不是只建议 restart 命令退出：

```text
service active
+ port open
+ health check 连续成功
+ stabilization window
```

---

## 42.8 ToolExecutionResult 扩展

`ToolExecutionResult.status` 应增加异步启动状态。

```ts
type ToolExecutionResult = {
  toolCallId: string
  toolName: string

  status:
    | "completed"
    | "started_async"
    | "waiting_external"
    | "failed"
    | "denied"
    | "aborted"
    | "cancelled"
    | "discarded"
    | "timeout"

  output?: unknown
  asyncOperation?: AsyncToolResult

  resultMessage: ToolResultMessage

  contextDelta?: RuntimeContextDelta

  metrics?: {
    startedAt: string
    completedAt?: string
    durationMs?: number
    outputSizeBytes?: number
  }
}
```

---

## 42.9 ToolProgressEvent 扩展

`ToolProgressEvent.progressType` 应明确支持异步等待：

```ts
type ToolProgressEvent = {
  // ... existing fields

  progressType:
    | "started"
    | "progress"
    | "waiting_for_permission"
    | "waiting_external"
    | "async_operation_started"
    | "operation_ref_created"
    | "wait_condition_registered"
    | "stream_chunk"
    | "completed"
    | "failed"

  operationRef?: OperationRef
  waitConditionId?: string
  message?: string
  payload?: Record<string, unknown>
  timestamp: string
}
```

---

## 42.10 ToolEvent 扩展

建议增加以下工具事件：

```ts
type ToolEventType =
  | "tool_async_operation_started"
  | "tool_operation_ref_created"
  | "tool_wait_condition_suggested"
  | "tool_wait_condition_registered"
  | "tool_external_wait_started"
  | "tool_external_wait_resolved"
  | "tool_external_wait_failed"
  | "tool_external_wait_timeout"
```

事件中应包含：

```ts
{
  operationId?: string
  waitConditionId?: string
  workflowRunId?: string
  stepRunId?: string
  backgroundRunId?: string
  subagentRunId?: string
}
```

---

## 42.11 Tool Executor 异步流水线

异步工具执行顺序：

```text
tool_use received
  │
  ▼
find tool definition
  │
  ▼
schema parse / validateInput
  │
  ▼
pre-tool hooks
  │
  ▼
permission decision
  │
  ▼
tool.call(async)
  │
  ▼
external operation started
  │
  ▼
return OperationRef
  │
  ▼
suggest WaitCondition
  │
  ▼
register WaitCondition with Event Trigger Runtime
  │
  ▼
emit started_async result
  │
  ▼
Kernel / Workflow / Subagent enters waiting_for_external_event
```

条件满足后的后续流程：

```text
Event Trigger Runtime
  → RuntimeTriggerEvent
  → Runtime Dispatcher
  → Workflow Runtime / Subagent Runtime / Agent Kernel resume
```

---

## 42.12 与 Workflow Runtime 的协作

固化 Workflow 中的长耗时 Step：

```text
WorkflowStep: install_dependencies
  ↓
Tool Plane 启动 async tool
  ↓
返回 OperationRef
  ↓
Workflow Runtime 将 stepRun 状态设为 waiting_for_external_event
  ↓
Event Trigger Runtime 监听 WaitCondition
  ↓
条件满足后恢复 WorkflowRun
```

Tool Plane 只负责启动和返回引用，不负责维护 WorkflowStepRun 状态。

---

## 42.13 与 Subagent Runtime 的协作

后台 Subagent 中的长耗时工具：

```text
BackgroundSubagentRun
  ↓
Subagent 调用 async tool
  ↓
Tool Plane 返回 OperationRef
  ↓
Subagent Runtime checkpoint
  ↓
Subagent Runtime 进入 waiting_for_external_event
  ↓
Event Trigger Runtime 监听条件
  ↓
条件满足后恢复 Subagent loop
```

Tool Plane 不负责 BackgroundSubagentRun 生命周期。

---

## 42.14 与 Event Trigger Runtime 的协作接口

Tool Plane 可以通过以下接口注册等待条件：

```ts
type RegisterWaitConditionRequest = {
  runId: string
  sessionId?: string
  toolCallId: string
  toolName: string

  operationRef: OperationRef
  waitCondition: WaitCondition

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
}
```

输出：

```ts
type RegisterWaitConditionResult = {
  waitConditionId: string
  status: "registered" | "rejected"
  reason?: string
}
```

---

## 42.15 本地执行与远程执行

如果工具动作发生在用户本地环境，例如：

```text
npm install
pnpm dev
systemctl restart
docker compose up
```

Tool Plane 不应假设云端能直接观察进程。

应通过：

```text
Local Runtime Worker
Local Connector
MCP Server
Remote Connector
```

返回 OperationRef，并由对应 Event Source Adapter 监听。

---

## 42.16 关键原则

1. 长耗时工具应优先支持 async mode。
2. 异步工具必须返回 OperationRef。
3. 工具可以建议 WaitCondition，但最终等待与唤醒归 Event Trigger Runtime。
4. Tool Plane 不管理长时间等待循环。
5. Workflow / Subagent / Kernel 负责进入 waiting_for_external_event。
6. 服务重启应等待 readiness，而不是只等命令退出。
7. 所有异步操作必须可观测、可审计、可恢复。
8. 所有已接受的 tool use 必须有 terminal state；异步启动成功时 terminal state 可以是 `started_async`，后续 completion 由 RuntimeTriggerEvent 驱动。


---

# 34. Foreground / PlannerRun 工具暴露策略补充

Foreground Conversation Agent 与 PlannerRun 应使用不同 ToolProfile。

## 34.1 Foreground ToolProfile

Foreground Conversation Agent 只应暴露短循环需要的工具：

- status.query_active_work
- approval.respond
- ask_user
- memory.retrieve 简化版
- transcript.search 简化版
- tool.search / tool.load_schema
- direct dispatch helper

默认不应暴露复杂写工具和长耗时工具的完整 schema。

## 34.2 PlannerRun ToolProfile

PlannerRun 应暴露计划与协调类工具：

- plan.write
- plan.patch
- todo.write
- todo.patch
- agent.assign
- runtime_action.create
- workflow_draft.create
- tool.search / tool.load_schema

PlannerRun 不应直接暴露 connector 业务读写工具；具体执行应通过 RuntimeAction 委派给 Tool Plane / Subagent / Workflow。

## 34.3 直接委派工具调用

Foreground Conversation Agent 对简单读写任务可以直接生成 `RuntimeAction: execute_tool`，但工具执行仍由 Runtime Dispatcher → Tool Plane 完成，并经过 Permission Engine。
