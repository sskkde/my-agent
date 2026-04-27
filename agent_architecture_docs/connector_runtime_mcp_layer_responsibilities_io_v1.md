# Connector Runtime / MCP Layer 功能职责与输入输出文档 v2（边界修复版）

## 1. 文档目的

本文档定义个人助理型 Agent 平台中的 **Connector Runtime / MCP Layer** 模块，包括：

- Connector Runtime / MCP Layer 的定位与职责边界
- 参考 Claude Code 后可借鉴的工具接入、MCP 接入、权限、事件与运行时管理思路
- Connector、MCP Server、Tool Plane、Gateway、Event Trigger Runtime、Memory System、Context Manager 的关系
- 连接器注册、鉴权、能力发现、工具桥接、资源访问、事件订阅、异步操作、审计和安全边界
- 输入输出对象设计
- 推荐目录结构与 MVP 实现建议

---

## 2. 模块定位

Connector Runtime / MCP Layer 的推荐定位是：

> **外部能力与外部数据的统一接入层。**

它负责把 Gmail、Calendar、Drive、Notion、Slack、本地系统、浏览器、MCP Server、Webhook、数据库、云服务等外部系统包装成平台内部可治理的能力。

它不是：

- Agent Kernel
- Tool Plane 本身
- Gateway
- Workflow Runtime
- Event Trigger Runtime
- Permission Engine
- Memory Store

更准确地说：

```text
Connector Runtime / MCP Layer
  = 外部系统适配层 + 鉴权层 + 能力发现层 + 资源访问层 + 事件接入层 + MCP 桥接层
```

---

## 3. 参考 Claude Code 的核心启发

Claude Code 中值得借鉴的不是某个具体 connector，而是以下运行时思想。

## 3.1 工具是模型行动的唯一显式通道

Claude Code 中模型要对外部世界产生影响，通常都通过 tool use 完成。

对本系统的启发：

> Connector 不应直接暴露给模型，而应通过 Tool Plane 转换成受权限控制、可审计、可裁剪 schema 的工具能力。

---

## 3.2 MCP Server 是能力提供者，不是 Agent 本身

Claude Code 可以接入 MCP Server，让 MCP Server 提供工具、资源和能力。

对本系统的启发：

```text
MCP Server
  → MCP Client / Session
  → Capability Discovery
  → Tool Bridge
  → Tool Plane
  → Model Tool Schema
```

模型看到的是工具，而不是直接看到 MCP 连接细节。

---

## 3.3 工具暴露需要动态选择

Claude Code 不会把所有工具无限制暴露给模型，而是按上下文、权限、工具类型、用户设置等进行选择。

对本系统的启发：

Connector Runtime 不负责决定最终暴露哪些工具；它只提供能力目录。  
Tool Plane / Tool Exposure Policy / Intent Router 决定本轮暴露哪些 connector tools。

---

## 3.4 权限判断不能散落在 connector 内部

Claude Code 的权限判断是工具执行前的统一环节，而不是每个工具各写一套判断。

对本系统的启发：

Connector 可以声明风险、scope 和 connector policy，但最终 allow / ask / deny 由 Permission & Approval Engine 统一决策。

---

## 3.5 MCP / Connector 结果要标准化

外部工具返回的数据格式不同。Claude Code 会将 tool result 统一回灌到 Agent Loop。

对本系统的启发：

Connector Runtime 必须把外部响应标准化为：

- ConnectorResponse
- ToolExecutionResult
- RuntimeContextDelta
- ArtifactRef
- Event
- OperationRef

---

## 3.6 长耗时外部操作需要异步化

对于安装、部署、服务重启、本地命令等长耗时操作，不能阻塞主 loop。

对本系统的启发：

Connector Runtime / MCP Layer 应支持：

```text
async operation
  → OperationRef
  → WaitCondition
  → Event Trigger Runtime
  → RuntimeTriggerEvent
  → resume
```

---

## 4. 总体架构位置

