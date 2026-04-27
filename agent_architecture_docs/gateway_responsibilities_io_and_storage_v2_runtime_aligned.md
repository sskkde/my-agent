# Gateway 职责清单与输入输出文档 v4（Foreground Conversation Agent 对齐版）

## 1. 文档目的

本文档定义个人助理型 Agent 系统中 **Gateway** 的职责边界、输入输出标准、事件归一化、渠道适配、初始状态装载，以及与 Event Store / Transcript Store / Memory Store 的关系。

本版重点对齐新的运行时边界：

```text
Gateway
  负责自然语言与外部渠道输入

Workflow Runtime
  负责可视化固化 Workflow 的编排入口

Planner / Intent Router
  负责自然语言产生的临时 Plan

Event Trigger Runtime
  负责定时、Webhook、MCP、Connector、Approval 等触发与唤醒

Subagent Runtime
  负责同步 / 后台 Subagent 的执行、监控、恢复、产物

Runtime Dispatcher
  负责统一把结构化请求分发给 Kernel / Subagent / Tool / Workflow / Gateway
```

---

## 2. Gateway 的定位

Gateway 的推荐定位是：

> **外部渠道入口 + 输入归一化 + 初始状态装载 + 输出渠道分发层。**

Gateway 主要处理：

- 用户自然语言输入
- Web / App / Chat / Email 等渠道输入
- 文件、图片、音频、视频等多模态输入
- 用户对审批卡片 / 授权码 / 通知的回复
- 外部渠道 webhook 的原始接入
- 外部系统通知的原始接入
- 系统结果向用户渠道的输出

Gateway 是系统的**外部边界层**，不是运行时大脑，也不是 Workflow 编排器。

---

## 3. 与新版运行时边界的关系

## 3.1 Gateway 与 Workflow Runtime 平行

新版架构中，Workflow Runtime 是与 Gateway 平行的另一套输入入口：

```text
用户自然语言输入
  → Gateway
  → Foreground Conversation Agent
  → 直接委派 RuntimeAction 或 spawn PlannerRun

用户可视化 Workflow 编排
  → Workflow Runtime
  → WorkflowDefinition / WorkflowRun
```

Gateway 不负责可视化 Workflow Builder 的内部编排逻辑。  
Workflow Runtime 不负责自然语言渠道接入。

## 3.2 Gateway 与 Event Trigger Runtime 分工

Event Trigger Runtime 负责触发器注册、事件匹配、定时触发和唤醒目标运行时。

Gateway 负责外部渠道的原始接入和用户侧交互。

```text
外部 webhook / MCP notification / connector event
  → Gateway / Connector Adapter 接收原始事件
  → Event Trigger Runtime 匹配 trigger
  → Runtime Dispatcher 唤醒目标运行时
```

## 3.2.1 外部事件双入口标准化规则

外部事件可以从两个入口进入系统：

```text
入口 A：Gateway Channel Adapter
  适合 webhook、聊天平台回调、邮件回复、通知回执、审批回复等用户渠道事件

入口 B：Connector Runtime / MCP EventBridge
  适合 connector 原生事件、MCP notification、本地 worker 事件、资源变更事件等能力层事件
```

但进入 Event Trigger Runtime 前必须统一转换为标准事件对象，并携带：

- `correlationId`
- `causationId`
- `idempotencyKey`
- `sourceType`
- `eventType`
- `relatedRefs`

推荐链路：

```text
Gateway / Connector EventBridge
  → normalize to InboundEnvelope / ConnectorEvent
  → Event Trigger Runtime
  → RuntimeTriggerEvent
  → Runtime Dispatcher
```

Gateway 不应与 Connector Runtime 抢同一事件的业务所有权；二者只负责各自入口的协议适配和标准化。

## 3.3 Gateway 与 Subagent Runtime 分工

后台 Subagent 的生命周期不归 Gateway 管理。

Gateway 只负责：

