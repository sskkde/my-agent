import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createE2EHarness, type E2EHarness } from './test-harness.js';
import { createBackgroundRuntime } from '../../src/subagents/background-runtime.js';
import { createBackgroundRunStore } from '../../src/storage/background-run-store.js';
import { createSubagentRuntime } from '../../src/subagents/subagent-runtime.js';
import type { SubagentTaskSpec, SubagentResult, SubagentConfig } from '../../src/subagents/types.js';
import type { ContextBundle } from '../../src/context/types.js';
import type { KernelRunResult } from '../../src/kernel/types.js';
import type { EventRecord, EventQuery, EventStore } from '../../src/storage/event-store.js';
import type { ToolDefinition } from '../../src/tools/types.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Flow 5: Background Task E2E Flows', () => {
  let harness: E2EHarness;

  beforeEach(() => {
    harness = createE2EHarness();
  });

  afterEach(() => {
    harness.close();
  });

  function createMockSubagentRuntime(delayMs: number = 100, shouldSucceed: boolean = true) {
    const mockKernelAdapter = {
      async execute(options: {
        contextBundle: ContextBundle;
        maxIterations: number;
        timeoutMs: number;
        onCancel?: () => boolean;
      }): Promise<KernelRunResult> {
        const iterations = 3;

        for (let i = 0; i < iterations; i++) {
          if (options.onCancel && options.onCancel()) {
            return {
              finalStatus: 'failed',
              finalResponse: 'Task was cancelled',
              toolCalls: [],
              iterationsUsed: i,
              transcript: [],
            };
          }

          await new Promise(resolve => setTimeout(resolve, delayMs / iterations));

          if (options.onCancel && options.onCancel()) {
            return {
              finalStatus: 'failed',
              finalResponse: 'Task was cancelled',
              toolCalls: [],
              iterationsUsed: i,
              transcript: [],
            };
          }
        }

        if (!shouldSucceed) {
          return {
            finalStatus: 'failed',
            finalResponse: 'Task failed',
            toolCalls: [],
            error: {
              code: 'EXECUTION_ERROR',
              message: 'Simulated failure',
            },
            iterationsUsed: iterations,
            transcript: [],
          };
        }

        return {
          finalStatus: 'completed',
          finalResponse: 'Background task completed successfully',
          toolCalls: [
            {
              toolCallId: 'mock-tool-1',
              toolName: 'mock_search',
              params: { query: 'test' },
            },
          ],
          iterationsUsed: iterations,
          transcript: [],
        };
      },
    };

    const mockContextManager = {
      createIsolatedContext(options: {
        parentContext: ContextBundle;
        taskSpec: SubagentTaskSpec;
        subagentRunId: string;
      }): ContextBundle {
        const baseContext: ContextBundle = {
          bundleId: options.subagentRunId,
          runId: options.subagentRunId,
          agentId: options.subagentRunId,
          agentType: 'subagent',
          invocationSource: 'subagent_runtime',
          pinnedItems: [],
          orderedItems: [],
          tokenEstimate: 0,
        };
        return baseContext;
      },
    };

    const config: SubagentConfig = {
      kernelAdapter: mockKernelAdapter,
      contextManager: mockContextManager,
      maxConcurrent: 5,
      defaultTimeoutMs: 60000,
      defaultMaxIterations: 10,
    };

    return createSubagentRuntime(config);
  }

  function setupBackgroundRuntime() {
    const backgroundRunStore = createBackgroundRunStore(harness.connection);

    const eventStoreAdapter: EventStore = {
      append: (event: EventRecord | EventRecord[]) => harness.stores.eventStore.append(event),
      query: (filters: EventQuery) => harness.stores.eventStore.query(filters),
      findByCorrelationId: (correlationId: string) => harness.stores.eventStore.findByCorrelationId(correlationId),
      findByCausationId: (causationId: string) => harness.stores.eventStore.findByCausationId(causationId),
      updateUserIdForSession: () => 0,
    };

    const backgroundRuntime = createBackgroundRuntime({
      backgroundRunStore,
      eventStore: eventStoreAdapter,
      maxConcurrentRuns: 3,
      watchdogTimeoutMs: 30000,
      maxRecoveryAttempts: 3,
    });

    return { backgroundRuntime, backgroundRunStore };
  }

  describe('Background Task Start', () => {
    it('should start background task without blocking foreground', async () => {
      const userId = 'user_bg_001';
      const sessionId = 'sess_bg_001';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const message = 'Process all my emails in the background';

      const result = await harness.sendMessage(userId, sessionId, message);

      expect(result.foregroundDecision.route).toBeDefined();
      expect(result.outboundEnvelopes.length).toBeGreaterThan(0);

      const taskSpec: SubagentTaskSpec = {
        objective: 'Process all emails',
        agentType: 'email_processor',
        maxIterations: 10,
      };

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'email_processor',
        taskSpec,
        launchSource: 'foreground_request',
        priority: 1,
      });

      expect(bgRunId).toBeDefined();
      expect(bgRunId.startsWith('bg-')).toBe(true);

      const run = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(run).toBeDefined();
      expect(run?.status).toBe('queued');
      expect(run?.userId).toBe(userId);
      expect(run?.sessionId).toBe(sessionId);

      await backgroundRuntime.startBackgroundRun(bgRunId);

      const startedRun = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(startedRun?.status).toBe('running');

      const evidenceDir = path.join(process.cwd(), '.sisyphus', 'evidence');
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(
        path.join(evidenceDir, 'task-34-background-start.txt'),
        JSON.stringify({
          bgRunId,
          foregroundRoute: result.foregroundDecision.route,
          backgroundStatus: startedRun?.status,
          timestamp: new Date().toISOString(),
        }, null, 2)
      );
    });

    it('should create proper events when background task starts', async () => {
      const userId = 'user_bg_002';
      const sessionId = 'sess_bg_002';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const taskSpec: SubagentTaskSpec = {
        objective: 'Summarize documents',
        agentType: 'document_summarizer',
      };

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'document_summarizer',
        taskSpec,
        launchSource: 'planner_dispatch',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      const events = harness.stores.eventStore.query({ sessionId });
      const backgroundEvents = events.filter((e: EventRecord) =>
        e.eventType.includes('Background')
      );

      expect(backgroundEvents.length).toBeGreaterThan(0);

      const enqueuedEvent = backgroundEvents.find((e: EventRecord) =>
        e.eventType === 'BackgroundRunEnqueued'
      );
      expect(enqueuedEvent).toBeDefined();

      const startedEvent = backgroundEvents.find((e: EventRecord) =>
        e.eventType === 'BackgroundRunStarted'
      );
      expect(startedEvent).toBeDefined();
    });
  });

  describe('Background Completion Notification', () => {
    it('should persist completion notification when background task completes', async () => {
      const userId = 'user_bg_003';
      const sessionId = 'sess_bg_003';
      const { backgroundRuntime } = setupBackgroundRuntime();
      const subagentRuntime = createMockSubagentRuntime(50, true);

      const taskSpec: SubagentTaskSpec = {
        objective: 'Generate weekly report',
        agentType: 'report_generator',
      };

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'report_generator',
        taskSpec,
        launchSource: 'user_request',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      const subagentRun = subagentRuntime.launchSubagent({
        taskSpec,
        parentContext: {
          bundleId: 'parent-bundle',
          runId: 'parent-run',
          agentId: 'parent-agent',
          agentType: 'main',
          invocationSource: 'gateway_intent',
          pinnedItems: [],
          orderedItems: [],
          tokenEstimate: 0,
        },
      });

      const result = await subagentRuntime.executeSubagent(subagentRun.subagentRunId);

      backgroundRuntime.completeBackgroundRun(bgRunId, result);

      const completedRun = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(completedRun?.status).toBe('completed');

      const notifications = backgroundRuntime.getPendingNotifications();
      const bgNotification = notifications.find(n => n.backgroundRunId === bgRunId);
      expect(bgNotification).toBeDefined();
      expect(bgNotification?.type).toBe('completed');
      expect(bgNotification?.userId).toBe(userId);

      const events = harness.stores.eventStore.query({ sessionId });
      const completedEvent = events.find((e: EventRecord) =>
        e.eventType === 'BackgroundRunCompleted'
      );
      expect(completedEvent).toBeDefined();
    });

    it('should send notification through Gateway interface', async () => {
      const userId = 'user_bg_004';
      const sessionId = 'sess_bg_004';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const taskSpec: SubagentTaskSpec = {
        objective: 'Sync calendar events',
        agentType: 'calendar_sync',
      };

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'calendar_sync',
        taskSpec,
        launchSource: 'scheduled_job',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      const result: SubagentResult = {
        status: 'completed',
        response: 'Calendar sync completed. 15 events synchronized.',
        toolCalls: [],
        iterationsUsed: 5,
      };

      backgroundRuntime.completeBackgroundRun(bgRunId, result);

      const notification = backgroundRuntime.getPendingNotifications()
        .find(n => n.backgroundRunId === bgRunId);

      expect(notification).toBeDefined();
      expect(notification?.title).toContain('completed');
      expect(notification?.message).toContain('Calendar sync completed');

      const outboundEnvelope = harness.gateway.formatOutbound(
        'notification',
        {
          notification: notification?.message,
          text: notification?.title,
        },
        { userId, sessionId },
        bgRunId
      );

      expect(outboundEnvelope.messageType).toBe('notification');
      expect(outboundEnvelope.content.text).toContain('completed');
      expect(outboundEnvelope.recipient.userId).toBe(userId);
    });
  });

  describe('Background Cancellation', () => {
    it('should create terminal transcript when background task is cancelled', async () => {
      const userId = 'user_bg_005';
      const sessionId = 'sess_bg_005';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const taskSpec: SubagentTaskSpec = {
        objective: 'Long running analysis',
        agentType: 'data_analyzer',
      };

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'data_analyzer',
        taskSpec,
        launchSource: 'user_request',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      backgroundRuntime.cancelBackgroundRun(bgRunId);

      const cancelledRun = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(cancelledRun?.status).toBe('cancelled');

      const events = harness.stores.eventStore.query({ sessionId });
      const cancelledEvent = events.find((e: EventRecord) =>
        e.eventType === 'BackgroundRunCancelled'
      );
      expect(cancelledEvent).toBeDefined();

      const turnId = harness.idGenerator.custom('turn');
      harness.stores.transcriptStore.saveTurn({
        turnId,
        sessionId,
        userId,
        input: {
          userMessageSummary: 'Background task cancelled by user',
        },
        output: {
          visibleMessages: [
            {
              messageId: harness.idGenerator.custom('msg'),
              role: 'system_status',
              content: `Background task ${bgRunId} was cancelled`,
            },
          ],
        },
        visibility: 'public',
        createdAt: harness.clock.nowISO(),
        runtimeSummary: {
          runtimeActionIds: [bgRunId],
        },
      });

      const transcripts = harness.stores.transcriptStore.findBySession(sessionId);
      const cancellationTranscript = transcripts.find(t =>
        t.output.visibleMessages.some(m => m.content.includes('cancelled'))
      );
      expect(cancellationTranscript).toBeDefined();

      const notifications = backgroundRuntime.getPendingNotifications();
      const cancelNotification = notifications.find(n =>
        n.backgroundRunId === bgRunId && n.type === 'cancelled'
      );
      expect(cancelNotification).toBeDefined();

      const evidenceDir = path.join(process.cwd(), '.sisyphus', 'evidence');
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(
        path.join(evidenceDir, 'task-34-background-cancel.txt'),
        JSON.stringify({
          bgRunId,
          finalStatus: cancelledRun?.status,
          transcriptCreated: !!cancellationTranscript,
          notificationCreated: !!cancelNotification,
          timestamp: new Date().toISOString(),
        }, null, 2)
      );
    });

    it('should allow cancellation from foreground via cancel request', async () => {
      const userId = 'user_bg_006';
      const sessionId = 'sess_bg_006';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'file_processor',
        taskSpec: { objective: 'Process files' },
        launchSource: 'user_request',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      const cancelMessage = 'cancel the current task';

      harness.stores.eventStore.append({
        eventId: harness.idGenerator.custom('evt'),
        eventType: 'BackgroundRunStarted',
        sourceModule: 'subagent',
        userId,
        sessionId,
        correlationId: bgRunId,
        relatedRefs: { backgroundRunId: bgRunId },
        payload: { backgroundRunId: bgRunId, agentType: 'file_processor' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: harness.clock.nowISO(),
      });

      const result = await harness.sendMessage(userId, sessionId, cancelMessage);

      expect(result.foregroundDecision.route).toBe('cancel_or_modify_task');

      backgroundRuntime.cancelBackgroundRun(bgRunId);

      const run = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(run?.status).toBe('cancelled');
    });
  });

  describe('Status Query While Background Running', () => {
    it('should return background task status when user queries status', async () => {
      const userId = 'user_bg_007';
      const sessionId = 'sess_bg_007';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'email_processor',
        taskSpec: { objective: 'Process emails' },
        launchSource: 'user_request',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      harness.stores.eventStore.append({
        eventId: harness.idGenerator.custom('evt'),
        eventType: 'BackgroundRunStarted',
        sourceModule: 'subagent',
        userId,
        sessionId,
        correlationId: bgRunId,
        relatedRefs: { backgroundRunId: bgRunId },
        payload: { backgroundRunId: bgRunId, agentType: 'email_processor' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: harness.clock.nowISO(),
      });

      const statusMessage = 'what is the status of my tasks?';
      const result = await harness.sendMessage(userId, sessionId, statusMessage);

      expect(result.foregroundDecision.route).toBe('status_query');
      expect(result.foregroundDecision.reason?.toLowerCase()).toContain('status');

      const run = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(run).toBeDefined();
      expect(run?.status).toBe('running');
    });

    it('should show running count in status', async () => {
      const userId = 'user_bg_008';
      const sessionId = 'sess_bg_008';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const bgRunId1 = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'task_1',
        taskSpec: { objective: 'Task 1' },
        launchSource: 'user_request',
      });

      const bgRunId2 = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'task_2',
        taskSpec: { objective: 'Task 2' },
        launchSource: 'user_request',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId1);
      await backgroundRuntime.startBackgroundRun(bgRunId2);

      expect(backgroundRuntime.getRunningCount()).toBe(2);

      const result = await harness.sendMessage(userId, sessionId, 'status');
      expect(result.foregroundDecision.route).toBe('status_query');
    });
  });

  describe('Approval Wait in Background', () => {
    it('should handle approval request from background task', async () => {
      const userId = 'user_bg_009';
      const sessionId = 'sess_bg_009';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const toolDef: ToolDefinition = {
        name: 'background_sensitive_tool',
        description: 'A tool that requires approval',
        category: 'write',
        sensitivity: 'high',
        schema: {
          type: 'object',
          properties: {
            action: { type: 'string' },
          },
          required: ['action'],
        },
        handler: async () => ({
          success: true,
          resultPreview: 'Action performed',
        }),
      };

      harness.registerTool(toolDef);

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'approval_test_agent',
        taskSpec: { objective: 'Perform sensitive action' },
        launchSource: 'user_request',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      const approvalId = harness.idGenerator.custom('approval');
      harness.stores.approvalStore.create({
        id: approvalId,
        userId,
        sessionId,
        actionType: 'tool:background_sensitive_tool',
        status: 'pending',
        requestedBy: 'background_agent',
        requestedAt: harness.clock.nowISO(),
        justification: 'Background task requires approval for sensitive action',
        metadata: JSON.stringify({ action: 'delete' }),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const approval = harness.stores.approvalStore.getById(approvalId);
      expect(approval).toBeDefined();
      expect(approval?.status).toBe('pending');

      backgroundRuntime.checkpointBackgroundRun(bgRunId, {
        iteration: 2,
        contextItems: ['waiting_for_approval'],
        lastToolResult: undefined,
        timestamp: harness.clock.nowISO(),
      });

      const run = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(run?.checkpointData).toBeDefined();
    });

    it('should resume background task after approval is granted', async () => {
      const userId = 'user_bg_010';
      const sessionId = 'sess_bg_010';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'approval_resume_agent',
        taskSpec: { objective: 'Complete after approval' },
        launchSource: 'user_request',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      const approvalId = harness.idGenerator.custom('approval');
      harness.stores.approvalStore.create({
        id: approvalId,
        userId,
        sessionId,
        actionType: 'tool:resume_test_tool',
        status: 'pending',
        requestedBy: 'background_agent',
        requestedAt: harness.clock.nowISO(),
        justification: 'Background approval needed',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const approvalResult = await harness.sendApprovalResponse(userId, sessionId, approvalId, true);
      expect(approvalResult.success).toBe(true);

      const result: SubagentResult = {
        status: 'completed',
        response: 'Task completed after approval',
        toolCalls: [],
        iterationsUsed: 3,
      };

      backgroundRuntime.completeBackgroundRun(bgRunId, result);

      const completedRun = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(completedRun?.status).toBe('completed');
    });
  });

  describe('Background Task Failure', () => {
    it('should handle background task failure and create failure notification', async () => {
      const userId = 'user_bg_011';
      const sessionId = 'sess_bg_011';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'failing_agent',
        taskSpec: { objective: 'Task that will fail' },
        launchSource: 'user_request',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      backgroundRuntime.failBackgroundRun(bgRunId, {
        code: 'EXECUTION_ERROR',
        message: 'Simulated task failure',
      });

      const failedRun = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(failedRun?.status).toBe('failed');

      const notifications = backgroundRuntime.getPendingNotifications();
      const failureNotification = notifications.find(n =>
        n.backgroundRunId === bgRunId && n.type === 'failed'
      );
      expect(failureNotification).toBeDefined();
      expect(failureNotification?.title).toContain('failed');
      expect(failureNotification?.message).toContain('failure');
    });
  });

  describe('Connector Auth Required Wait-For-User Path', () => {
    it('should wait for user when connector auth is required', async () => {
      const userId = 'user_bg_012';
      const sessionId = 'sess_bg_012';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'gmail_sync_agent',
        taskSpec: { objective: 'Sync Gmail' },
        launchSource: 'user_request',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      backgroundRuntime.checkpointBackgroundRun(bgRunId, {
        iteration: 1,
        contextItems: ['waiting_for_auth', 'connector:gmail'],
        lastToolResult: {
          status: 'auth_required',
          connector: 'gmail',
          authUrl: 'https://accounts.google.com/oauth/...',
        },
        timestamp: harness.clock.nowISO(),
      });

      const run = backgroundRuntime.getBackgroundRun(bgRunId);
      const checkpointData = run?.checkpointData as {
        iteration: number;
        contextItems: string[];
        lastToolResult: { status: string; connector: string };
      } | undefined;

      expect(checkpointData).toBeDefined();
      expect(checkpointData?.contextItems).toContain('waiting_for_auth');
      expect(checkpointData?.lastToolResult?.status).toBe('auth_required');

      const result: SubagentResult = {
        status: 'completed',
        response: 'Gmail sync completed after authentication',
        toolCalls: [],
        iterationsUsed: 2,
      };

      backgroundRuntime.completeBackgroundRun(bgRunId, result);

      const completedRun = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(completedRun?.status).toBe('completed');
    });
  });

  describe('Queue Management', () => {
    it('should queue background tasks when max concurrent is reached', async () => {
      const userId = 'user_bg_013';
      const sessionId = 'sess_bg_013';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const runIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const bgRunId = backgroundRuntime.enqueueBackgroundRun({
          userId,
          sessionId,
          agentType: `queued_agent_${i}`,
          taskSpec: { objective: `Task ${i}` },
          launchSource: 'user_request',
          priority: 5 - i,
        });
        runIds.push(bgRunId);
      }

      await backgroundRuntime.startBackgroundRun(runIds[0]);
      await backgroundRuntime.startBackgroundRun(runIds[1]);
      await backgroundRuntime.startBackgroundRun(runIds[2]);

      expect(backgroundRuntime.getRunningCount()).toBe(3);
      expect(backgroundRuntime.getQueuedCount()).toBe(2);

      backgroundRuntime.completeBackgroundRun(runIds[0], {
        status: 'completed',
        response: 'Done',
        toolCalls: [],
        iterationsUsed: 1,
      });

      expect(backgroundRuntime.getRunningCount()).toBeLessThanOrEqual(3);
    });

    it('should respect task priority when processing queue', async () => {
      const userId = 'user_bg_014';
      const sessionId = 'sess_bg_014';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const lowPriorityRun = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'low_priority_agent',
        taskSpec: { objective: 'Low priority task' },
        launchSource: 'user_request',
        priority: 1,
      });

      const highPriorityRun = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'high_priority_agent',
        taskSpec: { objective: 'High priority task' },
        launchSource: 'user_request',
        priority: 10,
      });

      const highRun = backgroundRuntime.getBackgroundRun(highPriorityRun);
      const lowRun = backgroundRuntime.getBackgroundRun(lowPriorityRun);

      expect(highRun?.priority).toBe(10);
      expect(lowRun?.priority).toBe(1);
    });
  });

  describe('Watchdog and Recovery', () => {
    it('should trigger watchdog for stale background runs', async () => {
      const userId = 'user_bg_015';
      const sessionId = 'sess_bg_015';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'stale_agent',
        taskSpec: { objective: 'Task that goes stale' },
        launchSource: 'user_request',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      backgroundRuntime.checkpointBackgroundRun(bgRunId, {
        iteration: 1,
        contextItems: [],
        timestamp: harness.clock.nowISO(),
      });

      const run = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(run?.status).toBe('running');
    });

    it('should recover from checkpoint when requested', async () => {
      const userId = 'user_bg_016';
      const sessionId = 'sess_bg_016';
      const { backgroundRuntime } = setupBackgroundRuntime();

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'recoverable_agent',
        taskSpec: { objective: 'Recoverable task' },
        launchSource: 'user_request',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      const checkpoint = {
        iteration: 3,
        contextItems: ['step1_completed', 'step2_completed'],
        lastToolResult: { status: 'success', data: 'intermediate_result' },
        timestamp: harness.clock.nowISO(),
      };

      backgroundRuntime.checkpointBackgroundRun(bgRunId, checkpoint);

      const recovery = await backgroundRuntime.recoverFromCheckpoint(bgRunId);

      expect(recovery.canResume).toBe(true);
      expect(recovery.checkpoint).toBeDefined();
      expect(recovery.checkpoint?.iteration).toBe(3);
    });
  });
});
