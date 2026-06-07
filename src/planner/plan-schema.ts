export type PlanStepKind =
  | 'agent_task'
  | 'tool_call'
  | 'subagent_task'
  | 'workflow_step'
  | 'user_approval'
  | 'final_response'

export type PlanExecutor = 'agent_kernel' | 'tool_plane' | 'subagent' | 'workflow_runtime' | 'foreground'

export type PlanDependencyType = 'depends_on' | 'blocks' | 'references'

export type PlanRiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'none'

export interface PlanDependency {
  type: PlanDependencyType
  targetStepId: string
  description?: string
}

export interface RetryPolicy {
  maxAttempts: number
  backoffMs: number
  retryableErrors?: string[]
}

export interface ApprovalRequirement {
  approvalId: string
  reason: string
  riskLevel: PlanRiskLevel
  requiredRoles?: string[]
}

export interface PlanStep {
  id: string
  kind: PlanStepKind
  title: string
  description: string
  executor: PlanExecutor
  toolName?: string
  dependsOn?: PlanDependency[]
  approvalRequirementId?: string
  expectedOutput?: string
  retryPolicy?: RetryPolicy
}

export interface ExecutionPlan {
  id: string
  goal: string
  assumptions?: string[]
  steps: PlanStep[]
  dependencies?: PlanDependency[]
  requiredApprovals?: ApprovalRequirement[]
  successCriteria?: string[]
  riskNotes?: string[]
  createdAt: string
  updatedAt: string
  version: number
}

export type PlanValidationSeverity = 'error' | 'warning'

export interface PlanValidationIssue {
  code: string
  message: string
  severity: PlanValidationSeverity
  path?: string
}

export interface PlanValidationResult {
  valid: boolean
  errors: PlanValidationIssue[]
  warnings: PlanValidationIssue[]
}

export interface PlanGenerationConstraints {
  mockMode?: boolean
  maxSteps?: number
  requireApprovalForWriteTools?: boolean
}

export interface PlanGenerationInput {
  goal: string
  sessionId?: string
  availableTools?: string[]
  constraints?: PlanGenerationConstraints
}

export interface PlanGenerationOutput {
  plan: ExecutionPlan
  warnings?: string[]
}
