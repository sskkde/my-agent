import type { AuditRecorder } from '../../observability/audit-types.js';
import type { RuntimeAction, RuntimeActionStore } from '../../storage/runtime-action-store.js';
import type { EventStore } from '../../storage/event-store.js';
import type { TriggerRegistration, TriggerStore, TriggerStatus } from '../../storage/trigger-store.js';
import type { RuntimeTriggerEvent } from '../../triggers/types.js';
import type { McpSessionManager } from './mcp-session-manager.js';

export interface McpNotification {
  id?: string;
  idempotencyKey?: string;
  method?: string;
  params?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface McpNotificationBridgeOptions {
  sessionManager: McpSessionManager;
  eventStore: EventStore;
  triggerStore: TriggerStore;
  runtimeActionStore: RuntimeActionStore;
  auditRecorder?: AuditRecorder;
  defaultUserId?: string;
}

const ACTIVE_TRIGGER_STATUS: TriggerStatus = 'active';

export class McpNotificationBridge {
  private readonly sessionManager: McpSessionManager;
  private readonly eventStore: EventStore;
  private readonly triggerStore: TriggerStore;
  private readonly runtimeActionStore: RuntimeActionStore;
  private readonly auditRecorder?: AuditRecorder;
  private readonly defaultUserId: string;
  private readonly dedupeCache = new Map<string, RuntimeTriggerEvent>();

  constructor(options: McpNotificationBridgeOptions) {
    this.sessionManager = options.sessionManager;
    this.eventStore = options.eventStore;
    this.triggerStore = options.triggerStore;
    this.runtimeActionStore = options.runtimeActionStore;
    this.auditRecorder = options.auditRecorder;
    this.defaultUserId = options.defaultUserId ?? 'system';
  }

  handleNotification(sessionId: string, notification: McpNotification): RuntimeTriggerEvent {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`MCP session not found: ${sessionId}`);
    }

    const idempotencyKey = this.getIdempotencyKey(session.serverId, notification);
    const cached = this.dedupeCache.get(idempotencyKey);
    if (cached) {
      return cached;
    }

    const event = this.createEvent(sessionId, session.serverId, notification, idempotencyKey);
    this.eventStore.append(event);
    this.auditNotification(sessionId, session.serverId, notification, event);
    this.fireMatchingTriggers(event);
    this.dedupeCache.set(idempotencyKey, event);
    return event;
  }

  private createEvent(
    sessionId: string,
    serverId: string,
    notification: McpNotification,
    idempotencyKey: string
  ): RuntimeTriggerEvent {
    const eventId = `evt_${crypto.randomUUID()}`;
    return {
      eventId,
      eventType: 'mcp_notification',
      sourceModule: 'trigger',
      sessionId,
      correlationId: eventId,
      idempotencyKey,
      relatedRefs: {},
      payload: {
        eventType: 'mcp_notification',
        source: `mcp.${serverId}`,
        sessionId,
        serverId,
        notification,
        sourceRefs: {
          mcpSessionId: sessionId,
          mcpServerId: serverId,
        },
      },
      sensitivity: 'medium',
      retentionClass: 'standard',
      createdAt: new Date().toISOString(),
    };
  }

  private fireMatchingTriggers(event: RuntimeTriggerEvent): void {
    const triggers = this.triggerStore.findByStatus(ACTIVE_TRIGGER_STATUS)
      .filter(trigger => trigger.conditionType === 'event' && this.matches(trigger, event));

    for (const trigger of triggers) {
      const action = this.createResumeAction(trigger, event);
      this.runtimeActionStore.save(action);
      this.triggerStore.incrementTriggerCount(trigger.id);
    }
  }

  private matches(trigger: TriggerRegistration, event: RuntimeTriggerEvent): boolean {
    if (trigger.conditionPattern === '*' || trigger.conditionPattern === event.eventType) {
      return true;
    }
    try {
      const pattern = JSON.parse(trigger.conditionPattern) as Record<string, unknown>;
      return Object.entries(pattern).every(([key, value]) => this.eventField(event, key) === value);
    } catch {
      return false;
    }
  }

  private eventField(event: RuntimeTriggerEvent, key: string): unknown {
    if (key === 'eventType') {
      return event.eventType;
    }
    return event.payload[key];
  }

  private createResumeAction(trigger: TriggerRegistration, event: RuntimeTriggerEvent): RuntimeAction {
    const existingKey = `${event.eventId}:${trigger.targetRef}`;
    const existing = this.runtimeActionStore.findByIdempotencyKey(existingKey);
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    return {
      actionId: `act_${crypto.randomUUID()}`,
      actionType: this.actionType(trigger.targetType),
      idempotencyKey: existingKey,
      source: { sourceModule: 'trigger', sourceAction: 'mcp_notification' },
      targetRuntime: this.targetRuntime(trigger.targetType),
      targetAction: this.targetAction(trigger.targetType),
      payload: {
        triggerId: trigger.id,
        targetRef: trigger.targetRef,
        eventType: event.eventType,
        triggerEventId: event.eventId,
        notification: event.payload.notification,
        source: event.payload.source,
      },
      correlationId: event.correlationId,
      sessionId: event.sessionId,
      targetRef: this.targetRef(trigger.targetType, trigger.targetRef),
      status: 'created',
      createdAt: now,
      updatedAt: now,
    };
  }

  private auditNotification(
    sessionId: string,
    serverId: string,
    notification: McpNotification,
    event: RuntimeTriggerEvent
  ): void {
    this.auditRecorder?.recordConnectorAccess({
      userId: this.defaultUserId,
      sessionId,
      connectorInstanceId: `mcp.${serverId}`,
      operation: `notification:${String(notification.method ?? notification.id ?? 'unknown')}`,
      status: 'success',
      correlationId: event.correlationId,
    });
  }

  private getIdempotencyKey(serverId: string, notification: McpNotification): string {
    const explicit = notification.idempotencyKey ?? notification.id;
    return explicit ? `mcp.${serverId}.${explicit}` : `mcp.${serverId}.${JSON.stringify(notification)}`;
  }

  private targetRuntime(targetType: string): string {
    if (targetType === 'background_run') {
      return 'subagent_runtime';
    }
    if (targetType === 'planner_run') {
      return 'planner_runtime';
    }
    if (targetType === 'kernel_run') {
      return 'agent_kernel';
    }
    return 'workflow_runtime';
  }

  private targetAction(targetType: string): string {
    if (targetType === 'background_run') {
      return 'resume_subagent';
    }
    if (targetType === 'planner_run') {
      return 'resume_planner_run';
    }
    if (targetType === 'kernel_run') {
      return 'resume_agent_run';
    }
    return 'resume_workflow_step';
  }

  private actionType(targetType: string): string {
    if (targetType === 'background_run') {
      return 'resume_subagent';
    }
    if (targetType === 'planner_run') {
      return 'resume_planner_run';
    }
    if (targetType === 'kernel_run') {
      return 'resume_agent_run';
    }
    return 'resume_workflow_step';
  }

  private targetRef(targetType: string, targetRef: string): RuntimeAction['targetRef'] {
    if (targetType === 'background_run') {
      return { backgroundRunId: targetRef };
    }
    if (targetType === 'planner_run') {
      return { plannerRunId: targetRef };
    }
    if (targetType === 'kernel_run') {
      return { runId: targetRef };
    }
    return { workflowStepRunId: targetRef };
  }
}