```text
Agent Kernel / Subagent Runtime / Workflow Runtime
        │
        ▼
Tool Plane
        │
        ▼
Connector Runtime / MCP Layer
        │
        ├─ Built-in Connectors
        │    ├─ Gmail
        │    ├─ Google Calendar
        │    ├─ Contacts
        │    ├─ Drive / Docs
        │    ├─ Notion
        │    ├─ Slack
        │    └─ Local Runtime Worker
        │
        └─ MCP Layer
             ├─ MCP Client Manager
             ├─ MCP Server Registry
             ├─ MCP Tool Bridge
             ├─ MCP Resource Bridge
             └─ MCP Event Bridge
```

更完整的调用关系：

```text
模型 tool_use
  ↓
Tool Plane
  ↓
Permission Engine
  ↓
Connector Runtime / MCP Layer
  ↓
External System / MCP Server
  ↓
ConnectorResponse
  ↓
ToolExecutionResult
  ↓
Agent Kernel / Subagent Runtime / Workflow Runtime
```

---

## 5. 职责边界

## 5.1 应承担的职责

### 5.1.1 Connector 注册与实例管理

管理可用连接器：

- ConnectorDefinition
- ConnectorInstance
- ConnectorAccount
- ConnectorAuthState
- ConnectorCapability
- ConnectorResource
- ConnectorEventSource

例如：

```text
gmail
google_calendar
google_drive
slack
notion
browser
local_worker
mcp_server_x
```

---

### 5.1.2 鉴权与凭证管理

负责连接器级鉴权：

- OAuth
- API Key
- Service Account
- Personal Access Token
- Local credential
- MCP server connection config

注意：

Connector Runtime 负责凭证获取和刷新，但不负责决定某个动作是否允许执行。  
动作级权限仍归 Permission Engine。

---

### 5.1.3 能力发现

负责从连接器或 MCP Server 获取能力目录：

- tools
- resources
- prompts
- event subscriptions
- async operations
- supported auth scopes
- rate limits
- safety metadata

能力发现结果进入 Tool Registry / Capability Registry。

---

### 5.1.4 工具桥接

将 connector / MCP 的能力桥接为 Tool Plane 可执行工具。

例如：

```text
gmail.search
gmail.read_thread
gmail.create_draft
calendar.search_events
calendar.create_event
drive.search_docs
drive.read_doc
local.run_command
mcp.<server>.<tool>
```

---

### 5.1.5 资源访问

统一访问外部资源：

- email thread
- calendar event
- drive file
- contact
- slack thread
- browser page
- local file
- MCP resource

并返回标准化 resource ref。

---

### 5.1.6 事件接入

接收或订阅外部事件：

- 邮件到达
- 日历变更
- 文件更新
- Slack 消息
- webhook
- MCP notification
- 本地进程状态
- Docker / Kubernetes event
- 服务 health check

这些事件不直接执行任务，而是交给 Event Trigger Runtime 匹配和唤醒。

---

### 5.1.7 长耗时操作支持

支持异步 connector 操作：

- 本地命令执行
- 项目安装
- 构建
- 服务重启
- 部署
- 数据迁移

返回：

```text
OperationRef
suggestedWaitConditions
logRef
```

---

### 5.1.8 结果标准化

将外部系统响应标准化为统一内部对象：

- ConnectorResponse
- ToolExecutionResult
- RuntimeContextDelta
- ArtifactRef
- OperationRef
- ConnectorEvent

---

### 5.1.9 限流、重试与熔断

管理 connector 级别运行稳定性：

- rate limit
- retry
- backoff
- circuit breaker
- quota monitoring
- transient failure handling
- connector health

---

### 5.1.10 审计与可观测

记录：

- connector call started
- connector call completed
- connector call failed
- auth refresh
- event received
- operation started
- operation completed
- resource accessed
- MCP server connected / disconnected

---

### 5.1.11 本地运行环境桥接

对 coding / project automation / local assistant 场景，需要 Local Runtime Worker / MCP Server 负责：

- 本地命令
- 文件系统
- 进程观察
- 日志流
- 端口探测
- 服务状态
- 项目安装 / 构建

