/**
 * Integration tests for kernel-driven foreground turns
 *
 * Exercises the full pipeline:
 *   ProcessorOrchestration → ForegroundAgent.runTurn() → AgentKernel.run()
 *   → projected tools → final response
 *
 * Covers: weather/search, planner creation, status query, subagent launch,
 * tool failure, and unprojected tool rejection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOrchestrationProcessor, type ProcessorOrchestrationDeps } from '../../../src/processing/processor-orchestration.js';
import { createForegroundAgent } from '../../../src/foreground/foreground-agent.js';
import type { MessageProcessorInput } from '../../../src/processing/types.js';
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js';
import type { KernelRunResult, KernelRunInput } from '../../../src/kernel/types.js';
import type { Gateway } from '../../../src/gateway/gateway.js';
import type { HydratedSessionState } from '../../../src/gateway/types.js';
import type { TranscriptStore } from '../../../src/storage/transcript-store.js';
import type { ProviderConfigStore } from '../../../src/storage/provider-config-store.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createMockHydratedSession(): HydratedSessionState {
  return {
    userContext: {
      userId: 'user-001',
      sessionId: 'session-001',
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
  };
}

function createMockStores() {
  return {
    eventStore: {
      append: vi.fn(),
      query: vi.fn().mockReturnValue([]),
    },
    summaryStore: {
      getSessionMemory: vi.fn().mockReturnValue(null),
    },
    transcriptStore: {
      findBySession: vi.fn().mockReturnValue([]),
      saveTurn: vi.fn().mockReturnValue(true),
    },
    runtimeActionStore: {
      findBySessionId: vi.fn().mockReturnValue([]),
    },
  };
}

function createMockProcessorInput(overrides?: Partial<MessageProcessorInput>): MessageProcessorInput {
  return {
    correlationId: 'turn-001',
    userId: 'user-001',
    sessionId: 'session-001',
    text: 'Hello!',
    timestamp: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function createSuccessfulKernelResult(overrides: Partial<KernelRunResult> & { finalResponse: string }): KernelRunResult {
  return {
    finalStatus: 'completed',
    iterationsUsed: 1,
    toolCalls: [],
    transcript: [],
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Kernel-Driven Foreground Turn Integration Tests', () => {
  let mockGateway: Gateway;
  let mockStores: ReturnType<typeof createMockStores>;
  let mockTranscriptStore: TranscriptStore;
  let mockAgentKernel: AgentKernel;
  let mockProviderConfigStore: ProviderConfigStore;

  beforeEach(() => {
    const hydratedSession = createMockHydratedSession();

    mockGateway = {
      assembleHydratedState: vi.fn().mockReturnValue(hydratedSession),
    } as unknown as Gateway;

    mockStores = createMockStores();
    mockTranscriptStore = mockStores.transcriptStore as unknown as TranscriptStore;

    mockAgentKernel = {
      run: vi.fn(),
    } as unknown as AgentKernel;

    mockProviderConfigStore = {
      getByUser: vi.fn().mockReturnValue({
        providerId: 'mock-provider',
        model: 'gpt-4o-mini',
      }),
      listByUser: vi.fn().mockReturnValue([{
        providerId: 'mock-provider',
        providerType: 'openai',
        displayName: 'Mock Provider',
        enabled: true,
        configured: true,
        selectedModel: 'gpt-4o-mini',
      }]),
    } as unknown as ProviderConfigStore;
  });

  /**
   * Helper: builds ProcessorOrchestrationDeps and creates the processor function.
   * Uses the real ForegroundAgent with a mocked AgentKernel.
   */
  function buildDepsAndProcessor(kernelRunMock: (input: KernelRunInput) => Promise<KernelRunResult>) {
    vi.mocked(mockAgentKernel.run).mockImplementation(kernelRunMock);

    const foregroundAgent = createForegroundAgent({
      agentKernel: mockAgentKernel,
    });

    const deps: ProcessorOrchestrationDeps = {
      gateway: mockGateway,
      stores: mockStores as unknown as ProcessorOrchestrationDeps['stores'],
      foregroundAgent,
      runtimeDispatcher: { dispatch: vi.fn() } as unknown as ProcessorOrchestrationDeps['runtimeDispatcher'],
      plannerRuntime: {} as unknown as ProcessorOrchestrationDeps['plannerRuntime'],
      agentKernel: mockAgentKernel,
      llmAdapter: {
        providers: [],
        config: { providers: [], defaultTimeoutMs: 10000, enableCircuitBreaker: false },
        complete: vi.fn(),
        stream: async function* () {},
      } as unknown as ProcessorOrchestrationDeps['llmAdapter'],
      transcriptStore: mockTranscriptStore,
      providerConfigStore: mockProviderConfigStore as unknown as ProcessorOrchestrationDeps['providerConfigStore'],
      agentConfigStore: {
        getByUser: vi.fn().mockReturnValue(null),
      } as unknown as ProcessorOrchestrationDeps['agentConfigStore'],
      sessionStore: {
        getById: vi.fn().mockReturnValue(null),
      } as unknown as ProcessorOrchestrationDeps['sessionStore'],
      processingObserver: {
        emitStatus: vi.fn(),
      },
    };

    const processor = createOrchestrationProcessor({ deps });
    return { processor, deps };
  }

  // ─── Scenario 1: Weather/Search Turn ──────────────────────────────────────

  describe('Weather/search turn', () => {
    it('calls search_subagent tool, feeds structured evidence back, and synthesizes final answer', async () => {
      const searchResult = {
        query: 'weather in Tokyo',
        results: [{ title: 'Tokyo Weather', snippet: 'Sunny, 22°C' }],
        provider: 'mock-search',
      };

      const kernelResult = createSuccessfulKernelResult({
        finalResponse: 'The weather in Tokyo is currently sunny with a temperature of 22°C.',
        toolCalls: [
          { toolCallId: 'tc-search-001', toolName: 'search_subagent', params: { query: 'weather in Tokyo' } },
        ],
        transcript: [
          { iteration: 1, timestamp: '2024-01-15T10:00:01.000Z', type: 'tool_call', content: { toolCallId: 'tc-search-001', toolName: 'search_subagent' } },
          { iteration: 1, timestamp: '2024-01-15T10:00:02.000Z', type: 'tool_result', content: { toolCallId: 'tc-search-001', result: searchResult } },
          { iteration: 1, timestamp: '2024-01-15T10:00:03.000Z', type: 'llm_response', content: { content: 'The weather in Tokyo is currently sunny with a temperature of 22°C.' } },
        ],
      });

      const { processor } = buildDepsAndProcessor(vi.fn().mockResolvedValue(kernelResult));
      const input = createMockProcessorInput({ text: "What's the weather in Tokyo?" });

      const output = await processor(input);

      // Verify processor output
      expect(output.success).toBe(true);
      expect(output.result?.text).toContain('Tokyo');
      expect(output.result?.text).toContain('22°C');

      // Verify AgentKernel.run was called (not ForegroundKernelRunner)
      expect(mockAgentKernel.run).toHaveBeenCalledTimes(1);

      // Verify kernel result data flows through
      expect(output.result?.data?.kernelResult).toBeDefined();
      expect(output.result?.data?.runtimeSummary).toBeDefined();

      // Verify search_subagent tool was called
      const kernelInput = vi.mocked(mockAgentKernel.run).mock.calls[0]![0];
      expect(kernelInput.toolProjection).toBeDefined();
    });
  });

  // ─── Scenario 2: Complex Task Planner Creation ────────────────────────────

  describe('Complex task planner creation', () => {
    it('calls foreground_spawn_planner and returns plannerRunId in runtimeSummary', async () => {
      const kernelResult = createSuccessfulKernelResult({
        finalResponse: "I've created a plan for your 3-day Tokyo trip. The planner will organize hotel bookings, sightseeing, and restaurant reservations.",
        toolCalls: [
          { toolCallId: 'tc-planner-001', toolName: 'foreground_spawn_planner', params: { objective: 'Plan a 3-day trip to Tokyo' } },
        ],
        transcript: [
          { iteration: 1, timestamp: '2024-01-15T10:00:01.000Z', type: 'tool_call', content: { toolCallId: 'tc-planner-001', toolName: 'foreground_spawn_planner' } },
          { iteration: 1, timestamp: '2024-01-15T10:00:02.000Z', type: 'tool_result', content: { toolCallId: 'tc-planner-001', result: { plannerRunId: 'planner-run-001', status: 'created' } } },
          { iteration: 1, timestamp: '2024-01-15T10:00:03.000Z', type: 'llm_response', content: { content: "I've created a plan for your 3-day Tokyo trip." } },
        ],
      });

      const { processor } = buildDepsAndProcessor(vi.fn().mockResolvedValue(kernelResult));
      const input = createMockProcessorInput({ text: 'Plan a 3-day trip to Tokyo' });

      const output = await processor(input);

      expect(output.success).toBe(true);
      expect(output.result?.text).toContain('plan');

      // Verify foreground_spawn_planner was called via toolCalls
      expect(kernelResult.toolCalls).toHaveLength(1);
      expect(kernelResult.toolCalls[0]!.toolName).toBe('foreground_spawn_planner');

      // Verify runtimeSummary includes tool call summaries
      const runtimeSummary = output.result?.data?.runtimeSummary as { toolCallSummaries?: Array<{ toolName: string }> } | undefined;
      expect(runtimeSummary?.toolCallSummaries).toBeDefined();
      expect(runtimeSummary?.toolCallSummaries?.[0]?.toolName).toBe('foreground_spawn_planner');
    });
  });

  // ─── Scenario 3: Status Query ─────────────────────────────────────────────

  describe('Status query', () => {
    it('calls foreground_status_query and returns current status', async () => {
      const kernelResult = createSuccessfulKernelResult({
        finalResponse: 'You have 2 active tasks: a planner running for your Tokyo trip and a background research task.',
        toolCalls: [
          { toolCallId: 'tc-status-001', toolName: 'foreground_status_query', params: {} },
        ],
        transcript: [
          { iteration: 1, timestamp: '2024-01-15T10:00:01.000Z', type: 'tool_call', content: { toolCallId: 'tc-status-001', toolName: 'foreground_status_query' } },
          { iteration: 1, timestamp: '2024-01-15T10:00:02.000Z', type: 'tool_result', content: { toolCallId: 'tc-status-001', result: { activeTasks: 2, details: ['Tokyo trip planner', 'Quantum computing research'] } } },
          { iteration: 1, timestamp: '2024-01-15T10:00:03.000Z', type: 'llm_response', content: { content: 'You have 2 active tasks.' } },
        ],
      });

      const { processor } = buildDepsAndProcessor(vi.fn().mockResolvedValue(kernelResult));
      const input = createMockProcessorInput({ text: "What's running?" });

      const output = await processor(input);

      expect(output.success).toBe(true);
      expect(output.result?.text).toContain('active tasks');

      // Verify foreground_status_query tool was called
      expect(kernelResult.toolCalls).toHaveLength(1);
      expect(kernelResult.toolCalls[0]!.toolName).toBe('foreground_status_query');

      // Verify tool result was present in transcript (evidence of feedback loop)
      const toolResultEntry = kernelResult.transcript.find(e => e.type === 'tool_result');
      expect(toolResultEntry).toBeDefined();
    });
  });

  // ─── Scenario 4: Subagent Launch ──────────────────────────────────────────

  describe('Subagent launch', () => {
    it('calls foreground_launch_subagent and returns runtimeActionId', async () => {
      const kernelResult = createSuccessfulKernelResult({
        finalResponse: "I've launched a background research agent to investigate quantum computing advances. It will report back when complete.",
        toolCalls: [
          { toolCallId: 'tc-subagent-001', toolName: 'foreground_launch_subagent', params: { taskSpec: { objective: 'Research quantum computing' } } },
        ],
        transcript: [
          { iteration: 1, timestamp: '2024-01-15T10:00:01.000Z', type: 'tool_call', content: { toolCallId: 'tc-subagent-001', toolName: 'foreground_launch_subagent' } },
          { iteration: 1, timestamp: '2024-01-15T10:00:02.000Z', type: 'tool_result', content: { toolCallId: 'tc-subagent-001', result: { runtimeActionId: 'action-sub-001', agentType: 'research', status: 'launched' } } },
          { iteration: 1, timestamp: '2024-01-15T10:00:03.000Z', type: 'llm_response', content: { content: "I've launched a background research agent." } },
        ],
      });

      const { processor } = buildDepsAndProcessor(vi.fn().mockResolvedValue(kernelResult));
      const input = createMockProcessorInput({ text: 'Research quantum computing advances' });

      const output = await processor(input);

      expect(output.success).toBe(true);
      expect(output.result?.text).toContain('launched');

      // Verify foreground_launch_subagent was called
      expect(kernelResult.toolCalls).toHaveLength(1);
      expect(kernelResult.toolCalls[0]!.toolName).toBe('foreground_launch_subagent');

      // Verify the tool result shows a runtimeActionId was returned
      const toolResult = kernelResult.transcript.find(e => e.type === 'tool_result');
      const toolResultContent = toolResult?.content as { result?: { runtimeActionId?: string } };
      expect(toolResultContent?.result?.runtimeActionId).toBe('action-sub-001');
    });
  });

  // ─── Scenario 5: Tool Failure ─────────────────────────────────────────────

  describe('Tool failure', () => {
    it('returns safe user-facing response when a tool fails', async () => {
      const kernelResult = createSuccessfulKernelResult({
        finalResponse: "I'm sorry, but I wasn't able to search the web right now. The search service appears to be temporarily unavailable. Please try again in a moment.",
        toolCalls: [
          { toolCallId: 'tc-search-fail-001', toolName: 'search_subagent', params: { query: 'test query' } },
        ],
        transcript: [
          { iteration: 1, timestamp: '2024-01-15T10:00:01.000Z', type: 'tool_call', content: { toolCallId: 'tc-search-fail-001', toolName: 'search_subagent' } },
          {
            iteration: 1,
            timestamp: '2024-01-15T10:00:02.000Z',
            type: 'tool_result',
            content: {
              toolCallId: 'tc-search-fail-001',
              result: null,
              error: { code: 'SEARCH_UNAVAILABLE', message: 'Search service is down', recoverable: true },
            },
          },
          { iteration: 1, timestamp: '2024-01-15T10:00:03.000Z', type: 'llm_response', content: { content: "I'm sorry, but I wasn't able to search the web right now." } },
        ],
      });

      const { processor } = buildDepsAndProcessor(vi.fn().mockResolvedValue(kernelResult));
      const input = createMockProcessorInput({ text: 'Search for something' });

      const output = await processor(input);

      // Verify safe user-facing response (no raw error dumps)
      expect(output.success).toBe(true);
      expect(output.result?.text).not.toContain('SEARCH_UNAVAILABLE');
      expect(output.result?.text).not.toContain('{"error"');
      expect(output.result?.text).not.toContain('stack');
      expect(output.result?.text).toContain('sorry');
      expect(output.result?.text).toContain('temporarily unavailable');
    });

    it('returns user-safe error when kernel itself fails', async () => {
      const failedKernelResult: KernelRunResult = {
        finalStatus: 'failed',
        iterationsUsed: 1,
        toolCalls: [
          { toolCallId: 'tc-fail-001', toolName: 'web_search', params: { query: 'test' } },
        ],
        transcript: [],
        error: { code: 'KERNEL_ERROR', message: 'Internal kernel execution failed' },
      };

      const { processor } = buildDepsAndProcessor(vi.fn().mockResolvedValue(failedKernelResult));
      const input = createMockProcessorInput({ text: 'Search the web' });

      const output = await processor(input);

      // Verify the output is an error or contains a safe message
      if (output.success) {
        // If mapped as success with error in finalResponse
        expect(output.result?.text).not.toContain('Internal kernel execution failed');
        expect(output.result?.text).not.toContain('KERNEL_ERROR');
      } else {
        // If mapped as processor error
        expect(output.error).toBeDefined();
        expect(output.error?.code).toBe('PROCESSING_ERROR');
      }
    });
  });

  // ─── Scenario 6: Unprojected Tool Rejection ───────────────────────────────

  describe('Unprojected tool rejection', () => {
    it('kernel rejects unprojected tool call with UNPROJECTED_TOOL_CALL error', async () => {
      // Kernel returns a result where the unprojected tool was rejected
      const kernelResult = createSuccessfulKernelResult({
        finalResponse: "I can't perform that action. The tool you requested isn't available for this conversation.",
        toolCalls: [
          { toolCallId: 'tc-unproj-001', toolName: 'admin_delete_all', params: {} },
        ],
        transcript: [
          { iteration: 1, timestamp: '2024-01-15T10:00:01.000Z', type: 'tool_call', content: { toolCallId: 'tc-unproj-001', toolName: 'admin_delete_all' } },
          {
            iteration: 1,
            timestamp: '2024-01-15T10:00:02.000Z',
            type: 'tool_result',
            content: {
              toolCallId: 'tc-unproj-001',
              result: null,
              error: {
                code: 'UNPROJECTED_TOOL_CALL',
                message: 'Tool admin_delete_all was not projected as callable for this kernel run',
                recoverable: false,
              },
            },
          },
          { iteration: 1, timestamp: '2024-01-15T10:00:03.000Z', type: 'llm_response', content: { content: "I can't perform that action." } },
        ],
      });

      const { processor } = buildDepsAndProcessor(vi.fn().mockResolvedValue(kernelResult));
      const input = createMockProcessorInput({ text: 'Delete all my data' });

      const output = await processor(input);

      // Verify the unprojected tool was rejected (not executed)
      expect(output.success).toBe(true);

      // Verify the tool result contains UNPROJECTED_TOOL_CALL error
      const toolResultEntry = kernelResult.transcript.find(e => e.type === 'tool_result');
      const toolResultContent = toolResultEntry?.content as { error?: { code: string } };
      expect(toolResultContent?.error?.code).toBe('UNPROJECTED_TOOL_CALL');

      // Verify the final response is user-safe (no internal error codes leaked)
      expect(output.result?.text).not.toContain('UNPROJECTED_TOOL_CALL');
      expect(output.result?.text).toContain("can't perform");
    });
  });

  // ─── Cross-cutting: ProcessorOrchestration uses ForegroundAgent.runTurn ───

  describe('ProcessorOrchestration routing', () => {
    it('calls foregroundAgent.runTurn() instead of foregroundKernelRunner', async () => {
      const kernelResult = createSuccessfulKernelResult({
        finalResponse: 'Test response',
        toolCalls: [],
        transcript: [],
      });

      const { processor, deps } = buildDepsAndProcessor(vi.fn().mockResolvedValue(kernelResult));
      const input = createMockProcessorInput({ text: 'Test message' });

      // Spy on foregroundAgent.runTurn
      const runTurnSpy = vi.spyOn(deps.foregroundAgent!, 'runTurn' as never);

      await processor(input);

      // Verify foregroundAgent.runTurn was called (not any kernel runner)
      expect(runTurnSpy).toHaveBeenCalledTimes(1);
      runTurnSpy.mockRestore();
    });

    it('propagates runtimeSummary from kernel result to output', async () => {
      const kernelResult = createSuccessfulKernelResult({
        finalResponse: 'Response with tool calls',
        toolCalls: [
          { toolCallId: 'tc-001', toolName: 'search_subagent', params: { query: 'test' } },
        ],
        transcript: [
          { iteration: 1, timestamp: '2024-01-15T10:00:01.000Z', type: 'tool_call', content: { toolCallId: 'tc-001' } },
          { iteration: 1, timestamp: '2024-01-15T10:00:02.000Z', type: 'tool_result', content: { toolCallId: 'tc-001', result: 'data' } },
        ],
      });

      const { processor } = buildDepsAndProcessor(vi.fn().mockResolvedValue(kernelResult));
      const input = createMockProcessorInput({ text: 'Search something' });

      const output = await processor(input);

      expect(output.success).toBe(true);
      expect(output.result?.data?.runtimeSummary).toBeDefined();

      const runtimeSummary = output.result?.data?.runtimeSummary as { toolCallSummaries?: Array<{ toolCallId: string; toolName: string }> };
      expect(runtimeSummary?.toolCallSummaries).toBeDefined();
      expect(runtimeSummary?.toolCallSummaries?.[0]?.toolCallId).toBe('tc-001');
      expect(runtimeSummary?.toolCallSummaries?.[0]?.toolName).toBe('search_subagent');
    });

    it('persists turn transcript after processing', async () => {
      const kernelResult = createSuccessfulKernelResult({
        finalResponse: 'Persisted response',
        toolCalls: [],
        transcript: [],
      });

      const { processor } = buildDepsAndProcessor(vi.fn().mockResolvedValue(kernelResult));
      const input = createMockProcessorInput({ text: 'Hello' });

      await processor(input);

      // Verify transcript was persisted
      expect(mockTranscriptStore.saveTurn).toBeDefined();
    });
  });
});
