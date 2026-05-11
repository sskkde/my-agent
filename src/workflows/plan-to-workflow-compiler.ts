/**
 * Plan-to-Workflow Compiler
 *
 * Compiles a plan-like linear structure into a WorkflowDraft creation payload.
 * This is a deterministic compiler that validates the plan structure before
 * conversion and returns stable machine-readable error codes.
 *
 * Supported step types: tool_call, agent_run, subagent_run, approval, wait, condition, branch, parallel_group
 * Rejected: duplicate IDs, missing required configs
 */

import type { WorkflowStep, WorkflowStepType } from './types.js';

/**
 * Supported step types for the compiler.
 */
export type CompilerStepType = 'tool_call' | 'agent_run' | 'subagent_run' | 'approval' | 'wait' | 'condition' | 'branch' | 'parallel_group';

/**
 * A step in the plan-like input structure.
 */
export interface PlanStep {
  stepId: string;
  title: string;
  description?: string;
  stepType: string;
  config: Record<string, unknown>;
  nextStepId?: string;
  requiresApproval?: boolean;
}

/**
 * Plan-like input structure that mimics what Planner would generate.
 */
export interface PlanToWorkflowInput {
  planId: string;
  name: string;
  description?: string;
  ownerUserId: string;
  steps: PlanStep[];
  metadata?: Record<string, unknown>;
}

/**
 * Stable error codes for compiler validation failures.
 * These are deterministic and machine-readable for programmatic handling.
 */
export const CompilerErrorCode = {
  MISSING_WORKFLOW_NAME: 'MISSING_WORKFLOW_NAME',
  EMPTY_STEPS: 'EMPTY_STEPS',
  DUPLICATE_STEP_ID: 'DUPLICATE_STEP_ID',
  UNSUPPORTED_STEP_TYPE: 'UNSUPPORTED_STEP_TYPE',
  INVALID_NEXT_STEP_ID: 'INVALID_NEXT_STEP_ID',
  MISSING_TOOL_NAME: 'MISSING_TOOL_NAME',
  MISSING_AGENT_ID: 'MISSING_AGENT_ID',
  MISSING_SUBAGENT_TYPE: 'MISSING_SUBAGENT_TYPE',
  MISSING_APPROVAL_SCOPE: 'MISSING_APPROVAL_SCOPE',
  MISSING_WAIT_CONDITION: 'MISSING_WAIT_CONDITION',
  MISSING_CONDITION_EXPRESSION: 'MISSING_CONDITION_EXPRESSION',
  MISSING_BRANCH_TARGETS: 'MISSING_BRANCH_TARGETS',
  MISSING_BRANCHES: 'MISSING_BRANCHES',
  MISSING_PARALLEL_STEPS: 'MISSING_PARALLEL_STEPS',
} as const;

export type CompilerErrorCodeType = typeof CompilerErrorCode[keyof typeof CompilerErrorCode];

/**
 * A compiler error with stable code and optional step context.
 */
export interface CompilerError {
  code: CompilerErrorCodeType;
  message: string;
  stepId?: string;
}

/**
 * Result type for the compiler - either success with payload or failure with errors.
 */
export interface CompiledWorkflowDraftPayload {
  name: string;
  description?: string;
  steps: WorkflowStep[];
  ownerUserId: string;
}

export type CompilerResult =
  | { success: true; payload: CompiledWorkflowDraftPayload; errors: [] }
  | { success: false; errors: CompilerError[]; payload?: undefined };

/**
 * Compiles a plan-like input into a WorkflowDraft creation payload.
 *
 * This function:
 * 1. Validates the plan structure (name, steps, step types, configs)
 * 2. Detects and rejects branching, loops, and unsupported features
 * 3. Inserts approval steps when requiresApproval=true on non-approval steps
 * 4. Returns a payload compatible with workflowRuntime.createDraft()
 *
 * @param plan - The plan-like input to compile
 * @returns CompilerResult with either success payload or validation errors
 */