云端 Connector Runtime 不应直接假设能访问用户本地进程。

---

## 5.2 不应承担的职责

Connector Runtime / MCP Layer 不应承担：

- 不驱动 Agent Loop
- 不决定意图
- 不生成 Plan
- 不编排 Workflow
- 不决定最终工具暴露
- 不做最终权限决策
- 不负责模型上下文裁剪
- 不直接写长期 Memory
- 不直接通知用户
- 不绕过 Tool Plane 执行动作

---

## 6. 推荐子模块

```text
Connector Runtime / MCP Layer
  ├─ ConnectorRegistry
  ├─ ConnectorDefinitionLoader
  ├─ ConnectorInstanceManager
  ├─ ConnectorAuthManager
  ├─ CredentialVault
  ├─ CapabilityDiscoveryService
  ├─ CapabilityRegistry
  ├─ ConnectorToolBridge
  ├─ ConnectorResourceResolver
  ├─ ConnectorRequestRouter
  ├─ ConnectorResponseNormalizer
  ├─ ConnectorEventBridge
  ├─ ConnectorRateLimitManager
  ├─ ConnectorRetryManager
  ├─ ConnectorHealthMonitor
  ├─ ConnectorAuditEmitter
  │
  ├─ MCPClientManager
  ├─ MCPServerRegistry
  ├─ MCPSessionManager
  ├─ MCPToolBridge
  ├─ MCPResourceBridge
  ├─ MCPPromptBridge
  ├─ MCPEventBridge
  └─ MCPAuthAdapter
```

---

## 7. Connector 核心对象

## 7.1 ConnectorDefinition

```ts
type ConnectorDefinition = {
  connectorId: string
  displayName: string
  description?: string

  connectorType:
    | "built_in"
    | "oauth_app"
    | "api_key"
    | "mcp_server"
    | "local_worker"
    | "webhook"
    | "custom"

  provider:
    | "google"
    | "microsoft"
    | "slack"
    | "notion"
    | "github"
    | "browser"
    | "local"
    | "mcp"
    | "custom"

  auth: {
    authType:
      | "none"
      | "oauth2"
      | "api_key"
      | "service_account"
      | "pat"
      | "local_session"
      | "mcp_auth"

    requiredScopes?: string[]
    optionalScopes?: string[]
    tokenRefreshSupported?: boolean
  }

  capabilities: ConnectorCapability[]

  eventSources?: ConnectorEventSourceDefinition[]

  resourceTypes?: ConnectorResourceType[]

  riskProfile: {
    readsPrivateData: boolean
    canWriteExternalState: boolean
    canSendMessages: boolean
    canDeleteData: boolean
    canExecuteCode: boolean
    canAccessLocalSystem: boolean
  }

  defaultPermissionMode:
    | "read_only"
    | "ask_on_write"
    | "trusted_auto"
    | "background_limited"

  status: "available" | "disabled" | "deprecated"
}
```

---

## 7.2 ConnectorInstance

```ts
type ConnectorInstance = {
  connectorInstanceId: string
  connectorId: string
  ownerUserId: string

  status:
    | "connected"
    | "disconnected"
    | "auth_required"
    | "auth_expired"
    | "degraded"
    | "disabled"

  account?: {
    accountId?: string
    displayName?: string
    email?: string
    tenantId?: string
    workspaceId?: string
  }

  authStateRef?: string

  enabledCapabilities?: string[]

  settings?: {
    allowRead?: boolean
    allowWrite?: boolean
    allowEventSubscriptions?: boolean
    memoryAllowed?: boolean
    defaultVisibility?: "private_user" | "workspace"
  }

  createdAt: string
  updatedAt: string
  lastHealthCheckAt?: string
}
```

---

## 7.3 ConnectorCapability

