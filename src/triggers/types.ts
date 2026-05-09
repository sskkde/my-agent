/**
 * Event Trigger Runtime Types
 *
 * Defines the type system for event triggers, scheduling, approvals, and wait conditions.
 */

import type { TriggerRegistration } from '../storage/trigger-store.js';
import type { WaitCondition } from '../storage/wait-condition-store.js';
import type { EventRecord } from '../storage/event-store.js';
import type { RuntimeAction } from '../storage/runtime-action-store.js';

// ============================================================================
// Trigger Event Types
// ============================================================================

/**
 * Types of trigger events that can be emitted by the EventTriggerRuntime
 */
export type TriggerEventType =
  | 'schedule_trigger_fired'
  | 'webhook_trigger_fired'
  | 'connector_event_trigger_fired'
  | 'mcp_notification'
  | 'approval_resolved_trigger'
  | 'wait_condition_satisfied'
  | 'wait_condition_timeout'
  | 'wait_condition_failed'
  | 'trigger_registered'
  | 'trigger_expired'
  | 'trigger_completed';

/**
 * Extended event record for runtime trigger events
 */
export interface RuntimeTriggerEvent extends EventRecord {
  eventType: TriggerEventType;
  sourceModule: 'trigger';
  relatedRefs: {
    triggerRegistrationId?: string;
    waitConditionId?: string;
    approvalId?: string;
    targetRef?: string;
  };
}

// ============================================================================
// Trigger Scheduler Types
// ============================================================================

/**
 * Types of schedule conditions supported
 */
export type ScheduleConditionType = 'schedule';

/**
 * Types of approval conditions supported
 */
export type ApprovalConditionType = 'approval_resolved';

/**
 * Types of wait conditions supported
 */
export type WaitConditionType =
  | 'operation_completion'
  | 'timeout'
  | 'event';

/**
 * Trigger scheduler interface for managing schedule-based triggers
 */
export interface TriggerScheduler {
  /**
   * Parse and validate a schedule pattern (cron-like or ISO timestamp)
   */
  parseSchedulePattern(pattern: string): { valid: boolean; nextRunAt?: Date; error?: string };

  /**
   * Check if a schedule trigger is due to fire at the given time
   */
  isDue(pattern: string, now: Date): boolean;

  /**
   * Calculate the next run time for a schedule pattern
   */
  getNextRunTime(pattern: string, from?: Date): Date | null;
}

// ============================================================================
// Wait Condition Evaluator Types
// ============================================================================

/**
 * Result of evaluating a wait condition
 */
export interface WaitConditionEvaluation {
  satisfied: boolean;
  reason?: string;
  resultData?: Record<string, unknown>;
}

/**
 * Wait condition evaluator interface for checking if conditions are met
 */
export interface WaitConditionEvaluator {
  /**
   * Evaluate if a wait condition is satisfied
   */
  evaluate(condition: WaitCondition, context: EvaluationContext): WaitConditionEvaluation;

  /**
   * Check if a wait condition has timed out
   */
  isTimedOut(condition: WaitCondition, now: Date): boolean;

  /**
   * Match an event against a condition pattern
   */
  matchEvent(pattern: string, event: Record<string, unknown>): boolean;
}

/**
 * Context for wait condition evaluation
 */
export interface EvaluationContext {
  now: Date;
  events?: EventRecord[];
  approvals?: Array<{ approvalId: string; status: string; result?: unknown }>;
  operations?: Array<{ operationId: string; status: string; result?: unknown }>;
}

// ============================================================================
// Event Trigger Runtime Input Types
// ============================================================================

/**
 * Input for registering a new trigger
 */
