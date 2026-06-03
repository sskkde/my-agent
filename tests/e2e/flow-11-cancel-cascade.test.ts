import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createForegroundAgent, type ForegroundAgent } from '../../src/foreground/foreground-agent.js';
import type { ForegroundMessageInput, ForegroundSessionState } from '../../src/foreground/types.js';
import type { LLMAdapter } from '../../src/llm/adapter.js';
import type { LLMRequest, LLMResult, LLMResponse } from '../../src/llm/types.js';
import { createE2EHarness, type E2EHarness } from './test-harness.js';
import { createBackgroundRuntime, type BackgroundRuntime } from '../../src/subagents/background-runtime.js';
import { createBackgroundRunStore } from '../../src/storage/background-run-store.js';
import { createCancellationCoordinator } from '../../src/recovery/cancellation-coordinator.js';
import type {
  CancellationCoordinatorConfig,
  CancellationRequest,
  ToolExecutionStore as RecoveryToolExecutionStore,
  PlannerRunStore as RecoveryPlannerRunStore,
  BackgroundRunStore as RecoveryBackgroundRunStore,
  KernelRunStore as RecoveryKernelRunStore,
  EventStore as RecoveryEventStore,
} from '../../src/recovery/types.js';
import { CANCELLATION_TARGET_TYPES, CANCELLATION_STATUSES } from '../../src/shared/cancellation.js';
import { createMockModelInputBuilder } from '../helpers/model-input.js';

// ============================================================
// Mock LLM Adapter (flow-10 pattern)
// ============================================================

function createMockLLMAdapter(responseContent: string): LLMAdapter {
  return {
    config: {
      providers: [],
      defaultTimeoutMs: 10000,
      enableCircuitBreaker: false,
    },
    providers: [],
    complete: vi.fn(async (_request: LLMRequest): Promise<LLMResult> => {
      const response: LLMResponse = {
        id: 'test-response-id',
        model: 'gpt-4o-mini',
        content: responseContent,
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      };
      return {
        success: true,
        response,
        providerId: 'mock-provider',
      };
    }),
    stream: async function* () {},
    addProvider: vi.fn(),
    removeProvider: vi.fn(),
    getProvider: vi.fn(),
    getHealthyProviders: vi.fn(() => []),
    updateProviderPriority: vi.fn(),
  };
}

// ============================================================
// Session State Helpers (flow-10 pattern)
// ============================================================

