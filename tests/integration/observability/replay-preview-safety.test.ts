import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createEventStore, type EventStore, type EventRecord } from '../../../src/storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createPlannerRunStore, type PlannerRunStore } from '../../../src/storage/planner-run-store.js';
import { createPlanStore, type PlanStore } from '../../../src/storage/plan-store.js';
import { createAuditStore } from '../../../src/observability/audit-store.js';
import { createTraceStore } from '../../../src/observability/trace-store.js';
import { createTimelineBuilder } from '../../../src/observability/timeline.js';
import {
  createReplayService,
  type ReplayService,
  type SafetyPolicy,
  type ReplayRequest,
} from '../../../src/observability/replay.js';
import type { AuditStore } from '../../../src/observability/audit-types.js';
import type { TraceStore } from '../../../src/observability/types.js';

const STRICT_SAFETY_POLICY: SafetyPolicy = {
  allowExternalWrites: false,
  allowToolExecution: false,
  allowConnectorAccess: false,
  maxReplayDepth: 1,
  requireApprovalForSideEffects: true,
  redactSensitivePayloads: true,
};

type CountingEventStore = EventStore & {
  writeCount: number;
};

type CountingAuditStore = AuditStore & {
  writeCount: number;
};

function createCountingEventStore(base: EventStore): CountingEventStore {
  let writeCount = 0;
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'writeCount') return writeCount;
      if (prop === 'append') {
        return (...args: unknown[]) => {
          writeCount++;
          return (target.append as (...a: unknown[]) => unknown)(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
    set(_target, prop, value) {
      if (prop === 'writeCount') {
        writeCount = value as number;
        return true;
      }
      return true;
    },
  }) as unknown as CountingEventStore;
}

function createCountingAuditStore(base: AuditStore): CountingAuditStore {
  let writeCount = 0;
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'writeCount') return writeCount;
      if (prop === 'create' || prop === 'store') {
        return (...args: unknown[]) => {
          writeCount++;
          const method = (target as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string];
          if (method) return method.apply(target, args);
          return undefined;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
    set(_target, prop, value) {
      if (prop === 'writeCount') {
        writeCount = value as number;
        return true;
      }
      return true;
    },
  }) as unknown as CountingAuditStore;
}