export interface RegisterTriggerInput {
  triggerType: string;
  conditionType: ScheduleConditionType | ApprovalConditionType | string;
  conditionPattern: string;
  targetType: string;
  targetRef: string;
  priority?: number;
  maxTriggers?: number;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Input for registering a wait condition
 */
export interface RegisterWaitConditionInput {
  waitType: WaitConditionType;
  conditionPattern: string;
  targetType: string;
  targetRef: string;
  priority?: number;
  timeoutAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Input for handling approval resolution
 */
export interface HandleApprovalResolvedInput {
  approvalId: string;
  status: 'approved' | 'rejected';
  result?: Record<string, unknown>;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface ScheduleTriggerDefinition extends Omit<RegisterTriggerInput, 'triggerType' | 'conditionType' | 'conditionPattern' | 'metadata'> {
  intervalMs: number;
  nextRunAt: string;
  metadata?: Record<string, unknown>;
}

export interface WebhookTriggerPayload {
  eventId?: string;
  idempotencyKey?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  userId?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export interface ConnectorTriggerEvent {
  eventId?: string;
  idempotencyKey?: string;
  eventType: string;
  connectorId?: string;
  connectorInstanceId?: string;
  operationId?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
  userId?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export interface McpTriggerNotification {
  id?: string;
  idempotencyKey?: string;
  method?: string;
  serverId?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TriggerActionResult {
  matched: number;
  events: RuntimeTriggerEvent[];
  actions: RuntimeAction[];
}

// ============================================================================
// Event Trigger Runtime Configuration
// ============================================================================

/**
 * Configuration for the EventTriggerRuntime
 */
export interface EventTriggerRuntimeConfig {
  triggerStore: {
    create(trigger: unknown): TriggerRegistration;
    getById(id: string): TriggerRegistration | null;
    findByTarget(targetType: string, targetRef: string): TriggerRegistration[];
    findByStatus(status: string): TriggerRegistration[];
    incrementTriggerCount(id: string): TriggerRegistration;
    updateStatus(id: string, status: string): TriggerRegistration;
    updateMetadata?(id: string, metadata: string): TriggerRegistration;
    findExpired(before: string): TriggerRegistration[];
  };
  waitConditionStore: {
    create(condition: unknown): WaitCondition;
    getById(id: string): WaitCondition | null;
    findByTarget(targetType: string, targetRef: string): WaitCondition[];
    findByStatus(status: string): WaitCondition[];
    markSatisfied(id: string, satisfiedBy: string, resultData?: Record<string, unknown>): WaitCondition;
    markFailed(id: string, reason?: string): WaitCondition;
    markTimeout(id: string): WaitCondition;
    findExpired(before: string): WaitCondition[];
  };
  eventStore: {
    append(event: EventRecord | EventRecord[]): void;
    query(filters: { eventType?: string; correlationId?: string }): EventRecord[];
  };
  runtimeActionStore: {
    save(action: RuntimeAction): void;
    findByIdempotencyKey(key: string): RuntimeAction | null;
  };
  scheduler?: TriggerScheduler;
  evaluator?: WaitConditionEvaluator;
}

// ============================================================================
// Event Trigger Runtime Interface
// ============================================================================

/**
 * EventTriggerRuntime interface for managing event triggers, schedules,
 * approvals, and wait conditions.
 */
export interface EventTriggerRuntime {
  /**
   * Register a new trigger for events, schedules, or approvals
   */
  registerTrigger(input: RegisterTriggerInput): TriggerRegistration;

  registerSchedule(definition: ScheduleTriggerDefinition): TriggerRegistration;

  /**
   * Register a new wait condition
   */
  registerWaitCondition(input: RegisterWaitConditionInput): WaitCondition;

  /**
   * Evaluate schedule triggers and fire those that are due
   */
  evaluateScheduleTriggers(now: Date): { fired: number; events: RuntimeTriggerEvent[]; actions: RuntimeAction[] };

  /**
   * Evaluate wait conditions and process timeouts or satisfied conditions
   */
  evaluateWaitConditions(now: Date): { processed: number; events: RuntimeTriggerEvent[]; actions: RuntimeAction[] };

  /**
   * Handle an approval resolution event
   */
  handleApprovalResolved(input: HandleApprovalResolvedInput): {
    matched: number;
    events: RuntimeTriggerEvent[];
    actions: RuntimeAction[];
  };

  handleWebhook(webhookPayload: WebhookTriggerPayload, signature: string): TriggerActionResult;

  handleConnectorEvent(event: ConnectorTriggerEvent): TriggerActionResult;

  handleMcpNotification(notification: McpTriggerNotification): TriggerActionResult;

  /**
   * Get a trigger registration by ID
   */
  getTrigger(id: string): TriggerRegistration | null;

  /**
   * Get a wait condition by ID
   */
  getWaitCondition(id: string): WaitCondition | null;

  /**
   * Find triggers by target
   */
  findTriggersByTarget(targetType: string, targetRef: string): TriggerRegistration[];

  /**
   * Find wait conditions by target
   */
  findWaitConditionsByTarget(targetType: string, targetRef: string): WaitCondition[];
}

// ============================================================================
// Resume Action Types
// ============================================================================

/**
 * Target types that can be resumed
 */
export type ResumeTargetType =
  | 'workflow_run'
  | 'workflow_step_run'
  | 'background_run'
  | 'planner_run'
  | 'kernel_run'
  | 'notification';

/**
 * Parameters for creating a resume action
 */
export interface CreateResumeActionParams {
  targetType: ResumeTargetType;
  targetRef: string;
  eventType: TriggerEventType;
  triggerEventId: string;
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Result of trigger evaluation
 */
export interface TriggerEvaluationResult {
  shouldFire: boolean;
  trigger: TriggerRegistration;
  reason?: string;
}
