import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations, getLatestMigrationVersion } from '../../../src/storage/all-stores-migrations.js';

import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createTranscriptStore, type TranscriptStore } from '../../../src/storage/transcript-store.js';
import { createSummaryStore, type SummaryStore } from '../../../src/storage/summary-store.js';
import { createPlanStore, type PlanStore } from '../../../src/storage/plan-store.js';
import { createPlannerRunStore, type PlannerRunStore } from '../../../src/storage/planner-run-store.js';
import { createKernelRunStore, type KernelRunStore } from '../../../src/storage/kernel-run-store.js';
import { createToolExecutionStore, type ToolExecutionStore } from '../../../src/storage/tool-execution-store.js';
import { createBackgroundRunStore, type BackgroundRunStore } from '../../../src/storage/background-run-store.js';
import { createWorkflowRunStore, type WorkflowRunStore } from '../../../src/storage/workflow-run-store.js';
import { createApprovalStore, type ApprovalStore } from '../../../src/storage/approval-store.js';
import { createPermissionGrantStore, type PermissionGrantStore } from '../../../src/storage/permission-grant-store.js';
import { createTriggerStore, type TriggerStore } from '../../../src/storage/trigger-store.js';
import { createWaitConditionStore, type WaitConditionStore } from '../../../src/storage/wait-condition-store.js';
import { createArtifactStore, type ArtifactStore } from '../../../src/storage/artifact-store.js';
import { createToolResultStore, type ToolResultStore } from '../../../src/storage/tool-result-store.js';
import { createConnectorStore, type ConnectorStore } from '../../../src/storage/connector-store.js';

