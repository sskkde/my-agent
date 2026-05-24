import type { PlanStore, ExecutionPlanRecord, PlanPatch, PlanStep } from '../storage/plan-store.js';
import type { PlannerRunStore, PlannerRunRecord } from '../storage/planner-run-store.js';
import type { RuntimeActionStore, RuntimeAction } from '../storage/runtime-action-store.js';
import type { RuntimeActionType } from '../dispatcher/types.js';
import type { EventStore, EventRecord, SourceModule } from '../storage/event-store.js';
import { PLANNER_STATES, EXECUTION_PLAN_STATES, RUNTIME_ACTION_STATES } from '../shared/states.js';
import { generateId, ACTION_ID_PREFIX } from '../shared/ids.js';
import type {
  PlannerRunState,
  PlannerRunInput,
  PlannerRunResult,
  PlannerRuntimeAction,
  ActiveExecutionRef,
  Checkpoint,
  PlannerResumeEvent,
} from './types.js';
import type { PlannerStatePatchData } from '../memory/planner-state-bridge.js';

export interface PlannerRuntime {
  createPlannerRun(input: PlannerRunInput): PlannerRunResult;
  resumePlannerRun(plannerRunId: string, event: PlannerResumeEvent): PlannerRunResult;
  cancelPlannerRun(plannerRunId: string): void;
  replan(plannerRunId: string, reason: string): void;
  archivePlannerRun(plannerRunId: string): void;
  transitionState(plannerRunId: string, newState: PlannerRunState, checkpointData?: Record<string, unknown>): void;
  handleApprovalRejection(plannerRunId: string, reason: string): void;
  applyPlanPatch(plannerRunId: string, patchData: Record<string, unknown>): void;
  addActiveExecutionRef(plannerRunId: string, ref: ActiveExecutionRef): void;
  emitRuntimeAction(plannerRunId: string, action: { targetRuntime: string; targetAction: string; payload: Record<string, unknown> }): PlannerRuntimeAction;
  saveCheckpoint(plannerRunId: string, checkpointData: Record<string, unknown>): void;
}

interface PlannerRuntimeConfig {
  planStore: PlanStore;
  plannerRunStore: PlannerRunStore;
  runtimeActionStore: RuntimeActionStore;
  eventStore: EventStore;
}

interface StateTransition {
  from: PlannerRunState[];
  to: PlannerRunState;
}

const VALID_TRANSITIONS: StateTransition[] = [
  { from: [PLANNER_STATES.INITIALIZING], to: PLANNER_STATES.PLANNING },
  { from: [PLANNER_STATES.PLANNING], to: PLANNER_STATES.WAITING_FOR_USER },
  { from: [PLANNER_STATES.PLANNING], to: PLANNER_STATES.WAITING_FOR_APPROVAL },
  { from: [PLANNER_STATES.PLANNING], to: PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT },
  { from: [PLANNER_STATES.PLANNING], to: PLANNER_STATES.WAITING_FOR_EXTERNAL_EVENT },
  { from: [PLANNER_STATES.PLANNING], to: PLANNER_STATES.COMPLETED },
  { from: [PLANNER_STATES.PLANNING], to: PLANNER_STATES.FAILED },
  { from: [PLANNER_STATES.PLANNING], to: PLANNER_STATES.REPLANNING },
  { from: [PLANNER_STATES.WAITING_FOR_USER], to: PLANNER_STATES.PLANNING },
  { from: [PLANNER_STATES.WAITING_FOR_USER], to: PLANNER_STATES.FAILED },
  { from: [PLANNER_STATES.WAITING_FOR_APPROVAL], to: PLANNER_STATES.PLANNING },
  { from: [PLANNER_STATES.WAITING_FOR_APPROVAL], to: PLANNER_STATES.REPLANNING },
  { from: [PLANNER_STATES.WAITING_FOR_APPROVAL], to: PLANNER_STATES.FAILED },
  { from: [PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT], to: PLANNER_STATES.PLANNING },
  { from: [PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT], to: PLANNER_STATES.COMPLETED },
  { from: [PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT], to: PLANNER_STATES.FAILED },
  { from: [PLANNER_STATES.WAITING_FOR_EXTERNAL_EVENT], to: PLANNER_STATES.PLANNING },
  { from: [PLANNER_STATES.WAITING_FOR_EXTERNAL_EVENT], to: PLANNER_STATES.FAILED },
  { from: [PLANNER_STATES.REPLANNING], to: PLANNER_STATES.PLANNING },
  { from: [PLANNER_STATES.REPLANNING], to: PLANNER_STATES.FAILED },
  { from: [PLANNER_STATES.PAUSED], to: PLANNER_STATES.PLANNING },
  { from: [PLANNER_STATES.PAUSED], to: PLANNER_STATES.FAILED },
];

