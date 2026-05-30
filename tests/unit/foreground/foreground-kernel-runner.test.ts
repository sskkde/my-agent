import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createForegroundKernelRunner,
  isForegroundKernelRunnerEnabled,
  buildRuntimeSummary,
} from '../../../src/foreground/foreground-kernel-runner.js';
import type {
  ForegroundTurnInput,
} from '../../../src/foreground/foreground-runner-types.js';
import type { ForegroundDecision, ForegroundSessionState } from '../../../src/foreground/types.js';
import type { ForegroundAgent } from '../../../src/foreground/foreground-agent.js';
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js';
import type { KernelRunResult } from '../../../src/kernel/types.js';
import type { RuntimeDispatcher, DispatchResult } from '../../../src/dispatcher/types.js';
import type { PlannerRuntime } from '../../../src/planner/planner-runtime.js';
import type { LLMAdapter } from '../../../src/llm/adapter.js';
import type { LLMResult } from '../../../src/llm/types.js';
import type { HydratedSessionState } from '../../../src/gateway/types.js';

import type { EventRecord, EventStore } from '../../../src/storage/event-store.js';
import type { SearchSubagent } from '../../../src/search/search-subagent.js';
import type { AgentConfig } from '../../../src/storage/agent-config-store.js';

// Helper to create minimal ForegroundSessionState
function createMockForegroundState(): ForegroundSessionState {
  return {
    hydratedSession: {
      userContext: {
        userId: 'user-123',
        sessionId: 'session-456',
        preferences: {},
      },
      sessionContext: {
        messageCount: 1,
        lastActivityAt: '2024-01-15T10:00:00.000Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
      activeWorkRefs: {
        pendingApprovals: [],
        activeRuns: [],
      },
    } as HydratedSessionState,
    activeWorkRefs: {
      pendingApprovals: [],
      activeRuns: [],
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
    conversationHistory: [],
  };
}

// Helper to create ForegroundTurnInput
function createMockInput(overrides?: Partial<ForegroundTurnInput>): ForegroundTurnInput {
  const state = createMockForegroundState();
  return {
    userId: 'user-123',
    sessionId: 'session-456',
    turnId: 'turn-001',
    message: 'Hello!',
    timestamp: '2024-01-15T10:00:00.000Z',
    hydratedState: state.hydratedSession,
    foregroundState: state,
    ...overrides,
  };
}

describe('ForegroundKernelRunner', () => {
  let mockForegroundAgent: ForegroundAgent;
  let mockAgentKernel: AgentKernel;
  let mockRuntimeDispatcher: RuntimeDispatcher;
  let mockPlannerRuntime: PlannerRuntime;
  let mockLlmAdapter: LLMAdapter;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Store original env
    originalEnv = process.env.FOREGROUND_KERNEL_RUNNER_ENABLED;

    // Enable feature flag by default
    process.env.FOREGROUND_KERNEL_RUNNER_ENABLED = 'true';

    // Create mock foreground agent
    mockForegroundAgent = {
      processMessage: vi.fn().mockResolvedValue({
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Default mock response',
      } as ForegroundDecision),
    };

    // Create mock agent kernel (minimal mock - only 'run' method is used)
    mockAgentKernel = {
      run: vi.fn().mockResolvedValue({
        finalStatus: 'completed',
        finalResponse: 'Kernel processed response',
        iterationsUsed: 1,
        toolCalls: [
          { toolCallId: 'tc-001', toolName: 'memory.retrieve', params: { query: 'test' } },
        ],
        transcript: [],
      } as KernelRunResult),
    } as unknown as AgentKernel;

    // Create mock runtime dispatcher
    mockRuntimeDispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        requestId: 'req-001',
        actionId: 'action-001',
        status: 'completed',
        targetRuntime: 'gateway',
        result: { activeWork: [] },
        createdAt: '2024-01-15T10:00:00.000Z',
      } as DispatchResult),
    };

    // Create mock planner runtime
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
    };

    // Create mock LLM adapter
    mockLlmAdapter = {
      providers: [{ providerId: 'test-provider' }],
      complete: vi.fn().mockResolvedValue({
        success: true,
        response: {
          id: 'resp-001',
          content: 'LLM response content',
          model: 'test-model',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      } as LLMResult),
      getProviderHealth: vi.fn().mockReturnValue({ healthy: true }),
      getHealthyProviders: vi.fn().mockReturnValue([{ providerId: 'test-provider', config: { capabilities: { supportsJsonMode: true } } }]),
    } as unknown as LLMAdapter;
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.FOREGROUND_KERNEL_RUNNER_ENABLED;
    } else {
      process.env.FOREGROUND_KERNEL_RUNNER_ENABLED = originalEnv;
    }
    vi.clearAllMocks();
  });

  describe('isForegroundKernelRunnerEnabled', () => {
    it('should return true when FOREGROUND_KERNEL_RUNNER_ENABLED is true', () => {
      process.env.FOREGROUND_KERNEL_RUNNER_ENABLED = 'true';
      expect(isForegroundKernelRunnerEnabled()).toBe(true);
    });

    it('should return false when FOREGROUND_KERNEL_RUNNER_ENABLED is not set', () => {
      delete process.env.FOREGROUND_KERNEL_RUNNER_ENABLED;
      expect(isForegroundKernelRunnerEnabled()).toBe(false);
    });

    it('should return false when FOREGROUND_KERNEL_RUNNER_ENABLED is false', () => {
      process.env.FOREGROUND_KERNEL_RUNNER_ENABLED = 'false';
      expect(isForegroundKernelRunnerEnabled()).toBe(false);
    });
  });

  describe('createForegroundKernelRunner', () => {
    it('should create a ForegroundKernelRunner instance', () => {
      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };
      const runner = createForegroundKernelRunner(deps);
      expect(runner).toBeDefined();
      expect(typeof runner.runTurn).toBe('function');
    });
  });

  describe('Scenario 1: answer_directly returns finalResponse (never calls AgentKernel)', () => {
    it('should return userVisibleResponse without calling AgentKernel', async () => {
      const userVisibleResponse = 'Hello! How can I help you today?';

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Simple greeting detected',
        userVisibleResponse,
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput({ message: 'Hello!' });
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.finalResponse).toBe('LLM response content');
      expect(result.decisionTrace.route).toBe('answer_directly');
      expect(mockAgentKernel.run).not.toHaveBeenCalled();
    });

    it('should fallback to userVisibleResponse when LLM fails', async () => {
      vi.mocked(mockLlmAdapter.complete).mockResolvedValue({
        success: false,
        error: {
          errorId: 'err-001',
          category: 'model_error',
          code: 'PROVIDER_ERROR',
          message: 'Provider unavailable',
          recoverability: 'retryable_later',
          source: { module: 'llm' },
          createdAt: '2024-01-15T10:00:00.000Z',
        },
        providerId: 'test-provider',
      } as LLMResult);

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Simple question',
        userVisibleResponse: 'Fallback response',
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.finalResponse).toBe('Fallback response');
      expect(mockAgentKernel.run).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 2: dispatch_tool calls AgentKernel.run()', () => {
    it('should call AgentKernel.run with correct parameters', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch required',
        suggestedTools: ['memory.retrieve'],
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput({ message: 'Search for something' });
      const result = await runner.runTurn(input);

      expect(mockAgentKernel.run).toHaveBeenCalled();
      const kernelCallArgs = vi.mocked(mockAgentKernel.run).mock.calls[0][0];
      expect(kernelCallArgs.agentId).toBe('foreground');
      expect(kernelCallArgs.agentType).toBe('main');
      expect(kernelCallArgs.userId).toBe('user-123');
      expect(kernelCallArgs.sessionId).toBe('session-456');
      expect(result.kernelResult).toBeDefined();
      expect(result.kernelResult?.finalResponse).toBe('Kernel processed response');
    });

    it('should handle AgentKernel failure gracefully', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch required',
        suggestedTools: ['memory.retrieve'],
      } as ForegroundDecision);

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'failed',
        finalResponse: undefined,
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
        error: { code: 'KERNEL_ERROR', message: 'Kernel failed' },
      } as KernelRunResult);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('KERNEL_ERROR');
    });
  });

  describe('Scenario 3: Tool results are processed through LLM (not returned as raw JSON)', () => {
    it('should return finalResponse from kernelResult, not raw tool result JSON', async () => {
      const llmProcessedResponse = 'Based on the search results, here is the answer...';

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch required',
        suggestedTools: ['web.search'],
      } as ForegroundDecision);

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'completed',
        finalResponse: llmProcessedResponse,
        iterationsUsed: 2,
        toolCalls: [
          { toolCallId: 'tc-001', toolName: 'web.search', params: { query: 'test' } },
        ],
        transcript: [],
      } as KernelRunResult);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      // The finalResponse should be the LLM-processed response, not raw JSON
      expect(result.finalResponse).toBe(llmProcessedResponse);
      expect(result.finalResponse).not.toContain('{"toolResult"');
      expect(result.finalResponse).not.toContain('raw');
      expect(result.finalResponse).not.toContain('tc-001');
    });

    it('should include toolCallSummaries in runtimeSummary', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch required',
        suggestedTools: ['memory.retrieve'],
      } as ForegroundDecision);

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'completed',
        finalResponse: 'Result',
        iterationsUsed: 1,
        toolCalls: [
          { toolCallId: 'tc-001', toolName: 'memory.retrieve', params: {} },
          { toolCallId: 'tc-002', toolName: 'transcript.search', params: {} },
        ],
        transcript: [],
      } as KernelRunResult);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.runtimeSummary).toBeDefined();
      expect(result.runtimeSummary?.toolCallSummaries).toHaveLength(2);
      expect(result.runtimeSummary?.toolCallSummaries?.[0].toolCallId).toBe('tc-001');
      expect(result.runtimeSummary?.toolCallSummaries?.[0].toolName).toBe('memory.retrieve');
      expect(result.runtimeSummary?.toolCallSummaries?.[0].status).toBe('completed');
    });
  });

  describe('Scenario 4: status_query creates server-side RuntimeAction', () => {
    it('should dispatch server-created RuntimeAction for status_query', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'status_query',
        requiresPlanner: false,
        reason: 'User requested status',
        userVisibleResponse: 'Checking status...',
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput({ message: 'What is the status?' });
      const result = await runner.runTurn(input);

      expect(mockRuntimeDispatcher.dispatch).toHaveBeenCalled();
      const dispatchCallArgs = vi.mocked(mockRuntimeDispatcher.dispatch).mock.calls[0][0];
      expect(dispatchCallArgs.action.actionType).toBe('query_active_work');
      expect(dispatchCallArgs.action.targetRuntime).toBe('gateway');
      expect(result.status).toBe('completed');
      expect(result.finalResponse).toBe('Checking status...');
    });

    it('should use decision.runtimeAction if provided by ForegroundAgent', async () => {
      const serverCreatedAction = {
        actionId: 'server-action-001',
        actionType: 'query_active_work' as const,
        targetRuntime: 'gateway' as const,
        targetAction: 'query',
        source: { sourceModule: 'foreground_agent' as const, sourceAction: 'status_query' },
        userId: 'user-123',
        sessionId: 'session-456',
        targetRef: {},
        payload: { queryType: 'active_work_status' },
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T10:00:00.000Z',
        status: 'created' as const,
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'status_query',
        requiresPlanner: false,
        reason: 'User requested status',
        userVisibleResponse: 'Checking status...',
        runtimeAction: serverCreatedAction,
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      await runner.runTurn(input);

      expect(mockRuntimeDispatcher.dispatch).toHaveBeenCalled();
      const dispatchCallArgs = vi.mocked(mockRuntimeDispatcher.dispatch).mock.calls[0][0];
      expect(dispatchCallArgs.action.actionId).toBe('server-action-001');
    });
  });

  describe('Scenario 5: spawn_planner creates planner run', () => {
    it('should call plannerRuntime.createPlannerRun with correct parameters', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'spawn_planner',
        requiresPlanner: true,
        reason: 'Complex task detected',
        userVisibleResponse: 'Creating a plan for your task...',
        estimatedSteps: 5,
        complexity: 'high',
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput({ message: 'Plan a complex project' });
      const result = await runner.runTurn(input);

      expect(mockPlannerRuntime.createPlannerRun).toHaveBeenCalledWith({
        objective: 'Creating a plan for your task...',
        userId: 'user-123',
        sessionId: 'session-456',
        contextBundle: {
          estimatedSteps: 5,
          complexity: 'high',
          reason: 'Complex task detected',
        },
      });
      expect(result.status).toBe('completed');
      expect(result.finalResponse).toContain("I've created a plan");
      expect(result.finalResponse).toContain('plan-001');
      expect(result.runtimeSummary?.plannerRunIds).toContain('planner-run-001');
    });

    it('should return natural language response, not raw planner result', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'spawn_planner',
        requiresPlanner: true,
        reason: 'Complex task',
        userVisibleResponse: 'Planning your task...',
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      // Response should be natural language, not JSON
      expect(result.finalResponse).not.toContain('{"plannerRunId"');
      expect(result.finalResponse).not.toContain('Spawning planner...');
      expect(result.finalResponse).toContain("I've created a plan");
    });

    it('should handle planner creation failure', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'spawn_planner',
        requiresPlanner: true,
        reason: 'Complex task',
        userVisibleResponse: 'Planning...',
      } as ForegroundDecision);

      vi.mocked(mockPlannerRuntime.createPlannerRun).mockImplementation(() => {
        throw new Error('Planner unavailable');
      });

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('SPAWN_PLANNER_ERROR');
      expect(result.error?.message).toContain('Planner unavailable');
    });
  });

  describe('Scenario 6: LLM-provided runtimeAction is ignored (server creates all runtime actions)', () => {
    it('should ignore runtimeAction from LLM and use server-created action', async () => {
      // ForegroundAgent strips runtimeAction from LLM output
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'status_query',
        requiresPlanner: false,
        reason: 'Status query',
        userVisibleResponse: 'Checking status...',
        // runtimeAction from LLM is NOT included here - ForegroundAgent strips it
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      await runner.runTurn(input);

      // The dispatched action should be server-created, not the LLM-provided one
      expect(mockRuntimeDispatcher.dispatch).toHaveBeenCalled();
      const dispatchCallArgs = vi.mocked(mockRuntimeDispatcher.dispatch).mock.calls[0][0];
      expect(dispatchCallArgs.action.actionId).not.toBe('malicious-action');
      expect(dispatchCallArgs.action.actionType).toBe('query_active_work');
    });
  });

  describe('Scenario 7: Disallowed suggestedTools are filtered', () => {
    it('should filter out tools not in tool catalog', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch',
        suggestedTools: ['memory.retrieve', 'nonexistent.tool', 'another.fake.tool'],
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      await runner.runTurn(input);

      expect(mockAgentKernel.run).toHaveBeenCalled();
      const kernelCallArgs = vi.mocked(mockAgentKernel.run).mock.calls[0][0];
      // Only valid tools should be in the projection
      expect(kernelCallArgs.toolProjection?.toolIds).toBeDefined();
      // The tool projection should filter out nonexistent tools
      const projectedTools = kernelCallArgs.toolProjection?.toolIds ?? [];
      expect(projectedTools).not.toContain('nonexistent.tool');
      expect(projectedTools).not.toContain('another.fake.tool');
    });

    it('should handle empty suggestedTools array', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch',
        suggestedTools: [],
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      await runner.runTurn(input);

      expect(mockAgentKernel.run).toHaveBeenCalled();
      const kernelCallArgs = vi.mocked(mockAgentKernel.run).mock.calls[0][0];
      expect(kernelCallArgs.toolProjection?.toolIds).toEqual([]);
    });
  });

  describe('Scenario 8: Route validation failure returns failed result', () => {
    it('should return failed result when feature flag is disabled', async () => {
      process.env.FOREGROUND_KERNEL_RUNNER_ENABLED = 'false';

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('FEATURE_DISABLED');
      expect(result.error?.message).toContain('not enabled');
      expect(mockForegroundAgent.processMessage).not.toHaveBeenCalled();
    });

    it('should return failed result on unhandled exception', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockRejectedValue(new Error('Agent crashed'));

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('UNHANDLED_ERROR');
      expect(result.error?.message).toContain('Agent crashed');
    });

    it('should handle non-Error exceptions', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockRejectedValue('String error');

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('UNHANDLED_ERROR');
    });
  });

  describe('Additional route handlers', () => {
    it('should handle cancel_or_modify_task route', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'cancel_or_modify_task',
        requiresPlanner: false,
        reason: 'Cancel requested',
        userVisibleResponse: 'Cancelling task...',
        targetRef: { plannerRunId: 'planner-run-123' },
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput({ message: 'Cancel my task' });
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.decisionTrace.route).toBe('cancel_or_modify_task');
    });

    it('should handle resume_existing_planner route', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'resume_existing_planner',
        requiresPlanner: true,
        reason: 'Resume requested',
        userVisibleResponse: 'Resuming task...',
        targetRef: { plannerRunId: 'planner-run-123' },
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput({ message: 'Continue my task' });
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.decisionTrace.route).toBe('resume_existing_planner');
      expect(mockPlannerRuntime.resumePlannerRun).toHaveBeenCalledWith(
        'planner-run-123',
        expect.objectContaining({ eventType: 'user_resume' })
      );
    });

    it('should handle approval_handler route', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'approval_handler',
        requiresPlanner: false,
        reason: 'Processing approval',
        userVisibleResponse: 'Processing your approval...',
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.decisionTrace.route).toBe('approval_handler');
    });

    it('should fallback to answer_directly for unknown routes', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'unknown_route' as ForegroundDecision['route'],
        requiresPlanner: false,
        reason: 'Unknown',
        userVisibleResponse: 'Fallback response',
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      // Falls back to answer_directly behavior
      expect(mockAgentKernel.run).not.toHaveBeenCalled();
    });
  });

  describe('buildRuntimeSummary', () => {
    it('should build runtimeSummary from KernelRunResult', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'completed',
        finalResponse: 'Done',
        iterationsUsed: 2,
        toolCalls: [
          { toolCallId: 'tc-001', toolName: 'memory.retrieve', params: {} },
          { toolCallId: 'tc-002', toolName: 'web.search', params: {} },
        ],
        transcript: [],
      };

      const summary = buildRuntimeSummary(kernelResult);

      expect(summary).toBeDefined();
      expect(summary?.toolCallSummaries).toHaveLength(2);
      expect(summary?.toolCallSummaries?.[0]).toEqual({
        toolCallId: 'tc-001',
        toolName: 'memory.retrieve',
        status: 'completed',
      });
      expect(summary?.toolCallSummaries?.[1]).toEqual({
        toolCallId: 'tc-002',
        toolName: 'web.search',
        status: 'completed',
      });
    });

    it('should return undefined for empty toolCalls', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'completed',
        finalResponse: 'Done',
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
      };

      const summary = buildRuntimeSummary(kernelResult);
      expect(summary).toBeUndefined();
    });

    it('should return undefined for undefined kernelResult', () => {
      const summary = buildRuntimeSummary(undefined);
      expect(summary).toBeUndefined();
    });

    it('should mark status as failed for failed kernel', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'failed',
        finalResponse: undefined,
        iterationsUsed: 1,
        toolCalls: [
          { toolCallId: 'tc-001', toolName: 'memory.retrieve', params: {} },
        ],
        transcript: [],
        error: { code: 'ERROR', message: 'Failed' },
      };

      const summary = buildRuntimeSummary(kernelResult);

      expect(summary?.toolCallSummaries?.[0].status).toBe('failed');
    });

    it('should mark status as failed for timeout kernel', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'timeout',
        finalResponse: undefined,
        iterationsUsed: 5,
        toolCalls: [
          { toolCallId: 'tc-001', toolName: 'memory.retrieve', params: {} },
        ],
        transcript: [],
      };

      const summary = buildRuntimeSummary(kernelResult);

      expect(summary?.toolCallSummaries?.[0].status).toBe('failed');
    });
  });

  describe('Event emission on failures', () => {
    let mockEventStore: EventStore;

    beforeEach(() => {
      mockEventStore = {
        append: vi.fn(),
        query: vi.fn().mockReturnValue([]),
        findByCorrelationId: vi.fn().mockReturnValue([]),
        findByCausationId: vi.fn().mockReturnValue([]),
        updateUserIdForSession: vi.fn().mockReturnValue(0),
      };
    });

    it('should emit search_subagent_failure event when searchSubagent returns failure', async () => {
      const mockSearchSubagent: SearchSubagent = {
        execute: vi.fn().mockResolvedValue({
          success: false,
          errorCode: 'MODEL_UNAVAILABLE' as const,
          message: 'Search model not available',
        }),
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Web search required',
        suggestedTools: ['web.search'],
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
        searchSubagent: mockSearchSubagent,
        eventStore: mockEventStore,
        agentConfig: {
          searchLlmProviderId: 'test-provider',
          searchLlmModel: 'test-model',
        } as AgentConfig,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput({ message: 'Search for cats' });
      await runner.runTurn(input);

      expect(mockEventStore.append).toHaveBeenCalled();
      const event = vi.mocked(mockEventStore.append).mock.calls[0][0] as EventRecord;
      expect(event.eventType).toBe('search_subagent_failure');
      expect(event.sourceModule).toBe('foreground_agent');
      expect(event.userId).toBe('user-123');
      expect(event.sessionId).toBe('session-456');
      expect(event.sensitivity).toBe('low');
      expect(event.payload).toMatchObject({
        errorCode: 'MODEL_UNAVAILABLE',
        errorMessage: 'Search model not available',
        fallbackBehavior: 'kernel_execution',
      });
    });

    it('should emit search_subagent_failure event when searchSubagent throws', async () => {
      const mockSearchSubagent: SearchSubagent = {
        execute: vi.fn().mockRejectedValue(new Error('Network timeout')),
      };

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Web search required',
        suggestedTools: ['web.search'],
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
        searchSubagent: mockSearchSubagent,
        eventStore: mockEventStore,
        agentConfig: {
          searchLlmProviderId: 'test-provider',
          searchLlmModel: 'test-model',
        } as AgentConfig,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput({ message: 'Search for cats' });
      await runner.runTurn(input);

      expect(mockEventStore.append).toHaveBeenCalled();
      const event = vi.mocked(mockEventStore.append).mock.calls[0][0] as EventRecord;
      expect(event.eventType).toBe('search_subagent_failure');
      expect(event.sourceModule).toBe('foreground_agent');
      expect(event.payload).toMatchObject({
        errorCode: 'SEARCH_SUBAGENT_EXCEPTION',
        errorMessage: 'Network timeout',
        fallbackBehavior: 'kernel_execution',
      });
    });

    it('should emit kernel_dispatch_failure event when kernelResult finalStatus is failed', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch',
        suggestedTools: ['memory.retrieve'],
      } as ForegroundDecision);

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'failed',
        finalResponse: undefined,
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
        error: { code: 'MODEL_ERROR', message: 'LLM provider returned an error' },
      } as KernelRunResult);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
        eventStore: mockEventStore,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      await runner.runTurn(input);

      expect(mockEventStore.append).toHaveBeenCalled();
      const event = vi.mocked(mockEventStore.append).mock.calls[0][0] as EventRecord;
      expect(event.eventType).toBe('kernel_dispatch_failure');
      expect(event.sourceModule).toBe('foreground_agent');
      expect(event.userId).toBe('user-123');
      expect(event.sessionId).toBe('session-456');
      expect(event.sensitivity).toBe('low');
      expect(event.payload).toMatchObject({
        errorCode: 'MODEL_ERROR',
        errorMessage: 'LLM provider returned an error',
        fallbackBehavior: 'user_visible_response',
      });
    });

    it('should emit kernel_dispatch_failure event with default error when kernel has no error object', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch',
        suggestedTools: ['memory.retrieve'],
      } as ForegroundDecision);

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'failed',
        finalResponse: undefined,
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
      } as KernelRunResult);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
        eventStore: mockEventStore,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      await runner.runTurn(input);

      expect(mockEventStore.append).toHaveBeenCalled();
      const event = vi.mocked(mockEventStore.append).mock.calls[0][0] as EventRecord;
      expect(event.eventType).toBe('kernel_dispatch_failure');
      expect(event.payload).toMatchObject({
        errorCode: 'KERNEL_RUN_FAILED',
        errorMessage: 'Kernel execution failed',
      });
    });

    it('should emit dispatch_tool_failure event on unhandled exception', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch',
        suggestedTools: ['memory.retrieve'],
      } as ForegroundDecision);

      vi.mocked(mockAgentKernel.run).mockRejectedValue(new Error('Kernel crashed'));

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
        eventStore: mockEventStore,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      await runner.runTurn(input);

      expect(mockEventStore.append).toHaveBeenCalled();
      const event = vi.mocked(mockEventStore.append).mock.calls[0][0] as EventRecord;
      expect(event.eventType).toBe('dispatch_tool_failure');
      expect(event.sourceModule).toBe('foreground_agent');
      expect(event.payload).toMatchObject({
        errorCode: 'DISPATCH_TOOL_ERROR',
        errorMessage: 'Kernel crashed',
        fallbackBehavior: 'user_visible_response',
      });
    });

    it('should not call eventStore when eventStore is undefined', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch',
        suggestedTools: ['memory.retrieve'],
      } as ForegroundDecision);

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'failed',
        finalResponse: undefined,
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
        error: { code: 'MODEL_ERROR', message: 'LLM error' },
      } as KernelRunResult);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('MODEL_ERROR');
      expect(mockEventStore.append).not.toHaveBeenCalled();
    });

    it('should include error code in foreground error message for kernel failure', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch',
        suggestedTools: ['memory.retrieve'],
      } as ForegroundDecision);

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'failed',
        finalResponse: undefined,
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
        error: { code: 'TIMEOUT_ERROR', message: 'Kernel execution timed out' },
      } as KernelRunResult);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
        eventStore: mockEventStore,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('failed');
      expect(result.finalResponse).toContain('TIMEOUT_ERROR');
      expect(result.finalResponse).not.toBe('Tool execution failed.');
    });

    it('should include error code in foreground error message for dispatch failure', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch',
        suggestedTools: ['memory.retrieve'],
      } as ForegroundDecision);

      vi.mocked(mockAgentKernel.run).mockRejectedValue(new Error('Kernel unavailable'));

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
        eventStore: mockEventStore,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('failed');
      expect(result.finalResponse).toContain('DISPATCH_TOOL_ERROR');
      expect(result.finalResponse).not.toBe('Tool execution failed.');
    });
  });

  describe('Conversation history handling', () => {
    it('should include conversation history in direct answer LLM call', async () => {
      const state = createMockForegroundState();
      state.conversationHistory = [
        { turnId: 'turn-001', role: 'user', message: 'Previous question', timestamp: '2024-01-15T09:00:00.000Z' },
        { turnId: 'turn-001', role: 'assistant', message: 'Previous answer', timestamp: '2024-01-15T09:00:10.000Z' },
      ];

      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Direct answer',
        userVisibleResponse: 'Response',
      } as ForegroundDecision);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput({ foregroundState: state, message: 'New question' });
      await runner.runTurn(input);

      expect(mockLlmAdapter.complete).toHaveBeenCalled();
      const llmCallArgs = vi.mocked(mockLlmAdapter.complete).mock.calls[0][0];
      expect(llmCallArgs.messages).toHaveLength(3); // 2 history + 1 current
      expect(llmCallArgs.messages[0].role).toBe('user');
      expect(llmCallArgs.messages[0].content).toBe('Previous question');
      expect(llmCallArgs.messages[1].role).toBe('assistant');
      expect(llmCallArgs.messages[1].content).toBe('Previous answer');
      expect(llmCallArgs.messages[2].role).toBe('user');
      expect(llmCallArgs.messages[2].content).toBe('New question');
    });
  });

  describe('Non-completed kernel statuses treated as failures', () => {
    let mockEventStore: EventStore;

    beforeEach(() => {
      mockEventStore = {
        append: vi.fn(),
        query: vi.fn().mockReturnValue([]),
        findByCorrelationId: vi.fn().mockReturnValue([]),
        findByCausationId: vi.fn().mockReturnValue([]),
        updateUserIdForSession: vi.fn().mockReturnValue(0),
      };
    });

    it('should treat timeout as failure and emit kernel_dispatch_failure event', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch',
        suggestedTools: ['memory.retrieve'],
      } as ForegroundDecision);

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'timeout',
        finalResponse: undefined,
        iterationsUsed: 5,
        toolCalls: [
          { toolCallId: 'tc-001', toolName: 'memory.retrieve', params: {} },
        ],
        transcript: [],
      } as KernelRunResult);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
        eventStore: mockEventStore,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('KERNEL_TIMEOUT');
      expect(result.error?.message).toBe('Kernel execution timed out');
      expect(result.finalResponse).toContain('KERNEL_TIMEOUT');
      expect(mockEventStore.append).toHaveBeenCalled();
      const event = vi.mocked(mockEventStore.append).mock.calls[0][0] as EventRecord;
      expect(event.eventType).toBe('kernel_dispatch_failure');
      expect(event.payload).toMatchObject({
        errorCode: 'KERNEL_TIMEOUT',
        errorMessage: 'Kernel execution timed out',
      });
    });

    it('should treat max_iterations_reached as failure and emit kernel_dispatch_failure event', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch',
        suggestedTools: ['memory.retrieve'],
      } as ForegroundDecision);

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'max_iterations_reached',
        finalResponse: undefined,
        iterationsUsed: 10,
        toolCalls: [
          { toolCallId: 'tc-001', toolName: 'memory.retrieve', params: {} },
        ],
        transcript: [],
      } as KernelRunResult);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
        eventStore: mockEventStore,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('KERNEL_MAX_ITERATIONS');
      expect(result.error?.message).toBe('Kernel reached maximum iterations');
      expect(result.finalResponse).toContain('KERNEL_MAX_ITERATIONS');
      expect(mockEventStore.append).toHaveBeenCalled();
      const event = vi.mocked(mockEventStore.append).mock.calls[0][0] as EventRecord;
      expect(event.eventType).toBe('kernel_dispatch_failure');
      expect(event.payload).toMatchObject({
        errorCode: 'KERNEL_MAX_ITERATIONS',
        errorMessage: 'Kernel reached maximum iterations',
      });
    });

    it('should include runtimeSummary even for non-completed statuses', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch',
        suggestedTools: ['memory.retrieve'],
      } as ForegroundDecision);

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'timeout',
        finalResponse: undefined,
        iterationsUsed: 5,
        toolCalls: [
          { toolCallId: 'tc-001', toolName: 'memory.retrieve', params: {} },
        ],
        transcript: [],
      } as KernelRunResult);

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
        eventStore: mockEventStore,
      };

      const runner = createForegroundKernelRunner(deps);
      const input = createMockInput();
      const result = await runner.runTurn(input);

      expect(result.runtimeSummary).toBeDefined();
      expect(result.runtimeSummary?.toolCallSummaries).toHaveLength(1);
      expect(result.runtimeSummary?.toolCallSummaries?.[0].status).toBe('failed');
    });
  });

  describe('eventStore injection in createApiContext', () => {
    it('ForegroundKernelRunnerDeps includes eventStore field', () => {
      const mockEventStore: EventStore = {
        append: vi.fn(),
        query: vi.fn().mockReturnValue([]),
        findByCorrelationId: vi.fn().mockReturnValue([]),
        findByCausationId: vi.fn().mockReturnValue([]),
        updateUserIdForSession: vi.fn().mockReturnValue(0),
      };

      const deps = {
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
        eventStore: mockEventStore,
      };

      const runner = createForegroundKernelRunner(deps);
      expect(runner).toBeDefined();
      expect(typeof runner.runTurn).toBe('function');
    });
  });
});