- 接收用户“后台执行”的自然语言请求
- 将输入交给 Intent Router / Runtime Dispatcher
- 输出后台任务开始 / 完成 / 失败 / 需要审批等通知
- 接收用户对通知或审批的回复

后台 Subagent 的状态、checkpoint、watchdog、artifact 归 Subagent Runtime。

---

## 4. Gateway 的职责清单

## 4.1 应承担的职责

### 4.1.1 多来源外部输入接入

负责接入不同来源的事件与消息，包括：

- 用户聊天输入
- Web / App 消息
- Email 文本回复
- 文件上传
- 图片 / 音频 / 视频输入
- 审批结果回传
- 授权码回复
- 外部 webhook 原始事件
- MCP notification 原始事件
- Connector event 原始事件
- 远程服务回调

### 4.1.2 输入归一化

将不同渠道、不同协议、不同消息结构统一转换成 `InboundEnvelope`。

### 4.1.3 身份与会话恢复

根据事件恢复：

- 用户身份
- Session
- Thread
- Approval 状态
- Channel 能力
- Tenant / Workspace
- 关联的 Plan / Workflow / BackgroundSubagentRun 引用

### 4.1.4 初始状态装载

从相关 provider 装载当前输入所需的初始状态：

- 用户 profile / preference
- 最近 session 状态
- ConversationStateProjection
- Pending approval
- Active plan / active artifact
- Workflow / BackgroundSubagentRun 引用
- Connector 快照
- Memory 候选
- Attachment manifest

### 4.1.5 路由分发

Gateway 不直接执行任务，而是把归一化输入送往：

- Foreground Conversation Agent：自然语言前台会话输入、意图判断、直接委派、PlannerRun 创建
- Approval Handler：审批回复 / 授权码回复
- Event Trigger Runtime：外部触发事件
- Runtime Dispatcher：结构化系统回调
- Notification Handler：用户通知回执

### 4.1.6 输出分发

将内部产生的 `OutboundEnvelope` 发送到外部渠道：

- 聊天消息
- 通知推送
- 审批卡片
- 授权码消息
- 状态更新
- 文件 / artifact 回传

### 4.1.7 边界事件记录

将 Gateway 可观察的 ingress / egress 事件写入 Event Store，例如：

- inbound_received
- inbound_normalized
- session_hydrated
- outbound_sent
- approval_response_received
- approval_code_received
- external_event_received

### 4.1.8 多模态输入登记与预处理触发

对文件、图片、音频、视频输入做：

- fileRef 生成
- MIME 类型识别
- 附件 manifest 生成
- 文档解析 / OCR / 转写预处理触发
- 预处理结果引用登记

---

## 4.2 不应承担的职责

Gateway 不应承担：

- 可视化 Workflow 编排
- WorkflowDefinition / WorkflowRun 管理
- BackgroundSubagentRun 生命周期
- Agent Loop 驱动
- Tool 执行
- 权限最终判断
- Context 最终裁剪
- 长期 Memory 写入决策
- 主 Agent 与 Subagent 同步协作
- Event Trigger 匹配与调度

---

## 5. Gateway 子模块

```text
Gateway
  ├─ Adapter Layer
  ├─ Normalization Layer
  ├─ Hydration Layer
  ├─ Routing Layer
  ├─ Output Adapter Layer
  └─ Boundary Event Emitter
```

### Adapter Layer

负责各渠道协议适配：

- Chat Adapter
- App Adapter
- Email Adapter
- Webhook Adapter
- MCP Event Adapter
- Connector Event Adapter
- File Upload Adapter
- Notification Adapter

### Normalization Layer

将原始输入转为 `InboundEnvelope`。

### Hydration Layer

恢复 `HydratedSessionState`，但只装载“进入后续运行时所需的初始状态”，不做最终上下文裁剪。

### Routing Layer

将输入路由给 Intent Router、Approval Handler、Event Trigger Runtime 或 Runtime Dispatcher。

---

## 6. Gateway 输入对象