```ts
type ConnectorCapability = {
  capabilityId: string
  name: string
  description?: string

  capabilityType:
    | "tool"
    | "resource"
    | "event_source"
    | "prompt"
    | "async_operation"

  toolName?: string

  category:
    | "read"
    | "search"
    | "write"
    | "delete"
    | "send"
    | "schedule"
    | "automation"
    | "local_execution"
    | "memory_source"
    | "workflow"

  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>

  riskLevel: "low" | "medium" | "high" | "critical"

  requiredAuthScopes?: string[]

  supportsAsync?: boolean
  supportsStreaming?: boolean
  supportsPagination?: boolean

  resultSensitivity:
    | "low"
    | "medium"
    | "high"
    | "restricted"

  exposureHints?: {
    exposeByDefault?: boolean
    simplifiedSchemaAvailable?: boolean
    fullSchemaTokenEstimate?: number
    intentTags?: string[]
  }
}
```

---

## 7.4 ConnectorResourceRef

```ts
type ConnectorResourceRef = {
  resourceRef: string

  connectorInstanceId: string
  connectorId: string

  resourceType:
    | "email"
    | "email_thread"
    | "calendar_event"
    | "contact"
    | "document"
    | "file"
    | "folder"
    | "slack_message"
    | "web_page"
    | "local_file"
    | "process"
    | "service"
    | "mcp_resource"
    | "custom"

  externalId?: string

  displayName?: string
  uri?: string

  metadata?: Record<string, unknown>

  sensitivity:
    | "low"
    | "medium"
    | "high"
    | "restricted"

  createdAt: string
}
```

---

## 7.5 ConnectorCallRequest

```ts
type ConnectorCallRequest = {
  requestId: string
  userId: string

  connectorInstanceId: string
  capabilityId: string

  operation:
    | "invoke_tool"
    | "read_resource"
    | "search_resource"
    | "subscribe_event"
    | "unsubscribe_event"
    | "start_async_operation"
    | "cancel_operation"
    | "health_check"

  input: Record<string, unknown>

  executionContext: {
    runId?: string
    sessionId?: string
    planId?: string
    workflowRunId?: string
    workflowStepRunId?: string
    backgroundRunId?: string
    subagentRunId?: string
    toolCallId?: string
  }

  authContext?: {
    requiredScopes?: string[]
    allowRefresh?: boolean
  }

  requestPolicy?: {
    timeoutMs?: number
    retryPolicyRef?: string
    idempotencyKey?: string
    allowAsync?: boolean
  }
}
```

---

## 7.6 ConnectorResponse

```ts
type ConnectorResponse = {
  requestId: string
  connectorInstanceId: string
  capabilityId: string

  status:
    | "success"
    | "started_async"
    | "partial_success"
    | "auth_required"
    | "permission_denied"
    | "rate_limited"
    | "failed"
    | "timeout"
    | "cancelled"

  data?: unknown

  resourceRefs?: ConnectorResourceRef[]

  operationRef?: OperationRef

  suggestedWaitConditions?: WaitCondition[]

  pagination?: {
    nextCursor?: string
    hasMore?: boolean
  }

  normalizedOutput?: {
    userVisibleSummary?: string
    modelFacingSummary?: string
    structured?: Record<string, unknown>
  }

  error?: {
    code: string
    message: string
    recoverable: boolean
    retryAfterMs?: number
  }

  metrics?: {
    startedAt: string
    completedAt?: string
    latencyMs?: number
    responseSizeBytes?: number
  }
}
```

---

## 8. MCP Layer 设计

## 8.1 MCPServerDefinition

```ts
type MCPServerDefinition = {
  mcpServerId: string
  displayName: string
  description?: string

  transport:
    | "stdio"
    | "http"
    | "sse"
    | "websocket"
    | "custom"

  endpoint?: string
  command?: string
  args?: string[]

  auth?: {
    authType:
      | "none"
      | "token"
      | "oauth2"
      | "custom"
    requiredScopes?: string[]
  }

  ownerScope:
    | "user"
    | "workspace"
    | "system"

  trustLevel:
    | "trusted"
    | "user_installed"
    | "third_party"
    | "untrusted"

  allowedCapabilities?: Array<
    | "tools"
    | "resources"
    | "prompts"
    | "notifications"
  >

  sandboxPolicy?: {
    networkAccess?: boolean
    filesystemAccess?: boolean
    processAccess?: boolean
  }

  status: "enabled" | "disabled" | "error"
}
```

