import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  MessageProcessorInput,
} from '../../../src/processing/types.js';
import {
  createOrchestrationProcessor,
  type ProcessorOrchestrationDeps,
} from '../../../src/processing/processor-orchestration.js';
import type {
  ForegroundDecision,
  ForegroundMessageInput,
  ForegroundSessionState,
} from '../../../src/foreground/types.js';
import type { ForegroundAgent } from '../../../src/foreground/foreground-agent.js';
import type { HydratedSessionState, Stores } from '../../../src/gateway/types.js';
import type { Gateway } from '../../../src/gateway/gateway.js';
import type { RuntimeDispatcher } from '../../../src/dispatcher/types.js';
import type { PlannerRuntime } from '../../../src/planner/planner-runtime.js';
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js';
import type { LLMAdapter } from '../../../src/llm/adapter.js';
import type { TranscriptStore, TurnTranscript } from '../../../src/storage/transcript-store.js';

describe('ProcessorOrchestration', () => {
  // Mock dependencies
  let mockGateway: Gateway;
  let mockStores: Stores;
  let mockForegroundAgent: ForegroundAgent;
  let mockRuntimeDispatcher: RuntimeDispatcher;
  let mockPlannerRuntime: PlannerRuntime;
  let mockAgentKernel: AgentKernel;
  let mockLlmAdapter: LLMAdapter;
  let mockTranscriptStore: TranscriptStore;
  let savedTranscripts: TurnTranscript[];

  let deps: ProcessorOrchestrationDeps;

  beforeEach(() => {
    // Create mock hydrated session state
    const mockHydratedSession: HydratedSessionState = {
      userContext: {
        userId: 'user-123',
        sessionId: 'session-456',
        preferences: {},
      },
      sessionContext: {
        messageCount: 5,
        lastActivityAt: '2024-01-15T10:00:00.000Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
      activeWorkRefs: {
        pendingApprovals: [],
        activeRuns: [],
      },
    };

    // Setup mock gateway
    mockGateway = {
      receiveUserMessage: vi.fn(),
      normalizeInbound: vi.fn(),
      assembleHydratedState: vi.fn().mockReturnValue(mockHydratedSession),
      formatOutbound: vi.fn(),
      getApprovalRoutingHint: vi.fn(),
    };

    // Setup mock stores
    mockStores = {
      eventStore: {
        append: vi.fn(),
        query: vi.fn().mockReturnValue([]),
      },
      summaryStore: {
        getSessionMemory: vi.fn().mockReturnValue(null),
      },
      transcriptStore: {
        findBySession: vi.fn().mockReturnValue([]),
      },
      runtimeActionStore: {
        findBySessionId: vi.fn().mockReturnValue([]),
      },
    };

    mockForegroundAgent = {
      processMessage: vi.fn().mockResolvedValue({
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Default mock response',
      } as ForegroundDecision),
    };

    // Setup mock runtime dispatcher
    mockRuntimeDispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        requestId: 'req-123',
        actionId: 'action-123',
        status: 'completed',
        targetRuntime: 'tool_plane',
      }),
    } as unknown as RuntimeDispatcher;

    // Setup mock planner runtime
    mockPlannerRuntime = {
      createPlannerRun: vi.fn().mockReturnValue({
        plannerRunId: 'planner-run-001',
        planId: 'plan-001',
        status: 'initializing',
        actions: [],
      }),
      resumePlannerRun: vi.fn(),
      cancelPlannerRun: vi.fn(),
      replan: vi.fn(),
      archivePlannerRun: vi.fn(),
      transitionState: vi.fn(),
      handleApprovalRejection: vi.fn(),
      applyPlanPatch: vi.fn(),
      addActiveExecutionRef: vi.fn(),
      emitRuntimeAction: vi.fn(),
      saveCheckpoint: vi.fn(),
    } as unknown as PlannerRuntime;

    // Setup mock agent kernel
    mockAgentKernel = {
      run: vi.fn().mockResolvedValue({
        finalStatus: 'completed',
        finalResponse: 'Kernel response',
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
      }),
    } as unknown as AgentKernel;

    mockLlmAdapter = {
      providers: [{ providerId: 'test-provider' }],
      complete: vi.fn().mockResolvedValue({
        success: true,
        response: {
          id: 'resp-123',
          content: 'LLM response',
          model: 'test-model',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      }),
      getProviderHealth: vi.fn().mockReturnValue({ healthy: true }),
    } as unknown as LLMAdapter;

    savedTranscripts = [];
    mockTranscriptStore = {
      saveTurn: vi.fn((transcript: TurnTranscript) => {
        savedTranscripts.push(transcript);
        return true;
      }),
      getTurn: vi.fn().mockReturnValue(null),
      findBySession: vi.fn().mockReturnValue([]),
      search: vi.fn().mockReturnValue([]),
      findByArtifactRef: vi.fn().mockReturnValue([]),
      findByPlannerRunId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn().mockReturnValue(0),
    } as unknown as TranscriptStore;

    deps = {
      gateway: mockGateway,
      stores: mockStores,
      foregroundAgent: mockForegroundAgent,
      runtimeDispatcher: mockRuntimeDispatcher,
      plannerRuntime: mockPlannerRuntime,
      agentKernel: mockAgentKernel,
      llmAdapter: mockLlmAdapter,
      transcriptStore: mockTranscriptStore,
    };
  });

  describe('answer_directly route', () => {
    it('should return visible assistant output with same correlation id', async () => {
      const correlationId = 'corr-abc-123';
      const userVisibleResponse = 'Hello! I understand your message.';

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Simple question detected',
        userVisibleResponse,
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Hello!',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(true);
      expect(result.correlationId).toBe(correlationId);
      expect(result.result?.text).toBe(userVisibleResponse);
      expect(result.result?.route).toBe('answer_directly');
      expect(result.result?.data?.reason).toBe('Simple question detected');
    });

    it('should handle direct answer with default response when none provided', async () => {
      const correlationId = 'corr-def-456';

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Default fallback',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(true);
      expect(result.correlationId).toBe(correlationId);
      expect(result.result?.text).toBe('I understand.');
    });
  });

  describe('status_query route', () => {
    it('should return status query acknowledgment with visible output', async () => {
      const correlationId = 'corr-status-789';

      const mockDecision: ForegroundDecision = {
        route: 'status_query',
        requiresPlanner: false,
        reason: 'User requested status update',
        userVisibleResponse: 'Checking active work status...',
        runtimeAction: {
          actionId: 'action-status-1',
          actionType: 'query_active_work',
          targetRuntime: 'gateway',
          targetAction: 'query',
          payload: { queryType: 'active_work_status' },
        } as unknown as ForegroundDecision['runtimeAction'],
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'What is the status?',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(true);
      expect(result.correlationId).toBe(correlationId);
      expect(result.result?.text).toBe('Checking active work status...');
      expect(result.result?.route).toBe('status_query');
      expect(result.result?.data?.hasRuntimeAction).toBe(true);
    });
  });

  describe('dispatch_tool route', () => {
    it('should return tool dispatch acknowledgment', async () => {
      const correlationId = 'corr-tool-abc';

      const mockDecision: ForegroundDecision = {
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Simple read task detected',
        userVisibleResponse: 'Processing your request...',
        suggestedTools: ['memory.retrieve', 'transcript.search'],
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Search for something',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(true);
      expect(result.correlationId).toBe(correlationId);
      expect(result.result?.text).toBe('Processing your request...');
      expect(result.result?.route).toBe('dispatch_tool');
      expect(result.result?.data?.suggestedTools).toEqual(['memory.retrieve', 'transcript.search']);
    });

    it('should call runtimeDispatcher.dispatch when runtimeAction is present', async () => {
      const correlationId = 'corr-tool-dispatch-001';

      const mockRuntimeAction = {
        actionId: 'action-123',
        actionType: 'execute_tool',
        targetRuntime: 'tool_plane',
        targetAction: 'search',
        payload: { query: 'test query' },
      };

      const mockDecision: ForegroundDecision = {
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch required',
        userVisibleResponse: 'Dispatching tool...',
        suggestedTools: ['memory.retrieve', 'transcript.search'],
        runtimeAction: mockRuntimeAction as unknown as ForegroundDecision['runtimeAction'],
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Search for test',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(true);
      expect(mockRuntimeDispatcher.dispatch).toHaveBeenCalledWith({
        requestId: correlationId,
        action: mockRuntimeAction,
        context: {
          userId: 'user-123',
          sessionId: 'session-456',
          callerModule: 'processing',
        },
      });
      expect(result.result?.data?.hasRuntimeAction).toBe(true);
      expect(result.result?.data?.dispatchResult).toBeDefined();
      const dispatchResult = result.result?.data?.dispatchResult as { actionId: string; status: string; targetRuntime: string };
      expect(dispatchResult.actionId).toBe('action-123');
    });

    it('should return error output when runtimeDispatcher.dispatch fails', async () => {
      const correlationId = 'corr-tool-dispatch-error-001';

      const mockRuntimeAction = {
        actionId: 'action-456',
        actionType: 'execute_tool',
        targetRuntime: 'tool_plane',
        targetAction: 'search',
        payload: { query: 'test query' },
      };

      const mockDecision: ForegroundDecision = {
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch required',
        userVisibleResponse: 'Dispatching tool...',
        suggestedTools: ['memory.retrieve', 'transcript.search'],
        runtimeAction: mockRuntimeAction as unknown as ForegroundDecision['runtimeAction'],
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);
      vi.mocked(mockRuntimeDispatcher.dispatch).mockRejectedValue(new Error('Dispatch failed'));

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Search for test',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DISPATCH_ERROR');
      expect(result.error?.message).toBe('Dispatch failed');
    });
  });

  describe('spawn_planner route', () => {
    it('should return planner spawn acknowledgment with task details', async () => {
      const correlationId = 'corr-planner-xyz';

      const mockDecision: ForegroundDecision = {
        route: 'spawn_planner',
        requiresPlanner: true,
        reason: 'Complex task detected (5 steps)',
        userVisibleResponse: 'This looks like a multi-step task. Spawning planner...',
        estimatedSteps: 5,
        complexity: 'high',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Plan a complex project with multiple steps',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(true);
      expect(result.correlationId).toBe(correlationId);
      expect(result.result?.text).toBe('This looks like a multi-step task. Spawning planner...');
      expect(result.result?.route).toBe('spawn_planner');
      expect(result.result?.data?.estimatedSteps).toBe(5);
      expect(result.result?.data?.complexity).toBe('high');
      expect(result.result?.data?.requiresPlanner).toBe(true);
    });

    it('should call plannerRuntime.createPlannerRun when spawning planner', async () => {
      const correlationId = 'corr-planner-spawn-001';

      const mockPlannerResult = {
        plannerRunId: 'planner-run-abc-123',
        planId: 'plan-xyz-789',
        status: 'initializing' as const,
        actions: [],
      };

      vi.mocked(mockPlannerRuntime.createPlannerRun).mockReturnValue(mockPlannerResult);

      const mockDecision: ForegroundDecision = {
        route: 'spawn_planner',
        requiresPlanner: true,
        reason: 'Complex task requiring planning',
        userVisibleResponse: 'Spawning planner for your task...',
        estimatedSteps: 3,
        complexity: 'medium',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Plan a complex project',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(true);
      expect(mockPlannerRuntime.createPlannerRun).toHaveBeenCalledWith({
        objective: 'Spawning planner for your task...',
        userId: 'user-123',
        sessionId: 'session-456',
        contextBundle: {
          correlationId,
          estimatedSteps: 3,
          complexity: 'medium',
          reason: 'Complex task requiring planning',
        },
      });
      expect(result.result?.data?.plannerRunId).toBe('planner-run-abc-123');
      expect(result.result?.data?.planId).toBe('plan-xyz-789');
      expect(result.result?.data?.plannerStatus).toBe('initializing');
    });

    it('should return error output when plannerRuntime.createPlannerRun fails', async () => {
      const correlationId = 'corr-planner-error-001';

      vi.mocked(mockPlannerRuntime.createPlannerRun).mockImplementation(() => {
        throw new Error('Planner runtime unavailable');
      });

      const mockDecision: ForegroundDecision = {
        route: 'spawn_planner',
        requiresPlanner: true,
        reason: 'Complex task requiring planning',
        userVisibleResponse: 'Spawning planner...',
        estimatedSteps: 5,
        complexity: 'high',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Plan a project',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PLANNER_SPAWN_ERROR');
      expect(result.error?.message).toBe('Planner runtime unavailable');
    });
  });

  describe('resume_existing_planner route', () => {
    it('should return planner resume acknowledgment', async () => {
      const correlationId = 'corr-resume-123';

      const mockDecision: ForegroundDecision = {
        route: 'resume_existing_planner',
        requiresPlanner: true,
        reason: 'Resuming existing planner run',
        userVisibleResponse: 'Resuming your previous task...',
        targetRef: { plannerRunId: 'planner-run-456' },
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Continue with my task',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(true);
      expect(result.correlationId).toBe(correlationId);
      expect(result.result?.text).toBe('Resuming your previous task...');
      expect(result.result?.route).toBe('resume_existing_planner');
      expect(result.result?.data?.targetRef).toEqual({ plannerRunId: 'planner-run-456' });
    });
  });

  describe('unsupported route error handling', () => {
    it('should return visible error for unsupported routes with same correlation id', async () => {
      const correlationId = 'corr-unsupported-999';

      // Create a decision with an unsupported route
      const mockDecision = {
        route: 'unknown_custom_route',
        requiresPlanner: false,
        reason: 'Custom routing',
      } as unknown as ForegroundDecision;

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(false);
      expect(result.correlationId).toBe(correlationId);
      expect(result.error?.code).toBe('UNSUPPORTED_ROUTE');
      expect(result.error?.message).toContain('unknown_custom_route');
      expect(result.error?.details?.route).toBe('unknown_custom_route');
    });
  });

  describe('processing error handling', () => {
    it('should return visible error when foreground agent throws', async () => {
      const correlationId = 'corr-error-111';

      vi.mocked(mockForegroundAgent.processMessage).mockRejectedValue(new Error('Foreground agent failed'));

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(false);
      expect(result.correlationId).toBe(correlationId);
      expect(result.error?.code).toBe('PROCESSING_ERROR');
      expect(result.error?.message).toBe('Foreground agent failed');
    });

    it('should return visible error when gateway hydration fails', async () => {
      const correlationId = 'corr-error-222';

      vi.mocked(mockGateway.assembleHydratedState).mockImplementation(() => {
        throw new Error('Hydration failed');
      });

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(false);
      expect(result.correlationId).toBe(correlationId);
      expect(result.error?.code).toBe('PROCESSING_ERROR');
      expect(result.error?.message).toBe('Hydration failed');
    });

    it('should handle non-Error exceptions gracefully', async () => {
      const correlationId = 'corr-error-333';

      vi.mocked(mockForegroundAgent.processMessage).mockRejectedValue('String error');

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(false);
      expect(result.correlationId).toBe(correlationId);
      expect(result.error?.code).toBe('PROCESSING_ERROR');
      expect(result.error?.message).toBe('Unknown processing error');
    });
  });

  describe('input transformation', () => {
    it('should correctly transform MessageProcessorInput to ForegroundMessageInput', async () => {
      const correlationId = 'corr-transform-444';

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Test transformation',
        userVisibleResponse: 'Response',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-transform',
        sessionId: 'session-transform',
        text: 'Test message content',
        timestamp: '2024-01-15T12:00:00.000Z',
        metadata: { customField: 'customValue' },
      };

      await processor(input);

      // Verify the foreground agent was called with correct input
      const callArgs = vi.mocked(mockForegroundAgent.processMessage).mock.calls[0];
      const foregroundInput = callArgs[0] as ForegroundMessageInput;

      expect(foregroundInput.message).toBe('Test message content');
      expect(foregroundInput.userId).toBe('user-transform');
      expect(foregroundInput.sessionId).toBe('session-transform');
      expect(foregroundInput.turnId).toBe(correlationId);
      expect(foregroundInput.timestamp).toBe('2024-01-15T12:00:00.000Z');
      expect(foregroundInput.metadata).toEqual({ customField: 'customValue' });
    });

    it('should correctly build ForegroundSessionState from hydrated state', async () => {
      const correlationId = 'corr-state-555';

      const customHydratedState: HydratedSessionState = {
        userContext: {
          userId: 'user-custom',
          sessionId: 'session-custom',
          preferences: { theme: 'dark' },
        },
        sessionContext: {
          messageCount: 42,
          lastActivityAt: '2024-01-15T11:00:00.000Z',
          activePlannerRunIds: ['planner-1'],
          activeBackgroundRunIds: ['bg-1'],
        },
        activeWorkRefs: {
          pendingApprovals: ['approval-1'],
          activeRuns: ['run-1'],
        },
      };

      vi.mocked(mockGateway.assembleHydratedState).mockReturnValue(customHydratedState);

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Test state building',
        userVisibleResponse: 'Response',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-custom',
        sessionId: 'session-custom',
        text: 'Test',
        timestamp: '2024-01-15T12:00:00.000Z',
        metadata: {},
      };

      await processor(input);

      // Verify the foreground agent was called with correct state
      const callArgs = vi.mocked(mockForegroundAgent.processMessage).mock.calls[0];
      const foregroundState = callArgs[1] as ForegroundSessionState;

      expect(foregroundState.hydratedSession).toBe(customHydratedState);
      expect(foregroundState.activeWorkRefs).toEqual(customHydratedState.activeWorkRefs);
      expect(foregroundState.currentPersona.personaId).toBe('default');
      expect(foregroundState.currentPersona.name).toBe('Assistant');
      expect(foregroundState.effectivePolicy.estimatedStepsGte).toBe(3);
    });
  });

  describe('persona customization', () => {
    it('should use custom persona when provided', async () => {
      const correlationId = 'corr-persona-666';

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Test custom persona',
        userVisibleResponse: 'Response',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({
        deps,
        defaultPersonaId: 'custom-persona',
        defaultPersonaName: 'Custom Assistant',
      });

      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      await processor(input);

      const callArgs = vi.mocked(mockForegroundAgent.processMessage).mock.calls[0];
      const foregroundState = callArgs[1] as ForegroundSessionState;

      expect(foregroundState.currentPersona.personaId).toBe('custom-persona');
      expect(foregroundState.currentPersona.name).toBe('Custom Assistant');
    });
  });

  describe('additional routes', () => {
    it('should handle dispatch_subagent route', async () => {
      const correlationId = 'corr-subagent-777';

      const mockDecision: ForegroundDecision = {
        route: 'dispatch_subagent',
        requiresPlanner: false,
        reason: 'Delegating to subagent',
        userVisibleResponse: 'Dispatching subagent...',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Do something in background',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(true);
      expect(result.correlationId).toBe(correlationId);
      expect(result.result?.route).toBe('dispatch_subagent');
    });

    it('should handle approval_handler route', async () => {
      const correlationId = 'corr-approval-888';

      const mockDecision: ForegroundDecision = {
        route: 'approval_handler',
        requiresPlanner: false,
        reason: 'Processing approval response',
        userVisibleResponse: 'Processing your approval response...',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Yes, approve it',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(true);
      expect(result.correlationId).toBe(correlationId);
      expect(result.result?.route).toBe('approval_handler');
    });

    it('should handle cancel_or_modify_task route', async () => {
      const correlationId = 'corr-cancel-999';

      const mockDecision: ForegroundDecision = {
        route: 'cancel_or_modify_task',
        requiresPlanner: false,
        reason: 'Cancel request for active work: run-123',
        userVisibleResponse: 'Processing your cancel request...',
        targetRef: { plannerRunId: 'run-123' },
        runtimeAction: {
          actionId: 'action-cancel-001',
          actionType: 'cancel_planner_run',
          targetRuntime: 'planner_runtime',
          targetAction: 'cancel',
          payload: { workId: 'run-123' },
        } as unknown as ForegroundDecision['runtimeAction'],
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Cancel my task',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(true);
      expect(result.correlationId).toBe(correlationId);
      expect(result.result?.route).toBe('cancel_or_modify_task');
      expect(result.result?.data?.targetRef).toEqual({ plannerRunId: 'run-123' });
    });
  });

  describe('channel neutrality verification', () => {
    it('should not include channel-specific fields in output', async () => {
      const correlationId = 'corr-neutral-000';

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Test channel neutrality',
        userVisibleResponse: 'Response',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      // Verify output is channel-neutral
      expect(result).not.toHaveProperty('sourceChannel');
      expect(result).not.toHaveProperty('channel');
      expect(result).not.toHaveProperty('recipient');
      expect(result).not.toHaveProperty('channelRegistry');
      expect(result).not.toHaveProperty('sseBroadcaster');
      expect(result).toHaveProperty('correlationId');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('timestamp');
    });
  });

  describe('transcript persistence', () => {
    beforeEach(() => {
      savedTranscripts = [];
      vi.mocked(mockTranscriptStore.saveTurn).mockClear();
    });

    it('should persist transcript on successful processing', async () => {
      const correlationId = 'corr-transcript-success-001';
      const userVisibleResponse = 'I understand your message.';

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Simple question detected',
        userVisibleResponse,
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Hello, can you help me?',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: { inboundEventId: 'evt-123' },
      };

      await processor(input);

      expect(mockTranscriptStore.saveTurn).toHaveBeenCalledTimes(1);
      expect(savedTranscripts).toHaveLength(1);

      const savedTranscript = savedTranscripts[0];
      expect(savedTranscript.turnId).toBe(correlationId);
      expect(savedTranscript.sessionId).toBe('session-456');
      expect(savedTranscript.userId).toBe('user-123');
      expect(savedTranscript.input.inboundEventId).toBe('evt-123');
      expect(savedTranscript.input.userMessageSummary).toBe('Hello, can you help me?');
      expect(savedTranscript.visibility).toBe('public');
      expect(savedTranscript.output.visibleMessages).toHaveLength(1);
      expect(savedTranscript.output.visibleMessages[0].role).toBe('assistant');
      expect(savedTranscript.output.visibleMessages[0].content).toBe(userVisibleResponse);
    });

    it('should persist transcript with error message on processing failure', async () => {
      const correlationId = 'corr-transcript-error-001';

      vi.mocked(mockForegroundAgent.processMessage).mockRejectedValue(new Error('Foreground agent crashed'));

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message that causes error',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(false);
      expect(mockTranscriptStore.saveTurn).toHaveBeenCalledTimes(1);
      expect(savedTranscripts).toHaveLength(1);

      const savedTranscript = savedTranscripts[0];
      expect(savedTranscript.turnId).toBe(correlationId);
      expect(savedTranscript.output.visibleMessages).toHaveLength(1);
      expect(savedTranscript.output.visibleMessages[0].role).toBe('error');
      expect(savedTranscript.output.visibleMessages[0].content).toContain('PROCESSING_ERROR');
      expect(savedTranscript.output.visibleMessages[0].content).toContain('Foreground agent crashed');
    });

    it('should persist transcript with system_status for non-answer_directly routes', async () => {
      const correlationId = 'corr-transcript-status-001';

      const mockDecision: ForegroundDecision = {
        route: 'spawn_planner',
        requiresPlanner: true,
        reason: 'Complex task requiring planning',
        userVisibleResponse: 'Spawning planner for your task...',
        estimatedSteps: 5,
        complexity: 'high',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Plan a complex project',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      await processor(input);

      expect(mockTranscriptStore.saveTurn).toHaveBeenCalledTimes(1);
      expect(savedTranscripts).toHaveLength(1);

      const savedTranscript = savedTranscripts[0];
      expect(savedTranscript.output.visibleMessages).toHaveLength(2);
      expect(savedTranscript.output.visibleMessages[0].role).toBe('assistant');
      expect(savedTranscript.output.visibleMessages[0].content).toBe('Spawning planner for your task...');
      expect(savedTranscript.output.visibleMessages[1].role).toBe('system_status');
      expect(savedTranscript.output.visibleMessages[1].content).toContain('spawn_planner');
    });

    it('should not include raw internal reasoning in thinking_summary', async () => {
      const correlationId = 'corr-transcript-safe-001';

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Internal chain-of-thought reasoning that should not be persisted',
        userVisibleResponse: 'Here is my public response.',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'What do you think?',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      await processor(input);

      const savedTranscript = savedTranscripts[0];

      const thinkingMessages = savedTranscript.output.visibleMessages.filter(
        m => m.role === 'thinking'
      );
      expect(thinkingMessages).toHaveLength(0);

      const hasInternalReasoning = savedTranscript.output.visibleMessages.some(
        m => m.content.includes('Internal chain-of-thought')
      );
      expect(hasInternalReasoning).toBe(false);

      expect(savedTranscript.output.visibleMessages[0].role).toBe('assistant');
      expect(savedTranscript.output.visibleMessages[0].content).toBe('Here is my public response.');
    });

    it('should continue processing even if transcript persistence fails', async () => {
      const correlationId = 'corr-transcript-fail-001';

      vi.mocked(mockTranscriptStore.saveTurn).mockImplementation(() => {
        throw new Error('Database error');
      });

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Test persistence failure handling',
        userVisibleResponse: 'Response despite persistence failure',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(true);
      expect(result.result?.text).toBe('Response despite persistence failure');
    });

    it('should return error and persist transcript when no LLM providers configured', async () => {
      const correlationId = 'corr-no-providers-001';

      const noProviderAdapter = {
        providers: [],
        complete: vi.fn(),
        getProviderHealth: vi.fn().mockReturnValue({ healthy: false }),
      } as unknown as LLMAdapter;

      const noProviderDeps = {
        ...deps,
        llmAdapter: noProviderAdapter,
      };

      const processor = createOrchestrationProcessor({ deps: noProviderDeps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message with no providers',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor(input);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PROCESSING_ERROR');
      expect(result.error?.message).toBe('No LLM providers configured. Message received but cannot be processed.');

      expect(mockTranscriptStore.saveTurn).toHaveBeenCalled();
      const savedTranscript = savedTranscripts[savedTranscripts.length - 1];
      expect(savedTranscript.output.visibleMessages).toHaveLength(1);
      expect(savedTranscript.output.visibleMessages[0].role).toBe('error');
      expect(savedTranscript.output.visibleMessages[0].content).toContain('PROCESSING_ERROR');
    });
  });

  describe('timeline visibility', () => {
    beforeEach(() => {
      savedTranscripts = [];
      vi.mocked(mockTranscriptStore.saveTurn).mockClear();
    });

    it('timeline query should include user_message and assistant_message after success', async () => {
      const correlationId = 'corr-timeline-success-001';

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Simple question',
        userVisibleResponse: 'Yes, I can help with that!',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Can you help me?',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      await processor(input);

      const savedTranscript = savedTranscripts[0];

      expect(savedTranscript.input.userMessageSummary).toBe('Can you help me?');
      expect(savedTranscript.output.visibleMessages.some(m => m.role === 'assistant')).toBe(true);

      const assistantMsg = savedTranscript.output.visibleMessages.find(m => m.role === 'assistant');
      expect(assistantMsg?.content).toBe('Yes, I can help with that!');
    });

    it('timeline query should include user_message and error after failure', async () => {
      const correlationId = 'corr-timeline-error-001';

      vi.mocked(mockForegroundAgent.processMessage).mockRejectedValue(new Error('Processing pipeline error'));

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'This will fail',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      await processor(input);

      const savedTranscript = savedTranscripts[0];

      expect(savedTranscript.input.userMessageSummary).toBe('This will fail');
      expect(savedTranscript.output.visibleMessages.some(m => m.role === 'error')).toBe(true);

      const errorMsg = savedTranscript.output.visibleMessages.find(m => m.role === 'error');
      expect(errorMsg?.content).toContain('PROCESSING_ERROR');
    });

    it('should include correlation metadata in transcript for timeline linkage', async () => {
      const correlationId = 'corr-timeline-link-001';

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Test correlation',
        userVisibleResponse: 'Response with correlation.',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({ deps });
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-456',
        sessionId: 'session-789',
        text: 'Test correlation linkage',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: { inboundEventId: 'evt-correlation-001' },
      };

      await processor(input);

      const savedTranscript = savedTranscripts[0];

      expect(savedTranscript.turnId).toBe(correlationId);
      expect(savedTranscript.input.inboundEventId).toBe('evt-correlation-001');
      expect(savedTranscript.sessionId).toBe('session-789');
      expect(savedTranscript.userId).toBe('user-456');
    });
  });

  describe('provider resolver integration', () => {
    it('should log fallback event when provider resolution triggers fallback', async () => {
      const correlationId = 'corr-fallback-001';
      const mockAppendEvent = vi.fn();

      const mockEventStore = {
        append: mockAppendEvent,
        query: vi.fn().mockReturnValue([]),
        findByCorrelationId: vi.fn().mockReturnValue([]),
        findByCausationId: vi.fn().mockReturnValue([]),
        updateUserIdForSession: vi.fn().mockReturnValue(0),
      };

      const mockProviderConfigStore = {
        listByUser: vi.fn().mockReturnValue([
          {
            providerId: 'fallback-provider',
            userId: 'user-123',
            providerType: 'openai',
            displayName: 'Fallback Provider',
            enabled: true,
            configured: true,
            selectedModel: 'fallback-model',
            apiKey: 'sk-test',
          },
        ]),
        getByIdWithSecret: vi.fn().mockReturnValue(null),
        getById: vi.fn().mockReturnValue(null),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      };

      const depsWithResolver = {
        ...deps,
        eventStore: mockEventStore,
        providerConfigStore: mockProviderConfigStore as unknown as import('../../../src/storage/provider-config-store.js').ProviderConfigStore,
      };

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Simple question',
        userVisibleResponse: 'I understand.',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({
        deps: depsWithResolver,
        sessionProviderSelection: {
          selectedProviderId: 'nonexistent-provider',
        },
      });

      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      await processor(input);

      expect(mockAppendEvent).toHaveBeenCalled();
      const loggedEvent = mockAppendEvent.mock.calls[0][0];
      expect(loggedEvent.eventType).toBe('llm_provider_fallback');
      expect(loggedEvent.payload.originalProviderId).toBe('nonexistent-provider');
      expect(loggedEvent.payload.actualProviderId).toBe('fallback-provider');
      expect(loggedEvent.payload.fallbackReason).toBeDefined();
      expect(loggedEvent.sensitivity).toBe('low');
    });

    it('should not include secrets in fallback event payload', async () => {
      const correlationId = 'corr-fallback-002';
      const mockAppendEvent = vi.fn();

      const mockEventStore = {
        append: mockAppendEvent,
        query: vi.fn().mockReturnValue([]),
        findByCorrelationId: vi.fn().mockReturnValue([]),
        findByCausationId: vi.fn().mockReturnValue([]),
        updateUserIdForSession: vi.fn().mockReturnValue(0),
      };

      const mockProviderConfigStore = {
        listByUser: vi.fn().mockReturnValue([
          {
            providerId: 'fallback-provider',
            userId: 'user-123',
            providerType: 'openai',
            displayName: 'Fallback Provider',
            enabled: true,
            configured: true,
            selectedModel: 'fallback-model',
            apiKey: 'sk-secret-key-12345',
          },
        ]),
        getByIdWithSecret: vi.fn().mockReturnValue(null),
        getById: vi.fn().mockReturnValue(null),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      };

      const depsWithResolver = {
        ...deps,
        eventStore: mockEventStore,
        providerConfigStore: mockProviderConfigStore as unknown as import('../../../src/storage/provider-config-store.js').ProviderConfigStore,
      };

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Simple question',
        userVisibleResponse: 'I understand.',
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue(mockDecision);

      const processor = createOrchestrationProcessor({
        deps: depsWithResolver,
        sessionProviderSelection: {
          selectedProviderId: 'nonexistent-provider',
        },
      });

      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      await processor(input);

      const loggedEvent = mockAppendEvent.mock.calls[0][0];
      const payloadStr = JSON.stringify(loggedEvent.payload);
      expect(payloadStr).not.toContain('sk-secret-key');
      expect(payloadStr).not.toContain('12345');
      expect(loggedEvent.payload).toHaveProperty('originalProviderId');
      expect(loggedEvent.payload).toHaveProperty('actualProviderId');
      expect(loggedEvent.payload).toHaveProperty('fallbackReason');
    });
  });
});