## 6.1 InboundEnvelope

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
    | "calendar"
    | "webhook"
    | "mcp"
    | "connector"
    | "notification"
    | "system"

  sourceId: string

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

  correlationId?: string
  causationId?: string
  idempotencyKey?: string

  contentParts: Array<
    | { type: "text"; text: string }
    | { type: "image"; fileRef: string }
    | { type: "audio"; fileRef: string }
    | { type: "video"; fileRef: string }
    | { type: "file"; fileRef: string; mimeType?: string }
    | { type: "structured_data"; payload: Record<string, unknown> }
  >

  attachments?: Array<{
    fileRef: string
    mimeType: string
    filename?: string
    sizeBytes?: number
    metadata?: Record<string, unknown>
  }>

  channelCapabilities?: {
    supportsText: boolean
    supportsRichCard?: boolean
    supportsAttachment?: boolean
    supportsStreaming?: boolean
    supportsApprovalUI?: boolean
  }

  authContext?: Record<string, unknown>
  metadata?: Record<string, unknown>
  createdAt: string
}
```

---

## 7. Gateway 输出对象

## 7.1 HydratedSessionState

```ts
type HydratedSessionState = {
  inbound: InboundEnvelope

  userContext: {
    userId: string
    profile?: Record<string, unknown>
    preferences?: Record<string, unknown>
    locale?: string
    timezone?: string
  }

  sessionContext?: {
    sessionId: string
    recentHistoryRefs: string[]
    lastActiveAt?: string
  }

  conversationState?: ConversationStateProjection

  approvalContext?: {
    pendingApprovalId?: string
    state?: string
  }

  planContext?: {
    activePlanId?: string
    currentStepId?: string
  }

  workflowContext?: {
    workflowId?: string
    workflowRunId?: string
    currentStepId?: string
  }

  backgroundRunContext?: {
    backgroundRunId?: string
    subagentRunId?: string
    status?: string
  }

  triggerContext?: {
    triggerId?: string
    triggerType?: string
    triggerPayload?: Record<string, unknown>
  }

  connectorSnapshots?: Array<{
    connector: string
    stateRef: string
  }>

  memoryCandidates?: Array<{
    memoryId: string
    memoryType: string
    relevanceScore?: number
    summary?: string
  }>

  attachmentManifest?: Array<{
    fileRef: string
    mimeType: string
    derivedTextRef?: string
    thumbnailRef?: string
    transcriptRef?: string
  }>

  routingHints?: {
    preferredPath?:
      | "intent_router"
      | "approval_handler"
      | "event_trigger_runtime"
      | "runtime_dispatcher"
      | "notification_handler"
    preferredAgentType?: string
  }
}
```

## 7.2 OutboundEnvelope

```ts
type OutboundEnvelope = {
  outboundId: string
  targetSourceType: string
  targetSourceId: string

  userId?: string
  sessionId?: string
  threadId?: string

  relatedRefs?: {
    planId?: string
    workflowRunId?: string
    backgroundRunId?: string
    subagentRunId?: string
    approvalId?: string
    artifactId?: string
  }

  contentParts: Array<
    | { type: "text"; text: string }
    | { type: "rich_card"; payload: Record<string, unknown> }
    | { type: "file"; fileRef: string }
    | { type: "approval_request"; payload: Record<string, unknown> }
    | { type: "approval_code"; payload: Record<string, unknown> }
    | { type: "status_update"; payload: Record<string, unknown> }
    | { type: "notification"; payload: Record<string, unknown> }
  >

  metadata?: Record<string, unknown>
}
```

---

## 8. 与核心模块的关系

## 8.1 与 Planner / Intent Router

Gateway 将自然语言输入交给 Intent Router。  
Intent Router 根据 ConversationStateProjection 判断：

- direct answer
- temporary plan
- foreground subagent
- background subagent
- artifact revision
- approval response
- plan-to-workflow request

## 8.2 与 Workflow Runtime

Workflow Runtime 与 Gateway 平行。  
Workflow Runtime 负责可视化编排、WorkflowDefinition、WorkflowRun 和固化流程执行。  
Workflow Runtime 需要通知用户时，通过 Gateway / Notification Center 输出。

## 8.3 与 Event Trigger Runtime

Event Trigger Runtime 负责 trigger 匹配和唤醒。  
Gateway 可以把外部原始事件转交给 Event Trigger Runtime，但不负责 trigger 规则。

如果外部事件来自 Connector Runtime / MCP EventBridge，则也必须在进入 Event Trigger Runtime 前标准化，并使用 correlationId / causationId / idempotencyKey 保证可追踪与幂等。

## 8.4 与 Subagent Runtime

Subagent Runtime 负责同步 / 后台 Subagent 的运行。  
Gateway 只负责把用户请求或用户回复送到正确入口，以及把状态通知给用户。

## 8.5 与 Permission & Approval Engine

Gateway / Approval Center 负责审批 UI 与渠道交互。  
Permission Engine 负责审批语义、授权作用域和最终权限决策。

---

## 9. 三层存储设计

系统中的历史与记忆应拆为三层：

```text
Event Store       = 运行事实与审计事件
Transcript Store  = 用户可理解的对话与运行摘要
Memory Store      = 抽取后的长期记忆
```

### 9.1 Event Store

Gateway 写入边界事件：

- inbound_received
- inbound_normalized
- outbound_sent
- approval_response_received
- external_event_received

内部运行事件由 Agent Kernel、Tool Plane、Subagent Runtime、Workflow Runtime、Event Trigger Runtime 各自写入。

### 9.2 Transcript Store

Transcript Store 不由 Gateway 直接生成。  
应由 Turn Committer / Transcript Committer 在每轮或每个 Workflow step / BackgroundSubagentRun 完成后写入。

### 9.3 Memory Store

Gateway 不直接写长期 Memory。  
Memory Extractor 从 Transcript Store / Event Store 中抽取稳定事实和偏好。

---

## 10. 推荐数据流

```text
用户自然语言 / 外部渠道
        │
        ▼
      Gateway
        │
        ├─ human_message → Intent Router / Planner
        ├─ approval_response → Approval Handler
        ├─ external_event → Event Trigger Runtime
        └─ notification_response → Runtime Dispatcher