---

## 8.2 MCPSession

```ts
type MCPSession = {
  mcpSessionId: string
  mcpServerId: string
  ownerUserId?: string

  status:
    | "connecting"
    | "connected"
    | "disconnected"
    | "error"
    | "restarting"

  capabilities?: {
    tools?: MCPToolDescriptor[]
    resources?: MCPResourceDescriptor[]
    prompts?: MCPPromptDescriptor[]
    notifications?: string[]
  }

  connectionInfo?: {
    transport: string
    endpoint?: string
    processId?: string
  }

  startedAt: string
  lastHeartbeatAt?: string
  error?: {
    code: string
    message: string
  }
}
```

---

## 8.3 MCPToolDescriptor

```ts
type MCPToolDescriptor = {
  mcpServerId: string
  mcpToolName: string

  description?: string
  inputSchema?: Record<string, unknown>

  mappedToolName: string

  riskLevel?: "low" | "medium" | "high" | "critical"

  category?:
    | "read"
    | "search"
    | "write"
    | "delete"
    | "local_execution"
    | "automation"

  exposureHints?: {
    intentTags?: string[]
    exposeByDefault?: boolean
    simplifiedSchemaAvailable?: boolean
  }
}
```

---

## 8.4 MCPToolCallRequest

```ts
type MCPToolCallRequest = {
  requestId: string
  mcpSessionId: string
  mcpServerId: string
  mcpToolName: string

  input: Record<string, unknown>

  executionContext: ConnectorCallRequest["executionContext"]

  timeoutMs?: number
  idempotencyKey?: string
}
```

---

## 8.5 MCPToolCallResult

```ts
type MCPToolCallResult = {
  requestId: string
  mcpServerId: string
  mcpToolName: string

  status:
    | "success"
    | "started_async"
    | "failed"
    | "timeout"
    | "cancelled"

  rawResult?: unknown

  normalizedOutput?: ConnectorResponse["normalizedOutput"]

  resourceRefs?: ConnectorResourceRef[]

  operationRef?: OperationRef
  suggestedWaitConditions?: WaitCondition[]

  error?: {
    code: string
    message: string
    recoverable: boolean
  }
}
```

---

## 9. Tool Plane 集成

Connector Runtime 不是直接给模型调用，而是通过 Tool Plane 暴露。

```text
Connector Capability
  ↓
ConnectorToolBridge
  ↓
ToolDefinition
  ↓
Tool Registry
  ↓
Tool Exposure Policy
  ↓
Model Tool Schema
```

### 9.1 ConnectorToolDefinition

```ts
type ConnectorToolDefinition = {
  toolName: string
  connectorId: string
  capabilityId: string

  description: string

  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>

  category:
    | "read"
    | "search"
    | "write"
    | "delete"
    | "send"
    | "automation"
    | "local_execution"

  permission: {
    riskLevel: "low" | "medium" | "high" | "critical"
    requiredScopes?: string[]
    requiresApprovalByDefault: boolean
  }

  execution: {
    supportedExecutionModes: Array<"sync" | "async">
    defaultExecutionMode: "sync" | "async"
    timeoutMs?: number
    maxResultSizeBytes?: number
  }

  exposure: {
    intentTags?: string[]
    exposeByDefault?: boolean
    simplifiedSchema?: Record<string, unknown>
    fullSchemaTokenEstimate?: number
  }
}
```

---

## 10. Event Trigger Runtime 集成

Connector Runtime / MCP Layer 提供事件源，但 Event Trigger Runtime 负责 trigger 匹配与唤醒。

```text
Connector Event
  ↓
ConnectorEventBridge
  ↓
ConnectorEvent
  ↓
Event Trigger Runtime
  ↓
RuntimeTriggerEvent
  ↓
Runtime Dispatcher
```

---

## 10.0.1 与 Gateway 的外部事件入口边界

外部事件可以由 Gateway 或 Connector Runtime / MCP Layer 接收，但二者边界不同：

