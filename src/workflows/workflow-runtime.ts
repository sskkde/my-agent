import type { WorkflowDraftStore } from '../storage/workflow-draft-store.js';
import type { WorkflowDefinitionStore } from '../storage/workflow-definition-store.js';
import type { WorkflowRunStore } from '../storage/workflow-run-store.js';
import type { RuntimeActionStore, RuntimeAction } from '../storage/runtime-action-store.js';
import type { EventStore, EventRecord, SourceModule } from '../storage/event-store.js';
import { WORKFLOW_RUN_STATES, RUNTIME_ACTION_STATES } from '../shared/states.js';
import type { WorkflowRunState } from '../shared/states.js';
import type { RuntimeActionType } from '../dispatcher/types.js';
import { generateId, ACTION_ID_PREFIX } from '../shared/ids.js';
import type {
  WorkflowDraft,
  WorkflowDefinition,
  WorkflowStep,
  ValidationIssue,
  WorkflowRunInput,
  WorkflowRunResult,
  WorkflowStepRunInfo,
  StepExecutionResult,
} from './types.js';

export interface WorkflowRuntime {
  createDraft(draft: Omit<WorkflowDraft, 'draftId' | 'status' | 'validationIssues' | 'createdAt' | 'updatedAt'>): WorkflowDraft;
  validateDraft(draftId: string): ValidationIssue[];
  publishDraft(draftId: string): WorkflowDefinition;
  startWorkflowRun(input: WorkflowRunInput): WorkflowRunResult;
  executeStep(stepRunId: string): void;
  handleStepCompletion(stepRunId: string, result: StepExecutionResult): void;
  getWorkflowRun(workflowRunId: string): WorkflowRunResult | null;
  cancelWorkflowRun(workflowRunId: string): void;
}

interface WorkflowRuntimeConfig {
  draftStore: WorkflowDraftStore;
  definitionStore: WorkflowDefinitionStore;
  workflowRunStore: WorkflowRunStore;
  runtimeActionStore: RuntimeActionStore;
  eventStore: EventStore;
  dispatcher?: RuntimeDispatcher;
}

interface RuntimeDispatcher {
  dispatch(request: {
    actionType: RuntimeActionType;
    targetRuntime: string;
    targetAction: string;
    payload: Record<string, unknown>;
    userId?: string;
    sessionId?: string;
    correlationId?: string;
  }): Promise<{ success: boolean; result?: unknown; error?: string }>;
}

interface WorkflowValidationContext {
  draft: WorkflowDraft;
  issues: ValidationIssue[];
}

class WorkflowRuntimeImpl implements WorkflowRuntime {
  private draftStore: WorkflowDraftStore;
  private definitionStore: WorkflowDefinitionStore;
  private workflowRunStore: WorkflowRunStore;
  private runtimeActionStore: RuntimeActionStore;
  private eventStore: EventStore;
  private dispatcher?: RuntimeDispatcher;

  constructor(config: WorkflowRuntimeConfig) {
    this.draftStore = config.draftStore;
    this.definitionStore = config.definitionStore;
    this.workflowRunStore = config.workflowRunStore;
    this.runtimeActionStore = config.runtimeActionStore;
    this.eventStore = config.eventStore;
    this.dispatcher = config.dispatcher;
  }

  createDraft(
    draft: Omit<WorkflowDraft, 'draftId' | 'status' | 'validationIssues' | 'createdAt' | 'updatedAt'>
  ): WorkflowDraft {
    const draftId = generateId('wf_draft_');
    const now = new Date().toISOString();

    const draftRecord: WorkflowDraft = {
      draftId,
      name: draft.name,
      description: draft.description,
      steps: draft.steps,
      ownerUserId: draft.ownerUserId,
      status: 'draft',
      validationIssues: [],
      createdAt: now,
      updatedAt: now,
    };

    this.draftStore.createDraft(draftRecord);

    this.emitEvent({
      eventType: 'workflow_draft_created',
      sourceModule: 'workflow',
      userId: draft.ownerUserId,
      relatedRefs: { draftId },
      payload: { draftId, name: draft.name, stepCount: draft.steps.length },
    });

    return draftRecord;
  }