const WAITING_STATES: PlannerRunState[] = [
  PLANNER_STATES.WAITING_FOR_USER,
  PLANNER_STATES.WAITING_FOR_APPROVAL,
  PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT,
  PLANNER_STATES.WAITING_FOR_EXTERNAL_EVENT,
];

const TERMINAL_STATES: PlannerRunState[] = [
  PLANNER_STATES.COMPLETED,
  PLANNER_STATES.FAILED,
  PLANNER_STATES.CANCELLED,
];

class PlannerRuntimeImpl implements PlannerRuntime {
  private planStore: PlanStore;
  private plannerRunStore: PlannerRunStore;
  private runtimeActionStore: RuntimeActionStore;
  private eventStore: EventStore;

  constructor(config: PlannerRuntimeConfig) {
    this.planStore = config.planStore;
    this.plannerRunStore = config.plannerRunStore;
    this.runtimeActionStore = config.runtimeActionStore;
    this.eventStore = config.eventStore;
  }

  createPlannerRun(input: PlannerRunInput): PlannerRunResult {
    const plannerRunId = generateId('pl_run_');
    const planId = generateId('plan_');
    const now = new Date().toISOString();

    const steps: PlanStep[] = [
      { stepId: 'step_001', description: 'Analyze objective: ' + input.objective, status: 'pending', dependencies: [] },
      { stepId: 'step_002', description: 'Execute required tool or agent action', status: 'pending', dependencies: ['step_001'] },
      { stepId: 'step_003', description: 'Summarize result and update session', status: 'pending', dependencies: ['step_002'] },
    ];

    const plan: ExecutionPlanRecord = {
      planId,
      userId: input.userId,
      sessionId: input.sessionId,
      objective: input.objective,
      status: EXECUTION_PLAN_STATES.DRAFT,
      currentVersion: 1,
      plannerRunIds: [plannerRunId],
      steps,
      createdAt: now,
      updatedAt: now,
    };

    this.planStore.createPlan(plan);

    const checkpoint: Checkpoint = {
      step: 'initialization',
      objective: input.objective,
    };

    const plannerRun: PlannerRunRecord = {
      plannerRunId,
      planId,
      userId: input.userId,
      sessionId: input.sessionId,
      status: PLANNER_STATES.INITIALIZING,
      checkpoint,
      createdAt: now,
      updatedAt: now,
    };

    this.plannerRunStore.create(plannerRun);

    const action = this.createRuntimeAction({
      plannerRunId,
      planId,
      userId: input.userId,
      sessionId: input.sessionId,
      targetRuntime: 'agent_kernel',
      targetAction: 'start_agent_run',
      payload: {
        planId,
        objective: input.objective,
      },
    });

    this.emitPlannerStatePatch(plannerRunId, {
      patchType: 'state_transition',
      from: null,
      to: PLANNER_STATES.INITIALIZING,
    });

    return {
      plannerRunId,
      planId,
      status: PLANNER_STATES.INITIALIZING,
      actions: [{
        actionId: action.actionId,
        targetRuntime: action.targetRuntime,
        targetAction: action.targetAction,
        payload: action.payload,
        status: action.status,
      }],
    };
  }

  resumePlannerRun(plannerRunId: string, event: PlannerResumeEvent): PlannerRunResult {
    const run = this.getPlannerRun(plannerRunId);

    if (!WAITING_STATES.includes(run.status)) {
      throw new Error(`Cannot resume from state: ${run.status}`);
    }

    this.appendEvent({
      eventType: 'planner_resumed',
      sourceModule: 'planner',
      userId: run.userId,
      sessionId: run.sessionId,
      relatedRefs: {
        plannerRunId,
        planId: run.planId,
      },
      payload: {
        eventType: event.eventType,
        eventPayload: event.payload,
      },
    });

    this.transitionState(plannerRunId, PLANNER_STATES.PLANNING, {
      resumedFrom: run.status,
      resumeEvent: event,
    });

    return {
      plannerRunId,
      planId: run.planId,
      status: PLANNER_STATES.PLANNING,
      actions: [],
    };
  }

