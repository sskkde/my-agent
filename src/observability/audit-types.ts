/**
 * Audit types for comprehensive audit logging and policy enforcement.
 * This module provides the foundation for the agent platform's audit infrastructure.
 */

import type { AgentType } from '../context/types.js'

// ============================================================================
// Source Module Type (aligned with observability types)
// ============================================================================

export type AuditSourceModule =
  | 'gateway'
  | 'dispatcher'
  | 'kernel'
  | 'tool'
  | 'workflow'
  | 'subagent'
  | 'trigger'
  | 'connector'
  | 'permission'
  | 'memory'
  | 'system'

// ============================================================================
// Audit Type Values
// ============================================================================

export type AuditType =
  | 'user_input'
  | 'assistant_output'
  | 'tool_call'
  | 'external_write'
  | 'permission_decision'
  | 'approval_request'
  | 'approval_response'
  | 'workflow_change'
  | 'workflow_run'
  | 'subagent_run'
  | 'connector_access'
  | 'connector_resource_access'
  | 'memory_write'
  | 'memory_delete'
  | 'summary_write'
  | 'dispatch'

// ============================================================================
// Audit Status
// ============================================================================

export type AuditStatus = 'pending' | 'completed' | 'failed' | 'blocked'

// ============================================================================
// Risk Level
// ============================================================================

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

// ============================================================================
// Sensitivity Level
// ============================================================================

export type SensitivityLevel = 'low' | 'medium' | 'high' | 'restricted'

// ============================================================================
// Audit Record
// ============================================================================

export interface AuditRecord {
  auditId: string
  auditType: AuditType
  timestamp: string
  userId: string
  sessionId?: string
  sourceModule: AuditSourceModule
  sourceAction: string
  actionSummary: string
  targetType?: string
  targetRef?: string
  status: AuditStatus
  payload: Record<string, unknown>
  inputHash?: string
  correlationId?: string
  causationId?: string
  approvalId?: string
  toolCallId?: string
  permissionDecisionId?: string
  riskLevel: RiskLevel
  sensitivity: SensitivityLevel
}

// ============================================================================
// Audit Query
// ============================================================================

export interface AuditQuery {
  userId?: string
  sessionId?: string
  auditType?: AuditType
  sourceModule?: AuditSourceModule
  status?: AuditStatus
  riskLevel?: RiskLevel
  sensitivity?: SensitivityLevel
  approvalId?: string
  toolCallId?: string
  permissionDecisionId?: string
  correlationId?: string
  startTime?: string
  endTime?: string
  limit?: number
  offset?: number
}

// ============================================================================
// Audit Policy Rule
// ============================================================================

export interface AuditPolicyRule {
  id: string
  name: string
  description?: string
  enabled: boolean
  // Match conditions
  auditTypes?: AuditType[]
  sourceModules?: AuditSourceModule[]
  riskLevels?: RiskLevel[]
  sensitivityLevels?: SensitivityLevel[]
  // Actions
  shouldAudit: boolean
  shouldRedact: boolean
  redactFields?: string[]
  redactPatterns?: RegExp[]
  // Retention
  retentionDays?: number
}

// ============================================================================
// Audit Policy
// ============================================================================

export interface AuditPolicy {
  id: string
  name: string
  description?: string
  version: number
  enabled: boolean
  defaultShouldAudit: boolean
  defaultShouldRedact: boolean
  defaultRetentionDays: number
  rules: AuditPolicyRule[]
  // Global redaction patterns
  sensitivePatterns?: Array<{ pattern: RegExp; replacement: string }>
  createdAt: string
  updatedAt: string
}

// ============================================================================
// Audit Store Interface
// ============================================================================

export interface AuditStore {
  record(record: AuditRecord): void
  recordMany(records: AuditRecord[]): void
  get(auditId: string): AuditRecord | null
  query(query: AuditQuery): AuditRecord[]
  findByUser(userId: string): AuditRecord[]
  findBySession(sessionId: string): AuditRecord[]
  findByCorrelationId(correlationId: string): AuditRecord[]
  findByApprovalId(approvalId: string): AuditRecord[]
  findByToolCallId(toolCallId: string): AuditRecord[]
  findByPermissionDecisionId(permissionDecisionId: string): AuditRecord[]
  count(query: AuditQuery): number
  deleteOlderThan(timestamp: string): number
}

// ============================================================================
// User Input Request
// ============================================================================

export interface UserInputRequest {
  userId: string
  sessionId?: string
  input: string
  inputType?: string
  metadata?: Record<string, unknown>
  correlationId?: string
  causationId?: string
}

// ============================================================================
// Assistant Output Response
// ============================================================================

export interface AssistantOutputResponse {
  userId: string
  sessionId?: string
  output: string
  outputType?: string
  metadata?: Record<string, unknown>
  correlationId?: string
  causationId?: string
}

// ============================================================================
// Tool Call Audit Request
// ============================================================================

export interface ToolCallAuditRequest {
  toolCallId: string
  toolName: string
  userId: string
  sessionId?: string
  params: Record<string, unknown>
  result?: unknown
  status: 'success' | 'failure'
  correlationId?: string
  causationId?: string
  agentType?: string
  agentProfile?: string
  launchSource?: string
  outputContract?: string
  permissionPolicyRef?: string
}

