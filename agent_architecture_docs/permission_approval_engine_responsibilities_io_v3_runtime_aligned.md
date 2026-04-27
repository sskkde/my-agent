# Permission & Approval Engine 功能职责与输入输出文档 v4（Foreground / PlannerRun 对齐版）

## 1. 文档目的

本文档定义个人助理型 Agent 系统中的 **Permission & Approval Engine**，包括权限模式、规则、审批、授权、预审批、授权码、bypass 作用域，以及在临时 Plan、固化 Workflow、后台 Subagent 中的权限边界。

---

## 2. 模块定位

Permission & Approval Engine 是：

> **Agent 行动安全与用户授权护栏。**

它负责判断某个工具调用、Plan step、Workflow step、BackgroundSubagentRun 或自动化动作是否允许执行、是否需要审批、是否必须拒绝，并管理授权结果的作用域与生命周期。

它不执行工具，不驱动 Agent Loop，不渲染 UI。

---

## 3. 新版运行时边界下的权限对象

新版系统存在三类主要执行来源：

```text
临时 Plan
  来源：Gateway → Intent Router / Planner
  执行：Agent Kernel / Subagent Runtime

固化 Workflow
  来源：Visual Workflow UI → Workflow Runtime
  执行：WorkflowRun / WorkflowStepRun

后台 Subagent
  来源：Intent Router / Workflow Runtime / Event Trigger Runtime
  执行：Subagent Runtime BackgroundSubagentRun
```

Permission Engine 必须支持这三类来源的授权作用域。

---

## 4. Permission Mode

```ts
type PermissionMode =
  | "read_only"
  | "plan_only"
  | "ask_on_write"
  | "trusted_auto"
  | "llm_preapprove_guarded"
  | "llm_preapprove_full"
  | "bypass_permissions"
  | "high_risk_blocked"
  | "background_limited"
```

### 4.1 ask_on_write

默认个人助理模式：读操作自动执行，写操作审批。

### 4.2 llm_preapprove_guarded

独立 LLM Judge 可自动放行 low / medium，高风险升级用户审批。

### 4.3 llm_preapprove_full

独立 LLM Judge 可在无 hard deny 的前提下放行全部风险等级。  
仍不能绕过 hard policy、safety guard、connector policy。

### 4.4 bypass_permissions

在明确 scope 内跳过常规用户审批，但仍保留 hard deny、安全策略、连接器策略和审计。

### 4.5 background_limited

适合 WorkflowRun / BackgroundSubagentRun。无交互时仅执行预授权动作，需要用户确认时进入 waiting_for_approval。

---

## 5. 权限上下文

```ts
type PermissionContext = {
  userId: string
  sessionId?: string

  runId?: string
  agentId?: string
  agentType?:
    | "main"
    | "subagent"
    | "background"
    | "workflow_step"
    | "remote"

  mode: PermissionMode

  sourceContext?: {
    sourceType:
      | "temporary_plan"
      | "workflow_run"
      | "workflow_step"
      | "background_subagent"
      | "direct_user_request"
      | "event_trigger"

    planId?: string
    planStepId?: string

    workflowId?: string
    workflowRunId?: string
    workflowStepId?: string
    workflowStepRunId?: string

    backgroundRunId?: string
    subagentRunId?: string

    triggerId?: string
    triggerEventId?: string
  }

  policyRefs?: {
    platformPolicyRef?: string
    userPolicyRef?: string
    connectorPolicyRefs?: string[]
    workflowPolicyRef?: string
    planPolicyRef?: string
  }

  activeRules?: PermissionRule[]
  activeGrants?: PermissionGrant[]
  pendingApprovals?: ApprovalRequestSummary[]

  environment: {
    interactive: boolean
    channelSupportsApprovalUI: boolean
    background: boolean
    workflowDriven?: boolean
  }

  bypassScope?: BypassPermissionScope

  llmPreApproval?: {
    enabled: boolean
    mode?: "guarded" | "full"
    confidenceThreshold?: number
  }
}
```

---

## 6. 授权作用域

```ts
type PermissionGrantScope =
  | "one_shot"
  | "turn"
  | "session"
  | "plan"
  | "workflow_run"
  | "workflow"
  | "background_run"
  | "connector"
  | "user_preference"
  | "policy"
```

### 6.1 推荐使用规则

- 临时 Plan 的授权默认限制在 `plan` 或 `one_shot`。
- 固化 Workflow 的授权可限制在 `workflow_run` 或 `workflow`，但高风险动作仍建议每次审批。
- 后台 Subagent 的授权应限制在 `background_run`。
- Connector 级长期授权必须由用户明确设置。
- `bypass_permissions` 必须有 expiresAt 和 riskLevelMax。