  cancelPlannerRun(plannerRunId: string): void {
    const run = this.getPlannerRun(plannerRunId);
    const checkpoint = (run.checkpoint as Checkpoint) || { step: 'unknown' };

    const activeRefs = checkpoint.activeExecutionRefs || [];
    const updatedRefs = activeRefs.map(ref => ({
      ...ref,
      cancellationRequested: true,
    }));

    for (const ref of updatedRefs) {
      this.createRuntimeAction({
        plannerRunId,
        planId: run.planId,
        userId: run.userId,
        sessionId: run.sessionId,
        targetRuntime: this.getRuntimeForRefType(ref.refType),
        targetAction: 'cancel',
        payload: {
          action: 'cancel',
          targetRefId: ref.refId,
          targetRefType: ref.refType,
          reason: 'PlannerRun cancelled',
        },
      });
    }

    const updatedCheckpoint: Checkpoint = {
      ...checkpoint,
      activeExecutionRefs: updatedRefs,
      cancelledAt: new Date().toISOString(),
    };

    this.plannerRunStore.updateStatus(plannerRunId, PLANNER_STATES.CANCELLED, updatedCheckpoint);

    this.appendEvent({
      eventType: 'planner_cancelled',
      sourceModule: 'planner',
      userId: run.userId,
      sessionId: run.sessionId,
      relatedRefs: {
        plannerRunId,
        planId: run.planId,
      },
      payload: {
        activeRefs: updatedRefs,
      },
    });
  }

  replan(plannerRunId: string, reason: string): void {
    const run = this.getPlannerRun(plannerRunId);

    this.transitionState(plannerRunId, PLANNER_STATES.REPLANNING, {
      replanReason: reason,
      replannedAt: new Date().toISOString(),
    });

    this.appendEvent({
      eventType: 'planner_replanning',
      sourceModule: 'planner',
      userId: run.userId,
      sessionId: run.sessionId,
      relatedRefs: {
        plannerRunId,
        planId: run.planId,
      },
      payload: {
        reason,
      },
    });
  }

  archivePlannerRun(plannerRunId: string): void {
    const run = this.getPlannerRun(plannerRunId);

    if (!TERMINAL_STATES.includes(run.status)) {
      throw new Error(`Cannot archive run in state: ${run.status}`);
    }

    this.plannerRunStore.updateStatus(plannerRunId, PLANNER_STATES.ARCHIVED, run.checkpoint);

    this.appendEvent({
      eventType: 'planner_archived',
      sourceModule: 'planner',
      userId: run.userId,
      sessionId: run.sessionId,
      relatedRefs: {
        plannerRunId,
        planId: run.planId,
      },
      payload: {
        archivedFrom: run.status,
      },
    });
  }

  transitionState(plannerRunId: string, newState: PlannerRunState, checkpointData?: Record<string, unknown>): void {
    const run = this.getPlannerRun(plannerRunId);
    const currentState = run.status;

    if (!this.isValidTransition(currentState, newState)) {
      throw new Error(`Invalid state transition from ${currentState} to ${newState}`);
    }

    const currentCheckpoint = (run.checkpoint as Checkpoint) || { step: 'unknown' };
    const updatedCheckpoint: Checkpoint = {
      ...currentCheckpoint,
      ...checkpointData,
    };

    this.plannerRunStore.updateStatus(plannerRunId, newState, updatedCheckpoint);

    this.emitPlannerStatePatch(plannerRunId, {
      patchType: 'state_transition',
      from: currentState,
      to: newState,
    });
  }

  handleApprovalRejection(plannerRunId: string, reason: string): void {
    const run = this.getPlannerRun(plannerRunId);

    if (run.status !== PLANNER_STATES.WAITING_FOR_APPROVAL) {
      throw new Error(`Cannot reject from state: ${run.status}`);
    }

    this.transitionState(plannerRunId, PLANNER_STATES.REPLANNING, {
      rejectionReason: reason,
      rejectedAt: new Date().toISOString(),
    });

    this.createRuntimeAction({
      plannerRunId,
      planId: run.planId,
      userId: run.userId,
      sessionId: run.sessionId,
      targetRuntime: 'planner',
      targetAction: 'replan',
      payload: {
        action: 'replan',
        planId: run.planId,
        reason,
      },
    });

    this.appendEvent({
      eventType: 'plan_rejected',
      sourceModule: 'planner',
      userId: run.userId,
      sessionId: run.sessionId,
      relatedRefs: {
        plannerRunId,
        planId: run.planId,
      },
      payload: {
        reason,
      },
    });
  }

  applyPlanPatch(plannerRunId: string, patchData: Record<string, unknown>): void {
    const run = this.getPlannerRun(plannerRunId);
    const plan = this.planStore.getPlan(run.planId);

    if (!plan) {
      throw new Error(`Plan not found: ${run.planId}`);
    }

    const currentVersion = plan.currentVersion;
    const newVersion = currentVersion + 1;

    const patch: PlanPatch = {
      planId: run.planId,
      fromVersion: currentVersion,
      toVersion: newVersion,
      patch: JSON.stringify(patchData),
      sourcePlannerRunId: plannerRunId,
      reason: 'Planner replanning update',
      createdAt: new Date().toISOString(),
    };

    this.planStore.applyPatch(patch);

    this.emitPlannerStatePatch(plannerRunId, {
      patchType: 'plan_update',
      planId: run.planId,
      fromVersion: currentVersion,
      toVersion: newVersion,
    });
  }