describe('All Stores Recovery Integration Test', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;

  // All store instances
  let eventStore: EventStore;
  let runtimeActionStore: RuntimeActionStore;
  let transcriptStore: TranscriptStore;
  let summaryStore: SummaryStore;
  let planStore: PlanStore;
  let plannerRunStore: PlannerRunStore;
  let kernelRunStore: KernelRunStore;
  let toolExecutionStore: ToolExecutionStore;
  let backgroundRunStore: BackgroundRunStore;
  let workflowRunStore: WorkflowRunStore;
  let approvalStore: ApprovalStore;
  let permissionGrantStore: PermissionGrantStore;
  let triggerStore: TriggerStore;
  let waitConditionStore: WaitConditionStore;
  let artifactStore: ArtifactStore;
  let toolResultStore: ToolResultStore;
  let connectorStore: ConnectorStore;

  // Test data references for verification
  const testData = {
    userId: 'test-user-001',
    sessionId: 'test-session-001',
    eventId: 'test-event-001',
    actionId: 'test-action-001',
    turnId: 'test-turn-001',
    summaryId: 'test-summary-001',
    planId: 'test-plan-001',
    plannerRunId: 'test-planner-run-001',
    kernelRunId: 'test-kernel-run-001',
    toolCallId: 'test-tool-call-001',
    backgroundRunId: 'test-bg-run-001',
    workflowRunId: 'test-wf-run-001',
    approvalId: 'test-approval-001',
    permissionId: 'test-permission-001',
    triggerId: 'test-trigger-001',
    waitConditionId: 'test-wait-001',
    artifactId: 'test-artifact-001',
    toolResultId: 'test-tool-result-001',
    connectorId: 'test-connector-001',
  };

  function initializeStores(): void {
    eventStore = createEventStore(connection);
    runtimeActionStore = createRuntimeActionStore(connection);
    transcriptStore = createTranscriptStore(connection);
    summaryStore = createSummaryStore(connection);
    planStore = createPlanStore(connection);
    plannerRunStore = createPlannerRunStore(connection);
    kernelRunStore = createKernelRunStore(connection);
    toolExecutionStore = createToolExecutionStore(connection);
    backgroundRunStore = createBackgroundRunStore(connection);
    workflowRunStore = createWorkflowRunStore(connection);
    approvalStore = createApprovalStore(connection);
    permissionGrantStore = createPermissionGrantStore(connection);
    triggerStore = createTriggerStore(connection);
    waitConditionStore = createWaitConditionStore(connection);
    artifactStore = createArtifactStore(connection);
    toolResultStore = createToolResultStore(connection);
    connectorStore = createConnectorStore(connection);
  }

  function insertRepresentativeRecords(): void {
    const now = new Date().toISOString();

    // Event Store
    eventStore.append({
      eventId: testData.eventId,
      eventType: 'test_event',
      sourceModule: 'system',
      userId: testData.userId,
      sessionId: testData.sessionId,
      payload: { test: true },
      sensitivity: 'low',
      retentionClass: 'standard',
      createdAt: now,
    });

    // RuntimeAction Store
    runtimeActionStore.save({
      actionId: testData.actionId,
      actionType: 'execute_tool',
      source: { sourceModule: 'system' },
      targetRuntime: 'kernel',
      targetAction: 'execute',
      payload: { test: true },
      status: 'created',
      createdAt: now,
      updatedAt: now,
    });

    // Transcript Store
    transcriptStore.saveTurn({
      turnId: testData.turnId,
      sessionId: testData.sessionId,
      userId: testData.userId,
      input: { userMessageSummary: 'Test message' },
      output: { visibleMessages: [{ messageId: 'msg-001', role: 'assistant', content: 'Test response' }] },
      visibility: 'public',
      createdAt: now,
    });

    // Summary Store
    summaryStore.save({
      summaryId: testData.summaryId,
      summaryType: 'working_summary',
      userId: testData.userId,
      sessionId: testData.sessionId,
      sourceRefs: { transcriptRefs: [testData.turnId] },
      summary: 'Test summary content',
      status: 'active',
      createdAt: now,
    });

    // Plan Store
    planStore.createPlan({
      planId: testData.planId,
      userId: testData.userId,
      sessionId: testData.sessionId,
      objective: 'Test objective',
      status: 'draft',
      currentVersion: 1,
      steps: [{ stepId: 'step-001', description: 'Test step', status: 'pending' }],
      createdAt: now,
      updatedAt: now,
    });

    // PlannerRun Store
    plannerRunStore.create({
      plannerRunId: testData.plannerRunId,
      planId: testData.planId,
      userId: testData.userId,
      sessionId: testData.sessionId,
      status: 'planning',
      checkpoint: null,
      createdAt: now,
      updatedAt: now,
    });

    // KernelRun Store
    kernelRunStore.create({
      runId: testData.kernelRunId,
      sessionId: testData.sessionId,
      agentId: 'test-agent',
      invocationSource: 'test',
      status: 'initializing',
    });

    // ToolExecution Store
    toolExecutionStore.create({
      toolCallId: testData.toolCallId,
      toolName: 'test_tool',
      userId: testData.userId,
      sessionId: testData.sessionId,
      kernelRunId: testData.kernelRunId,
      status: 'completed',
      sensitivity: 'low',
    });

    // BackgroundRun Store
    backgroundRunStore.create({
      backgroundRunId: testData.backgroundRunId,
      userId: testData.userId,
      sessionId: testData.sessionId,
      agentType: 'background_agent',
      status: 'running',
      launchSource: 'scheduler',
    });

    // WorkflowRun Store
    workflowRunStore.createWorkflowRun({
      workflowRunId: testData.workflowRunId,
      workflowId: 'test-workflow',
      workflowVersion: '1.0.0',
      ownerUserId: testData.userId,
      status: 'running',
    });

    // Approval Store
    approvalStore.create({
      id: testData.approvalId,
      userId: testData.userId,
      sessionId: testData.sessionId,
      status: 'pending',
      actionType: 'test_action',
      requestedBy: 'test-system',
      requestedAt: now,
    });

    // PermissionGrant Store
    permissionGrantStore.create({
      id: testData.permissionId,
      userId: testData.userId,
      scope: 'test_scope',
      action: 'test_action',
    });

    // Trigger Store
    triggerStore.create({
      id: testData.triggerId,
      triggerType: 'scheduled',
      conditionType: 'cron',
      conditionPattern: '0 0 * * *',
      targetType: 'workflow',
      targetRef: testData.workflowRunId,
      status: 'active',
    });

    // WaitCondition Store
    waitConditionStore.create({
      id: testData.waitConditionId,
      waitType: 'event',
      conditionPattern: 'test.event.completed',
      targetType: 'workflow',
      targetRef: testData.workflowRunId,
      status: 'registered',
    });

    // Artifact Store
    artifactStore.create({
      artifactId: testData.artifactId,
      artifactType: 'document',
      name: 'Test Artifact',
      contentRef: 'ref://test-content',
      userId: testData.userId,
      sessionId: testData.sessionId,
      status: 'draft',
    });

    // ToolResult Store
    toolResultStore.create({
      resultRef: testData.toolResultId,
      toolCallId: testData.toolCallId,
      toolName: 'test_tool',
      userId: testData.userId,
      sessionId: testData.sessionId,
      sensitivity: 'low',
    });

    // Connector Store
    connectorStore.createDefinition({
      connectorId: testData.connectorId,
      name: 'Test Connector',
      connectorType: 'api',
      version: '1.0.0',
      capabilities: ['read', 'write'],
      status: 'active',
    });
  }

  function verifyAllDataExists(): void {
    // Event Store
    const events = eventStore.query({ sessionId: testData.sessionId });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventId).toBe(testData.eventId);

    // RuntimeAction Store
    const action = runtimeActionStore.findById(testData.actionId);
    expect(action).not.toBeNull();
    expect(action?.actionId).toBe(testData.actionId);

    // Transcript Store
    const transcript = transcriptStore.getTurn(testData.turnId);
    expect(transcript).not.toBeNull();
    expect(transcript?.turnId).toBe(testData.turnId);

    // Summary Store
    const summary = summaryStore.getBySummaryId(testData.summaryId);
    expect(summary).not.toBeNull();
    expect(summary?.summaryId).toBe(testData.summaryId);

    // Plan Store
    const plan = planStore.getPlan(testData.planId);
    expect(plan).not.toBeNull();
    expect(plan?.planId).toBe(testData.planId);

    // PlannerRun Store
    const plannerRuns = plannerRunStore.findActive(testData.userId);
    expect(plannerRuns.length).toBeGreaterThan(0);
    expect(plannerRuns.some(r => r.plannerRunId === testData.plannerRunId)).toBe(true);

    // KernelRun Store
    const kernelRun = kernelRunStore.getById(testData.kernelRunId);
    expect(kernelRun).not.toBeNull();
    expect(kernelRun?.runId).toBe(testData.kernelRunId);

    // ToolExecution Store
    const toolExec = toolExecutionStore.getById(testData.toolCallId);
    expect(toolExec).not.toBeNull();
    expect(toolExec?.toolCallId).toBe(testData.toolCallId);

    // BackgroundRun Store
    const bgRun = backgroundRunStore.getById(testData.backgroundRunId);
    expect(bgRun).not.toBeNull();
    expect(bgRun?.backgroundRunId).toBe(testData.backgroundRunId);

    // WorkflowRun Store
    const wfRun = workflowRunStore.getWorkflowRunById(testData.workflowRunId);
    expect(wfRun).not.toBeNull();
    expect(wfRun?.workflowRunId).toBe(testData.workflowRunId);

    // Approval Store
    const approval = approvalStore.getById(testData.approvalId);
    expect(approval).not.toBeNull();
    expect(approval?.id).toBe(testData.approvalId);

    // PermissionGrant Store
    const permission = permissionGrantStore.getById(testData.permissionId);
    expect(permission).not.toBeNull();
    expect(permission?.id).toBe(testData.permissionId);

    // Trigger Store
    const trigger = triggerStore.getById(testData.triggerId);
    expect(trigger).not.toBeNull();
    expect(trigger?.id).toBe(testData.triggerId);

    // WaitCondition Store
    const waitCondition = waitConditionStore.getById(testData.waitConditionId);
    expect(waitCondition).not.toBeNull();
    expect(waitCondition?.id).toBe(testData.waitConditionId);

    // Artifact Store
    const artifact = artifactStore.findByArtifactId(testData.artifactId);
    expect(artifact).not.toBeUndefined();
    expect(artifact?.artifactId).toBe(testData.artifactId);

    // ToolResult Store
    const toolResult = toolResultStore.findByToolCallId(testData.toolCallId);
    expect(toolResult).toHaveLength(1);

    // Connector Store
    const connector = connectorStore.findDefinitionByConnectorId(testData.connectorId);
    expect(connector).not.toBeUndefined();
    expect(connector?.connectorId).toBe(testData.connectorId);
  }

  describe('In-Memory Database Recovery', () => {
    beforeEach(() => {
      connection = createConnectionManager(':memory:');
      connection.open();
      migrations = createMigrationRunner(connection);
      migrations.init();
    });

    afterEach(() => {
      connection?.close();
    });

    it('should apply all store migrations in order', () => {
      migrations.apply(allStoreMigrations);

      const version = migrations.getCurrentVersion();
      expect(version).toBe(getLatestMigrationVersion());

      // Verify all tables were created
      const tables = connection.query<{ name: string }>(`
        SELECT name FROM sqlite_master 
        WHERE type = 'table' 
        AND name NOT LIKE 'sqlite_%' 
        AND name != 'migrations'
        ORDER BY name
      `);

      const expectedTables = [
        'events',
        'runtime_actions',
        'transcripts',
        'summaries',
        'plans',
        'plan_patches',
        'planner_runs',
        'kernel_runs',
        'tool_executions',
        'background_runs',
        'workflow_runs',
        'workflow_step_runs',
        'approval_requests',
        'permission_grants',
        'trigger_registrations',
        'wait_conditions',
        'artifacts',
        'tool_results',
        'connector_definitions',
        'connector_instances',
        'connector_events',
      ];

      const tableNames = tables.map(t => t.name);
      for (const expected of expectedTables) {
        expect(tableNames).toContain(expected);
      }
    });

    it('should insert and retrieve records from all stores', () => {
      migrations.apply(allStoreMigrations);
      initializeStores();
      insertRepresentativeRecords();
      verifyAllDataExists();
    });

    it('should verify WAL mode is active on file databases', () => {
      // WAL mode verification is done in the connection test, but we verify the pragma works
      const result = connection.query<{ journal_mode: string }>('PRAGMA journal_mode');
      // Memory DB returns 'memory', file DB returns 'wal'
      expect(['memory', 'wal']).toContain(result[0]?.journal_mode.toLowerCase());
    });
  });

  describe('Database Recovery Simulation (Close and Reopen)', () => {
    let tempDbPath: string;

    beforeEach(() => {
      tempDbPath = `/tmp/test-recovery-${Date.now()}.db`;
    });

    afterEach(() => {
      // Cleanup temp files
      try {
        const fs = require('fs');
        if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
        if (fs.existsSync(tempDbPath + '-wal')) fs.unlinkSync(tempDbPath + '-wal');
        if (fs.existsSync(tempDbPath + '-shm')) fs.unlinkSync(tempDbPath + '-shm');
      } catch {}
    });

    it('should recover all data after connection restart', () => {
      // Phase 1: Initial setup and data insertion
      const conn1 = createConnectionManager(tempDbPath);
      conn1.open();
      const migr1 = createMigrationRunner(conn1);
      migr1.init();
      migr1.apply(allStoreMigrations);

      // Initialize stores with first connection
      eventStore = createEventStore(conn1);
      runtimeActionStore = createRuntimeActionStore(conn1);
      transcriptStore = createTranscriptStore(conn1);
      summaryStore = createSummaryStore(conn1);
      planStore = createPlanStore(conn1);
      plannerRunStore = createPlannerRunStore(conn1);
      kernelRunStore = createKernelRunStore(conn1);
      toolExecutionStore = createToolExecutionStore(conn1);
      backgroundRunStore = createBackgroundRunStore(conn1);
      workflowRunStore = createWorkflowRunStore(conn1);
      approvalStore = createApprovalStore(conn1);
      permissionGrantStore = createPermissionGrantStore(conn1);
      triggerStore = createTriggerStore(conn1);
      waitConditionStore = createWaitConditionStore(conn1);
      artifactStore = createArtifactStore(conn1);
      toolResultStore = createToolResultStore(conn1);
      connectorStore = createConnectorStore(conn1);

      insertRepresentativeRecords();

      // Verify data exists before closing
      let eventCount = conn1.query<{ count: number }>('SELECT COUNT(*) as count FROM events');
      expect(eventCount[0]?.count).toBe(1);

      // Close first connection (simulate shutdown)
      conn1.close();

      // Phase 2: Reopen connection and verify recovery
      const conn2 = createConnectionManager(tempDbPath);
      conn2.open();
      const migr2 = createMigrationRunner(conn2);
      migr2.init();

      // Verify migration version persisted
      const version = migr2.getCurrentVersion();
      expect(version).toBe(getLatestMigrationVersion());

      // Re-initialize stores with new connection
      eventStore = createEventStore(conn2);
      runtimeActionStore = createRuntimeActionStore(conn2);
      transcriptStore = createTranscriptStore(conn2);
      summaryStore = createSummaryStore(conn2);
      planStore = createPlanStore(conn2);
      plannerRunStore = createPlannerRunStore(conn2);
      kernelRunStore = createKernelRunStore(conn2);
      toolExecutionStore = createToolExecutionStore(conn2);
      backgroundRunStore = createBackgroundRunStore(conn2);
      workflowRunStore = createWorkflowRunStore(conn2);
      approvalStore = createApprovalStore(conn2);
      permissionGrantStore = createPermissionGrantStore(conn2);
      triggerStore = createTriggerStore(conn2);
      waitConditionStore = createWaitConditionStore(conn2);
      artifactStore = createArtifactStore(conn2);
      toolResultStore = createToolResultStore(conn2);
      connectorStore = createConnectorStore(conn2);

      // Verify all data is recovered
      verifyAllDataExists();

      // Verify WAL mode is still active after recovery
      const walResult = conn2.query<{ journal_mode: string }>('PRAGMA journal_mode');
      expect(walResult[0]?.journal_mode.toLowerCase()).toBe('wal');

      conn2.close();
    });

    it('should handle migration idempotency on recovery', () => {
      // First connection: apply migrations
      const conn1 = createConnectionManager(tempDbPath);
      conn1.open();
      const migr1 = createMigrationRunner(conn1);
      migr1.init();
      migr1.apply(allStoreMigrations);
      const version1 = migr1.getCurrentVersion();
      conn1.close();

      // Second connection: apply migrations again (should be idempotent)
      const conn2 = createConnectionManager(tempDbPath);
      conn2.open();
      const migr2 = createMigrationRunner(conn2);
      migr2.init();

      // This should not throw and should not change version
      migr2.apply(allStoreMigrations);
      const version2 = migr2.getCurrentVersion();

      expect(version2).toBe(version1);
      expect(version2).toBe(getLatestMigrationVersion());

      conn2.close();
    });
  });

  describe('Health Check', () => {
    beforeEach(() => {
      connection = createConnectionManager(':memory:');
      connection.open();
      migrations = createMigrationRunner(connection);
      migrations.init();
      migrations.apply(allStoreMigrations);
    });

    afterEach(() => {
      connection?.close();
    });

    it('should report correct migration version', () => {
      const version = migrations.getCurrentVersion();
      expect(version).toBeGreaterThan(0);
      expect(version).toBe(getLatestMigrationVersion());
    });

    it('should report WAL status for file-based databases', () => {
      // Test with temp file to verify WAL
      const tempPath = `/tmp/test-wal-health-${Date.now()}.db`;
      const fileConn = createConnectionManager(tempPath);
      fileConn.open();

      const walResult = fileConn.query<{ journal_mode: string }>('PRAGMA journal_mode');
      expect(walResult[0]?.journal_mode.toLowerCase()).toBe('wal');

      fileConn.close();

      // Cleanup
      try {
        const fs = require('fs');
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        if (fs.existsSync(tempPath + '-wal')) fs.unlinkSync(tempPath + '-wal');
        if (fs.existsSync(tempPath + '-shm')) fs.unlinkSync(tempPath + '-shm');
      } catch {}
    });

    it('should count records across all tables', () => {
      initializeStores();
      insertRepresentativeRecords();

      const tableCounts = connection.query<{ name: string; count: number }>(`
        SELECT 
          'events' as name, COUNT(*) as count FROM events
        UNION ALL SELECT 'runtime_actions', COUNT(*) FROM runtime_actions
        UNION ALL SELECT 'transcripts', COUNT(*) FROM transcripts
        UNION ALL SELECT 'summaries', COUNT(*) FROM summaries
        UNION ALL SELECT 'plans', COUNT(*) FROM plans
        UNION ALL SELECT 'planner_runs', COUNT(*) FROM planner_runs
        UNION ALL SELECT 'kernel_runs', COUNT(*) FROM kernel_runs
        UNION ALL SELECT 'tool_executions', COUNT(*) FROM tool_executions
        UNION ALL SELECT 'background_runs', COUNT(*) FROM background_runs
        UNION ALL SELECT 'workflow_runs', COUNT(*) FROM workflow_runs
        UNION ALL SELECT 'approval_requests', COUNT(*) FROM approval_requests
        UNION ALL SELECT 'permission_grants', COUNT(*) FROM permission_grants
        UNION ALL SELECT 'trigger_registrations', COUNT(*) FROM trigger_registrations
        UNION ALL SELECT 'wait_conditions', COUNT(*) FROM wait_conditions
        UNION ALL SELECT 'artifacts', COUNT(*) FROM artifacts
        UNION ALL SELECT 'tool_results', COUNT(*) FROM tool_results
        UNION ALL SELECT 'connector_definitions', COUNT(*) FROM connector_definitions
      `);

      // All tables should have at least 1 record
      for (const table of tableCounts) {
        expect(table.count).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('Startup Consistency Check', () => {
    let tempDbPath: string;

    beforeEach(() => {
      tempDbPath = `/tmp/test-consistency-${Date.now()}.db`;
    });

    afterEach(() => {
      try {
        const fs = require('fs');
        if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
        if (fs.existsSync(tempDbPath + '-wal')) fs.unlinkSync(tempDbPath + '-wal');
        if (fs.existsSync(tempDbPath + '-shm')) fs.unlinkSync(tempDbPath + '-shm');
      } catch {}
    });

    it('should verify all required tables exist on startup', () => {
      const conn = createConnectionManager(tempDbPath);
      conn.open();
      const migr = createMigrationRunner(conn);
      migr.init();
      migr.apply(allStoreMigrations);

      // Simulate startup consistency check
      const requiredTables = [
        'events',
        'runtime_actions',
        'transcripts',
        'summaries',
        'plans',
        'plan_patches',
        'planner_runs',
        'kernel_runs',
        'tool_executions',
        'background_runs',
        'workflow_runs',
        'workflow_step_runs',
        'approval_requests',
        'permission_grants',
        'trigger_registrations',
        'wait_conditions',
        'artifacts',
        'tool_results',
        'connector_definitions',
        'connector_instances',
        'connector_events',
      ];

      const existingTables = conn.query<{ name: string }>(`
        SELECT name FROM sqlite_master 
        WHERE type = 'table' 
        AND name NOT LIKE 'sqlite_%' 
        AND name != 'migrations'
      `).map(t => t.name);

      for (const table of requiredTables) {
        expect(existingTables).toContain(table);
      }

      conn.close();
    });

    it('should verify foreign key integrity on startup', () => {
      const conn = createConnectionManager(tempDbPath);
      conn.open();
      const migr = createMigrationRunner(conn);
      migr.init();
      migr.apply(allStoreMigrations);

      // Verify foreign keys are enabled
      const fkResult = conn.query<{ foreign_keys: 0 | 1 }>('PRAGMA foreign_keys');
      expect(fkResult[0]?.foreign_keys).toBe(1);

      // Run integrity check
      const integrityResult = conn.query<{ integrity_check: string }>('PRAGMA integrity_check');
      expect(integrityResult[0]?.integrity_check).toBe('ok');

      conn.close();
    });
  });
});