---

## 7. PermissionCheckRequest

```ts
type PermissionCheckRequest = {
  requestId: string

  toolCall?: {
    toolCallId: string
    toolName: string
    toolCategory:
      | "read"
      | "search"
      | "write"
      | "destructive"
      | "automation"
      | "subagent"
      | "planning"
      | "workflow"
      | "memory"
      | "system"
    input: Record<string, unknown>
    originalInput?: Record<string, unknown>
  }

  workflowAction?: {
    workflowId: string
    workflowRunId?: string
    stepId?: string
    stepRunId?: string
    actionType:
      | "create_workflow"
      | "update_workflow"
      | "enable_workflow"
      | "disable_workflow"
      | "run_workflow"
      | "convert_plan_to_workflow"
  }

  subagentAction?: {
    backgroundRunId?: string
    subagentRunId?: string
    agentType: string
    actionType:
      | "launch_subagent"
      | "launch_background_subagent"
      | "resume_subagent"
      | "cancel_subagent"
      | "delegate_child_subagent"
  }

  resource?: {
    connector?: string
    resourceType?: string
    resourceId?: string
    resourceDisplayName?: string
  }

  intentContext?: {
    userGoal?: string
    planId?: string
    planStepId?: string
    workflowId?: string
    workflowRunId?: string
    backgroundRunId?: string
  }

  permissionContext: PermissionContext
}
```

---

## 8. PermissionDecision

```ts
type PermissionDecision = {
  behavior: "allow" | "deny" | "ask" | "passthrough"

  riskLevel?: "low" | "medium" | "high" | "critical"

  reason?: string

  decisionReason?: {
    type:
      | "policy"
      | "rule"
      | "mode"
      | "tool"
      | "hook"
      | "classifier"
      | "approval"
      | "grant"
      | "safety_check"
      | "headless"
      | "workflow_policy"
      | "background_run_policy"
      | "other"
    detail?: string
    matchedRuleId?: string
    policyRef?: string
  }

  updatedInput?: Record<string, unknown>
  userModified?: boolean
  approvalRequest?: ApprovalRequest
  suggestedPermissionUpdates?: PermissionUpdate[]

  audit?: {
    decisionId: string
    decidedAt: string
    decisionSource: string
  }
}
```

---

## 9. ApprovalRequest

```ts
type ApprovalRequest = {
  approvalId: string
  requestId: string

  userId: string
  sessionId?: string

  sourceContext?: PermissionContext["sourceContext"]

  status: "pending" | "approved" | "rejected" | "expired" | "cancelled"

  title: string
  summary: string
  riskLevel: "low" | "medium" | "high" | "critical"

  action: {
    actionKind:
      | "tool_call"
      | "workflow_action"
      | "subagent_action"
      | "connector_action"

    toolName?: string
    connector?: string
    actionType: string

    originalInput: Record<string, unknown>
    proposedInput: Record<string, unknown>
    diff?: Record<string, unknown>
  }

  editableFields?: Array<{
    fieldPath: string
    label: string
    type: "text" | "datetime" | "email" | "select" | "textarea" | "json"
    required?: boolean
  }>

  choices: Array<{
    choiceId:
      | "approve_once"
      | "approve_session"
      | "approve_plan"
      | "approve_workflow_run"
      | "approve_background_run"
      | "approve_connector"
      | "reject"
      | "modify"
    label: string
    createsGrant?: PermissionGrantScope
  }>

  expiresAt?: string
  createdAt: string
}
```

---

## 10. Approval Code

无 UI / 后台 / Workflow 自动触发场景下，可以通过授权码审批。

```ts
type ApprovalCodeGrant = {
  approvalCodeId: string
  approvalId: string
  codeHash: string

  userId: string
  sessionId?: string

  sourceContext?: PermissionContext["sourceContext"]

  proposedInputHash: string
  riskLevel: "low" | "medium" | "high" | "critical"

  scope:
    | "one_shot"
    | "plan"
    | "workflow_run"
    | "background_run"

  status:
    | "pending"
    | "used"
    | "expired"
    | "revoked"

  expiresAt: string
  createdAt: string
}
```

---

## 11. LLMPreApprovalJudge

LLMPreApprovalJudge 不是最终审批者，只是自动放行 / 升级审批判断器。