  addActiveExecutionRef(plannerRunId: string, ref: ActiveExecutionRef): void {
    const run = this.getPlannerRun(plannerRunId);
    const checkpoint = (run.checkpoint as Checkpoint) || { step: 'unknown' };
    const activeRefs = checkpoint.activeExecutionRefs || [];

    const existingIndex = activeRefs.findIndex(r => r.refId === ref.refId);
    if (existingIndex >= 0) {
      activeRefs[existingIndex] = ref;
    } else {
      activeRefs.push(ref);
    }

    const updatedCheckpoint: Checkpoint = {
      ...checkpoint,
      activeExecutionRefs: activeRefs,
    };

    this.plannerRunStore.updateStatus(plannerRunId, run.status, updatedCheckpoint);

    this.emitPlannerStatePatch(plannerRunId, {
      patchType: 'execution_ref_update',
      refId: ref.refId,
      refType: ref.refType,
      status: ref.status,
    });
  }

  emitRuntimeAction(
    plannerRunId: string,
    action: { targetRuntime: string; targetAction: string; payload: Record<string, unknown> }
  ): PlannerRuntimeAction {
    const run = this.getPlannerRun(plannerRunId);

    const runtimeAction = this.createRuntimeAction({
      plannerRunId,
      planId: run.planId,
      userId: run.userId,
      sessionId: run.sessionId,
      targetRuntime: action.targetRuntime,
      targetAction: action.targetAction,
      payload: action.payload,
    });

    return {
      actionId: runtimeAction.actionId,
      targetRuntime: runtimeAction.targetRuntime,
      targetAction: runtimeAction.targetAction,
      payload: runtimeAction.payload,
      status: runtimeAction.status,
    };
  }

  saveCheckpoint(plannerRunId: string, checkpointData: Record<string, unknown>): void {
    const run = this.getPlannerRun(plannerRunId);
    const checkpoint = checkpointData as Checkpoint;
    this.plannerRunStore.updateStatus(plannerRunId, run.status, checkpoint);

    this.emitPlannerStatePatch(plannerRunId, {
      patchType: 'checkpoint_update',
      checkpointKeys: Object.keys(checkpointData),
    });
  }

  private getPlannerRun(plannerRunId: string): PlannerRunRecord {
    const run = this.plannerRunStore.getById(plannerRunId);
    if (!run) {
      throw new Error(`PlannerRun not found: ${plannerRunId}`);
    }
    return run;
  }

  private isValidTransition(from: PlannerRunState, to: PlannerRunState): boolean {
    if (to === PLANNER_STATES.CANCELLED) {
      return true;
    }

    const transition = VALID_TRANSITIONS.find(t =>
      t.from.includes(from) && t.to === to
    );

    return !!transition;
  }

  private getRuntimeForRefType(refType: string): string {
    switch (refType) {
      case 'background_run':
        return 'background_runner';
      case 'workflow_run':
        return 'workflow_engine';
      case 'subagent_run':
        return 'subagent_dispatcher';
      case 'kernel_run':
        return 'kernel';
      case 'tool_execution':
        return 'tool_executor';
      default:
        return 'unknown';
    }
  }

  private createRuntimeAction(params: {
    plannerRunId: string;
    planId: string;
    userId: string;
    sessionId?: string;
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
        sourceModule: 'planner',
        sourceAction: 'create_action',
      },
      targetRuntime: params.targetRuntime,
      targetAction: params.targetAction,
      payload: params.payload,
      correlationId: params.plannerRunId,
      sessionId: params.sessionId,
      userId: params.userId,
      targetRef: {
        plannerRunId: params.plannerRunId,
        planId: params.planId,
      },
      status: RUNTIME_ACTION_STATES.CREATED,
      createdAt: now,
      updatedAt: now,
    };

    this.runtimeActionStore.save(action);

    return action;
  }

  private emitPlannerStatePatch(
    plannerRunId: string,
    data: PlannerStatePatchData
  ): void {
    const now = new Date().toISOString();

    const event: EventRecord = {
      eventId: generateId('evt_'),
      eventType: 'planner_state_patch',
      sourceModule: 'planner',
      relatedRefs: {
        plannerRunId,
      },
      payload: {
        plannerRunId,
        patchType: data.patchType,
        patchData: data,
      },
      sensitivity: 'low',
      retentionClass: 'standard',
      createdAt: now,
    };

    this.eventStore.append(event);
  }

  private appendEvent(params: {
    eventType: string;
    sourceModule: SourceModule;
    userId?: string;
    sessionId?: string;
    relatedRefs?: {
      plannerRunId?: string;
      planId?: string;
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

export function createPlannerRuntime(config: PlannerRuntimeConfig): PlannerRuntime {
  return new PlannerRuntimeImpl(config);
}