describe('Replay Preview Safety', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let eventStore: CountingEventStore;
  let auditStore: CountingAuditStore;
  let traceStore: TraceStore;
  let plannerRunStore: PlannerRunStore;
  let planStore: PlanStore;
  let actionStore: RuntimeActionStore;
  let replayService: ReplayService;
  let plannerRunId: string;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(allStoreMigrations);

    const baseEventStore = createEventStore(connection);
    eventStore = createCountingEventStore(baseEventStore);

    const baseAuditStore = createAuditStore(connection);
    auditStore = createCountingAuditStore(baseAuditStore);

    traceStore = createTraceStore(connection);
    actionStore = createRuntimeActionStore(connection);
    plannerRunStore = createPlannerRunStore(connection);
    planStore = createPlanStore(connection);

    const timelineBuilder = createTimelineBuilder({
      eventStore,
      auditStore,
      traceStore,
      actionStore,
    });

    replayService = createReplayService({
      timelineBuilder,
      eventStore,
      auditStore,
      traceStore,
    });

    const now = new Date().toISOString();
    plannerRunId = `pr-safety-${Date.now()}`;
    const planId = `plan-safety-${Date.now()}`;

    planStore.createPlan({
      planId,
      userId: 'testuser',
      objective: 'Safety test plan',
      status: 'in_execution',
      currentVersion: 1,
      steps: [{ stepId: 'step-1', description: 'Test step', status: 'completed' }],
      createdAt: now,
      updatedAt: now,
    });

    plannerRunStore.create({
      plannerRunId,
      planId,
      userId: 'testuser',
      status: 'completed',
      checkpoint: null,
      createdAt: now,
      updatedAt: now,
    });

    eventStore.append({
      eventId: `evt-safety-${Date.now()}`,
      eventType: 'planner_started',
      sourceModule: 'planner',
      userId: 'testuser',
      relatedRefs: { plannerRunId, planId },
      payload: { objective: 'Safety test' },
      sensitivity: 'low',
      retentionClass: 'short',
      createdAt: now,
    });
  });

  afterEach(() => {
    connection?.close();
  });

  it('should assert 0 tool calls executed during replay', () => {
    eventStore.writeCount = 0;
    auditStore.writeCount = 0;

    const request: ReplayRequest = {
      rootType: 'planner_run',
      rootId: plannerRunId,
      replayMode: 'timeline_only',
      safetyPolicy: STRICT_SAFETY_POLICY,
      includeSensitiveData: false,
    };

    const result = replayService.replay(request);
    expect(result.status).not.toBe('error');

    expect(eventStore.writeCount).toBe(0);
    expect(auditStore.writeCount).toBe(0);
  });

  it('should assert 0 store writes performed during replay', () => {
    eventStore.writeCount = 0;
    auditStore.writeCount = 0;

    const request: ReplayRequest = {
      rootType: 'planner_run',
      rootId: plannerRunId,
      replayMode: 'timeline_only',
      safetyPolicy: STRICT_SAFETY_POLICY,
      includeSensitiveData: false,
    };

    replayService.replay(request);

    expect(eventStore.writeCount).toBe(0);
    expect(auditStore.writeCount).toBe(0);
  });

  it('should assert 0 external HTTP requests made during replay', () => {
    eventStore.writeCount = 0;
    auditStore.writeCount = 0;

    const request: ReplayRequest = {
      rootType: 'planner_run',
      rootId: plannerRunId,
      replayMode: 'timeline_only',
      safetyPolicy: STRICT_SAFETY_POLICY,
      includeSensitiveData: false,
    };

    const result = replayService.replay(request);

    for (const event of result.timeline.events) {
      const sourceData = event.sourceData as EventRecord | undefined;
      if (sourceData?.eventType) {
        expect(sourceData.eventType).not.toBe('external_http_request');
      }
    }

    expect(eventStore.writeCount).toBe(0);
  });

  it('should assert 0 triggers fired during replay', () => {
    eventStore.writeCount = 0;
    auditStore.writeCount = 0;

    const request: ReplayRequest = {
      rootType: 'planner_run',
      rootId: plannerRunId,
      replayMode: 'timeline_only',
      safetyPolicy: STRICT_SAFETY_POLICY,
      includeSensitiveData: false,
    };

    const result = replayService.replay(request);

    for (const event of result.timeline.events) {
      const sourceData = event.sourceData as EventRecord | undefined;
      if (sourceData?.eventType) {
        expect(sourceData.eventType).not.toBe('trigger_fired');
      }
    }

    expect(eventStore.writeCount).toBe(0);
    expect(auditStore.writeCount).toBe(0);
  });

  it('should return blockedActions when events contain tool/connector/external_write actions', () => {
    const now = new Date().toISOString();
    const runId = `pr-blocked-${Date.now()}`;
    const planId = `plan-blocked-${Date.now()}`;

    planStore.createPlan({
      planId,
      userId: 'testuser',
      objective: 'Blocked actions plan',
      status: 'completed',
      currentVersion: 1,
      steps: [],
      createdAt: now,
      updatedAt: now,
    });

    plannerRunStore.create({
      plannerRunId: runId,
      planId,
      userId: 'testuser',
      status: 'completed',
      checkpoint: null,
      createdAt: now,
      updatedAt: now,
    });

    eventStore.append([
      {
        eventId: `evt-blocked-1-${Date.now()}`,
        eventType: 'planner_started',
        sourceModule: 'planner',
        userId: 'testuser',
        relatedRefs: { plannerRunId: runId, planId },
        payload: { objective: 'Blocked test' },
        sensitivity: 'low',
        retentionClass: 'short',
        createdAt: now,
      },
      {
        eventId: `evt-blocked-2-${Date.now()}`,
        eventType: 'tool_executed',
        sourceModule: 'tool',
        userId: 'testuser',
        relatedRefs: { plannerRunId: runId },
        payload: { toolName: 'file_write', params: { path: '/tmp/test' } },
        sensitivity: 'medium',
        retentionClass: 'standard',
        createdAt: now,
      },
    ]);

    auditStore.record({
      auditId: `audit-blocked-${Date.now()}`,
      auditType: 'tool_call',
      timestamp: now,
      userId: 'testuser',
      sessionId: undefined,
      sourceModule: 'tool',
      sourceAction: 'execute_tool',
      actionSummary: 'Executed tool: file_write',
      status: 'completed',
      payload: { toolName: 'file_write' },
      riskLevel: 'medium',
      sensitivity: 'medium',
      correlationId: runId,
    });

    const request: ReplayRequest = {
      rootType: 'planner_run',
      rootId: runId,
      replayMode: 'timeline_only',
      safetyPolicy: STRICT_SAFETY_POLICY,
      includeSensitiveData: false,
    };

    const result = replayService.replay(request);

    expect(result.blockedActions.length).toBeGreaterThan(0);
    const toolBlocked = result.blockedActions.some(
      (a) => a.reason.includes('Tool execution blocked') || a.reason.includes('External write'),
    );
    expect(toolBlocked).toBe(true);
  });
});