```ts
type LLMPreApprovalDecision = {
  behavior: "allow" | "ask_user"

  mode:
    | "llm_preapprove_guarded"
    | "llm_preapprove_full"

  riskLevel: "low" | "medium" | "high" | "critical"
  confidence: number
  reason: string

  escalationReason?:
    | "risk_too_high"
    | "low_confidence"
    | "policy_ambiguous"
    | "user_intent_unclear"
    | "sensitive_resource"
    | "irreversible_action"
}
```

真正的 deny 只能来自：

- hard policy
- safety guard
- connector policy
- user deny rule
- 用户明确拒绝

---

## 12. Workflow 权限策略

Workflow Runtime 中需要区分两类权限：

### 12.1 编排权限

控制用户或 Agent 是否可以：

- 创建 workflow
- 修改 workflow
- 启用 workflow
- 删除 workflow
- 从 plan 转 workflow

### 12.2 执行权限

控制某次 WorkflowRun / WorkflowStep 是否可以执行实际动作：

- tool_call
- subagent_run
- agent_run
- approval step
- notification step

固化 Workflow 不能因为已经被创建，就永久绕过所有运行时权限。  
每次高风险 step 仍需执行权限检查或依赖有效 grant。

---

## 13. Background Subagent 权限策略

BackgroundSubagentRun 的权限必须受更严格限制：

- 默认 `background_limited`
- 写操作需要预授权或 approval
- 高风险动作不能在无交互时盲目执行
- 子 Agent 递归创建子 Agent 需要 delegation policy
- 授权 scope 推荐限制为 `background_run`

---

## 14. 与 Gateway / Event Trigger / Workflow 的关系

### Gateway

负责审批 UI、授权码消息、用户回复收发。

### Event Trigger Runtime

负责在 approval resolved 后触发 resume：

```text
ApprovalResponse
  → Gateway
  → Permission Engine
  → approval_resolved event
  → Event Trigger Runtime
  → Runtime Dispatcher
```

### Workflow Runtime

负责在 Workflow step 需要审批时进入 waiting_for_approval，并在 approval resolved 后恢复对应 step。

### Subagent Runtime

负责在 BackgroundSubagentRun 中等待审批，并在 approval resolved 后恢复 subagent loop。

---

## 15. PermissionEvent

```ts
type PermissionEvent = {
  eventId: string

  eventType:
    | "permission_check_started"
    | "policy_rule_matched"
    | "permission_decision_allowed"
    | "permission_decision_denied"
    | "permission_decision_ask"
    | "approval_requested"
    | "approval_received"
    | "approval_expired"
    | "approval_code_created"
    | "approval_code_used"
    | "approval_code_expired"
    | "permission_input_updated"
    | "permission_grant_created"
    | "permission_grant_revoked"
    | "classifier_decision"
    | "llm_preapproval_decision"
    | "bypass_scope_created"
    | "bypass_scope_revoked"
    | "workflow_permission_checked"
    | "background_run_permission_checked"
    | "permission_hook_decision"

  runId?: string
  sessionId?: string

  planId?: string
  workflowId?: string
  workflowRunId?: string
  backgroundRunId?: string
  subagentRunId?: string

  toolCallId?: string
  toolName?: string
  approvalId?: string
  grantId?: string

  timestamp: string
  payload?: Record<string, unknown>
}
```

---

## 16. 关键结论

- Permission Engine 不只保护工具调用，也保护 Plan、Workflow、BackgroundSubagentRun 的执行边界。
- 固化 Workflow 不是免审批通道，高风险 step 仍要权限判断。
- Background Subagent 默认应采用更保守的权限模式。
- Approval resolved 后由 Event Trigger Runtime / Runtime Dispatcher 唤醒对应 WorkflowRun、KernelRun 或 BackgroundSubagentRun。
- `task` 作用域应拆细为 `plan / workflow_run / background_run` 等更明确的授权范围。

---

# 19. Foreground 直接委派与 PlannerRun 权限边界

Foreground Conversation Agent 的直接委派必须遵循权限系统。

## 19.1 新增 sourceContext 建议

```ts
type PermissionSourceContextExtension =
  | "foreground_conversation"
  | "planner_run"
```

## 19.2 需要权限预检查的前台动作

- 直接执行写工具。
- 直接启动前台 / 后台 Subagent。
- 创建 PlannerRun 并进入 auto_execute。
- 创建 WorkflowDraft / WorkflowDefinition。
- 注册触发器。
- 发送外部通知。

## 19.3 Persona 不可覆盖权限

AssistantPersonaProfile 可影响语气、主动性、解释风格和交互习惯，但不能改变：

- hard policy
- connector policy
- permission mode
- approval requirement
- audit requirement
- safety guard

用户自定义助手人格不能让系统绕过审批或隐藏审计。