  validateDraft(draftId: string): ValidationIssue[] {
    const draft = this.draftStore.getDraftById(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    const context: WorkflowValidationContext = { draft, issues: [] };

    this.draftStore.updateDraft(draftId, { status: 'validating' });

    this.validateSteps(context);
    this.validateLinearFlow(context);
    this.validateStepReferences(context);

    if (context.issues.length > 0) {
      this.draftStore.addValidationIssues(draftId, context.issues);
    } else {
      this.draftStore.clearValidationIssues(draftId);
    }

    this.emitEvent({
      eventType: 'workflow_draft_validated',
      sourceModule: 'workflow',
      userId: draft.ownerUserId,
      relatedRefs: { draftId },
      payload: {
        draftId,
        issueCount: context.issues.length,
        issues: context.issues,
      },
    });

    return context.issues;
  }

  publishDraft(draftId: string): WorkflowDefinition {
    const draft = this.draftStore.getDraftById(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    const issues = this.validateDraft(draftId);
    if (issues.length > 0) {
      throw new Error(`Cannot publish draft with validation issues: ${issues.length} issues found`);
    }

    const nextVersion = this.definitionStore.getNextVersionNumber(draft.name);
    const workflowId = generateId('wf_def_');
    const now = new Date().toISOString();

    const definition: WorkflowDefinition = {
      workflowId,
      name: draft.name,
      description: draft.description,
      version: nextVersion,
      steps: draft.steps,
      ownerUserId: draft.ownerUserId,
      status: 'published',
      publishedFromDraftId: draftId,
      createdAt: now,
      updatedAt: now,
    };

    this.definitionStore.createDefinition(definition);

    this.emitEvent({
      eventType: 'workflow_definition_published',
      sourceModule: 'workflow',
      userId: draft.ownerUserId,
      relatedRefs: { workflowId, draftId },
      payload: {
        workflowId,
        draftId,
        name: draft.name,
        version: nextVersion,
      },
    });

    return definition;
  }

  startWorkflowRun(input: WorkflowRunInput): WorkflowRunResult {
    const definition = this.definitionStore.getDefinitionById(input.definitionId);
    if (!definition) {
      throw new Error(`Workflow definition not found: ${input.definitionId}`);
    }

    if (definition.status !== 'published') {
      throw new Error(`Workflow definition is not published: ${input.definitionId}`);
    }

    const workflowRunId = generateId('wf_run_');

    this.workflowRunStore.createWorkflowRun({
      workflowRunId,
      workflowId: definition.workflowId,
      workflowVersion: String(definition.version),
      ownerUserId: input.userId,
      triggerEventId: input.triggerEventId,
      status: WORKFLOW_RUN_STATES.QUEUED,
      inputData: input.inputData,
      currentStepIds: [],
    });

    const stepRuns: WorkflowStepRunInfo[] = [];
    for (const step of definition.steps) {
      const stepRunId = generateId('wf_step_run_');

      this.workflowRunStore.createStepRun({
        stepRunId,
        workflowRunId,
        stepId: step.stepId,
        stepType: step.stepType,
        status: WORKFLOW_RUN_STATES.QUEUED,
        inputData: this.buildStepInput(step, input.inputData),
      });

      stepRuns.push({
        stepRunId,
        stepId: step.stepId,
        stepType: step.stepType,
        status: WORKFLOW_RUN_STATES.QUEUED,
      });
    }

    this.workflowRunStore.updateWorkflowStatus(workflowRunId, WORKFLOW_RUN_STATES.RUNNING);

    const firstStep = definition.steps[0];
    if (firstStep) {
      const firstStepRun = stepRuns.find(sr => sr.stepId === firstStep.stepId);
      if (firstStepRun) {
        this.workflowRunStore.updateCurrentSteps(workflowRunId, [firstStep.stepId]);
        this.executeStep(firstStepRun.stepRunId);
      }
    }

    this.emitEvent({
      eventType: 'workflow_run_started',
      sourceModule: 'workflow',
      userId: input.userId,
      sessionId: input.sessionId,
      relatedRefs: { workflowRunId, workflowId: definition.workflowId },
      payload: {
        workflowRunId,
        workflowId: definition.workflowId,
        version: definition.version,
        stepCount: definition.steps.length,
      },
    });

    return {
      workflowRunId,
      definitionId: definition.workflowId,
      version: definition.version,
      status: WORKFLOW_RUN_STATES.RUNNING,
      currentStepIds: firstStep ? [firstStep.stepId] : [],
      stepRuns,
    };
  }

  executeStep(stepRunId: string): void {
    const stepRun = this.workflowRunStore.getStepRunById(stepRunId);
    if (!stepRun) {
      throw new Error(`Step run not found: ${stepRunId}`);
    }

    const workflowRun = this.workflowRunStore.getWorkflowRunById(stepRun.workflowRunId);
    if (!workflowRun) {
      throw new Error(`Workflow run not found: ${stepRun.workflowRunId}`);
    }

    this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.RUNNING);

    const definition = this.definitionStore.getDefinitionById(workflowRun.workflowId);
    if (!definition) {
      throw new Error(`Definition not found: ${workflowRun.workflowId}`);
    }

    const step = definition.steps.find(s => s.stepId === stepRun.stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepRun.stepId}`);
    }

    const action = this.createRuntimeAction({
      workflowRunId: stepRun.workflowRunId,
      stepRunId,
      userId: workflowRun.ownerUserId,
      targetRuntime: this.getTargetRuntimeForStepType(step.stepType),
      targetAction: this.getTargetActionForStepType(step.stepType),
      payload: {
        stepRunId,
        stepType: step.stepType,
        stepConfig: step.config,
        inputData: stepRun.inputData,
      },
    });

    if (this.dispatcher) {
      this.dispatcher
        .dispatch({
          actionType: action.actionType as RuntimeActionType,
          targetRuntime: action.targetRuntime,
          targetAction: action.targetAction,
          payload: action.payload as Record<string, unknown>,
          userId: workflowRun.ownerUserId,
          correlationId: stepRun.workflowRunId,
        })
        .then(result => {
          this.handleStepCompletion(stepRunId, {
            success: result.success,
            output: result.result,
            error: result.error,
          });
        })
        .catch(error => {
          this.handleStepCompletion(stepRunId, {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }

    this.emitEvent({
      eventType: 'workflow_step_executing',
      sourceModule: 'workflow',
      userId: workflowRun.ownerUserId,
      relatedRefs: { workflowRunId: stepRun.workflowRunId, stepRunId },
      payload: {
        stepRunId,
        stepId: step.stepId,
        stepType: step.stepType,
        actionId: action.actionId,
      },
    });
  }

  handleStepCompletion(stepRunId: string, result: StepExecutionResult): void {
    const stepRun = this.workflowRunStore.getStepRunById(stepRunId);
    if (!stepRun) {
      throw new Error(`Step run not found: ${stepRunId}`);
    }

    const workflowRun = this.workflowRunStore.getWorkflowRunById(stepRun.workflowRunId);
    if (!workflowRun) {
      throw new Error(`Workflow run not found: ${stepRun.workflowRunId}`);
    }

    const definition = this.definitionStore.getDefinitionById(workflowRun.workflowId);
    if (!definition) {
      throw new Error(`Definition not found: ${workflowRun.workflowId}`);
    }

    const step = definition.steps.find(s => s.stepId === stepRun.stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepRun.stepId}`);
    }