```text
Gateway
  负责用户渠道、webhook、聊天 / 邮件回复、审批回执、通知回执等入口协议适配

Connector Runtime / MCP EventBridge
  负责 connector 原生事件、MCP notification、本地 worker 事件、资源变化事件等能力层事件接入
```

二者进入 Event Trigger Runtime 前必须统一标准化：

```text
Gateway InboundEnvelope / ConnectorEvent
  → RuntimeTriggerEvent
  → Runtime Dispatcher
```

所有事件必须带上可追踪和幂等字段：

- `correlationId`
- `causationId`
- `idempotencyKey`
- source connector / channel metadata
- relatedRefs

Connector Runtime / MCP Layer 只提供事件源和标准化事件，不负责 trigger 匹配、不直接唤醒运行时、不直接通知用户。

## 10.1 ConnectorEventSourceDefinition

```ts
type ConnectorEventSourceDefinition = {
  eventSourceId: string
  connectorId: string

  eventTypes: string[]

  deliveryMode:
    | "webhook"
    | "polling"
    | "stream"
    | "mcp_notification"
    | "local_worker"

  supportedFilters?: Record<string, unknown>

  requiresSubscription: boolean

  defaultPollingIntervalMs?: number
}
```

---

## 10.2 ConnectorEventSubscription

```ts
type ConnectorEventSubscription = {
  subscriptionId: string
  userId: string
  connectorInstanceId: string
  eventSourceId: string

  filters?: Record<string, unknown>

  target: {
    triggerId?: string
    eventTriggerRuntimeTarget?: boolean
  }

  status:
    | "active"
    | "paused"
    | "disabled"
    | "error"

  createdAt: string
  updatedAt: string
  expiresAt?: string
}
```

---

## 10.3 ConnectorEvent

```ts
type ConnectorEvent = {
  connectorEventId: string

  connectorId: string
  connectorInstanceId?: string

  eventSourceId: string
  eventType: string

  userId?: string

  resourceRef?: ConnectorResourceRef

  payload: Record<string, unknown>

  occurredAt: string
  receivedAt: string

  idempotencyKey?: string

  rawEventRef?: string
}
```

---

## 11. 异步操作与 WaitCondition

Connector Runtime / MCP Layer 应支持长耗时操作。

```text
Tool Plane 调用 connector async capability
  ↓
Connector Runtime 启动外部操作
  ↓
返回 OperationRef + suggestedWaitConditions
  ↓
Event Trigger Runtime 注册 WaitCondition
  ↓
条件满足后 Runtime Dispatcher 恢复目标运行时
```

## 11.1 OperationRef

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

    connectorInstanceId?: string
    mcpServerId?: string
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

## 11.2 WaitCondition 协作

Connector Runtime 可以建议 WaitCondition，但最终注册、持久化和唤醒归 Event Trigger Runtime。

```ts
type ConnectorSuggestedWaitCondition = {
  conditionType:
    | "process_exit"
    | "command_completed"
    | "service_ready"
    | "port_open"
    | "http_health_ok"
    | "log_pattern_matched"
    | "file_changed"
    | "connector_event_received"
    | "mcp_notification_received"

  match: Record<string, unknown>

  successCriteria?: Record<string, unknown>
  failureCriteria?: Record<string, unknown>
  pollingPolicy?: Record<string, unknown>
}
```

---

## 12. 权限与安全边界

## 12.1 权限分层

Connector Runtime 提供能力风险声明：

```text
connector risk profile
capability risk level
required auth scopes
resource sensitivity
```

Permission Engine 决定：

```text
allow / ask / deny
```

Tool Plane 负责在执行前调用 Permission Engine。

---

## 12.2 Connector Policy

```ts
type ConnectorPolicy = {
  connectorId: string
  userId?: string

  allowedCapabilities?: string[]
  deniedCapabilities?: string[]

  allowedResourceScopes?: Array<{
    resourceType: string
    pattern?: string
  }>

  writePolicy?: {
    requireApproval: boolean
    allowDraftOnly?: boolean
    denyDelete?: boolean
  }

  memoryPolicy?: {
    allowMemoryExtraction: boolean
    allowedMemoryTypes?: string[]
  }

  eventPolicy?: {
    allowSubscriptions: boolean
    maxSubscriptions?: number
  }
}
```