export function compilePlanToWorkflowDraft(plan: PlanToWorkflowInput): CompilerResult {
  const errors: CompilerError[] = [];

  if (!plan.name || plan.name.trim() === '') {
    errors.push({
      code: CompilerErrorCode.MISSING_WORKFLOW_NAME,
      message: 'Workflow name is required',
    });
  }

  if (!plan.steps || plan.steps.length === 0) {
    errors.push({
      code: CompilerErrorCode.EMPTY_STEPS,
      message: 'Workflow must have at least one step',
    });
    return { success: false, errors };
  }

  const validStepTypes = ['tool_call', 'agent_run', 'subagent_run', 'approval', 'wait', 'condition', 'branch', 'parallel_group'];
  for (const step of plan.steps) {
    if (!isCompilerStepType(step.stepType)) {
      errors.push({
        code: CompilerErrorCode.UNSUPPORTED_STEP_TYPE,
        message: `Step ${step.stepId} has invalid step type '${step.stepType}'. Must be one of: ${validStepTypes.join(', ')}`,
        stepId: step.stepId,
      });
    }
  }

  const stepIdCounts = new Map<string, number>();
  for (const step of plan.steps) {
    const count = stepIdCounts.get(step.stepId) ?? 0;
    stepIdCounts.set(step.stepId, count + 1);
  }
  for (const [stepId, count] of stepIdCounts) {
    if (count > 1) {
      errors.push({
        code: CompilerErrorCode.DUPLICATE_STEP_ID,
        message: `Duplicate stepId found: ${stepId} (appears ${count} times)`,
        stepId,
      });
    }
  }

  const stepIds = new Set(plan.steps.map(s => s.stepId));
  for (const step of plan.steps) {
    if (step.requiresApproval === true && step.stepType !== 'approval') {
      const generatedApprovalStepId = `approval-before-${step.stepId}`;
      if (stepIds.has(generatedApprovalStepId)) {
        errors.push({
          code: CompilerErrorCode.DUPLICATE_STEP_ID,
          message: `Generated approval stepId would collide with existing stepId: ${generatedApprovalStepId}`,
          stepId: generatedApprovalStepId,
        });
      }
    }
  }

  for (const step of plan.steps) {
    if (step.nextStepId !== undefined && !stepIds.has(step.nextStepId)) {
      errors.push({
        code: CompilerErrorCode.INVALID_NEXT_STEP_ID,
        message: `Step ${step.stepId} references non-existent nextStepId: ${step.nextStepId}`,
        stepId: step.stepId,
      });
    }
  }

  for (const step of plan.steps) {
    const config = step.config;

    switch (step.stepType) {
      case 'tool_call':
        if (!config.toolName) {
          errors.push({
            code: CompilerErrorCode.MISSING_TOOL_NAME,
            message: `Step ${step.stepId} is missing required config field 'toolName'`,
            stepId: step.stepId,
          });
        }
        break;
      case 'agent_run':
        if (!config.agentId) {
          errors.push({
            code: CompilerErrorCode.MISSING_AGENT_ID,
            message: `Step ${step.stepId} is missing required config field 'agentId'`,
            stepId: step.stepId,
          });
        }
        break;
      case 'subagent_run':
        if (!config.subagentType) {
          errors.push({
            code: CompilerErrorCode.MISSING_SUBAGENT_TYPE,
            message: `Step ${step.stepId} is missing required config field 'subagentType'`,
            stepId: step.stepId,
          });
        }
        break;
      case 'approval':
        if (!config.approvalScope) {
          errors.push({
            code: CompilerErrorCode.MISSING_APPROVAL_SCOPE,
            message: `Step ${step.stepId} is missing required config field 'approvalScope'`,
            stepId: step.stepId,
          });
        }
        break;
      case 'wait':
        if (!config.waitCondition) {
          errors.push({
            code: CompilerErrorCode.MISSING_WAIT_CONDITION,
            message: `Step ${step.stepId} is missing required config field 'waitCondition'`,
            stepId: step.stepId,
          });
        }
        break;
      case 'condition':
        if (!config.conditionExpression) {
          errors.push({
            code: CompilerErrorCode.MISSING_CONDITION_EXPRESSION,
            message: `Step ${step.stepId} is missing required config field 'conditionExpression'`,
            stepId: step.stepId,
          });
        }
        if (!config.trueNextStepId && !config.falseNextStepId) {
          errors.push({
            code: CompilerErrorCode.MISSING_BRANCH_TARGETS,
            message: `Step ${step.stepId} must have at least one branch target`,
            stepId: step.stepId,
          });
        }
        break;
      case 'branch':
        if (!config.branches || !Array.isArray(config.branches) || config.branches.length === 0) {
          errors.push({
            code: CompilerErrorCode.MISSING_BRANCHES,
            message: `Step ${step.stepId} is missing required config field 'branches'`,
            stepId: step.stepId,
          });
        }
        break;
      case 'parallel_group':
        if (!config.parallelSteps || !Array.isArray(config.parallelSteps) || config.parallelSteps.length === 0) {
          errors.push({
            code: CompilerErrorCode.MISSING_PARALLEL_STEPS,
            message: `Step ${step.stepId} is missing required config field 'parallelSteps'`,
            stepId: step.stepId,
          });
        }
        break;
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const workflowSteps = transformStepsWithApprovals(plan.steps);

  return {
    success: true,
    payload: {
      name: plan.name,
      description: plan.description,
      steps: workflowSteps,
      ownerUserId: plan.ownerUserId,
    },
    errors: [],
  };
}

function toWorkflowStepType(step: PlanStep): WorkflowStepType {
  if (isCompilerStepType(step.stepType)) {
    return step.stepType;
  }

  throw new Error(`Unsupported step type after validation: ${step.stepType}`);
}

function isCompilerStepType(stepType: string): stepType is CompilerStepType {
  return stepType === 'tool_call'
    || stepType === 'agent_run'
    || stepType === 'subagent_run'
    || stepType === 'approval'
    || stepType === 'wait'
    || stepType === 'condition'
    || stepType === 'branch'
    || stepType === 'parallel_group';
}

/**
 * Transforms plan steps into workflow steps, inserting explicit approval steps
 * where requiresApproval=true on non-approval steps.
 *
 * When requiresApproval=true on a non-approval step:
 * - Insert an approval step immediately before the protected step
 * - Approval step has stepId: approval-before-{protectedStepId}
 * - Approval step has config.approvalScope: workflow_step:{protectedStepId}
 * - Preserve linear chain by adjusting nextStepId values
 */
function transformStepsWithApprovals(planSteps: PlanStep[]): WorkflowStep[] {
  const result: WorkflowStep[] = [];

  for (let i = 0; i < planSteps.length; i++) {
    const planStep = planSteps[i];
    if (!planStep) continue;

    const needsApproval = planStep.requiresApproval === true && planStep.stepType !== 'approval';

    if (needsApproval) {
      const approvalStepId = `approval-before-${planStep.stepId}`;
      const approvalStep: WorkflowStep = {
        stepId: approvalStepId,
        stepType: 'approval',
        name: `Approval for: ${planStep.title}`,
        description: `Approval required before executing step: ${planStep.title}`,
        config: {
          approvalScope: `workflow_step:${planStep.stepId}`,
        },
        nextStepId: planStep.stepId,
      };
      result.push(approvalStep);

      if (result.length > 1) {
        const prevStep = result[result.length - 2];
        if (prevStep) {
          prevStep.nextStepId = approvalStepId;
        }
      }
    }

    const workflowStep: WorkflowStep = {
      stepId: planStep.stepId,
      stepType: toWorkflowStepType(planStep),
      name: planStep.title,
      description: planStep.description,
      config: planStep.config,
      nextStepId: planStep.nextStepId,
    };

    result.push(workflowStep);
  }

  for (let i = 0; i < result.length; i++) {
    const step = result[i];
    if (!step) continue;

    if (step.nextStepId) {
      const targetExists = result.some(s => s.stepId === step.nextStepId);
      if (!targetExists) {
        step.nextStepId = undefined;
      }
    }
  }

  for (let i = 0; i < result.length - 1; i++) {
    const currentStep = result[i];
    if (!currentStep) continue;

    if (currentStep.stepType === 'approval' && currentStep.stepId.startsWith('approval-before-')) {
      continue;
    }

    const nextStep = result[i + 1];
    if (nextStep && !currentStep.nextStepId) {
      currentStep.nextStepId = nextStep.stepId;
    }
  }

  const lastStep = result[result.length - 1];
  if (lastStep) {
    lastStep.nextStepId = undefined;
  }

  return result;
}
