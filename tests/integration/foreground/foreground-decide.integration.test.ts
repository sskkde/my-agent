import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createForegroundAgent } from '../../../src/foreground/foreground-agent.js';
import {
  createForegroundKernelRunner,
} from '../../../src/foreground/foreground-kernel-runner.js';
import type { ForegroundTurnInput } from '../../../src/foreground/foreground-runner-types.js';
import type { ForegroundSessionState } from '../../../src/foreground/types.js';
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js';
import type { KernelRunResult } from '../../../src/kernel/types.js';
import type { RuntimeDispatcher, DispatchResult } from '../../../src/dispatcher/types.js';
import type { PlannerRuntime } from '../../../src/planner/planner-runtime.js';
import type { LLMAdapter } from '../../../src/llm/adapter.js';
import type { LLMResult, LLMResponse, ToolCall } from '../../../src/llm/types.js';
import type { HydratedSessionState } from '../../../src/gateway/types.js';
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js';

function createMockForegroundState(overrides?: {
  activePlannerRunIds?: string[];
  activeBackgroundRunIds?: string[];
}): ForegroundSessionState {
  return {
    hydratedSession: {
      userContext: {
        userId: 'user-001',
        sessionId: 'session-001',
        preferences: {},
      },
      sessionContext: {
        messageCount: 1,
        lastActivityAt: '2024-01-15T10:00:00.000Z',
        activePlannerRunIds: overrides?.activePlannerRunIds ?? [],
        activeBackgroundRunIds: overrides?.activeBackgroundRunIds ?? [],
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

function createMockInput(overrides?: Partial<ForegroundTurnInput>): ForegroundTurnInput {
  const state = createMockForegroundState();
  return {
    userId: 'user-001',
    sessionId: 'session-001',
    turnId: 'turn-001',
    message: 'Hello!',
    timestamp: '2024-01-15T10:00:00.000Z',
    hydratedState: state.hydratedSession,
    foregroundState: state,
    ...overrides,
  };
}

function createDecideToolCall(params: {
  route: string;
  requiresPlanner?: boolean;
  reason?: string;
  userVisibleResponse?: string;
  suggestedTools?: string[];
  estimatedSteps?: number;
  complexity?: string;
  targetRef?: { plannerRunId?: string; planId?: string };
}): ToolCall {
  return {
    id: `tc-decide-${Date.now()}`,
    type: 'function',
    function: {
      name: 'foreground.decide',
      arguments: JSON.stringify({
        schemaVersion: '1.0',
        route: params.route,
        requiresPlanner: params.requiresPlanner ?? false,
        reason: params.reason ?? `Routing to ${params.route}`,
        userVisibleResponse: params.userVisibleResponse,
        suggestedTools: params.suggestedTools,
        estimatedSteps: params.estimatedSteps,
        complexity: params.complexity,
        targetRef: params.targetRef,
      }),
    },
  };
}

function createDecideLLMResult(toolCall: ToolCall): LLMResult {
  const response: LLMResponse = {
    id: 'resp-decide-001',
    content: '',
    toolCalls: [toolCall],
    model: 'gpt-4o-mini',
    role: 'assistant',
    finishReason: 'tool_calls',
    createdAt: '2024-01-15T10:00:00.000Z',
  };
  return {
    success: true,
    response,
    providerId: 'mock-provider',
  };
}

function createMockLLMAdapter(result: LLMResult): LLMAdapter {
  return {
    config: {
      providers: [],
      defaultTimeoutMs: 10000,
      enableCircuitBreaker: false,
    },
    providers: [],
    complete: vi.fn().mockResolvedValue(result),
    stream: async function* () {},
    addProvider: vi.fn(),
    removeProvider: vi.fn(),
    getProvider: vi.fn(),
    getHealthyProviders: vi.fn().mockReturnValue([{
      id: 'mock-provider',
      config: {
        id: 'mock-provider',
        name: 'Mock Provider',
        enabled: true,
        priority: 1,
        timeoutMs: 10000,
        retries: 2,
        capabilities: {
          supportsStreaming: false,
          supportsFunctionCalling: true,
          supportsJsonMode: true,
          supportsVision: false,
          maxTokens: 4096,
          supportedModels: [],
        },
      },
      circuitBreaker: { state: 'CLOSED', canExecute: () => true, recordSuccess: () => {}, recordFailure: () => {} },
      health: 'healthy',
      stats: { totalRequests: 0, successfulRequests: 0, failedRequests: 0, timeoutRequests: 0, averageLatencyMs: 0, healthStatus: 'healthy' },
      isHealthy: () => true,
      getStats: () => ({ totalRequests: 0, successfulRequests: 0, failedRequests: 0, timeoutRequests: 0, averageLatencyMs: 0, healthStatus: 'healthy' }),
      updateConfig: () => {},
      resetStats: () => {},
      complete: async () => result,
    }]),
    updateProviderPriority: vi.fn(),
  } as unknown as LLMAdapter;
}

function createMockModelInputBuilder(): ModelInputBuilder {
  return {
    build: vi.fn().mockResolvedValue({
      messages: [
        { role: 'system', content: 'You are a routing assistant.' },
        { role: 'user', content: 'Hello!' },
      ],
      segments: {
        staticPrefix: 'system prefix',
        tenantProject: '',
        toolPlane: '',
        contextBundle: '',
      },
      segmentHashes: {
        segmentA: 'hash-a',
        segmentB: 'hash-b',
        segmentC: 'hash-c',
        segmentD: 'hash-d',
      },
      metadata: {
        mode: 'routing_tool_call',
        agentKind: 'foreground',
        providerFamily: 'openai',
        messageCount: 2,
      },
    }),
  } as unknown as ModelInputBuilder;
}

describe('foreground.decide Routing Integration Tests', () => {
  let originalDecideEnabled: string | undefined;
  let originalModelInputBuilder: string | undefined;
  let originalKernelRunnerEnabled: string | undefined;

  beforeEach(() => {
    originalDecideEnabled = process.env.FOREGROUND_DECIDE_ENABLED;
    originalModelInputBuilder = process.env.MODEL_INPUT_BUILDER_ENABLED;
    originalKernelRunnerEnabled = process.env.FOREGROUND_KERNEL_RUNNER_ENABLED;
    process.env.FOREGROUND_DECIDE_ENABLED = 'true';
    process.env.FOREGROUND_KERNEL_RUNNER_ENABLED = 'true';
    delete process.env.MODEL_INPUT_BUILDER_ENABLED;
  });

  afterEach(() => {
    if (originalDecideEnabled === undefined) {
      delete process.env.FOREGROUND_DECIDE_ENABLED;
    } else {
      process.env.FOREGROUND_DECIDE_ENABLED = originalDecideEnabled;
    }
    if (originalModelInputBuilder === undefined) {
      delete process.env.MODEL_INPUT_BUILDER_ENABLED;
    } else {
      process.env.MODEL_INPUT_BUILDER_ENABLED = originalModelInputBuilder;
    }
    if (originalKernelRunnerEnabled === undefined) {
      delete process.env.FOREGROUND_KERNEL_RUNNER_ENABLED;
    } else {
      process.env.FOREGROUND_KERNEL_RUNNER_ENABLED = originalKernelRunnerEnabled;
    }
    vi.clearAllMocks();
  });

  describe('answer_directly via foreground.decide', () => {
    it('reaches direct answer handler without calling AgentKernel', async () => {
      const decideToolCall = createDecideToolCall({
        route: 'answer_directly',
        reason: 'Simple greeting',
        userVisibleResponse: 'Hello! How can I help you today?',
      });
      const llmResult = createDecideLLMResult(decideToolCall);

      const directAnswerResult: LLMResult = {
        success: true,
        response: {
          id: 'resp-direct-001',
          content: 'Hello! I am your AI assistant. How can I assist you?',
          model: 'gpt-4o-mini',
          role: 'assistant',
          finishReason: 'stop',
          createdAt: '2024-01-15T10:00:00.000Z',
        },
        providerId: 'mock-provider',
      };

      const mockLlmAdapter = createMockLLMAdapter(llmResult);
      vi.mocked(mockLlmAdapter.complete)
        .mockResolvedValueOnce(llmResult)
        .mockResolvedValueOnce(directAnswerResult);

      const foregroundAgent = createForegroundAgent({
        llmAdapter: mockLlmAdapter,
        modelInputBuilder: createMockModelInputBuilder(),
      });

      const mockAgentKernel = { run: vi.fn() } as unknown as AgentKernel;

      const runner = createForegroundKernelRunner({
        foregroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: { dispatch: vi.fn() } as unknown as RuntimeDispatcher,
        plannerRuntime: { createPlannerRun: vi.fn(), resumePlannerRun: vi.fn() } as unknown as PlannerRuntime,
        llmAdapter: mockLlmAdapter,
      });

      const state = createMockForegroundState();
      const input = createMockInput({ message: 'Hello!', foregroundState: state });
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.decisionTrace.route).toBe('answer_directly');
      expect(mockAgentKernel.run).not.toHaveBeenCalled();
    });
  });

  describe('dispatch_tool via foreground.decide', () => {
    it('routes to AgentKernel with suggestedTools in kernel config', async () => {
      const decideToolCall = createDecideToolCall({
        route: 'dispatch_tool',
        reason: 'User needs memory retrieval',
        suggestedTools: ['memory.retrieve'],
      });
      const llmResult = createDecideLLMResult(decideToolCall);

      const mockLlmAdapter = createMockLLMAdapter(llmResult);

      const foregroundAgent = createForegroundAgent({
        llmAdapter: mockLlmAdapter,
        modelInputBuilder: createMockModelInputBuilder(),
      });

      const mockAgentKernel = {
        run: vi.fn().mockResolvedValue({
          finalStatus: 'completed',
          finalResponse: 'Retrieved memory: Project Mercury details.',
          iterationsUsed: 1,
          toolCalls: [
            { toolCallId: 'tc-mem-001', toolName: 'memory.retrieve', params: { query: 'project' } },
          ],
          transcript: [],
        } as KernelRunResult),
      } as unknown as AgentKernel;

      const runner = createForegroundKernelRunner({
        foregroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: { dispatch: vi.fn() } as unknown as RuntimeDispatcher,
        plannerRuntime: { createPlannerRun: vi.fn(), resumePlannerRun: vi.fn() } as unknown as PlannerRuntime,
        llmAdapter: mockLlmAdapter,
      });

      const state = createMockForegroundState();
      const input = createMockInput({ message: 'What do you remember about my project?', foregroundState: state });
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.decisionTrace.route).toBe('dispatch_tool');
      expect(mockAgentKernel.run).toHaveBeenCalledTimes(1);
      expect(result.kernelResult).toBeDefined();
      expect(result.kernelResult?.toolCalls).toHaveLength(1);
      expect(result.runtimeSummary?.toolCallSummaries).toHaveLength(1);
    });

    it('suggestedTools from decide tool call reaches kernel input', async () => {
      const decideToolCall = createDecideToolCall({
        route: 'dispatch_tool',
        reason: 'Search documentation',
        suggestedTools: ['docs.search', 'transcript.search'],
      });
      const llmResult = createDecideLLMResult(decideToolCall);

      const mockLlmAdapter = createMockLLMAdapter(llmResult);

      const foregroundAgent = createForegroundAgent({
        llmAdapter: mockLlmAdapter,
        modelInputBuilder: createMockModelInputBuilder(),
      });

      const mockAgentKernel = {
        run: vi.fn().mockResolvedValue({
          finalStatus: 'completed',
          finalResponse: 'Found documentation about TypeScript interfaces.',
          iterationsUsed: 1,
          toolCalls: [
            { toolCallId: 'tc-docs-001', toolName: 'docs.search', params: { query: 'typescript' } },
          ],
          transcript: [],
        } as KernelRunResult),
      } as unknown as AgentKernel;

      const runner = createForegroundKernelRunner({
        foregroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: { dispatch: vi.fn() } as unknown as RuntimeDispatcher,
        plannerRuntime: { createPlannerRun: vi.fn(), resumePlannerRun: vi.fn() } as unknown as PlannerRuntime,
        llmAdapter: mockLlmAdapter,
      });

      const state = createMockForegroundState();
      const input = createMockInput({ message: 'Search docs for TypeScript', foregroundState: state });
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.decisionTrace.route).toBe('dispatch_tool');
      expect(result.decisionTrace.suggestedTools).toContain('docs.search');
      expect(result.decisionTrace.suggestedTools).toContain('transcript.search');
      expect(mockAgentKernel.run).toHaveBeenCalledTimes(1);
    });
  });

  describe('status_query via foreground.decide', () => {
    it('creates server-side runtimeAction and dispatches it', async () => {
      const decideToolCall = createDecideToolCall({
        route: 'status_query',
        reason: 'User asked about task progress',
        userVisibleResponse: 'Checking your active tasks...',
      });
      const llmResult = createDecideLLMResult(decideToolCall);

      const mockLlmAdapter = createMockLLMAdapter(llmResult);

      const foregroundAgent = createForegroundAgent({
        llmAdapter: mockLlmAdapter,
        modelInputBuilder: createMockModelInputBuilder(),
      });

      const mockDispatchResult: DispatchResult = {
        requestId: 'req-status-001',
        actionId: 'action-status-001',
        status: 'completed',
        targetRuntime: 'gateway',
        result: { activeWork: [] },
        createdAt: '2024-01-15T10:00:00.000Z',
      };

      const mockRuntimeDispatcher = {
        dispatch: vi.fn().mockResolvedValue(mockDispatchResult),
      } as unknown as RuntimeDispatcher;

      const runner = createForegroundKernelRunner({
        foregroundAgent,
        agentKernel: { run: vi.fn() } as unknown as AgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: { createPlannerRun: vi.fn(), resumePlannerRun: vi.fn() } as unknown as PlannerRuntime,
        llmAdapter: mockLlmAdapter,
      });

      const state = createMockForegroundState();
      const input = createMockInput({ message: 'What is the status of my tasks?', foregroundState: state });
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.decisionTrace.route).toBe('status_query');
      expect(result.decisionTrace.runtimeAction).toBeDefined();
      expect(result.decisionTrace.runtimeAction?.actionType).toBe('query_active_work');
      expect(result.decisionTrace.runtimeAction?.targetRuntime).toBe('gateway');
      expect(mockRuntimeDispatcher.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('spawn_planner via foreground.decide', () => {
    it('creates a planner run with correct objective', async () => {
      const decideToolCall = createDecideToolCall({
        route: 'spawn_planner',
        requiresPlanner: true,
        reason: 'Complex multi-step task',
        userVisibleResponse: 'Planning your trip to Shanghai...',
        estimatedSteps: 5,
        complexity: 'high',
      });
      const llmResult = createDecideLLMResult(decideToolCall);

      const mockLlmAdapter = createMockLLMAdapter(llmResult);

      const foregroundAgent = createForegroundAgent({
        llmAdapter: mockLlmAdapter,
        modelInputBuilder: createMockModelInputBuilder(),
      });

      const mockPlannerResult = {
        plannerRunId: 'planner-run-001',
        planId: 'plan-001',
        status: 'initializing',
        actions: [],
      };

      const mockPlannerRuntime = {
        createPlannerRun: vi.fn().mockReturnValue(mockPlannerResult),
        resumePlannerRun: vi.fn(),
      } as unknown as PlannerRuntime;

      const runner = createForegroundKernelRunner({
        foregroundAgent,
        agentKernel: { run: vi.fn() } as unknown as AgentKernel,
        runtimeDispatcher: { dispatch: vi.fn() } as unknown as RuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      });

      const state = createMockForegroundState();
      const input = createMockInput({ message: 'Plan my trip to Shanghai with hotels and meetings', foregroundState: state });
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.decisionTrace.route).toBe('spawn_planner');
      expect(result.decisionTrace.requiresPlanner).toBe(true);
      expect(mockPlannerRuntime.createPlannerRun).toHaveBeenCalledTimes(1);
      const createCall = vi.mocked(mockPlannerRuntime.createPlannerRun).mock.calls[0]![0];
      expect(createCall.objective).toBeDefined();
      expect(createCall.userId).toBe('user-001');
      expect(createCall.sessionId).toBe('session-001');
      expect(result.runtimeSummary?.plannerRunIds).toContain('planner-run-001');
    });
  });

  describe('cancel_or_modify_task via foreground.decide', () => {
    it('validates active work and dispatches cancel runtime action', async () => {
      const decideToolCall = createDecideToolCall({
        route: 'cancel_or_modify_task',
        reason: 'User wants to cancel the running task',
        userVisibleResponse: 'Cancelling your active task...',
      });
      const llmResult = createDecideLLMResult(decideToolCall);

      const mockLlmAdapter = createMockLLMAdapter(llmResult);

      const foregroundAgent = createForegroundAgent({
        llmAdapter: mockLlmAdapter,
        modelInputBuilder: createMockModelInputBuilder(),
      });

      const mockDispatchResult: DispatchResult = {
        requestId: 'req-cancel-001',
        actionId: 'action-cancel-001',
        status: 'completed',
        targetRuntime: 'planner_runtime',
        result: { cancelled: true },
        createdAt: '2024-01-15T10:00:00.000Z',
      };

      const mockRuntimeDispatcher = {
        dispatch: vi.fn().mockResolvedValue(mockDispatchResult),
      } as unknown as RuntimeDispatcher;

      const runner = createForegroundKernelRunner({
        foregroundAgent,
        agentKernel: { run: vi.fn() } as unknown as AgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: { createPlannerRun: vi.fn(), resumePlannerRun: vi.fn() } as unknown as PlannerRuntime,
        llmAdapter: mockLlmAdapter,
      });

      const state = createMockForegroundState({ activePlannerRunIds: ['planner-run-active-001'] });
      const input = createMockInput({ message: 'Cancel the current task', foregroundState: state });
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.decisionTrace.route).toBe('cancel_or_modify_task');
      expect(result.decisionTrace.targetRef).toBeDefined();
      expect(result.decisionTrace.targetRef?.plannerRunId).toBe('planner-run-active-001');
      expect(result.decisionTrace.runtimeAction).toBeDefined();
      expect(mockRuntimeDispatcher.dispatch).toHaveBeenCalledTimes(1);
    });

    it('returns answer_directly when no active work found for cancel', async () => {
      const decideToolCall = createDecideToolCall({
        route: 'cancel_or_modify_task',
        reason: 'User wants to cancel something',
        userVisibleResponse: 'Cancelling...',
      });
      const llmResult = createDecideLLMResult(decideToolCall);

      const mockLlmAdapter = createMockLLMAdapter(llmResult);

      const foregroundAgent = createForegroundAgent({
        llmAdapter: mockLlmAdapter,
        modelInputBuilder: createMockModelInputBuilder(),
      });

      const runner = createForegroundKernelRunner({
        foregroundAgent,
        agentKernel: { run: vi.fn() } as unknown as AgentKernel,
        runtimeDispatcher: { dispatch: vi.fn() } as unknown as RuntimeDispatcher,
        plannerRuntime: { createPlannerRun: vi.fn(), resumePlannerRun: vi.fn() } as unknown as PlannerRuntime,
        llmAdapter: mockLlmAdapter,
      });

      const state = createMockForegroundState();
      const input = createMockInput({ message: 'Cancel the task', foregroundState: state });
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.decisionTrace.route).toBe('answer_directly');
    });
  });

  describe('resume_existing_planner via foreground.decide', () => {
    it('resumes planner with targetRef.plannerRunId', async () => {
      const decideToolCall = createDecideToolCall({
        route: 'resume_existing_planner',
        reason: 'User wants to continue the previous plan',
        userVisibleResponse: 'Resuming your previous task...',
        targetRef: { plannerRunId: 'planner-run-paused-001' },
      });
      const llmResult = createDecideLLMResult(decideToolCall);

      const mockLlmAdapter = createMockLLMAdapter(llmResult);

      const foregroundAgent = createForegroundAgent({
        llmAdapter: mockLlmAdapter,
        modelInputBuilder: createMockModelInputBuilder(),
      });

      const mockPlannerRuntime = {
        createPlannerRun: vi.fn(),
        resumePlannerRun: vi.fn(),
      } as unknown as PlannerRuntime;

      const runner = createForegroundKernelRunner({
        foregroundAgent,
        agentKernel: { run: vi.fn() } as unknown as AgentKernel,
        runtimeDispatcher: { dispatch: vi.fn() } as unknown as RuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      });

      const state = createMockForegroundState({ activePlannerRunIds: ['planner-run-paused-001'] });
      const input = createMockInput({ message: 'Continue the previous plan', foregroundState: state });
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.decisionTrace.route).toBe('resume_existing_planner');
      expect(mockPlannerRuntime.resumePlannerRun).toHaveBeenCalledTimes(1);
      expect(mockPlannerRuntime.resumePlannerRun).toHaveBeenCalledWith(
        'planner-run-paused-001',
        expect.objectContaining({ eventType: 'user_resume' }),
      );
      expect(result.runtimeSummary?.plannerRunIds).toContain('planner-run-paused-001');
    });

    it('uses first active planner run ID when no targetRef provided', async () => {
      const decideToolCall = createDecideToolCall({
        route: 'resume_existing_planner',
        reason: 'User wants to continue',
        userVisibleResponse: 'Resuming...',
      });
      const llmResult = createDecideLLMResult(decideToolCall);

      const mockLlmAdapter = createMockLLMAdapter(llmResult);

      const foregroundAgent = createForegroundAgent({
        llmAdapter: mockLlmAdapter,
        modelInputBuilder: createMockModelInputBuilder(),
      });

      const mockPlannerRuntime = {
        createPlannerRun: vi.fn(),
        resumePlannerRun: vi.fn(),
      } as unknown as PlannerRuntime;

      const runner = createForegroundKernelRunner({
        foregroundAgent,
        agentKernel: { run: vi.fn() } as unknown as AgentKernel,
        runtimeDispatcher: { dispatch: vi.fn() } as unknown as RuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      });

      const state = createMockForegroundState({ activePlannerRunIds: ['planner-run-existing-001'] });
      const input = createMockInput({ message: 'Resume my plan', foregroundState: state });
      const result = await runner.runTurn(input);

      expect(result.status).toBe('completed');
      expect(result.decisionTrace.route).toBe('resume_existing_planner');
      expect(result.decisionTrace.targetRef?.plannerRunId).toBe('planner-run-existing-001');
      expect(mockPlannerRuntime.resumePlannerRun).toHaveBeenCalledTimes(1);
    });
  });
});