    const now = new Date().toISOString();

    if (result.success) {
      this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.COMPLETED);

      this.emitEvent({
        eventType: 'workflow_step_completed',
        sourceModule: 'workflow',
        userId: workflowRun.ownerUserId,
        relatedRefs: { workflowRunId: stepRun.workflowRunId, stepRunId },
        payload: {
          stepRunId,
          stepId: step.stepId,
          output: result.output,
          completedAt: now,
        },
      });

      this.advanceToNextStep(stepRun.workflowRunId, step, result.output);
    } else {
      const shouldRetry = this.shouldRetryStep(step);

      if (shouldRetry) {
        this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.QUEUED);
        this.executeStep(stepRunId);
      } else if (step.config.onFailure === 'continue') {
        this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.COMPLETED);
        this.advanceToNextStep(stepRun.workflowRunId, step, null);
      } else {
        this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.FAILED);
        this.workflowRunStore.updateWorkflowStatus(stepRun.workflowRunId, WORKFLOW_RUN_STATES.FAILED);

        this.emitEvent({
          eventType: 'workflow_step_failed',
          sourceModule: 'workflow',
          userId: workflowRun.ownerUserId,
          relatedRefs: { workflowRunId: stepRun.workflowRunId, stepRunId },
          payload: {
            stepRunId,
            stepId: step.stepId,
            error: result.error,
            failedAt: now,
          },
        });

        this.emitEvent({
          eventType: 'workflow_run_failed',
          sourceModule: 'workflow',
          userId: workflowRun.ownerUserId,
          relatedRefs: { workflowRunId: stepRun.workflowRunId },
          payload: {
            workflowRunId: stepRun.workflowRunId,
            failedStepId: step.stepId,
            error: result.error,
            failedAt: now,
          },
        });
      }
    }
  }

  getWorkflowRun(workflowRunId: string): WorkflowRunResult | null {
    const workflowRun = this.workflowRunStore.getWorkflowRunById(workflowRunId);
    if (!workflowRun) {
      return null;
    }

    const stepRuns = this.workflowRunStore.getStepsByWorkflowRunId(workflowRunId);

    return {
      workflowRunId: workflowRun.workflowRunId,
      definitionId: workflowRun.workflowId,
      version: parseInt(workflowRun.workflowVersion, 10),
      status: workflowRun.status,
      currentStepIds: workflowRun.currentStepIds ?? [],
      stepRuns: stepRuns.map(sr => ({
        stepRunId: sr.stepRunId,
        stepId: sr.stepId,
        stepType: sr.stepType,
        status: sr.status,
        startedAt: sr.startedAt,
        completedAt: sr.completedAt,
      })),
    };
  }

  cancelWorkflowRun(workflowRunId: string): void {
    const workflowRun = this.workflowRunStore.getWorkflowRunById(workflowRunId);
    if (!workflowRun) {
      throw new Error(`Workflow run not found: ${workflowRunId}`);
    }

    const terminalStates: WorkflowRunState[] = ['completed', 'failed', 'cancelled', 'timeout'];
    if (terminalStates.includes(workflowRun.status)) {
      return;
    }

    this.workflowRunStore.updateWorkflowStatus(workflowRunId, WORKFLOW_RUN_STATES.CANCELLED);

    const stepRuns = this.workflowRunStore.getStepsByWorkflowRunId(workflowRunId);
    for (const stepRun of stepRuns) {
      if (!terminalStates.includes(stepRun.status)) {
        this.workflowRunStore.updateStepStatus(stepRun.stepRunId, WORKFLOW_RUN_STATES.CANCELLED);
      }
    }

    this.emitEvent({
      eventType: 'workflow_run_cancelled',
      sourceModule: 'workflow',
      userId: workflowRun.ownerUserId,
      relatedRefs: { workflowRunId },
      payload: {
        workflowRunId,
        cancelledAt: new Date().toISOString(),
      },
    });
  }

  private validateSteps(context: WorkflowValidationContext): void {
    if (context.draft.steps.length === 0) {
      context.issues.push({
        code: 'NO_STEPS',
        message: 'Workflow must have at least one step',
        severity: 'error',
      });
      return;
    }

    const validStepTypes = ['tool_call', 'agent_run', 'subagent_run', 'approval', 'wait'];

    for (const step of context.draft.steps) {
      if (!step.stepId) {
        context.issues.push({
          code: 'MISSING_STEP_ID',
          message: 'Step is missing a stepId',
          severity: 'error',
        });
      }

      if (!validStepTypes.includes(step.stepType)) {
        context.issues.push({
          code: 'INVALID_STEP_TYPE',
          message: `Invalid step type: ${step.stepType}. Must be one of: ${validStepTypes.join(', ')}`,
          stepId: step.stepId,
          severity: 'error',
        });
      }

      if (!step.name) {
        context.issues.push({
          code: 'MISSING_STEP_NAME',
          message: `Step ${step.stepId} is missing a name`,
          stepId: step.stepId,
          severity: 'warning',
        });
      }

      this.validateStepConfig(step, context);
    }
  }

  private validateStepConfig(step: WorkflowStep, context: WorkflowValidationContext): void {
    const config = step.config;

    switch (step.stepType) {
      case 'tool_call':
        if (!config.toolName) {
          context.issues.push({
            code: 'MISSING_TOOL_NAME',
            message: `Step ${step.stepId} is missing toolName in config`,
            stepId: step.stepId,
            severity: 'error',
          });
        }
        break;
      case 'agent_run':
        if (!config.agentId) {
          context.issues.push({
            code: 'MISSING_AGENT_ID',
            message: `Step ${step.stepId} is missing agentId in config`,
            stepId: step.stepId,
            severity: 'error',
          });
        }
        break;
      case 'subagent_run':
        if (!config.subagentType) {
          context.issues.push({
            code: 'MISSING_SUBAGENT_TYPE',
            message: `Step ${step.stepId} is missing subagentType in config`,
            stepId: step.stepId,
            severity: 'error',
          });
        }
        break;
      case 'approval':
        if (!config.approvalScope) {
          context.issues.push({
            code: 'MISSING_APPROVAL_SCOPE',
            message: `Step ${step.stepId} is missing approvalScope in config`,
            stepId: step.stepId,
            severity: 'error',
          });
        }
        break;
      case 'wait':
        if (!config.waitCondition) {
          context.issues.push({
            code: 'MISSING_WAIT_CONDITION',
            message: `Step ${step.stepId} is missing waitCondition in config`,
            stepId: step.stepId,
            severity: 'error',
          });
        }
        break;
    }
  }

  private validateLinearFlow(context: WorkflowValidationContext): void {
    const steps = context.draft.steps;
    if (steps.length === 0) return;

    const stepIds = new Set(steps.map(s => s.stepId));
    const firstStep = steps[0];

    if (!firstStep) return;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;

      if (step.nextStepId && !stepIds.has(step.nextStepId)) {
        context.issues.push({
          code: 'INVALID_NEXT_STEP',
          message: `Step ${step.stepId} references non-existent nextStepId: ${step.nextStepId}`,
          stepId: step.stepId,
          severity: 'error',
        });
      }
    }

    const visited = new Set<string>();
    let currentStep: WorkflowStep | undefined = firstStep;
    let cycleDetection = 0;

    while (currentStep && cycleDetection < steps.length * 2) {
      if (visited.has(currentStep.stepId)) {
        context.issues.push({
          code: 'CYCLE_DETECTED',
          message: `Cycle detected in workflow starting at step: ${currentStep.stepId}`,
          stepId: currentStep.stepId,
          severity: 'error',
        });
        break;
      }

      visited.add(currentStep.stepId);

      if (currentStep.nextStepId) {
        currentStep = steps.find(s => s.stepId === currentStep!.nextStepId);
      } else {
        currentStep = undefined;
      }

      cycleDetection++;
    }
  }

  private validateStepReferences(context: WorkflowValidationContext): void {
    const stepIds = new Set(context.draft.steps.map(s => s.stepId));

    for (const step of context.draft.steps) {
      if (step.stepId && stepIds.has(step.stepId)) {
        const duplicates = context.draft.steps.filter(s => s.stepId === step.stepId);
        if (duplicates.length > 1) {
          context.issues.push({
            code: 'DUPLICATE_STEP_ID',
            message: `Duplicate stepId found: ${step.stepId}`,
            stepId: step.stepId,
            severity: 'error',
          });
        }
      }
    }
  }

  private buildStepInput(step: WorkflowStep, workflowInput?: Record<string, unknown>): Record<string, unknown> {
    const input: Record<string, unknown> = {};

    if (workflowInput) {
      Object.assign(input, workflowInput);
    }

    switch (step.stepType) {
      case 'tool_call':
        input.toolName = step.config.toolName;
        input.params = step.config.toolParams;
        break;
      case 'agent_run':
        input.agentId = step.config.agentId;
        input.params = step.config.agentParams;
        break;
      case 'subagent_run':
        input.subagentType = step.config.subagentType;
        input.params = step.config.subagentParams;
        break;
      case 'approval':
        input.approvalScope = step.config.approvalScope;
        break;
      case 'wait':
        input.waitCondition = step.config.waitCondition;
        break;
    }

    return input;
  }

  private advanceToNextStep(workflowRunId: string, currentStep: WorkflowStep, stepOutput: unknown): void {
    const definition = this.getDefinitionFromRun(workflowRunId);
    if (!definition) return;

    if (!currentStep.nextStepId) {
      this.workflowRunStore.saveWorkflowOutput(workflowRunId, { finalOutput: stepOutput });
      this.workflowRunStore.updateWorkflowStatus(workflowRunId, WORKFLOW_RUN_STATES.COMPLETED);

      this.emitEvent({
        eventType: 'workflow_run_completed',
        sourceModule: 'workflow',
        relatedRefs: { workflowRunId },
        payload: {
          workflowRunId,
          completedAt: new Date().toISOString(),
        },
      });
      return;
    }

    const nextStep = definition.steps.find(s => s.stepId === currentStep.nextStepId);
    if (!nextStep) return;

    const stepRuns = this.workflowRunStore.getStepsByWorkflowRunId(workflowRunId);
    const nextStepRun = stepRuns.find(sr => sr.stepId === nextStep.stepId);

    if (nextStepRun) {
      this.workflowRunStore.updateCurrentSteps(workflowRunId, [nextStep.stepId]);
      this.executeStep(nextStepRun.stepRunId);
    }
  }

  private shouldRetryStep(step: WorkflowStep): boolean {
    const retryPolicy = step.config.retryPolicy;
    if (!retryPolicy || retryPolicy.maxRetries <= 0) {
      return false;
    }

    return false;
  }

  private getTargetRuntimeForStepType(stepType: string): string {
    switch (stepType) {
      case 'tool_call':
        return 'tool_plane';
      case 'agent_run':
        return 'agent_kernel';
      case 'subagent_run':
        return 'subagent_runtime';
      case 'approval':
        return 'permission_engine';
      case 'wait':
        return 'event_trigger_runtime';
      default:
        return 'workflow_runtime';
    }
  }

  private getTargetActionForStepType(stepType: string): string {
    switch (stepType) {
      case 'tool_call':
        return 'execute_tool';
      case 'agent_run':
        return 'start_agent_run';
      case 'subagent_run':
        return 'launch_subagent';
      case 'approval':
        return 'request_approval';
      case 'wait':
        return 'register_wait_condition';
      default:
        return 'execute_step';
    }
  }

  private getDefinitionFromRun(workflowRunId: string): WorkflowDefinition | null {
    const workflowRun = this.workflowRunStore.getWorkflowRunById(workflowRunId);
    if (!workflowRun) return null;

    return this.definitionStore.getDefinitionById(workflowRun.workflowId);
  }

  private createRuntimeAction(params: {
    workflowRunId: string;
    stepRunId: string;
    userId: string;
    targetRuntime: string;
    targetAction: string;
    payload: Record<string, unknown>;
  }): RuntimeAction {
    const actionId = generateId(ACTION_ID_PREFIX);
    const now = new Date().toISOString();

    const action: RuntimeAction = {
      actionId,
      actionType: params.targetAction as RuntimeActionType,
      source: {
        sourceModule: 'workflow',
        sourceAction: 'execute_step',
      },
      targetRuntime: params.targetRuntime,
      targetAction: params.targetAction,
      payload: params.payload,
      correlationId: params.workflowRunId,
      userId: params.userId,
      targetRef: {
        workflowRunId: params.workflowRunId,
        workflowStepRunId: params.stepRunId,
      },
      status: RUNTIME_ACTION_STATES.CREATED,
      createdAt: now,
      updatedAt: now,
    };

    this.runtimeActionStore.save(action);

    return action;
  }

  private emitEvent(params: {
    eventType: string;
    sourceModule: SourceModule;
    userId?: string;
    sessionId?: string;
    relatedRefs?: {
      workflowRunId?: string;
      workflowId?: string;
      stepRunId?: string;
      draftId?: string;
    };
    payload: Record<string, unknown>;
  }): void {
    const now = new Date().toISOString();

    const event: EventRecord = {
      eventId: generateId('evt_'),
      eventType: params.eventType,
      sourceModule: params.sourceModule,
      userId: params.userId,
      sessionId: params.sessionId,
      relatedRefs: params.relatedRefs,
      payload: params.payload,
      sensitivity: 'low',
      retentionClass: 'standard',
      createdAt: now,
    };

    this.eventStore.append(event);
  }
}

export function createWorkflowRuntime(config: WorkflowRuntimeConfig): WorkflowRuntime {
  return new WorkflowRuntimeImpl(config);
}