// ============================================================================
// External Write Audit Request
// ============================================================================

export interface ExternalWriteAuditRequest {
  userId: string
  sessionId?: string
  targetType: string
  targetRef: string
  writeData: Record<string, unknown>
  approvalId?: string
  toolCallId?: string
  correlationId?: string
  causationId?: string
}

// ============================================================================
// Permission Decision Audit Request
// ============================================================================

export interface PermissionDecisionAuditRequest {
  decisionId: string
  userId: string
  sessionId?: string
  actionType: string
  resource?: string
  operationType: 'read' | 'write' | 'execute' | 'delete' | 'admin'
  decision: 'allowed' | 'denied' | 'requires_approval' | 'pending_approval'
  reason: string
  approvalId?: string
  correlationId?: string
  causationId?: string
}

// ============================================================================
// Approval Request Audit Request
// ============================================================================

export interface ApprovalRequestAuditRequest {
  requestId: string
  userId: string
  sessionId?: string
  actionType: string
  resource?: string
  riskLevel: RiskLevel
  justification?: string
  correlationId?: string
  causationId?: string
}

// ============================================================================
// Approval Response Audit Request
// ============================================================================

export interface ApprovalResponseAuditRequest {
  requestId: string
  userId: string
  sessionId?: string
  responseType: 'approve_once' | 'approve_always' | 'reject'
  respondedBy: string
  reason?: string
  correlationId?: string
  causationId?: string
}

// ============================================================================
// Workflow Change Audit Request
// ============================================================================

export interface WorkflowChangeAuditRequest {
  userId: string
  sessionId?: string
  workflowId: string
  changeType: 'create' | 'update' | 'delete' | 'publish' | 'deprecate'
  changeSummary: string
  correlationId?: string
  causationId?: string
}

// ============================================================================
// Subagent Run Audit Request
// ============================================================================

export interface SubagentRunAuditRequest {
  subagentRunId: string
  userId: string
  sessionId?: string
  agentType: AgentType
  objective: string
  status: 'started' | 'completed' | 'failed'
  correlationId?: string
  causationId?: string
}

// ============================================================================
// Connector Access Audit Request
// ============================================================================

export interface ConnectorAccessAuditRequest {
  userId: string
  sessionId?: string
  connectorInstanceId: string
  operation: string
  status: 'success' | 'failure'
  resourceRef?: string
  payloadSummary?: Record<string, unknown>
  correlationId?: string
  causationId?: string
}

// ============================================================================
// Memory Write Audit Request
// ============================================================================

export interface MemoryWriteAuditRequest {
  memoryId: string
  userId: string
  sessionId?: string
  operation: 'write' | 'delete'
  contentSummary: string
  correlationId?: string
  causationId?: string
}

export interface SummaryWriteAuditRequest {
  summaryId: string
  summaryType: string
  userId: string
  sessionId?: string
  runId?: string
  correlationId?: string
  causationId?: string
}

// ============================================================================
// Dispatch Audit Request
// ============================================================================

export interface DispatchAuditRequest {
  actionId?: string
  userId: string
  sessionId?: string
  targetRuntime: string
  targetAction: string
  status?: 'pending' | 'completed' | 'failed' | 'blocked'
  payloadSummary: string
  correlationId?: string
  causationId?: string
}

// ============================================================================
// Audit Recorder Interface
// ============================================================================

export interface AuditRecorder {
  recordUserInput(request: UserInputRequest): AuditRecord
  recordAssistantOutput(response: AssistantOutputResponse): AuditRecord
  recordToolCall(toolCall: ToolCallAuditRequest): AuditRecord
  recordExternalWrite(write: ExternalWriteAuditRequest): AuditRecord
  recordPermissionDecision(decision: PermissionDecisionAuditRequest): AuditRecord
  recordApprovalRequest(request: ApprovalRequestAuditRequest): AuditRecord
  recordApprovalResponse(response: ApprovalResponseAuditRequest): AuditRecord
  recordWorkflowChange(change: WorkflowChangeAuditRequest): AuditRecord
  recordSubagentRun(run: SubagentRunAuditRequest): AuditRecord
  recordConnectorAccess(access: ConnectorAccessAuditRequest): AuditRecord
  recordMemoryWrite(write: MemoryWriteAuditRequest): AuditRecord
  recordSummaryWrite(write: SummaryWriteAuditRequest): AuditRecord
  recordDispatch(dispatch: DispatchAuditRequest): AuditRecord
  getStore(): AuditStore
  getPolicy(): AuditPolicy
  setPolicy(policy: AuditPolicy): void
}

// ============================================================================
// Audit Recorder Configuration
// ============================================================================

export interface AuditRecorderConfig {
  auditStore: AuditStore
  policy?: AuditPolicy
  enabled?: boolean
  generateHash?: boolean
}

// ============================================================================
// Redaction Result
// ============================================================================

export interface RedactionResult {
  redacted: Record<string, unknown>
  inputHash: string
  redactedFields: string[]
}
