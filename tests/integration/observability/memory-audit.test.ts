import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAuditRecorder } from '../../../src/observability/audit-recorder.js';
import { createAuditStore } from '../../../src/observability/audit-store.js';
import { createTimelineBuilder } from '../../../src/observability/timeline.js';
import { createTraceStore } from '../../../src/observability/trace-store.js';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createEventStore } from '../../../src/storage/event-store.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { createRuntimeActionStore } from '../../../src/storage/runtime-action-store.js';

describe('memory_audit', () => {
  let connection: ConnectionManager;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);
  });

  afterEach(() => {
    connection.close();
  });

  it('records memory_write and memory_delete audits and includes both in timeline', () => {
    const eventStore = createEventStore(connection);
    const auditStore = createAuditStore(connection);
    const traceStore = createTraceStore(connection);
    const recorder = createAuditRecorder({ auditStore });
    const sessionId = 'session-memory-001';
    const memoryId = 'memory-001';

    const write = recorder.recordMemoryWrite({
      memoryId,
      userId: 'user-memory-001',
      sessionId,
      operation: 'write',
      contentSummary: 'Preference saved',
      correlationId: memoryId,
    });
    const deletion = recorder.recordMemoryWrite({
      memoryId,
      userId: 'user-memory-001',
      sessionId,
      operation: 'delete',
      contentSummary: 'Preference deleted',
      correlationId: memoryId,
    });

    expect(write.auditType).toBe('memory_write');
    expect(deletion.auditType).toBe('memory_delete');
    expect(auditStore.query({ auditType: 'memory_write' })).toHaveLength(1);
    expect(auditStore.query({ auditType: 'memory_delete' })).toHaveLength(1);

    const timeline = createTimelineBuilder({
      eventStore,
      auditStore,
      traceStore,
      actionStore: createRuntimeActionStore(connection),
    }).queryBySessionId(sessionId);

    const auditTypes = timeline.events
      .filter((event) => event.eventType === 'audit')
      .map((event) => (event.sourceData as { auditType?: string }).auditType);
    expect(auditTypes).toContain('memory_write');
    expect(auditTypes).toContain('memory_delete');
  });
});