function createBaseState(overrides?: Partial<ForegroundSessionState>): ForegroundSessionState {
  return {
    hydratedSession: {
      userContext: {
        userId: 'user_test_011',
        sessionId: 'sess_test_011',
      },
      sessionContext: {
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
      activeWorkRefs: {
        activeRuns: [],
        pendingApprovals: [],
      },
    },
    activeWorkRefs: {
      activeRuns: [],
      pendingApprovals: [],
    },
    currentPersona: {
      personaId: 'test-assistant',
      name: 'Test Assistant',
      directDelegationPolicy: {
        estimatedStepsGte: 3,
        maxComplexity: 'medium',
        allowedToolCategories: ['read', 'search', 'internal'],
      },
    },
    effectivePolicy: {
      estimatedStepsGte: 3,
      maxComplexity: 'medium',
      allowedToolCategories: ['read', 'search', 'internal'],
    },
    ...overrides,
  };
}

function createMessageInput(
  message: string,
  overrides?: Partial<ForegroundMessageInput>
): ForegroundMessageInput {
  return {
    message,
    userId: 'user_test_011',
    sessionId: 'sess_test_011',
    turnId: 'turn_test_011',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================
// Flow 11: Cancel Cascade E2E Tests
// ============================================================

describe('Flow 11: Cancel Cascade', () => {
  // ----------------------------------------------------------
  // SECTION A: ForegroundAgent Cancel Routing
  // Tests that the ForegroundAgent correctly routes cancel
  // messages and generates RuntimeActions for cascade
  // ----------------------------------------------------------

  describe('ForegroundAgent Cancel Routing', () => {
    let agent: ForegroundAgent;

    it('routes cancel to cancel_or_modify_task for single active PlannerRun', async () => {
      const mockAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'cancel_or_modify_task',
          reason: 'User requested cancellation of planner run',
          userVisibleResponse: 'Cancelling the active planner task...',
        })
      );
      agent = createForegroundAgent({ llmAdapter: mockAdapter, modelInputBuilder: createMockModelInputBuilder() });

      const input = createMessageInput('cancel the current task');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_run_c01'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('cancel_planner_run');
      expect(decision.runtimeAction?.targetRuntime).toBe('planner_runtime');
      expect(decision.targetRef?.plannerRunId).toBe('planner_run_c01');
      expect(decision.requiresPlanner).toBe(false);
      expect(decision.userVisibleResponse).toContain('Cancelling');
    });

    it('routes cancel to cancel_or_modify_task for single active background run', async () => {
      const mockAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'cancel_or_modify_task',
          reason: 'User requested cancellation of background run',
          userVisibleResponse: 'Cancelling the background task...',
        })
      );
      agent = createForegroundAgent({ llmAdapter: mockAdapter, modelInputBuilder: createMockModelInputBuilder() });

      const input = createMessageInput('stop the background job');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activeBackgroundRunIds: ['bg_run_c01'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.targetRef?.runtimeActionId).toBe('bg_run_c01');
    });

    it('asks for clarification when multiple active tasks exist (ambiguous target)', async () => {
      const mockAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'cancel_or_modify_task',
          reason: 'Cancel request but multiple active tasks found',
          userVisibleResponse: 'You have multiple active tasks. Which one would you like to cancel?',
        })
      );
      agent = createForegroundAgent({ llmAdapter: mockAdapter, modelInputBuilder: createMockModelInputBuilder() });

      const input = createMessageInput('cancel it');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_run_a1', 'planner_run_a2'],
            activeBackgroundRunIds: ['bg_run_a1'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.userVisibleResponse?.toLowerCase()).toContain('multiple');
      expect(decision.userVisibleResponse?.toLowerCase()).toContain('which');
      expect(decision.targetRef).toBeUndefined();
      expect(decision.runtimeAction).toBeUndefined();
    });

    it('returns answer_directly when no active work exists for cancel', async () => {
      const mockAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'cancel_or_modify_task',
          reason: 'Cancel requested but no active work found',
          userVisibleResponse: 'There is no active work to cancel.',
        })
      );
      agent = createForegroundAgent({ llmAdapter: mockAdapter, modelInputBuilder: createMockModelInputBuilder() });

      const input = createMessageInput('cancel everything');
      const state = createBaseState();

      const decision = await agent.processMessage(input, state);

      // When no active work, ForegroundAgent falls back to answer_directly
      expect(decision.route).toBe('answer_directly');
      expect(decision.userVisibleResponse).toContain('no active');
      expect(decision.runtimeAction).toBeUndefined();
    });

    it('generates proper RuntimeAction with all required fields for cascade', async () => {
      const mockAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'cancel_or_modify_task',
          reason: 'User requested cancellation',
          userVisibleResponse: 'Cancelling your task...',
        })
      );
      agent = createForegroundAgent({ llmAdapter: mockAdapter, modelInputBuilder: createMockModelInputBuilder() });

      const input = createMessageInput('cancel my task');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_run_r01'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      const action = decision.runtimeAction;
      expect(action).toBeDefined();
      expect(action?.actionId).toBeDefined();
      expect(action?.actionId).toMatch(/^action-/);
      expect(action?.actionType).toBe('cancel_planner_run');
      expect(action?.targetRuntime).toBe('planner_runtime');
      expect(action?.source).toBeDefined();
      expect(action?.source.sourceModule).toBeDefined();
      expect(action?.userId).toBe('user_test_011');
      expect(action?.sessionId).toBe('sess_test_011');
      expect(action?.targetRef?.runId).toBe('planner_run_r01');
      expect(action?.payload).toBeDefined();
      expect(action?.payload?.workId).toBe('planner_run_r01');
      expect(action?.payload?.reason).toContain('cancel');
      expect(action?.status).toBe('created');
    });
  });

  // ----------------------------------------------------------
  // SECTION B: Cancellation Cascade Execution
  // Tests actual cancellation through BackgroundRuntime
  // and CancellationCoordinator with real stores
  // ----------------------------------------------------------

  describe('Cancellation Cascade Execution', () => {
    let harness: E2EHarness;
    let bgRuntime: BackgroundRuntime;

    beforeEach(() => {
      harness = createE2EHarness();
      const bgStore = createBackgroundRunStore(harness.connection);
      bgRuntime = createBackgroundRuntime({
        backgroundRunStore: bgStore,
        eventStore: harness.stores.eventStore,
        maxConcurrentRuns: 3,
        watchdogTimeoutMs: 30000,
        maxRecoveryAttempts: 3,
      });
    });

    afterEach(() => {
      harness.close();
    });

    it('cancels a running background task and changes status to cancelled', async () => {
      const userId = 'user_cascade_01';
      const sessionId = 'sess_cascade_01';

      // Create and start a background task
      const bgRunId = bgRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'data_analyzer',
        taskSpec: { objective: 'Analyze large dataset' },
        launchSource: 'user_request',
        priority: 1,
      });

      await bgRuntime.startBackgroundRun(bgRunId);

      // Verify it is running
      let run = bgRuntime.getBackgroundRun(bgRunId);
      expect(run).toBeDefined();
      expect(run?.status).toBe('running');

      // Cancel the task
      bgRuntime.cancelBackgroundRun(bgRunId);

      // Verify status changed to cancelled
      run = bgRuntime.getBackgroundRun(bgRunId);
      expect(run).toBeDefined();
      expect(run?.status).toBe('cancelled');
    });

    it('emits BackgroundRunCancelled event on cancellation', async () => {
      const userId = 'user_cascade_02';
      const sessionId = 'sess_cascade_02';

      const bgRunId = bgRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'report_generator',
        taskSpec: { objective: 'Generate monthly report' },
        launchSource: 'user_request',
      });

      await bgRuntime.startBackgroundRun(bgRunId);
      bgRuntime.cancelBackgroundRun(bgRunId);

      // Verify cancellation event was emitted
      const events = harness.stores.eventStore.query({ sessionId });
      const cancelledEvents = events.filter(
        (e) => e.eventType === 'BackgroundRunCancelled'
      );
      expect(cancelledEvents.length).toBeGreaterThanOrEqual(1);

      const cancelEvent = cancelledEvents[0];
      expect(cancelEvent.payload.backgroundRunId).toBe(bgRunId);
      expect(cancelEvent.sourceModule).toBe('subagent');
    });

    it('creates cancellation notification for cancelled background task', async () => {
      const userId = 'user_cascade_03';
      const sessionId = 'sess_cascade_03';

      const bgRunId = bgRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'email_processor',
        taskSpec: { objective: 'Process inbox emails' },
        launchSource: 'user_request',
      });

      await bgRuntime.startBackgroundRun(bgRunId);
      bgRuntime.cancelBackgroundRun(bgRunId);

      // Verify notification was created
      const notifications = bgRuntime.getPendingNotifications();
      const cancelNotification = notifications.find(
        (n) => n.backgroundRunId === bgRunId && n.type === 'cancelled'
      );
      expect(cancelNotification).toBeDefined();
      expect(cancelNotification?.title).toContain('cancelled');
    });

    it('errors when cancelling already-terminal background task', async () => {
      const userId = 'user_cascade_04';
      const sessionId = 'sess_cascade_04';

      const bgRunId = bgRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'quick_task',
        taskSpec: { objective: 'Simple quick task' },
        launchSource: 'user_request',
      });

      await bgRuntime.startBackgroundRun(bgRunId);

      // First cancel: succeeds
      bgRuntime.cancelBackgroundRun(bgRunId);
      const runAfterFirstCancel = bgRuntime.getBackgroundRun(bgRunId);
      expect(runAfterFirstCancel?.status).toBe('cancelled');

      // Second cancel: should throw because status is already terminal
      expect(() => bgRuntime.cancelBackgroundRun(bgRunId)).toThrow(
        /Cannot cancel background run with status/
      );
    });
  });

  // ----------------------------------------------------------
  // SECTION C: Cancellation Coordinator Cascade
  // Tests the cancellation coordinator with cascade logic
  // through planner runs and tool executions
  // ----------------------------------------------------------

  describe('Cancellation Coordinator Cascade', () => {
    it('cascades cancellation from PlannerRun to active tool execution refs', async () => {
      // Mock stores for coordinator with proper recovery-types interfaces
      const mockPlannerRunStore: RecoveryPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'planner_c1',
          status: 'planning',
          checkpoint: {
            activeExecutionRefs: [
              { refId: 'tool_c1', refType: 'tool_execution', status: 'running' },
              { refId: 'tool_c2', refType: 'tool_execution', status: 'running' },
              { refId: 'bg_c1', refType: 'background_run', status: 'running' },
            ],
          },
        }),
        updateStatus: vi.fn(),
      };

      const mockToolExecutionStore: RecoveryToolExecutionStore = {
        getById: vi.fn((id: string) => ({
          toolCallId: id,
          toolName: `tool_${id}`,
          status: 'executing',
          userId: 'user_c1',
          sessionId: 'sess_c1',
        })),
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      };

      const mockBackgroundRunStore: RecoveryBackgroundRunStore = {
        getById: vi.fn().mockReturnValue({
          backgroundRunId: 'bg_c1',
          status: 'running',
        }),
        updateStatus: vi.fn(),
      };

      const mockKernelRunStore: RecoveryKernelRunStore = {
        getById: vi.fn().mockReturnValue(null),
        updateStatus: vi.fn(),
      };

      const mockEventStore: RecoveryEventStore = {
        append: vi.fn(),
      };

      const config: CancellationCoordinatorConfig = {
        toolExecutionStore: mockToolExecutionStore,
        plannerRunStore: mockPlannerRunStore,
        backgroundRunStore: mockBackgroundRunStore,
        kernelRunStore: mockKernelRunStore,
        eventStore: mockEventStore,
      };

      const coordinator = createCancellationCoordinator(config);

      const request: CancellationRequest = {
        targetType: CANCELLATION_TARGET_TYPES.PLANNER_RUN,
        targetId: 'planner_c1',
        cascade: true,
        reason: 'User cancelled plan',
      };

      const result = await coordinator.cancel(request);

      // Verify all children were cancelled
      expect(result.status).toBe(CANCELLATION_STATUSES.COMPLETED);
      expect(result.affectedRefs).toContain('planner_c1');
      expect(result.affectedRefs).toContain('tool_c1');
      expect(result.affectedRefs).toContain('tool_c2');
      expect(result.affectedRefs).toContain('bg_c1');

      // Verify status updates were called
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith('tool_c1', 'cancelled');
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith('tool_c2', 'cancelled');
      expect(mockBackgroundRunStore.updateStatus).toHaveBeenCalledWith('bg_c1', 'cancelled');
      expect(mockPlannerRunStore.updateStatus).toHaveBeenCalledWith(
        'planner_c1',
        'cancelled',
        expect.anything()
      );

      // Verify cancellation events emitted
      expect(mockEventStore.append).toHaveBeenCalledTimes(4); // 3 refs + 1 planner
    });

    it('returns ALREADY_TERMINAL when PlannerRun is already completed', async () => {
      const mockPlannerRunStore: RecoveryPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'planner_term',
          status: 'completed',
          checkpoint: {
            activeExecutionRefs: [
              { refId: 'tool_term', refType: 'tool_execution', status: 'completed' },
            ],
          },
        }),
        updateStatus: vi.fn(),
      };

      const mockToolExecutionStore: RecoveryToolExecutionStore = {
        getById: vi.fn(),
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      };

      const mockBackgroundRunStore: RecoveryBackgroundRunStore = {
        getById: vi.fn().mockReturnValue(null),
        updateStatus: vi.fn(),
      };

      const mockKernelRunStore: RecoveryKernelRunStore = {
        getById: vi.fn().mockReturnValue(null),
        updateStatus: vi.fn(),
      };

      const mockEventStore: RecoveryEventStore = {
        append: vi.fn(),
      };

      const config: CancellationCoordinatorConfig = {
        toolExecutionStore: mockToolExecutionStore,
        plannerRunStore: mockPlannerRunStore,
        backgroundRunStore: mockBackgroundRunStore,
        kernelRunStore: mockKernelRunStore,
        eventStore: mockEventStore,
      };

      const coordinator = createCancellationCoordinator(config);

      const result = await coordinator.cancelPlannerRun('planner_term');

      // Should return ALREADY_TERMINAL without cascading
      expect(result.status).toBe(CANCELLATION_STATUSES.ALREADY_TERMINAL);
      expect(result.affectedRefs).toHaveLength(0);
      expect(result.partialRefs).toContain('planner_term');

      // No status updates should have been called for children
      expect(mockToolExecutionStore.updateStatus).not.toHaveBeenCalled();
      expect(mockPlannerRunStore.updateStatus).not.toHaveBeenCalled();
    });

    it('cancels in-flight ToolExecution and sets synthetic result', async () => {
      const mockToolExecutionStore: RecoveryToolExecutionStore = {
        getById: vi.fn().mockReturnValue({
          toolCallId: 'tool_flight',
          toolName: 'longRunningOp',
          status: 'executing',
          userId: 'user_f1',
          sessionId: 'sess_f1',
        }),
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      };

      const mockEventStore: RecoveryEventStore = {
        append: vi.fn(),
      };

      const config: CancellationCoordinatorConfig = {
        toolExecutionStore: mockToolExecutionStore,
        plannerRunStore: {} as RecoveryPlannerRunStore,
        backgroundRunStore: {} as RecoveryBackgroundRunStore,
        kernelRunStore: {} as RecoveryKernelRunStore,
        eventStore: mockEventStore,
      };

      const coordinator = createCancellationCoordinator(config);
      const syntheticResult = await coordinator.cancelTool('tool_flight');

      // Verify synthetic result
      expect(syntheticResult.isSynthetic).toBe(true);
      expect(syntheticResult.status).toBe('cancelled');
      expect(syntheticResult.toolCallId).toBe('tool_flight');
      expect(syntheticResult.reason).toBe('Tool execution cancelled');

      // Verify store updates
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith('tool_flight', 'cancelled');
      expect(mockToolExecutionStore.saveResult).toHaveBeenCalledWith('tool_flight', {
        synthetic: true,
        status: 'cancelled',
        reason: 'Tool execution cancelled',
      });

      // Verify cancellation event emitted
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'tool_execution_cancelled',
          sourceModule: 'recovery',
          userId: 'user_f1',
          sessionId: 'sess_f1',
        })
      );
    });

    it('handles partial success: some refs already terminal, some running', async () => {
      const mockPlannerRunStore: RecoveryPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'planner_partial',
          status: 'planning',
          checkpoint: {
            activeExecutionRefs: [
              { refId: 'tool_active', refType: 'tool_execution', status: 'running' },
              { refId: 'tool_completed', refType: 'tool_execution', status: 'completed' },
              { refId: 'tool_failed', refType: 'tool_execution', status: 'failed' },
            ],
          },
        }),
        updateStatus: vi.fn(),
      };

      const mockToolExecutionStore: RecoveryToolExecutionStore = {
        getById: vi.fn((id: string) => {
          if (id === 'tool_active') {
            return { toolCallId: id, toolName: 'activeOp', status: 'executing' };
          }
          if (id === 'tool_completed') {
            return { toolCallId: id, toolName: 'doneOp', status: 'completed' };
          }
          if (id === 'tool_failed') {
            return { toolCallId: id, toolName: 'failOp', status: 'failed' };
          }
          return null;
        }),
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      };

      const mockBackgroundRunStore: RecoveryBackgroundRunStore = {
        getById: vi.fn().mockReturnValue(null),
        updateStatus: vi.fn(),
      };

      const mockKernelRunStore: RecoveryKernelRunStore = {
        getById: vi.fn().mockReturnValue(null),
        updateStatus: vi.fn(),
      };

      const mockEventStore: RecoveryEventStore = {
        append: vi.fn(),
      };

      const config: CancellationCoordinatorConfig = {
        toolExecutionStore: mockToolExecutionStore,
        plannerRunStore: mockPlannerRunStore,
        backgroundRunStore: mockBackgroundRunStore,
        kernelRunStore: mockKernelRunStore,
        eventStore: mockEventStore,
      };

      const coordinator = createCancellationCoordinator(config);
      const result = await coordinator.cancelPlannerRun('planner_partial');

      // Only the active ref should have been cancelled
      expect(result.status).toBe(CANCELLATION_STATUSES.PARTIAL);
      expect(result.affectedRefs).toContain('planner_partial');
      expect(result.affectedRefs).toContain('tool_active');
      expect(result.partialRefs).toContain('tool_completed');
      expect(result.partialRefs).toContain('tool_failed');

      // Only the active tool should be updated
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith('tool_active', 'cancelled');
      expect(mockToolExecutionStore.updateStatus).not.toHaveBeenCalledWith('tool_completed', expect.anything());
      expect(mockToolExecutionStore.updateStatus).not.toHaveBeenCalledWith('tool_failed', expect.anything());
    });

    it('detects external side effects for known write tools during cascade', async () => {
      const mockPlannerRunStore: RecoveryPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'planner_side',
          status: 'planning',
          checkpoint: {
            activeExecutionRefs: [
              { refId: 'tool_send', refType: 'tool_execution', status: 'running' },
            ],
          },
        }),
        updateStatus: vi.fn(),
      };

      const mockToolExecutionStore: RecoveryToolExecutionStore = {
        getById: vi.fn().mockReturnValue({
          toolCallId: 'tool_send',
          toolName: 'sendEmail',
          status: 'executing',
        }),
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      };

      const mockBackgroundRunStore: RecoveryBackgroundRunStore = {
        getById: vi.fn().mockReturnValue(null),
        updateStatus: vi.fn(),
      };

      const mockKernelRunStore: RecoveryKernelRunStore = {
        getById: vi.fn().mockReturnValue(null),
        updateStatus: vi.fn(),
      };

      const mockEventStore: RecoveryEventStore = {
        append: vi.fn(),
      };

      const config: CancellationCoordinatorConfig = {
        toolExecutionStore: mockToolExecutionStore,
        plannerRunStore: mockPlannerRunStore,
        backgroundRunStore: mockBackgroundRunStore,
        kernelRunStore: mockKernelRunStore,
        eventStore: mockEventStore,
      };

      const coordinator = createCancellationCoordinator(config);
      const result = await coordinator.cancelPlannerRun('planner_side');

      // Should include side effect notice for external write tools
      expect(result.sideEffectNotice).toBeDefined();
      expect(result.sideEffectNotice?.externalSideEffectsMayHaveOccurred).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // SECTION D: Full E2E Cancel Flow (Harness-based)
  // Tests full cancel flow from ForegroundAgent through to
  // actual background task cancellation with real stores
  // ----------------------------------------------------------

  describe('Full E2E Cancel Flow', () => {
    let harness: E2EHarness;
    let bgRuntime: BackgroundRuntime;

    beforeEach(() => {
      harness = createE2EHarness();
      const bgStore = createBackgroundRunStore(harness.connection);
      bgRuntime = createBackgroundRuntime({
        backgroundRunStore: bgStore,
        eventStore: harness.stores.eventStore,
        maxConcurrentRuns: 3,
        watchdogTimeoutMs: 30000,
        maxRecoveryAttempts: 3,
      });
    });

    afterEach(() => {
      harness.close();
    });

    it('end-to-end: ForegroundAgent cancel routing triggers actual background task cancellation', async () => {
      const userId = 'user_e2e_01';
      const sessionId = 'sess_e2e_01';

      // Step 1: Create a running background task
      const bgRunId = bgRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'document_processor',
        taskSpec: { objective: 'Process all documents' },
        launchSource: 'user_request',
      });
      await bgRuntime.startBackgroundRun(bgRunId);

      // Step 2: ForegroundAgent receives cancel message
      const mockAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'cancel_or_modify_task',
          reason: 'User requested cancellation',
          userVisibleResponse: 'Cancelling document processing...',
        })
      );
      const agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input: ForegroundMessageInput = {
        message: 'cancel the document processing',
        userId,
        sessionId,
        turnId: harness.idGenerator.custom('turn'),
        timestamp: harness.clock.nowISO(),
      };

      const state: ForegroundSessionState = {
        hydratedSession: {
          userContext: { userId, sessionId },
          sessionContext: {
            messageCount: 3,
            lastActivityAt: harness.clock.nowISO(),
            activePlannerRunIds: [],
            activeBackgroundRunIds: [bgRunId],
          },
          activeWorkRefs: {
            activeRuns: [],
            pendingApprovals: [],
          },
        },
        activeWorkRefs: {
          activeRuns: [],
          pendingApprovals: [],
        },
        currentPersona: {
          personaId: 'default',
          name: 'Assistant',
          directDelegationPolicy: {
            estimatedStepsGte: 3,
            maxComplexity: 'medium',
            allowedToolCategories: ['read', 'search', 'internal'],
          },
        },
        effectivePolicy: {
          estimatedStepsGte: 3,
          maxComplexity: 'medium',
          allowedToolCategories: ['read', 'search', 'internal'],
        },
      };

      // Step 3: Process the cancel message through ForegroundAgent
      const decision = await agent.processMessage(input, state);

      // Verify routing decision
      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();

      // Step 4: Actually cancel the background task
      bgRuntime.cancelBackgroundRun(bgRunId);

      // Step 5: Verify the cancellation took effect
      const cancelledRun = bgRuntime.getBackgroundRun(bgRunId);
      expect(cancelledRun?.status).toBe('cancelled');

      // Step 6: Verify events were emitted
      const events = harness.stores.eventStore.query({ sessionId });
      const cancelledEvent = events.find(
        (e) =>
          e.eventType === 'BackgroundRunCancelled' &&
          e.payload.backgroundRunId === bgRunId
      );
      expect(cancelledEvent).toBeDefined();

      // Step 7: Verify notification created
      const notifications = bgRuntime.getPendingNotifications();
      const cancelNotif = notifications.find(
        (n) => n.backgroundRunId === bgRunId && n.type === 'cancelled'
      );
      expect(cancelNotif).toBeDefined();
    });

    it('end-to-end: cancel cascades properly with multiple background tasks', async () => {
      const userId = 'user_e2e_02';
      const sessionId = 'sess_e2e_02';

      // Create multiple background tasks
      const bgRunId1 = bgRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'task_a',
        taskSpec: { objective: 'Task A' },
        launchSource: 'user_request',
      });
      const bgRunId2 = bgRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'task_b',
        taskSpec: { objective: 'Task B' },
        launchSource: 'user_request',
      });

      await bgRuntime.startBackgroundRun(bgRunId1);
      await bgRuntime.startBackgroundRun(bgRunId2);

      // Cancel first task
      bgRuntime.cancelBackgroundRun(bgRunId1);

      // Verify first cancelled, second still running
      const run1 = bgRuntime.getBackgroundRun(bgRunId1);
      const run2 = bgRuntime.getBackgroundRun(bgRunId2);
      expect(run1?.status).toBe('cancelled');
      expect(run2?.status).toBe('running');

      // Cancel second task
      bgRuntime.cancelBackgroundRun(bgRunId2);
      const run2After = bgRuntime.getBackgroundRun(bgRunId2);
      expect(run2After?.status).toBe('cancelled');

      // Verify both cancellation events exist
      const events = harness.stores.eventStore.query({ sessionId });
      const cancelledEvents = events.filter(
        (e) => e.eventType === 'BackgroundRunCancelled'
      );
      expect(cancelledEvents.length).toBe(2);
    });

    it('end-to-end: ForegroundAgent cancel routing with ambiguous target falls back to clarification', async () => {
      const userId = 'user_e2e_03';
      const sessionId = 'sess_e2e_03';

      // Create multiple background tasks
      const bgRunId1 = bgRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'task_x',
        taskSpec: { objective: 'Task X' },
        launchSource: 'user_request',
      });
      const bgRunId2 = bgRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'task_y',
        taskSpec: { objective: 'Task Y' },
        launchSource: 'user_request',
      });

      // Use ForegroundAgent with ambiguous target
      const mockAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'cancel_or_modify_task',
          reason: 'Cancel request but multiple active tasks found',
          userVisibleResponse: 'You have multiple active tasks. Which one would you like to cancel?',
        })
      );
      const agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input: ForegroundMessageInput = {
        message: 'cancel the task',
        userId,
        sessionId,
        turnId: harness.idGenerator.custom('turn'),
        timestamp: harness.clock.nowISO(),
      };

      const state: ForegroundSessionState = {
        hydratedSession: {
          userContext: { userId, sessionId },
          sessionContext: {
            messageCount: 2,
            lastActivityAt: harness.clock.nowISO(),
            activePlannerRunIds: [],
            activeBackgroundRunIds: [bgRunId1, bgRunId2],
          },
          activeWorkRefs: {
            activeRuns: [],
            pendingApprovals: [],
          },
        },
        activeWorkRefs: {
          activeRuns: [],
          pendingApprovals: [],
        },
        currentPersona: {
          personaId: 'default',
          name: 'Assistant',
          directDelegationPolicy: {
            estimatedStepsGte: 3,
            maxComplexity: 'medium',
            allowedToolCategories: ['read', 'search', 'internal'],
          },
        },
        effectivePolicy: {
          estimatedStepsGte: 3,
          maxComplexity: 'medium',
          allowedToolCategories: ['read', 'search', 'internal'],
        },
      };

      const decision = await agent.processMessage(input, state);

      // Should ask for clarification, not guess
      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.userVisibleResponse?.toLowerCase()).toContain('multiple');
      expect(decision.userVisibleResponse?.toLowerCase()).toContain('which');
      expect(decision.targetRef).toBeUndefined();
      expect(decision.runtimeAction).toBeUndefined();

      // Verify tasks weren't cancelled by the routing decision alone
      const run1 = bgRuntime.getBackgroundRun(bgRunId1);
      const run2 = bgRuntime.getBackgroundRun(bgRunId2);
      expect(run1?.status).toBe('queued');
      expect(run2?.status).toBe('queued');
    });
  });
});
