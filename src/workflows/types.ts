import type { RuntimeErrorCategory } from '../shared/errors.js'
import type { BackoffStrategy } from '../shared/retry.js'

export type WorkflowStepType =
  | 'tool_call'
  | 'agent_run'
  | 'subagent_run'
  | 'approval'
  | 'wait'
  | 'condition'
  | 'branch'
  | 'parallel_group'
  | 'polling_wait'

export type WorkflowDraftStatus = 'draft' | 'validating' | 'invalid'

export type WorkflowDefinitionStatus = 'published' | 'deprecated'

export interface ValidationIssue {
  code: string
  message: string
  stepId?: string
  severity: 'error' | 'warning'
}

export interface WorkflowStepRetryPolicy {
  maxAttempts: number
  backoff: BackoffStrategy
  initialDelayMs?: number
  maxDelayMs?: number
  retryableErrorCategories?: RuntimeErrorCategory[]
}

export type OnFailurePolicy = 'fail' | 'continue' | 'skip' | 'compensate'

export interface SubagentModelOverride {
  providerId?: string
  model?: string
  temperature?: number
  maxTokens?: number
  providerFallbackMode?: 'none' | 'same_provider' | 'any_compatible'
}

export interface WorkflowStepConfig {
  toolName?: string
  toolParams?: Record<string, unknown>
  agentId?: string
  agentParams?: Record<string, unknown>
  /** @deprecated Use agentProfile instead. Kept for backward compatibility. */
  subagentType?: string
  /** Capability profile identifier for subagent_run steps. Falls back to subagentType when not provided. */
  agentProfile?: string
  subagentParams?: Record<string, unknown>
  // Subagent execution mode (for subagent_run steps)
  subagentExecutionMode?: 'sync' | 'background'
  // Model override for subagent
  subagentModelOverride?: SubagentModelOverride
  // Allowed tools for subagent (overrides definition defaults)
  subagentAllowedTools?: string[]
  // Output mode for subagent results
  subagentOutputMode?: 'summary' | 'artifact' | 'json'
  approvalScope?: string
  waitCondition?: Record<string, unknown>
  // Legacy retry policy (deprecated, use retryPolicy)
  retryPolicy?: {
    maxRetries: number
    retryDelayMs: number
  }
  // New retry policy with full support
  retryPolicyV2?: WorkflowStepRetryPolicy
  onFailure?: OnFailurePolicy
  compensateHook?: string
  // Condition step config
  conditionExpression?: string
  trueNextStepId?: string
  falseNextStepId?: string
  // Branch step config
  branches?: WorkflowBranch[]
  // Parallel group config
  parallelSteps?: WorkflowStep[]
  maxParallel?: number
  // Polling wait config
  pollingCondition?: string
  pollingIntervalMs?: number
  timeoutMs?: number
}

export interface WorkflowBranch {
  branchId: string
  name: string
  condition?: string
  steps: WorkflowStep[]
}

export interface WorkflowStep {
  stepId: string
  stepType: WorkflowStepType
  name: string
  description?: string
  config: WorkflowStepConfig
  nextStepId?: string
  selectedBranch?: string
}

export interface WorkflowDraft {
  draftId: string
  name: string
  description?: string
  steps: WorkflowStep[]
  ownerUserId: string
  status: WorkflowDraftStatus
  validationIssues: ValidationIssue[]
  createdAt: string
  updatedAt: string
}

export interface WorkflowDefinition {
  workflowId: string
  name: string
  description?: string
  version: number
  steps: WorkflowStep[]
  ownerUserId: string
  status: WorkflowDefinitionStatus
  publishedFromDraftId?: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowRunInput {
  definitionId: string
  inputData?: Record<string, unknown>
  userId: string
  sessionId?: string
  triggerEventId?: string
}

export interface WorkflowRunResult {
  workflowRunId: string
  definitionId: string
  version: number
  status: string
  currentStepIds: string[]
  stepRuns: WorkflowStepRunInfo[]
}

export interface WorkflowStepRunInfo {
  stepRunId: string
  stepId: string
  stepType: WorkflowStepType
  status: string
  startedAt?: string
  completedAt?: string
}

export interface StepExecutionResult {
  success: boolean
  output?: unknown
  error?: string
  errorCategory?: RuntimeErrorCategory | 'undefined_variable' | 'expression_error' | 'execution_error'
  recoverability?: 'retryable_later' | 'recoverable_auto' | 'non_recoverable'
  attemptNumber?: number
  auditTrail?: RetryAttemptAuditEntry[]
}

export interface RetryAttemptAuditEntry {
  attempt: number
  status: 'started' | 'succeeded' | 'failed' | 'retry_scheduled'
  errorCategory?: string
  errorCode?: string
  delayMs?: number
  timestamp: string
}

export interface ConditionEvalResult {
  conditionMet: boolean
  selectedBranch?: string
  error?: {
    code: 'UNDEFINED_VARIABLE' | 'EXPRESSION_ERROR'
    message: string
    variableName?: string
  }
}