---

## 12.3 本地系统安全

Local Runtime Worker / 本地 MCP Server 是高风险连接器。

必须特别约束：

- 文件系统访问范围
- 命令执行白名单 / 黑名单
- 网络访问
- 环境变量读取
- 凭证遮蔽
- 进程控制权限
- 审批要求
- sandbox
- 操作日志

---

## 13. Memory / Context 集成

Connector Runtime 不直接写长期 Memory。

它提供：

- ConnectorResourceRef
- normalized output
- tool result summary
- resource metadata
- source refs

Memory System 可从 Transcript / Tool Result / Artifact 中抽取记忆。

Context Manager 可以根据 resource refs、connector refs、memory refs 选择注入上下文。

---

## 14. Gateway 集成

Gateway 负责外部渠道输入和用户输出。  
Connector Runtime 可以作为 Gateway 的底层 adapter 来源之一，但不替代 Gateway。

例如：

```text
Email reply
  → Gateway Email Adapter
  → InboundEnvelope

Gmail connector search
  → Tool Plane
  → Connector Runtime
  → Gmail API
```

注意区分：

```text
Gateway 处理“用户输入通道”
Connector Runtime 处理“外部资源和能力访问”
```

---

## 15. Observability / Audit 事件

```ts
type ConnectorRuntimeEvent = {
  eventId: string

  eventType:
    | "connector_registered"
    | "connector_instance_connected"
    | "connector_instance_disconnected"
    | "connector_auth_required"
    | "connector_auth_refreshed"
    | "connector_capabilities_discovered"
    | "connector_call_started"
    | "connector_call_completed"
    | "connector_call_failed"
    | "connector_resource_accessed"
    | "connector_event_received"
    | "connector_event_subscription_created"
    | "connector_rate_limited"
    | "connector_circuit_opened"
    | "mcp_server_registered"
    | "mcp_server_connected"
    | "mcp_server_disconnected"
    | "mcp_tool_discovered"
    | "mcp_tool_called"
    | "mcp_resource_read"
    | "mcp_notification_received"
    | "operation_ref_created"
    | "connector_async_operation_started"

  userId?: string
  sessionId?: string

  connectorId?: string
  connectorInstanceId?: string
  mcpServerId?: string
  capabilityId?: string
  toolCallId?: string

  operationId?: string
  resourceRef?: string

  timestamp: string
  payload?: Record<string, unknown>
}
```

---

## 16. 推荐首批 Connector

## 16.1 Gmail Connector

能力：

- search emails
- read email
- read thread
- create draft
- update draft
- send draft
- label email
- archive email
- email event subscription

---

## 16.2 Google Calendar Connector

能力：

- search events
- read event
- create event
- update event
- delete event
- respond invitation
- event changed subscription

---

## 16.3 Contacts Connector

能力：

- search contacts
- read contact
- resolve email to person

---

## 16.4 Drive / Docs Connector

能力：

- search files
- read docs
- read sheets
- read slides
- create / update docs
- file changed event

---

## 16.5 Browser / Web Connector

能力：

- web search
- open page
- read page
- scrape structured content
- download file

---

## 16.6 Local Runtime Worker / Local MCP

能力：

- run command
- inspect process
- watch logs
- read project files
- check ports
- check service readiness
- return OperationRef

---

## 17. MVP 实现建议

## Phase 1：Connector 基础层

实现：

- ConnectorDefinition
- ConnectorInstance
- ConnectorRegistry
- ConnectorAuthManager
- CapabilityDiscoveryService
- ConnectorToolBridge
- Gmail / Calendar / Contacts read-only connector
- ConnectorResponseNormalizer
- ConnectorRuntimeEvent

---

## Phase 2：Tool Plane 深度集成

实现：

