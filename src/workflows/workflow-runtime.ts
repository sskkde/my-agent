import type { WorkflowDraftStore } from '../storage/workflow-draft-store.js';
import type { WorkflowDefinitionStore } from '../storage/workflow-definition-store.js';
import type { WorkflowRunStore } from '../storage/workflow-run-store.js';
import type { RuntimeActionStore, RuntimeAction } from '../storage/runtime-action-store.js';
import type { EventStore, EventRecord, SourceModule } from '../storage/event-store.js';
import type { WaitConditionStore, WaitCondition } from '../storage/wait-condition-store.js';
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
  ConditionEvalResult,
  RetryAttemptAuditEntry,
} from './types.js';
import { evaluateConditionExpression } from './expression-evaluator.js';
import type { RuntimeErrorCategory } from '../shared/errors.js';

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
  waitConditionStore?: WaitConditionStore;
  dispatcher?: RuntimeDispatcher;
  clock?: { now: () => number; nowISO: () => string; advance: (ms: number) => void };
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
  private waitConditionStore?: WaitConditionStore;
  private dispatcher?: RuntimeDispatcher;
  private clock: { now: () => number; nowISO: () => string; advance: (ms: number) => void };
  private stepAttemptCounts: Map<string, number> = new Map();
  private stepAuditTrails: Map<string, RetryAttemptAuditEntry[]> = new Map();

  constructor(config: WorkflowRuntimeConfig) {
    this.draftStore = config.draftStore;
    this.definitionStore = config.definitionStore;
    this.workflowRunStore = config.workflowRunStore;
    this.runtimeActionStore = config.runtimeActionStore;
    this.eventStore = config.eventStore;
    this.waitConditionStore = config.waitConditionStore;
    this.dispatcher = config.dispatcher;
    this.clock = config.clock ?? { now: Date.now, nowISO: () => new Date().toISOString(), advance: () => {} };
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

      if (step.stepType === 'branch' && step.config.branches) {
        for (const branch of step.config.branches) {
          for (const branchStep of branch.steps) {
            const branchStepRunId = generateId('wf_step_run_');

            this.workflowRunStore.createStepRun({
              stepRunId: branchStepRunId,
              workflowRunId,
              stepId: branchStep.stepId,
              stepType: branchStep.stepType,
              status: WORKFLOW_RUN_STATES.QUEUED,
              inputData: this.buildStepInput(branchStep, input.inputData),
            });

            stepRuns.push({
              stepRunId: branchStepRunId,
              stepId: branchStep.stepId,
              stepType: branchStep.stepType,
              status: WORKFLOW_RUN_STATES.QUEUED,
            });
          }
        }
      }

      if (step.stepType === 'parallel_group' && step.config.parallelSteps) {
        for (const parallelStep of step.config.parallelSteps) {
          const parallelStepRunId = generateId('wf_step_run_');

          this.workflowRunStore.createStepRun({
            stepRunId: parallelStepRunId,
            workflowRunId,
            stepId: parallelStep.stepId,
            stepType: parallelStep.stepType,
            status: WORKFLOW_RUN_STATES.QUEUED,
            inputData: this.buildStepInput(parallelStep, input.inputData),
          });

          stepRuns.push({
            stepRunId: parallelStepRunId,
            stepId: parallelStep.stepId,
            stepType: parallelStep.stepType,
            status: WORKFLOW_RUN_STATES.QUEUED,
          });
        }
      }
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

    const definition = this.definitionStore.getDefinitionById(workflowRun.workflowId);
    if (!definition) {
      throw new Error(`Definition not found: ${workflowRun.workflowId}`);
    }

    const step = definition.steps.find(s => s.stepId === stepRun.stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepRun.stepId}`);
    }

    if (step.stepType === 'condition') {
      this.executeConditionStep(stepRunId);
      return;
    }

    if (step.stepType === 'branch') {
      this.executeBranchStep(stepRunId);
      return;
    }

    if (step.stepType === 'parallel_group') {
      this.executeParallelGroupStep(stepRunId);
      return;
    }

    if (step.stepType === 'polling_wait') {
      this.executePollingWaitStep(stepRunId);
      return;
    }

    this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.RUNNING);

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

    const now = this.clock.nowISO();

    if (result.success) {
      this.stepAttemptCounts.delete(stepRunId);
      this.stepAuditTrails.delete(stepRunId);
      this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.COMPLETED);
      this.workflowRunStore.saveStepOutput(stepRunId, result.output);

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
          attemptNumber: result.attemptNumber,
        },
      });

      this.advanceToNextStep(stepRun.workflowRunId, step, result.output);
    } else {
      this.handleStepFailure(stepRunId, step, workflowRun, result, now);
    }
  }

  private handleStepFailure(
    stepRunId: string,
    step: WorkflowStep,
    workflowRun: { workflowRunId: string; ownerUserId: string },
    result: StepExecutionResult,
    now: string
  ): void {
    const retryPolicy = step.config.retryPolicyV2;
    const currentAttempt = (this.stepAttemptCounts.get(stepRunId) ?? 0) + 1;
    this.stepAttemptCounts.set(stepRunId, currentAttempt);

    const auditEntry: RetryAttemptAuditEntry = {
      attempt: currentAttempt,
      status: 'failed',
      errorCategory: result.errorCategory,
      errorCode: result.error ? 'EXECUTION_ERROR' : undefined,
      timestamp: now,
    };

    const auditTrail = this.stepAuditTrails.get(stepRunId) ?? [];
    auditTrail.push(auditEntry);
    this.stepAuditTrails.set(stepRunId, auditTrail);

    const shouldRetry = this.shouldRetryStepV2(step, result, currentAttempt);

    if (shouldRetry) {
      const delayMs = this.calculateRetryDelay(step, currentAttempt);
      auditTrail.push({
        attempt: currentAttempt + 1,
        status: 'retry_scheduled',
        delayMs,
        timestamp: now,
      });

      this.emitEvent({
        eventType: 'workflow_step_retry_scheduled',
        sourceModule: 'workflow',
        userId: workflowRun.ownerUserId,
        relatedRefs: { workflowRunId: workflowRun.workflowRunId, stepRunId },
        payload: {
          stepRunId,
          stepId: step.stepId,
          attempt: currentAttempt,
          maxAttempts: retryPolicy?.maxAttempts ?? 1,
          delayMs,
          error: result.error,
          errorCategory: result.errorCategory,
          scheduledAt: now,
        },
      });

      this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.QUEUED);
      setTimeout(() => this.executeStep(stepRunId), delayMs);
    } else {
      this.applyOnFailurePolicy(stepRunId, step, workflowRun, result, auditTrail, now);
    }
  }

  private shouldRetryStepV2(step: WorkflowStep, result: StepExecutionResult, currentAttempt: number): boolean {
    const retryPolicy = step.config.retryPolicyV2;
    if (!retryPolicy) {
      return false;
    }

    const maxAttempts = retryPolicy.maxAttempts ?? 1;
    if (currentAttempt >= maxAttempts) {
      return false;
    }

    if (result.recoverability === 'non_recoverable') {
      return false;
    }

    const errorCategory = result.errorCategory as RuntimeErrorCategory | undefined;
    if (errorCategory && retryPolicy.retryableErrorCategories) {
      return retryPolicy.retryableErrorCategories.includes(errorCategory);
    }

    return result.recoverability === 'retryable_later' || result.recoverability === 'recoverable_auto';
  }

  private calculateRetryDelay(step: WorkflowStep, attempt: number): number {
    const retryPolicy = step.config.retryPolicyV2;
    if (!retryPolicy) {
      return 1000;
    }

    const initialDelay = retryPolicy.initialDelayMs ?? 1000;
    const maxDelay = retryPolicy.maxDelayMs ?? 30000;
    const backoff = retryPolicy.backoff ?? 'exponential';

    let delay: number;
    switch (backoff) {
      case 'none':
        delay = 0;
        break;
      case 'fixed':
        delay = initialDelay;
        break;
      case 'linear':
        delay = initialDelay * attempt;
        break;
      case 'exponential':
      default:
        delay = initialDelay * Math.pow(2, attempt - 1);
        break;
    }

    return Math.min(delay, maxDelay);
  }

  private applyOnFailurePolicy(
    stepRunId: string,
    step: WorkflowStep,
    workflowRun: { workflowRunId: string; ownerUserId: string },
    result: StepExecutionResult,
    auditTrail: RetryAttemptAuditEntry[],
    now: string
  ): void {
    const onFailure = step.config.onFailure ?? 'fail';

    switch (onFailure) {
      case 'continue':
        this.handleOnFailureContinue(stepRunId, step, workflowRun, result, auditTrail, now);
        break;
      case 'skip':
        this.handleOnFailureSkip(stepRunId, step, workflowRun, result, auditTrail, now);
        break;
      case 'compensate':
        this.handleOnFailureCompensate(stepRunId, step, workflowRun, result, auditTrail, now);
        break;
      case 'fail':
      default:
        this.handleOnFailureFail(stepRunId, step, workflowRun, result, auditTrail, now);
        break;
    }

    this.stepAttemptCounts.delete(stepRunId);
    this.stepAuditTrails.delete(stepRunId);
  }

  private handleOnFailureFail(
    stepRunId: string,
    step: WorkflowStep,
    workflowRun: { workflowRunId: string; ownerUserId: string },
    result: StepExecutionResult,
    auditTrail: RetryAttemptAuditEntry[],
    now: string
  ): void {
    this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.FAILED);
    this.workflowRunStore.updateWorkflowStatus(workflowRun.workflowRunId, WORKFLOW_RUN_STATES.FAILED);

    this.emitEvent({
      eventType: 'workflow_step_failed',
      sourceModule: 'workflow',
      userId: workflowRun.ownerUserId,
      relatedRefs: { workflowRunId: workflowRun.workflowRunId, stepRunId },
      payload: {
        stepRunId,
        stepId: step.stepId,
        error: result.error,
        errorCategory: result.errorCategory,
        failedAt: now,
        auditTrail,
      },
    });

    this.emitEvent({
      eventType: 'workflow_run_failed',
      sourceModule: 'workflow',
      userId: workflowRun.ownerUserId,
      relatedRefs: { workflowRunId: workflowRun.workflowRunId },
      payload: {
        workflowRunId: workflowRun.workflowRunId,
        failedStepId: step.stepId,
        error: result.error,
        errorCategory: result.errorCategory,
        failedAt: now,
      },
    });
  }

  private handleOnFailureContinue(
    stepRunId: string,
    step: WorkflowStep,
    workflowRun: { workflowRunId: string; ownerUserId: string },
    result: StepExecutionResult,
    auditTrail: RetryAttemptAuditEntry[],
    now: string
  ): void {
    this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.COMPLETED);
    this.workflowRunStore.saveStepOutput(stepRunId, { failed: true, error: result.error, continued: true });

    this.emitEvent({
      eventType: 'workflow_step_failed_continue',
      sourceModule: 'workflow',
      userId: workflowRun.ownerUserId,
      relatedRefs: { workflowRunId: workflowRun.workflowRunId, stepRunId },
      payload: {
        stepRunId,
        stepId: step.stepId,
        error: result.error,
        errorCategory: result.errorCategory,
        continuedAt: now,
        auditTrail,
      },
    });

    this.advanceToNextStep(workflowRun.workflowRunId, step, null);
  }

  private handleOnFailureSkip(
    stepRunId: string,
    step: WorkflowStep,
    workflowRun: { workflowRunId: string; ownerUserId: string },
    result: StepExecutionResult,
    auditTrail: RetryAttemptAuditEntry[],
    now: string
  ): void {
    this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.CANCELLED);

    this.emitEvent({
      eventType: 'workflow_step_skipped',
      sourceModule: 'workflow',
      userId: workflowRun.ownerUserId,
      relatedRefs: { workflowRunId: workflowRun.workflowRunId, stepRunId },
      payload: {
        stepRunId,
        stepId: step.stepId,
        reason: 'onFailure=skip',
        error: result.error,
        errorCategory: result.errorCategory,
        skippedAt: now,
        auditTrail,
      },
    });

    this.advanceToNextStep(workflowRun.workflowRunId, step, null);
  }

  private handleOnFailureCompensate(
    stepRunId: string,
    step: WorkflowStep,
    workflowRun: { workflowRunId: string; ownerUserId: string },
    result: StepExecutionResult,
    auditTrail: RetryAttemptAuditEntry[],
    now: string
  ): void {
    const compensateHook = step.config.compensateHook;

    this.emitEvent({
      eventType: 'workflow_step_compensate_requested',
      sourceModule: 'workflow',
      userId: workflowRun.ownerUserId,
      relatedRefs: { workflowRunId: workflowRun.workflowRunId, stepRunId },
      payload: {
        stepRunId,
        stepId: step.stepId,
        compensateHook,
        error: result.error,
        errorCategory: result.errorCategory,
        requestedAt: now,
        auditTrail,
      },
    });

    if (compensateHook && this.dispatcher) {
      const action = this.createRuntimeAction({
        workflowRunId: workflowRun.workflowRunId,
        stepRunId,
        userId: workflowRun.ownerUserId,
        targetRuntime: 'workflow_runtime',
        targetAction: 'execute_compensate_hook',
        payload: {
          stepRunId,
          stepId: step.stepId,
          compensateHook,
          originalError: result.error,
          originalErrorCategory: result.errorCategory,
        },
      });

      this.dispatcher
        .dispatch({
          actionType: action.actionType as RuntimeActionType,
          targetRuntime: action.targetRuntime,
          targetAction: action.targetAction,
          payload: action.payload as Record<string, unknown>,
          userId: workflowRun.ownerUserId,
          correlationId: workflowRun.workflowRunId,
        })
        .then(compensateResult => {
          if (compensateResult.success) {
            this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.COMPLETED);
            this.emitEvent({
              eventType: 'workflow_step_compensated',
              sourceModule: 'workflow',
              userId: workflowRun.ownerUserId,
              relatedRefs: { workflowRunId: workflowRun.workflowRunId, stepRunId },
              payload: {
                stepRunId,
                stepId: step.stepId,
                compensateResult: compensateResult.result,
                compensatedAt: this.clock.nowISO(),
              },
            });
            this.advanceToNextStep(workflowRun.workflowRunId, step, null);
          } else {
            this.handleOnFailureFail(stepRunId, step, workflowRun, result, auditTrail, this.clock.nowISO());
          }
        })
        .catch(() => {
          this.handleOnFailureFail(stepRunId, step, workflowRun, result, auditTrail, this.clock.nowISO());
        });
    } else {
      this.handleOnFailureFail(stepRunId, step, workflowRun, result, auditTrail, now);
    }
  }

  private executePollingWaitStep(stepRunId: string): void {
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

    this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.RUNNING);

    const pollingCondition = step.config.pollingCondition || '';
    const pollingIntervalMs = step.config.pollingIntervalMs ?? 1000;
    const timeoutMs = step.config.timeoutMs ?? 60000;

    if (!this.waitConditionStore) {
      this.handleStepCompletion(stepRunId, {
        success: false,
        error: 'WaitConditionStore not configured',
        errorCategory: 'system_internal_error',
        recoverability: 'non_recoverable',
      });
      return;
    }

    const waitConditionId = generateId('wait_');
    const timeoutAt = new Date(this.clock.now() + timeoutMs).toISOString();

    const waitCondition = this.waitConditionStore.create({
      id: waitConditionId,
      waitType: 'polling',
      conditionPattern: pollingCondition,
      targetType: 'workflow_step_run',
      targetRef: stepRunId,
      status: 'active',
      priority: 0,
      timeoutAt,
      metadata: JSON.stringify({
        pollingIntervalMs,
        stepRunId,
        workflowRunId: stepRun.workflowRunId,
      }),
    });

    this.emitEvent({
      eventType: 'workflow_polling_wait_registered',
      sourceModule: 'workflow',
      userId: workflowRun.ownerUserId,
      relatedRefs: { workflowRunId: stepRun.workflowRunId, stepRunId },
      payload: {
        stepRunId,
        stepId: step.stepId,
        waitConditionId,
        pollingCondition,
        pollingIntervalMs,
        timeoutMs,
        timeoutAt,
        registeredAt: this.clock.nowISO(),
      },
    });

    this.evaluatePollingCondition(stepRunId, waitCondition, pollingCondition, pollingIntervalMs, timeoutAt, 0);
  }

  private evaluatePollingCondition(
    stepRunId: string,
    waitCondition: WaitCondition,
    pollingCondition: string,
    pollingIntervalMs: number,
    timeoutAt: string,
    pollAttempt: number
  ): void {
    const stepRun = this.workflowRunStore.getStepRunById(stepRunId);
    if (!stepRun) {
      return;
    }

    const workflowRun = this.workflowRunStore.getWorkflowRunById(stepRun.workflowRunId);
    if (!workflowRun) {
      return;
    }

    const now = this.clock.now();
    const timeoutTime = new Date(timeoutAt).getTime();

    if (now >= timeoutTime) {
      if (this.waitConditionStore) {
        this.waitConditionStore.markTimeout(waitCondition.id);
      }

      this.emitEvent({
        eventType: 'workflow_polling_wait_timeout',
        sourceModule: 'workflow',
        userId: workflowRun.ownerUserId,
        relatedRefs: { workflowRunId: stepRun.workflowRunId, stepRunId },
        payload: {
          stepRunId,
          waitConditionId: waitCondition.id,
          pollAttempt,
          timedOutAt: this.clock.nowISO(),
        },
      });

      this.handleStepCompletion(stepRunId, {
        success: false,
        error: 'Polling wait timed out',
        errorCategory: 'timeout',
        recoverability: 'retryable_later',
        attemptNumber: pollAttempt,
      });
      return;
    }

    const stepOutputs = this.collectStepOutputs(stepRun.workflowRunId);
    let inputData: Record<string, unknown> | undefined;
    if (workflowRun.inputData) {
      if (typeof workflowRun.inputData === 'string') {
        try {
          inputData = JSON.parse(workflowRun.inputData);
        } catch {
          inputData = undefined;
        }
      } else {
        inputData = workflowRun.inputData as Record<string, unknown>;
      }
    }

    const result = evaluateConditionExpression(pollingCondition, stepOutputs, inputData);

    if (result.error) {
      this.emitEvent({
        eventType: 'workflow_polling_wait_error',
        sourceModule: 'workflow',
        userId: workflowRun.ownerUserId,
        relatedRefs: { workflowRunId: stepRun.workflowRunId, stepRunId },
        payload: {
          stepRunId,
          waitConditionId: waitCondition.id,
          pollAttempt,
          error: result.error.message,
          errorAt: this.clock.nowISO(),
        },
      });

      this.handleStepCompletion(stepRunId, {
        success: false,
        error: result.error.message,
        errorCategory: 'expression_error',
        recoverability: 'non_recoverable',
        attemptNumber: pollAttempt,
      });
      return;
    }

    if (result.conditionMet) {
      if (this.waitConditionStore) {
        this.waitConditionStore.markSatisfied(waitCondition.id, 'polling_evaluator', { conditionMet: true, pollAttempt });
      }

      this.emitEvent({
        eventType: 'workflow_polling_wait_satisfied',
        sourceModule: 'workflow',
        userId: workflowRun.ownerUserId,
        relatedRefs: { workflowRunId: stepRun.workflowRunId, stepRunId },
        payload: {
          stepRunId,
          waitConditionId: waitCondition.id,
          pollAttempt,
          satisfiedAt: this.clock.nowISO(),
        },
      });

      this.handleStepCompletion(stepRunId, {
        success: true,
        output: { conditionMet: true, pollAttempt },
        attemptNumber: pollAttempt,
      });
      return;
    }

    this.emitEvent({
      eventType: 'workflow_polling_wait_poll',
      sourceModule: 'workflow',
      userId: workflowRun.ownerUserId,
      relatedRefs: { workflowRunId: stepRun.workflowRunId, stepRunId },
      payload: {
        stepRunId,
        waitConditionId: waitCondition.id,
        pollAttempt,
        nextPollInMs: pollingIntervalMs,
        polledAt: this.clock.nowISO(),
      },
    });

    setTimeout(() => {
      this.evaluatePollingCondition(stepRunId, waitCondition, pollingCondition, pollingIntervalMs, timeoutAt, pollAttempt + 1);
    }, pollingIntervalMs);
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

    const validStepTypes = ['tool_call', 'agent_run', 'subagent_run', 'approval', 'wait', 'condition', 'branch', 'parallel_group', 'polling_wait'];

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
      case 'condition':
        if (!config.conditionExpression) {
          context.issues.push({
            code: 'MISSING_CONDITION_EXPRESSION',
            message: `Step ${step.stepId} is missing conditionExpression in config`,
            stepId: step.stepId,
            severity: 'error',
          });
        }
        if (!config.trueNextStepId && !config.falseNextStepId) {
          context.issues.push({
            code: 'MISSING_BRANCH_TARGETS',
            message: `Step ${step.stepId} must have at least one branch target (trueNextStepId or falseNextStepId)`,
            stepId: step.stepId,
            severity: 'error',
          });
        }
        break;
      case 'branch':
        if (!config.branches || config.branches.length === 0) {
          context.issues.push({
            code: 'MISSING_BRANCHES',
            message: `Step ${step.stepId} is missing branches in config`,
            stepId: step.stepId,
            severity: 'error',
          });
        }
        break;
      case 'parallel_group':
        if (!config.parallelSteps || config.parallelSteps.length === 0) {
          context.issues.push({
            code: 'MISSING_PARALLEL_STEPS',
            message: `Step ${step.stepId} is missing parallelSteps in config`,
            stepId: step.stepId,
            severity: 'error',
          });
        }
        break;
      case 'polling_wait':
        if (!config.pollingCondition) {
          context.issues.push({
            code: 'MISSING_POLLING_CONDITION',
            message: `Step ${step.stepId} is missing pollingCondition in config`,
            stepId: step.stepId,
            severity: 'error',
          });
        }
        if (!config.timeoutMs || config.timeoutMs <= 0) {
          context.issues.push({
            code: 'MISSING_POLLING_TIMEOUT',
            message: `Step ${step.stepId} must have a valid timeoutMs for polling_wait`,
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

  private collectStepOutputs(workflowRunId: string): Map<string, unknown> {
    const stepRuns = this.workflowRunStore.getStepsByWorkflowRunId(workflowRunId);
    const outputs = new Map<string, unknown>();

    for (const stepRun of stepRuns) {
      if (stepRun.status === WORKFLOW_RUN_STATES.COMPLETED && stepRun.outputData) {
        if (typeof stepRun.outputData === 'string') {
          try {
            const output = JSON.parse(stepRun.outputData);
            outputs.set(stepRun.stepId, output);
          } catch {
            outputs.set(stepRun.stepId, stepRun.outputData);
          }
        } else {
          outputs.set(stepRun.stepId, stepRun.outputData);
        }
      }
    }

    return outputs;
  }

  private executeConditionStep(stepRunId: string): void {
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

    this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.RUNNING);

    const stepOutputs = this.collectStepOutputs(stepRun.workflowRunId);
    let inputData: Record<string, unknown> | undefined;
    if (workflowRun.inputData) {
      if (typeof workflowRun.inputData === 'string') {
        try {
          inputData = JSON.parse(workflowRun.inputData);
        } catch {
          inputData = undefined;
        }
      } else {
        inputData = workflowRun.inputData as Record<string, unknown>;
      }
    }

    const expression = step.config.conditionExpression || '';
    const result: ConditionEvalResult = evaluateConditionExpression(expression, stepOutputs, inputData);

    const now = new Date().toISOString();

    if (result.error) {
      const onFailure = step.config.onFailure ?? 'fail';

      if (onFailure === 'continue') {
        this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.COMPLETED);
        this.workflowRunStore.saveStepOutput(stepRunId, { conditionError: result.error });

        const nextStepId = result.conditionMet ? step.config.trueNextStepId : step.config.falseNextStepId;
        if (nextStepId) {
          const nextStep = definition.steps.find(s => s.stepId === nextStepId);
          if (nextStep) {
            const stepRuns = this.workflowRunStore.getStepsByWorkflowRunId(stepRun.workflowRunId);
            const nextStepRun = stepRuns.find(sr => sr.stepId === nextStep.stepId);
            if (nextStepRun) {
              this.workflowRunStore.updateCurrentSteps(stepRun.workflowRunId, [nextStep.stepId]);
              this.executeStep(nextStepRun.stepRunId);
            }
          }
        }
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
            error: result.error.message,
            errorCategory: 'undefined_variable',
            failedAt: now,
          },
        });
      }
      return;
    }

    this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.COMPLETED);
    this.workflowRunStore.saveStepOutput(stepRunId, { conditionMet: result.conditionMet });

    this.emitEvent({
      eventType: 'workflow_condition_evaluated',
      sourceModule: 'workflow',
      userId: workflowRun.ownerUserId,
      relatedRefs: { workflowRunId: stepRun.workflowRunId, stepRunId },
      payload: {
        stepRunId,
        stepId: step.stepId,
        conditionMet: result.conditionMet,
        evaluatedAt: now,
      },
    });

    const nextStepId = result.conditionMet ? step.config.trueNextStepId : step.config.falseNextStepId;

    if (!nextStepId) {
      this.workflowRunStore.saveWorkflowOutput(stepRun.workflowRunId, { finalOutput: { conditionMet: result.conditionMet } });
      this.workflowRunStore.updateWorkflowStatus(stepRun.workflowRunId, WORKFLOW_RUN_STATES.COMPLETED);

      this.emitEvent({
        eventType: 'workflow_run_completed',
        sourceModule: 'workflow',
        relatedRefs: { workflowRunId: stepRun.workflowRunId },
        payload: {
          workflowRunId: stepRun.workflowRunId,
          completedAt: now,
        },
      });
      return;
    }

    const nextStep = definition.steps.find(s => s.stepId === nextStepId);
    if (!nextStep) return;

    const stepRuns = this.workflowRunStore.getStepsByWorkflowRunId(stepRun.workflowRunId);
    const nextStepRun = stepRuns.find(sr => sr.stepId === nextStep.stepId);

    if (nextStepRun) {
      this.workflowRunStore.updateCurrentSteps(stepRun.workflowRunId, [nextStep.stepId]);
      this.executeStep(nextStepRun.stepRunId);
    }
  }

  private executeBranchStep(stepRunId: string): void {
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

    this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.RUNNING);

    const branches = step.config.branches || [];
    if (branches.length === 0) {
      this.handleStepCompletion(stepRunId, { success: false, error: 'No branches defined' });
      return;
    }

    const stepOutputs = this.collectStepOutputs(stepRun.workflowRunId);
    let inputData: Record<string, unknown> | undefined;
    if (workflowRun.inputData) {
      if (typeof workflowRun.inputData === 'string') {
        try {
          inputData = JSON.parse(workflowRun.inputData);
        } catch {
          inputData = undefined;
        }
      } else {
        inputData = workflowRun.inputData as Record<string, unknown>;
      }
    }

    let selectedBranch = branches[0];
    for (const branch of branches) {
      if (branch.condition) {
        const result = evaluateConditionExpression(branch.condition, stepOutputs, inputData);
        if (!result.error && result.conditionMet) {
          selectedBranch = branch;
          break;
        }
      }
    }

    const now = new Date().toISOString();
    this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.COMPLETED);
    this.workflowRunStore.saveStepOutput(stepRunId, { selectedBranch: selectedBranch.branchId });

    this.emitEvent({
      eventType: 'workflow_branch_selected',
      sourceModule: 'workflow',
      userId: workflowRun.ownerUserId,
      relatedRefs: { workflowRunId: stepRun.workflowRunId, stepRunId },
      payload: {
        stepRunId,
        stepId: step.stepId,
        selectedBranch: selectedBranch.branchId,
        selectedAt: now,
      },
    });

    for (const branch of branches) {
      if (branch.branchId !== selectedBranch.branchId) {
        this.skipBranchSteps(branch.steps, stepRun.workflowRunId, workflowRun.ownerUserId);
      }
    }

    if (selectedBranch.steps.length === 0) {
      this.advanceToNextStep(stepRun.workflowRunId, step, null);
      return;
    }

    const firstBranchStep = selectedBranch.steps[0];
    if (!firstBranchStep) {
      this.advanceToNextStep(stepRun.workflowRunId, step, null);
      return;
    }

    const stepRuns = this.workflowRunStore.getStepsByWorkflowRunId(stepRun.workflowRunId);
    const firstBranchStepRun = stepRuns.find(sr => sr.stepId === firstBranchStep.stepId);

    if (firstBranchStepRun) {
      this.workflowRunStore.updateCurrentSteps(stepRun.workflowRunId, [firstBranchStep.stepId]);
      this.executeBranchInternalStep(firstBranchStepRun.stepRunId, firstBranchStep, selectedBranch.steps, step);
    }
  }

  private executeBranchInternalStep(
    stepRunId: string,
    branchStep: WorkflowStep,
    branchSteps: WorkflowStep[],
    parentBranchStep: WorkflowStep
  ): void {
    const stepRun = this.workflowRunStore.getStepRunById(stepRunId);
    if (!stepRun) {
      throw new Error(`Step run not found: ${stepRunId}`);
    }

    const workflowRun = this.workflowRunStore.getWorkflowRunById(stepRun.workflowRunId);
    if (!workflowRun) {
      throw new Error(`Workflow run not found: ${stepRun.workflowRunId}`);
    }

    this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.RUNNING);

    const action = this.createRuntimeAction({
      workflowRunId: stepRun.workflowRunId,
      stepRunId,
      userId: workflowRun.ownerUserId,
      targetRuntime: this.getTargetRuntimeForStepType(branchStep.stepType),
      targetAction: this.getTargetActionForStepType(branchStep.stepType),
      payload: {
        stepRunId,
        stepType: branchStep.stepType,
        stepConfig: branchStep.config,
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
          this.handleBranchInternalStepCompletion(
            stepRunId,
            branchStep,
            branchSteps,
            parentBranchStep,
            {
              success: result.success,
              output: result.result,
              error: result.error,
            }
          );
        })
        .catch(error => {
          this.handleBranchInternalStepCompletion(
            stepRunId,
            branchStep,
            branchSteps,
            parentBranchStep,
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        });
    }

    this.emitEvent({
      eventType: 'workflow_step_executing',
      sourceModule: 'workflow',
      userId: workflowRun.ownerUserId,
      relatedRefs: { workflowRunId: stepRun.workflowRunId, stepRunId },
      payload: {
        stepRunId,
        stepId: branchStep.stepId,
        stepType: branchStep.stepType,
        actionId: action.actionId,
      },
    });
  }

  private handleBranchInternalStepCompletion(
    stepRunId: string,
    branchStep: WorkflowStep,
    branchSteps: WorkflowStep[],
    parentBranchStep: WorkflowStep,
    result: StepExecutionResult
  ): void {
    const stepRun = this.workflowRunStore.getStepRunById(stepRunId);
    if (!stepRun) {
      throw new Error(`Step run not found: ${stepRunId}`);
    }

    const workflowRun = this.workflowRunStore.getWorkflowRunById(stepRun.workflowRunId);
    if (!workflowRun) {
      throw new Error(`Workflow run not found: ${stepRun.workflowRunId}`);
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
          stepId: branchStep.stepId,
          output: result.output,
          completedAt: now,
        },
      });

      const currentIndex = branchSteps.findIndex(s => s.stepId === branchStep.stepId);
      const nextBranchStep = branchSteps[currentIndex + 1];

      if (nextBranchStep) {
        const stepRuns = this.workflowRunStore.getStepsByWorkflowRunId(stepRun.workflowRunId);
        const nextStepRun = stepRuns.find(sr => sr.stepId === nextBranchStep.stepId);

        if (nextStepRun) {
          this.workflowRunStore.updateCurrentSteps(stepRun.workflowRunId, [nextBranchStep.stepId]);
          this.executeBranchInternalStep(nextStepRun.stepRunId, nextBranchStep, branchSteps, parentBranchStep);
        }
      } else {
        this.advanceToNextStep(stepRun.workflowRunId, parentBranchStep, result.output);
      }
    } else {
      const onFailure = branchStep.config.onFailure ?? 'fail';

      if (onFailure === 'continue') {
        this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.COMPLETED);

        const currentIndex = branchSteps.findIndex(s => s.stepId === branchStep.stepId);
        const nextBranchStep = branchSteps[currentIndex + 1];

        if (nextBranchStep) {
          const stepRuns = this.workflowRunStore.getStepsByWorkflowRunId(stepRun.workflowRunId);
          const nextStepRun = stepRuns.find(sr => sr.stepId === nextBranchStep.stepId);

          if (nextStepRun) {
            this.workflowRunStore.updateCurrentSteps(stepRun.workflowRunId, [nextBranchStep.stepId]);
            this.executeBranchInternalStep(nextStepRun.stepRunId, nextBranchStep, branchSteps, parentBranchStep);
          }
        } else {
          this.advanceToNextStep(stepRun.workflowRunId, parentBranchStep, null);
        }
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
            stepId: branchStep.stepId,
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
            failedStepId: branchStep.stepId,
            error: result.error,
            failedAt: now,
          },
        });
      }
    }
  }

  private skipBranchSteps(steps: WorkflowStep[], workflowRunId: string, userId: string): void {
    for (const step of steps) {
      const stepRuns = this.workflowRunStore.getStepsByWorkflowRunId(workflowRunId);
      const stepRun = stepRuns.find(sr => sr.stepId === step.stepId);

      if (stepRun) {
        this.workflowRunStore.updateStepStatus(stepRun.stepRunId, WORKFLOW_RUN_STATES.CANCELLED);

        this.emitEvent({
          eventType: 'workflow_step_skipped',
          sourceModule: 'workflow',
          userId,
          relatedRefs: { workflowRunId, stepRunId: stepRun.stepRunId },
          payload: {
            stepRunId: stepRun.stepRunId,
            stepId: step.stepId,
            reason: 'Branch not selected',
            skippedAt: new Date().toISOString(),
          },
        });
      }
    }
  }

  private async executeParallelGroupStep(stepRunId: string): Promise<void> {
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

    this.workflowRunStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.RUNNING);

    const parallelSteps = step.config.parallelSteps || [];
    const maxParallel = step.config.maxParallel || 5;

    if (parallelSteps.length === 0) {
      this.handleStepCompletion(stepRunId, { success: true, output: { parallelResults: [] } });
      return;
    }

    const stepRuns = this.workflowRunStore.getStepsByWorkflowRunId(stepRun.workflowRunId);
    const parallelStepRunIds: string[] = [];

    for (const parallelStep of parallelSteps) {
      const parallelStepRun = stepRuns.find(sr => sr.stepId === parallelStep.stepId);
      if (parallelStepRun) {
        parallelStepRunIds.push(parallelStepRun.stepRunId);
      }
    }

    this.workflowRunStore.updateCurrentSteps(stepRun.workflowRunId, parallelSteps.map(s => s.stepId));

    const batchSize = Math.min(maxParallel, parallelStepRunIds.length);

    for (let i = 0; i < parallelStepRunIds.length; i += batchSize) {
      const batch = parallelStepRunIds.slice(i, i + batchSize);
      const promises = batch.map(stepRunId => this.executeParallelStep(stepRunId));

      await Promise.all(promises);
    }

    const allStepRuns = this.workflowRunStore.getStepsByWorkflowRunId(stepRun.workflowRunId);
    const allCompleted = parallelSteps.every(ps => {
      const psr = allStepRuns.find(sr => sr.stepId === ps.stepId);
      return psr && (psr.status === WORKFLOW_RUN_STATES.COMPLETED || psr.status === WORKFLOW_RUN_STATES.FAILED);
    });

    if (allCompleted) {
      this.handleStepCompletion(stepRunId, { success: true, output: { parallelGroupCompleted: true } });
    }
  }

  private executeParallelStep(stepRunId: string): Promise<void> {
    return new Promise((resolve) => {
      this.executeStep(stepRunId);

      const checkCompletion = () => {
        const stepRun = this.workflowRunStore.getStepRunById(stepRunId);
        if (stepRun && (
          stepRun.status === WORKFLOW_RUN_STATES.COMPLETED ||
          stepRun.status === WORKFLOW_RUN_STATES.FAILED ||
          stepRun.status === WORKFLOW_RUN_STATES.CANCELLED
        )) {
          resolve();
        } else {
          setTimeout(checkCompletion, 100);
        }
      };

      checkCompletion();
    });
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
      case 'polling_wait':
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
      case 'polling_wait':
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