可视化 Workflow UI
        │
        ▼
  Workflow Runtime
        │
        ▼
  Runtime Dispatcher


Scheduler / MCP / Connector / Webhook
        │
        ▼
 Event Trigger Runtime
        │
        ▼
 Runtime Dispatcher
```

---

## 11. 关键结论

- Gateway 是自然语言与外部渠道入口，不是 Workflow 编排器。
- Workflow Runtime 是与 Gateway 平行的可视化固化流程入口。
- Event Trigger Runtime 负责触发与唤醒，不应塞进 Gateway。
- 后台 Subagent 生命周期归 Subagent Runtime，不归 Gateway。
- Gateway 负责输出渠道复用：Workflow / Subagent / Permission 需要通知用户时都通过 Gateway / Notification Center。

---

# 16. 与 Foreground Conversation Agent 的关系

Gateway 仍然是外部渠道入口，不是前台会话大脑。

新的自然语言入口链路为：

```text
User / Channel
  → Gateway
  → HydratedSessionState
  → Foreground Conversation Agent
  → ForegroundDecision
  → Runtime Dispatcher / PlannerRun / Direct Response
```

Gateway 负责：

- 接收用户输入。
- 归一化为 InboundEnvelope。
- 装载 HydratedSessionState。
- 发送 OutboundEnvelope。
- 渲染通知、审批卡片、状态更新。

Foreground Conversation Agent 负责：

- 用户对话。
- 意图判断。
- 助手 persona 应用。
- 简单任务直接委派。
- 复杂任务创建 PlannerRun。
- 查询 ActiveWorkProjection。
- 处理用户打断、取消、修改、审批回复。

Gateway 不应直接调用 PlannerRun，也不应直接决定复杂任务是否需要计划；该判断由 Foreground Conversation Agent 完成。
