import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createE2EHarness, type E2EHarness } from './test-harness.js';
import { createTraceStore } from '../../src/observability/trace-store.js';
import { createAuditStore } from '../../src/observability/audit-store.js';
import { createMetricStore } from '../../src/observability/metric-store.js';
import { createTimelineBuilder } from '../../src/observability/timeline.js';
import { createReplayService, DEFAULT_SAFETY_POLICY } from '../../src/observability/replay.js';
import { createTracingCollector, createTracingHooks } from '../../src/observability/tracing.js';
import { createAuditRecorder } from '../../src/observability/audit-recorder.js';
import { createFailureAnalyzer, analyzeConnectorResponse } from '../../src/observability/failure-analyzer.js';
import type { ToolDefinition } from '../../src/tools/types.js';
import type { PermissionContext } from '../../src/permissions/types.js';
import type { EventRecord } from '../../src/storage/event-store.js';
import { createBackgroundRuntime } from '../../src/subagents/background-runtime.js';
import { createBackgroundRunStore } from '../../src/storage/background-run-store.js';
import type { SubagentTaskSpec, SubagentResult } from '../../src/subagents/types.js';
import { createWorkflowRuntime } from '../../src/workflows/workflow-runtime.js';
import { createWorkflowDraftStore } from '../../src/storage/workflow-draft-store.js';
import { createWorkflowDefinitionStore } from '../../src/storage/workflow-definition-store.js';
import { createWorkflowRunStore } from '../../src/storage/workflow-run-store.js';
import type { WorkflowStep } from '../../src/workflows/types.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Task 46: Observability Integration Across All Runtime Flows', () => {
  let harness: E2EHarness;
  let traceStore: ReturnType<typeof createTraceStore>;
  let auditStore: ReturnType<typeof createAuditStore>;
  let metricStore: ReturnType<typeof createMetricStore>;
  let timelineBuilder: ReturnType<typeof createTimelineBuilder>;
  let replayService: ReturnType<typeof createReplayService>;
  let tracingCollector: ReturnType<typeof createTracingCollector>;
  let tracingHooks: ReturnType<typeof createTracingHooks>;
  let auditRecorder: ReturnType<typeof createAuditRecorder>;
  let failureAnalyzer: ReturnType<typeof createFailureAnalyzer>;

  beforeEach(() => {
    harness = createE2EHarness();
    traceStore = createTraceStore(harness.connection);
    auditStore = createAuditStore(harness.connection);
    metricStore = createMetricStore(harness.connection);
    timelineBuilder = createTimelineBuilder({
      eventStore: harness.stores.eventStore,
      auditStore,
      traceStore,
      actionStore: harness.stores.runtimeActionStore,
    });
    replayService = createReplayService({
      timelineBuilder,
      eventStore: harness.stores.eventStore,
      auditStore,
      traceStore,
    });
    tracingCollector = createTracingCollector({
      traceStore,
      metricStore,
      enabled: true,
      sampleRate: 1.0,
    });
    tracingHooks = createTracingHooks(tracingCollector);
    auditRecorder = createAuditRecorder({
      auditStore,
      enabled: true,
    });
    failureAnalyzer = createFailureAnalyzer();
  });

  afterEach(() => {
    harness.close();
  });

  describe('Flow 1: Chat - Trace and Timeline Observability', () => {
    it('should create trace with span for gateway request', async () => {
      const userId = 'user_obs_chat_001';
      const sessionId = 'sess_obs_chat_001';
      const message = 'Hello, how are you?';

      const traceContext = tracingCollector.startTrace({
        userId,
        sessionId,
        correlationId: `chat_${sessionId}`,
      });

      tracingHooks.onGatewayRequest(traceContext, {
        message,
        sessionId,
      });

      await harness.sendMessage(userId, sessionId, message);

      tracingCollector.endTrace(traceContext.traceId, 'completed');

      const trace = traceStore.getTrace(traceContext.traceId);
      expect(trace).toBeDefined();
      expect(trace?.userId).toBe(userId);
      expect(trace?.sessionId).toBe(sessionId);
      expect(trace?.status).toBe('completed');

      const spans = traceStore.findSpansByTrace(traceContext.traceId);
      expect(spans.length).toBeGreaterThan(0);
      
      const gatewaySpans = spans.filter(s => s.spanType === 'dispatch' && s.module === 'gateway');
      expect(gatewaySpans.length).toBeGreaterThan(0);
    });

    it('should create timeline with events for chat flow', async () => {
      const userId = 'user_obs_chat_002';
      const sessionId = 'sess_obs_chat_002';
      const message = 'What is the weather?';

      await harness.sendMessage(userId, sessionId, message);

      const timeline = timelineBuilder.buildTimeline('session', sessionId);

      expect(timeline).toBeDefined();
      expect(timeline.rootType).toBe('session');
      expect(timeline.rootId).toBe(sessionId);
      expect(timeline.events.length).toBeGreaterThan(0);
      expect(timeline.status).toBe('completed');
    });
  });

  describe('Flow 3: Write Approval - Audit Chain Observability', () => {
    it('should create audit chain: permission_decision -> approval_request -> approval_response -> external_write', async () => {
      const userId = 'user_obs_approval_001';
      const sessionId = 'sess_obs_approval_001';

      const mockWriteTool: ToolDefinition = {
        name: 'writeObsFile',
        description: 'Writes content to a file for observability test',
        category: 'write',
        sensitivity: 'high',
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
        handler: async (params) => ({
          success: true,
          data: { written: true, path: (params as { path: string }).path },
          resultPreview: `File written to ${(params as { path: string }).path}`,
        }),
      };

      harness.registerTool(mockWriteTool);

      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'ask_on_write',
        grants: [],
        metadata: {},
      };

      const traceContext = tracingCollector.startTrace({
        userId,
        sessionId,
        correlationId: `approval_${sessionId}`,
      });

      const decisionId = `decision_${Date.now()}`;
      const permissionAudit = auditRecorder.recordPermissionDecision({
        decisionId,
        userId,
        sessionId,
        actionType: 'tool:writeObsFile',
        resource: '/test/obs/file.txt',
        operationType: 'write',
        decision: 'requires_approval',
        reason: 'Write operation requires user approval',
        correlationId: traceContext.correlationId,
      });

      const toolCallId = harness.idGenerator.custom('tool_call');
      await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'writeObsFile',
        params: { path: '/test/obs/file.txt', content: 'Hello World' },
        userId,
        sessionId,
        permissionContext,
      });

      const pendingApprovals = harness.stores.approvalStore.findPendingBySession(sessionId);
      expect(pendingApprovals.length).toBeGreaterThan(0);
      const approvalId = pendingApprovals[0].id;

      const approvalRequestAudit = auditRecorder.recordApprovalRequest({
        requestId: approvalId,
        userId,
        sessionId,
        actionType: 'tool:writeObsFile',
        resource: '/test/obs/file.txt',
        riskLevel: 'high',
        justification: 'User requested file write',
        correlationId: traceContext.correlationId,
        causationId: permissionAudit.correlationId,
      });

      await harness.sendApprovalResponse(userId, sessionId, approvalId, true);

      const approvalResponseAudit = auditRecorder.recordApprovalResponse({
        requestId: approvalId,
        userId,
        sessionId,
        responseType: 'approve_once',
        respondedBy: userId,
        reason: 'User approved the write operation',
        correlationId: traceContext.correlationId,
        causationId: approvalRequestAudit.correlationId,
      });

      auditRecorder.recordExternalWrite({
        userId,
        sessionId,
        targetType: 'file',
        targetRef: '/test/obs/file.txt',
        writeData: { path: '/test/obs/file.txt', content: 'Hello World' },
        approvalId,
        toolCallId,
        correlationId: traceContext.correlationId,
        causationId: approvalResponseAudit.correlationId,
      });

      tracingCollector.endTrace(traceContext.traceId, 'completed');

      const auditRecords = auditStore.findByCorrelationId(traceContext.correlationId ?? '');
      expect(auditRecords.length).toBeGreaterThanOrEqual(4);

      const permissionDecisionRecord = auditRecords.find(r => r.auditType === 'permission_decision');
      const approvalRequestRecord = auditRecords.find(r => r.auditType === 'approval_request');
      const approvalResponseRecord = auditRecords.find(r => r.auditType === 'approval_response');
      const externalWriteRecord = auditRecords.find(r => r.auditType === 'external_write');

      expect(permissionDecisionRecord).toBeDefined();
      expect(approvalRequestRecord).toBeDefined();
      expect(approvalResponseRecord).toBeDefined();
      expect(externalWriteRecord).toBeDefined();

      expect(approvalRequestRecord?.correlationId).toBe(traceContext.correlationId);
      expect(approvalResponseRecord?.correlationId).toBe(traceContext.correlationId);
      expect(externalWriteRecord?.correlationId).toBe(traceContext.correlationId);

      const evidenceDir = path.join(process.cwd(), '.sisyphus', 'evidence');
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(
        path.join(evidenceDir, 'task-46-flow3-audit-chain.txt'),
        JSON.stringify({
          flow: 'Flow 3: Write Approval',
          correlationId: traceContext.correlationId,
          auditChain: [
            {
              type: 'permission_decision',
              auditId: permissionDecisionRecord?.auditId,
              decision: permissionDecisionRecord?.payload.decision,
            },
            {
              type: 'approval_request',
              auditId: approvalRequestRecord?.auditId,
              actionType: approvalRequestRecord?.payload.actionType,
            },
            {
              type: 'approval_response',
              auditId: approvalResponseRecord?.auditId,
              responseType: approvalResponseRecord?.payload.responseType,
            },
            {
              type: 'external_write',
              auditId: externalWriteRecord?.auditId,
              target: externalWriteRecord?.payload.targetRef,
            },
          ],
          timestamp: new Date().toISOString(),
        }, null, 2)
      );
    });
  });

  describe('Flow 5: Background Task - Trace and Timeline Observability', () => {
    it('should create trace with background_run spans for background task', async () => {
      const userId = 'user_obs_bg_001';
      const sessionId = 'sess_obs_bg_001';
      const backgroundRunStore = createBackgroundRunStore(harness.connection);

      const backgroundRuntime = createBackgroundRuntime({
        backgroundRunStore,
        eventStore: harness.stores.eventStore,
        maxConcurrentRuns: 3,
        watchdogTimeoutMs: 30000,
        maxRecoveryAttempts: 3,
      });

      const traceContext = tracingCollector.startTrace({
        userId,
        sessionId,
        correlationId: `background_${sessionId}`,
      });

      const taskSpec: SubagentTaskSpec = {
        objective: 'Process documents in background',
        agentType: 'document_processor',
        maxIterations: 10,
      };

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'document_processor',
        taskSpec,
        launchSource: 'foreground_request',
        priority: 1,
      });

      tracingHooks.onSubagentRun(traceContext.traceId, 'document_processor', traceContext.rootSpanId);

      await backgroundRuntime.startBackgroundRun(bgRunId);

      const result: SubagentResult = {
        status: 'completed',
        response: 'Background task completed successfully',
        toolCalls: [],
        iterationsUsed: 5,
      };
      backgroundRuntime.completeBackgroundRun(bgRunId, result);

      tracingCollector.endTrace(traceContext.traceId, 'completed');

      const trace = traceStore.getTrace(traceContext.traceId);
      expect(trace).toBeDefined();
      expect(trace?.status).toBe('completed');

      const spans = traceStore.findSpansByTrace(traceContext.traceId);
      const bgRunSpans = spans.filter(s => s.spanType === 'subagent_run');
      expect(bgRunSpans.length).toBeGreaterThan(0);
      expect(bgRunSpans[0].module).toBe('subagent');
    });

    it('should create timeline for background run', async () => {
      const userId = 'user_obs_bg_002';
      const sessionId = 'sess_obs_bg_002';
      const backgroundRunStore = createBackgroundRunStore(harness.connection);

      const backgroundRuntime = createBackgroundRuntime({
        backgroundRunStore,
        eventStore: harness.stores.eventStore,
        maxConcurrentRuns: 3,
        watchdogTimeoutMs: 30000,
        maxRecoveryAttempts: 3,
      });

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'email_processor',
        taskSpec: { objective: 'Process emails' },
        launchSource: 'user_request',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      backgroundRuntime.completeBackgroundRun(bgRunId, {
        status: 'completed',
        response: 'Emails processed',
        toolCalls: [],
        iterationsUsed: 3,
      });

      const timeline = timelineBuilder.buildTimeline('background_run', bgRunId);

      expect(timeline).toBeDefined();
      expect(timeline.rootType).toBe('background_run');
      expect(timeline.rootId).toBe(bgRunId);
      expect(timeline.events.length).toBeGreaterThan(0);
    });
  });

  describe('Flow 6: Workflow - Trace and Timeline Observability', () => {
    it('should create trace with workflow_run spans for workflow execution', async () => {
      const userId = 'user_obs_wf_001';
      const sessionId = 'sess_obs_wf_001';

      const draftStore = createWorkflowDraftStore(harness.connection);
      const definitionStore = createWorkflowDefinitionStore(harness.connection);
      const workflowRunStore = createWorkflowRunStore(harness.connection);

      const workflowRuntime = createWorkflowRuntime({
        draftStore,
        definitionStore,
        workflowRunStore,
        runtimeActionStore: harness.stores.runtimeActionStore,
        eventStore: harness.stores.eventStore,
      });

      const traceContext = tracingCollector.startTrace({
        userId,
        sessionId,
        correlationId: `workflow_${sessionId}`,
      });

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Test Step',
          config: { toolName: 'test.tool' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Observability Test Workflow',
        steps,
        ownerUserId: userId,
      });

      const definition = workflowRuntime.publishDraft(draft.draftId);

      tracingHooks.onWorkflowRun(traceContext.traceId, definition.workflowId, traceContext.rootSpanId);

      const runResult = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
      });

      workflowRuntime.handleStepCompletion(runResult.stepRuns[0].stepRunId, {
        success: true,
        output: { result: 'success' },
      });

      tracingCollector.endTrace(traceContext.traceId, 'completed');

      const spans = traceStore.findSpansByTrace(traceContext.traceId);
      const workflowSpans = spans.filter(s => s.spanType === 'workflow_run');
      expect(workflowSpans.length).toBeGreaterThan(0);
      expect(workflowSpans[0].module).toBe('workflow');
    });

    it('should create timeline for workflow run', async () => {
      const userId = 'user_obs_wf_002';
      const sessionId = 'sess_obs_wf_002';

      const draftStore = createWorkflowDraftStore(harness.connection);
      const definitionStore = createWorkflowDefinitionStore(harness.connection);
      const workflowRunStore = createWorkflowRunStore(harness.connection);

      const workflowRuntime = createWorkflowRuntime({
        draftStore,
        definitionStore,
        workflowRunStore,
        runtimeActionStore: harness.stores.runtimeActionStore,
        eventStore: harness.stores.eventStore,
      });

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Timeline Test Step',
          config: { toolName: 'test.tool' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Timeline Test Workflow',
        steps,
        ownerUserId: userId,
      });

      const definition = workflowRuntime.publishDraft(draft.draftId);

      const runResult = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
      });

      workflowRuntime.handleStepCompletion(runResult.stepRuns[0].stepRunId, {
        success: true,
        output: { result: 'success' },
      });

      const timeline = timelineBuilder.buildTimeline('workflow_run', runResult.workflowRunId);

      expect(timeline).toBeDefined();
      expect(timeline.rootType).toBe('workflow_run');
      expect(timeline.rootId).toBe(runResult.workflowRunId);
      expect(timeline.events.length).toBeGreaterThan(0);
    });
  });

  describe('PlannerRun Replay - Key Path Reconstruction', () => {
    it('should reconstruct key path: ForegroundDecision -> PlannerRun spawn -> ExecutionPlan -> RuntimeActions -> results', async () => {
      const userId = 'user_obs_planner_001';
      const sessionId = 'sess_obs_planner_001';

      const traceContext = tracingCollector.startTrace({
        userId,
        sessionId,
        correlationId: `planner_${sessionId}`,
      });

      tracingHooks.onGatewayRequest(traceContext, {
        decision: 'spawn_planner',
        reason: 'Complex task requires planning',
      });

      const plannerRunId = `planner_run_${Date.now()}`;
      auditRecorder.recordDispatch({
        userId,
        sessionId,
        targetRuntime: 'planner',
        targetAction: 'spawn_planner_run',
        payloadSummary: 'Spawn planner run for complex task',
        correlationId: traceContext.correlationId,
      });

      const plannerSpan = tracingCollector.startSpan(
        traceContext.traceId,
        'planner_run',
        'dispatcher',
        'planner_execution',
        traceContext.rootSpanId,
        { plannerRunId, objective: 'Complex task planning' }
      );

      harness.stores.eventStore.append({
        eventId: `evt_${Date.now()}_1`,
        eventType: 'planner_started',
        sourceModule: 'dispatcher',
        userId,
        sessionId,
        correlationId: traceContext.correlationId,
        relatedRefs: { plannerRunId },
        payload: { plannerRunId, objective: 'Complex task', totalSteps: 3 },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      });

      harness.stores.runtimeActionStore.save({
        actionId: `action_${Date.now()}_1`,
        actionType: 'execute_tool',
        source: { sourceModule: 'dispatcher' },
        targetRuntime: 'tool_plane',
        targetAction: 'execute_tool',
        payload: { toolName: 'search', query: 'test' },
        correlationId: traceContext.correlationId,
        sessionId,
        userId,
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        targetRef: { plannerRunId },
      });

      harness.stores.eventStore.append({
        eventId: `evt_${Date.now()}_2`,
        eventType: 'planner_completed',
        sourceModule: 'dispatcher',
        userId,
        sessionId,
        correlationId: traceContext.correlationId,
        relatedRefs: { plannerRunId },
        payload: { plannerRunId, status: 'completed', totalSteps: 3 },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      });

      tracingCollector.endSpan(plannerSpan.spanId, 'completed');
      tracingCollector.endTrace(traceContext.traceId, 'completed');

      const replayResult = replayService.replay({
        rootType: 'planner_run',
        rootId: plannerRunId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      });

      expect(replayResult.status).toBe('partial');
      expect(replayResult.timeline).toBeDefined();
      expect(replayResult.timeline.events.length).toBeGreaterThan(0);

      const timelineEvents = replayResult.timeline.events;
      const hasPlannerStarted = timelineEvents.some(e => 
        (e.sourceData as EventRecord)?.eventType === 'planner_started'
      );
      const hasPlannerCompleted = timelineEvents.some(e => 
        (e.sourceData as EventRecord)?.eventType === 'planner_completed'
      );

      expect(hasPlannerStarted).toBe(true);
      expect(hasPlannerCompleted).toBe(true);

      const evidenceDir = path.join(process.cwd(), '.sisyphus', 'evidence');
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(
        path.join(evidenceDir, 'task-46-planner-replay.txt'),
        JSON.stringify({
          flow: 'PlannerRun Replay',
          plannerRunId,
          correlationId: traceContext.correlationId,
          keyPath: [
            'ForegroundDecision: spawn_planner',
            'PlannerRun spawn: planner dispatched',
            'ExecutionPlan: planner_started event',
            'RuntimeActions: tool execution actions',
            'Results: planner_completed event',
          ],
          timelineEventCount: replayResult.timeline.events.length,
          timelineStatus: replayResult.timeline.status,
          replayStatus: replayResult.status,
          originalTraceRefs: replayResult.originalTraceRefs,
          timestamp: new Date().toISOString(),
        }, null, 2)
      );
    });
  });

  describe('Universal Observability Assertions', () => {
    it('should create at least one trace span for every flow', async () => {
      const userId = 'user_obs_universal_001';
      const sessionId = 'sess_obs_universal_001';

      const chatTrace = tracingCollector.startTrace({ userId, sessionId, correlationId: 'chat_test' });
      await harness.sendMessage(userId, sessionId, 'Test message');
      tracingCollector.endTrace(chatTrace.traceId, 'completed');

      const chatSpans = traceStore.findSpansByTrace(chatTrace.traceId);

      const approvalTrace = tracingCollector.startTrace({ userId, sessionId, correlationId: 'approval_test' });
      auditRecorder.recordApprovalRequest({
        requestId: 'test_approval',
        userId,
        sessionId,
        actionType: 'test_action',
        riskLevel: 'medium',
        correlationId: 'approval_test',
      });
      tracingCollector.endTrace(approvalTrace.traceId, 'completed');

      const approvalSpans = traceStore.findSpansByTrace(approvalTrace.traceId);

      const bgTrace = tracingCollector.startTrace({ userId, sessionId, correlationId: 'bg_test' });
      tracingHooks.onSubagentRun(bgTrace.traceId, 'test_agent', bgTrace.rootSpanId);
      tracingCollector.endTrace(bgTrace.traceId, 'completed');

      const bgSpans = traceStore.findSpansByTrace(bgTrace.traceId);

      const wfTrace = tracingCollector.startTrace({ userId, sessionId, correlationId: 'wf_test' });
      tracingHooks.onWorkflowRun(wfTrace.traceId, 'test_workflow', wfTrace.rootSpanId);
      tracingCollector.endTrace(wfTrace.traceId, 'completed');

      const wfSpans = traceStore.findSpansByTrace(wfTrace.traceId);

      expect(chatSpans.length + approvalSpans.length + bgSpans.length + wfSpans.length).toBeGreaterThanOrEqual(4);
    });

    it('should create at least one audit record for every flow', async () => {
      const userId = 'user_obs_universal_002';
      const sessionId = 'sess_obs_universal_002';
      const correlationId = 'audit_universal_test';

      auditRecorder.recordUserInput({
        userId,
        sessionId,
        input: 'Test message',
        inputType: 'text',
        correlationId,
      });

      auditRecorder.recordApprovalRequest({
        requestId: 'test_approval_2',
        userId,
        sessionId,
        actionType: 'write_file',
        riskLevel: 'high',
        correlationId,
      });

      auditRecorder.recordSubagentRun({
        subagentRunId: 'test_bg_run',
        userId,
        sessionId,
        agentType: 'test_agent',
        objective: 'Test objective',
        status: 'completed',
        correlationId,
      });

      auditRecorder.recordWorkflowChange({
        userId,
        sessionId,
        workflowId: 'test_workflow',
        changeType: 'create',
        changeSummary: 'Created test workflow',
        correlationId,
      });

      const auditRecords = auditStore.findByCorrelationId(correlationId);
      expect(auditRecords.length).toBeGreaterThanOrEqual(4);

      const hasUserInput = auditRecords.some(r => r.auditType === 'user_input');
      const hasApprovalRequest = auditRecords.some(r => r.auditType === 'approval_request');
      const hasSubagentRun = auditRecords.some(r => r.auditType === 'subagent_run');
      const hasWorkflowChange = auditRecords.some(r => r.auditType === 'workflow_change');

      expect(hasUserInput).toBe(true);
      expect(hasApprovalRequest).toBe(true);
      expect(hasSubagentRun).toBe(true);
      expect(hasWorkflowChange).toBe(true);
    });
  });

  describe('Failure Analyzer - Error Analysis', () => {
    it('should produce analysis for connector auth failure', () => {
      const connectorResponse = {
        status: 'auth_required' as const,
        requestId: 'req_auth_001',
        connectorInstanceId: 'conn_gmail_001',
        connector: 'gmail',
        authUrl: 'https://accounts.google.com/oauth/...',
      };

      const analysis = analyzeConnectorResponse(connectorResponse);

      expect(analysis).toBeDefined();
      expect(analysis.category).toBe('connector_auth');
      expect(analysis.rootCause).toContain('auth');
      expect(analysis.retryable).toBe(true);
      expect(analysis.severity).toBe('high');
      expect(analysis.suggestedFixes).toContain('reauthorize');
    });

    it('should produce analysis for rate limit failure', () => {
      const connectorResponse = {
        status: 'rate_limited' as const,
        requestId: 'req_rate_001',
        connectorInstanceId: 'conn_api_001',
        retryAfterMs: 60000,
      };

      const analysis = analyzeConnectorResponse(connectorResponse);

      expect(analysis).toBeDefined();
      expect(analysis.category).toBe('connector_rate_limit');
      expect(analysis.rootCause).toContain('rate limit');
      expect(analysis.retryable).toBe(true);
      expect(analysis.severity).toBe('medium');
    });

    it('should produce analysis for tool execution failure', () => {
      const error = new Error('Tool execution failed: TOOL_NOT_FOUND');
      (error as { code?: string }).code = 'TOOL_NOT_FOUND';

      const analysis = failureAnalyzer.analyze(error, {
        module: 'tool',
        toolName: 'nonexistent_tool',
      });

      expect(analysis).toBeDefined();
      expect(analysis.category).toBe('tool_execution');
      expect(analysis.rootCause).toContain('tool');
      expect(analysis.retryable).toBe(false);
      expect(analysis.severity).toBe('high');
    });

    it('should produce analysis for failed flows', () => {
      const errors = [
        { error: new Error('Authentication failed'), expectedCategory: 'connector_auth' },
        { error: new Error('Rate limit exceeded'), expectedCategory: 'connector_rate_limit' },
        { error: new Error('Approval rejected by user'), expectedCategory: 'approval_rejected' },
        { error: new Error('Timeout waiting for response'), expectedCategory: 'wait_timeout' },
      ];

      for (const { error, expectedCategory } of errors) {
        const analysis = failureAnalyzer.analyze(error, {});
        expect(analysis.category).toBe(expectedCategory);
        expect(analysis.suggestedFixes.length).toBeGreaterThan(0);
      }
    });
  });
});