- ConnectorToolDefinition
- Tool Registry 自动注册 connector tools
- connector capability risk metadata
- Tool Permission check
- result size control
- resource refs
- pagination

---

## Phase 3：MCP Layer

实现：

- MCPServerRegistry
- MCPClientManager
- MCPSessionManager
- MCPToolBridge
- MCPResourceBridge
- MCPNotificationBridge
- MCP server trust policy

---

## Phase 4：事件与异步操作

实现：

- ConnectorEventBridge
- ConnectorEventSubscription
- Event Trigger Runtime 集成
- OperationRef
- suggestedWaitConditions
- Local Runtime Worker
- process / service / log watchers

---

## Phase 5：安全、治理和产品化

实现：

- ConnectorPolicy
- CredentialVault
- rate limit / retry / circuit breaker
- connector health dashboard
- audit / replay
- user connector settings UI
- memory extraction policy per connector

---

## 18. 推荐目录结构

```text
src/
  connectors/
    registry/
      ConnectorRegistry.ts
      ConnectorDefinition.ts
      ConnectorInstanceManager.ts

    auth/
      ConnectorAuthManager.ts
      CredentialVault.ts
      OAuthTokenRefresher.ts

    capabilities/
      CapabilityDiscoveryService.ts
      CapabilityRegistry.ts
      CapabilityMapper.ts

    runtime/
      ConnectorRequestRouter.ts
      ConnectorResponseNormalizer.ts
      ConnectorRateLimitManager.ts
      ConnectorRetryManager.ts
      ConnectorHealthMonitor.ts

    tools/
      ConnectorToolBridge.ts
      ConnectorToolDefinition.ts

    resources/
      ConnectorResourceResolver.ts
      ConnectorResourceRef.ts

    events/
      ConnectorEventBridge.ts
      ConnectorEventSubscription.ts

    audit/
      ConnectorAuditEmitter.ts

    builtins/
      gmail/
      calendar/
      contacts/
      drive/
      browser/
      slack/
      local-worker/

  mcp/
    registry/
      MCPServerRegistry.ts
      MCPServerDefinition.ts

    client/
      MCPClientManager.ts
      MCPSessionManager.ts

    bridge/
      MCPToolBridge.ts
      MCPResourceBridge.ts
      MCPPromptBridge.ts
      MCPEventBridge.ts

    security/
      MCPTrustPolicy.ts
      MCPSandboxPolicy.ts
      MCPAuthAdapter.ts
```

---

## 19. 关键原则

1. Connector Runtime / MCP Layer 是外部能力接入层，不是 Agent 大脑。
2. Connector 不直接暴露给模型，必须通过 Tool Plane。
3. MCP Server 是能力提供者，不是 Agent 本身。
4. 能力发现归 Connector Runtime，工具暴露归 Tool Plane / Tool Exposure Policy。
5. Connector 声明风险，Permission Engine 做最终权限决策。
6. Connector 结果必须标准化为 ToolExecutionResult / ConnectorResponse / ResourceRef。
7. 长耗时操作必须返回 OperationRef，并交给 Event Trigger Runtime 等待与唤醒。
8. 外部事件可由 Gateway 或 Connector EventBridge 接入，但进入 Event Trigger Runtime 前必须统一标准化并携带幂等字段。
9. 外部事件由 Connector Event Bridge 接入时，trigger 匹配仍归 Event Trigger Runtime。
9. 本地命令、本地文件和进程控制属于高风险 connector，必须强权限和 sandbox。
10. Connector Runtime 不直接写 Memory，但必须提供 source refs 和 resource refs，便于后续抽取、审计和召回。

---

## 20. 最终结论

Connector Runtime / MCP Layer 的核心价值是：

```text
把外部世界变成平台可治理、可审计、可权限控制、可上下文引用、可事件触发的标准能力。
```

一句话总结：

> **Tool Plane 负责“模型可以调用什么能力”，Connector Runtime / MCP Layer 负责“这些能力如何真实连接到外部系统”，Permission Engine 负责“这些能力是否允许执行”，Event Trigger Runtime 负责“外部状态变化如何唤醒系统”。**
