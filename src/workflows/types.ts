export type WorkflowStepType = 'tool_call' | 'agent_run' | 'subagent_run' | 'approval' | 'wait' | 'condition' | 'branch' | 'parallel_group';

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
  // Condition step config
  conditionExpression?: string;
  trueNextStepId?: string;
  falseNextStepId?: string;
  // Branch step config
  branches?: WorkflowBranch[];
  // Parallel group config
  parallelSteps?: WorkflowStep[];
  maxParallel?: number;
}

export interface WorkflowBranch {
  branchId: string;
  name: string;
  condition?: string;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  stepId: string;
  stepType: WorkflowStepType;
  name: string;
  description?: string;
  config: WorkflowStepConfig;
  nextStepId?: string;
  selectedBranch?: string;
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
  errorCategory?: 'undefined_variable' | 'expression_error' | 'execution_error';
}

export interface ConditionEvalResult {
  conditionMet: boolean;
  selectedBranch?: string;
  error?: {
    code: 'UNDEFINED_VARIABLE' | 'EXPRESSION_ERROR';
    message: string;
    variableName?: string;
  };
}
