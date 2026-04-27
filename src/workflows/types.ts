export type WorkflowStepType = 'tool_call' | 'agent_run' | 'subagent_run' | 'approval' | 'wait' | 'condition';

export type WorkflowDraftStatus = 'draft' | 'validating' | 'invalid';

export type WorkflowDefinitionStatus = 'published' | 'deprecated';

export interface ValidationIssue {
  code: string;
  message: string;
  stepId?: string;
  severity: 'error' | 'warning';
}

export interface WorkflowStepConfig {
  toolName?: string;
  toolParams?: Record<string, unknown>;
  agentId?: string;
  agentParams?: Record<string, unknown>;
  subagentType?: string;
  subagentParams?: Record<string, unknown>;
  approvalScope?: string;
  waitCondition?: Record<string, unknown>;
  retryPolicy?: {
    maxRetries: number;
    retryDelayMs: number;
  };
  onFailure?: 'fail_workflow' | 'continue' | 'retry';
}

export interface WorkflowStep {
  stepId: string;
  stepType: WorkflowStepType;
  name: string;
  description?: string;
  config: WorkflowStepConfig;
  nextStepId?: string;
}

export interface WorkflowDraft {
  draftId: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  ownerUserId: string;
  status: WorkflowDraftStatus;
  validationIssues: ValidationIssue[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDefinition {
  workflowId: string;
  name: string;
  description?: string;
  version: number;
  steps: WorkflowStep[];
  ownerUserId: string;
  status: WorkflowDefinitionStatus;
  publishedFromDraftId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunInput {
  definitionId: string;
  inputData?: Record<string, unknown>;
  userId: string;
  sessionId?: string;
  triggerEventId?: string;
}

export interface WorkflowRunResult {
  workflowRunId: string;
  definitionId: string;
  version: number;
  status: string;
  currentStepIds: string[];
  stepRuns: WorkflowStepRunInfo[];
}

export interface WorkflowStepRunInfo {
  stepRunId: string;
  stepId: string;
  stepType: WorkflowStepType;
  status: string;
  startedAt?: string;
  completedAt?: string;
}

export interface StepExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
}
