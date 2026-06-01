import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createE2EHarness, type E2EHarness } from './test-harness.js';
import { AgentKernel } from '../../src/kernel/agent-kernel.js';
import type {
  KernelConfig,
  KernelRunResult,
  ToolUseRequest,
} from '../../src/kernel/types.js';
import type { ToolDefinition } from '../../src/tools/types.js';
import type { TurnTranscript } from '../../src/storage/transcript-store.js';
import { validateToolResultPairing } from '../../src/kernel/tool-result-pairing-guard.js';
import { ModelInputBuilder } from '../../src/kernel/model-input/model-input-builder.js';
import { PromptTemplateRegistry } from '../../src/prompt/prompt-template-registry.js';
import { TemplateLoader } from '../../src/prompt/template-loader.js';
import type { LLMAdapter, LLMAdapterConfig } from '../../src/llm/adapter.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import type { LLMResult, LLMResponse, ToolCall } from '../../src/llm/types.js';
import type { PermissionContext } from '../../src/permissions/types.js';
import type { DispatchRequest } from '../../src/dispatcher/types.js';
import type { ContextItem } from '../../src/context/types.js';

class FakeToolLoopLLMAdapter implements LLMAdapter {
  private index = 0;
  config: LLMAdapterConfig;
  providers: LLMProvider[] = [];

  constructor(private responses: LLMResponse[]) {
    this.config = { providers: [], defaultTimeoutMs: 60000, enableCircuitBreaker: false };
  }

  async complete(): Promise<LLMResult> {
    const response = this.responses[this.index];
    if (this.index < this.responses.length - 1) {
      this.index++;
    }
    return { success: true, response, providerId: 'mock-provider' };
  }

  async *stream(): AsyncGenerator<{ delta: string; providerId: string; model?: string }> {}

  addProvider(provider: LLMProvider): void { this.providers.push(provider); }
  removeProvider(providerId: string): void { this.providers = this.providers.filter(p => p.id !== providerId); }
  getProvider(providerId: string): LLMProvider | undefined { return this.providers.find(p => p.id === providerId); }
  getHealthyProviders(): LLMProvider[] { return this.providers; }
  updateProviderPriority(providerId: string, priority: number): void {
    const p = this.getProvider(providerId);
    if (p) p.updateConfig({ ...p.config, priority });
  }
}

function makeToolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return {
    id,
    type: 'function' as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}

function makeToolUseResponse(toolCalls: ToolCall[]): LLMResponse {
  return {
    id: `resp-${Date.now()}`,
    model: 'test-model',
    content: '',
    role: 'assistant',
    toolCalls,
    finishReason: 'tool_calls',
    createdAt: new Date().toISOString(),
  };
}

function makeTextResponse(content: string): LLMResponse {
  return {
    id: `resp-${Date.now()}`,
    model: 'test-model',
    content,
    role: 'assistant',
    finishReason: 'stop',
    createdAt: new Date().toISOString(),
  };
}

function createMockSearchTool(): ToolDefinition {
  return {
    name: 'web_search',
    description: 'Search the web',
    category: 'search',
    sensitivity: 'low',
    schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    handler: async (params) => {
      const query = (params as { query: string }).query;
      return {
        success: true,
        data: { query, results: [{ title: 'Result', url: 'https://example.com', snippet: `Found: ${query}` }], totalResults: 1 },
        resultPreview: `Found 1 result for "${query}"`,
      };
    },
  };
}

function createMockReadTool(): ToolDefinition {
  return {
    name: 'file_read',
    description: 'Read a file',
    category: 'read',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    handler: async (params) => {
      const path = (params as { path: string }).path;
      return {
        success: true,
        data: { path, content: 'Hello from file', lines: 1 },
        resultPreview: `File ${path}: 1 line`,
      };
    },
  };
}

function createMockStatusTool(): ToolDefinition {
  return {
    name: 'status_query',
    description: 'Query active work status',
    category: 'read',
    sensitivity: 'low',
    schema: { type: 'object', properties: {} },
    handler: async () => ({
      success: true,
      data: { activeTasks: 2, completedTasks: 5 },
      resultPreview: 'Active: 2, Completed: 5',
    }),
  };
}

class FakeE2EContextManager {
  private items: ContextItem[] = [];

  addItem(item: ContextItem): void { this.items.push(item); }
  getItems(): ContextItem[] { return this.items; }

  assembleBundle() {
    return {
      bundleId: 'e2e-bundle',
      runId: 'e2e-run',
      agentId: 'e2e-agent',
      agentType: 'main' as const,
      userId: 'e2e-user',
      invocationSource: 'gateway_intent' as const,
      pinnedItems: [],
      orderedItems: this.items,
      tokenEstimate: 100,
    };
  }

  applyDelta(delta: { items?: ContextItem[] }): void {
    if (delta.items) this.items.push(...delta.items);
  }
}



describe('Flow: Tool Loop Closure (E2E)', () => {
  let harness: E2EHarness;
  let originalEnv: string | undefined;

  beforeAll(() => {
    originalEnv = process.env.TOOL_LOOP_V2_ENABLED;
    process.env.TOOL_LOOP_V2_ENABLED = 'true';
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.TOOL_LOOP_V2_ENABLED;
    } else {
      process.env.TOOL_LOOP_V2_ENABLED = originalEnv;
    }
  });

  beforeEach(() => {
    harness = createE2EHarness();
  });

  afterEach(() => {
    harness.close();
  });

  function createKernel(
    adapter: FakeToolLoopLLMAdapter,
    userId = 'e2e-user',
    sessionId = 'e2e-session',
  ): { kernel: AgentKernel; run: () => Promise<KernelRunResult> } {
    const contextManager = new FakeE2EContextManager();

    const fakeDispatcher = {
      async dispatch(request: DispatchRequest) {
        const payload = (request.action.targetAction as unknown) as Record<string, unknown> | undefined;
        const toolCallId = (payload?.toolCallId as string) ?? request.action.actionId;
        const toolName = (payload?.toolName as string) ?? 'unknown';
        const params = payload?.params ?? payload ?? {};

        const permissionContext: PermissionContext = {
          userId: request.context.userId ?? userId,
          sessionId: request.context.sessionId ?? sessionId,
          mode: 'read_only',
          grants: [],
          metadata: {},
        };

        const toolResult = await harness.toolExecutor.execute({
          toolCallId,
          toolName,
          params,
          userId: request.context.userId ?? userId,
          sessionId: request.context.sessionId ?? sessionId,
          permissionContext,
        });

        return {
          requestId: request.requestId,
          actionId: request.action.actionId,
          status: toolResult.success ? ('completed' as const) : ('failed' as const),
          targetRuntime: 'tool_plane' as const,
          result: toolResult.data,
          error: toolResult.error,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      },
    };

    const testRegistry = new PromptTemplateRegistry(new Map([
      ['platform:base', {
        id: 'platform:base', version: '2026-05-23', path: 'platform/base.md',
        agentKind: '*', providerFamily: '*', layer: 1,
        description: 'Test base', content: 'You are a helpful assistant.',
      }],
      ['agents:kernel', {
        id: 'agents:kernel', version: '2026-05-23', path: 'agents/kernel.md',
        agentKind: 'kernel', providerFamily: '*', layer: 3,
        description: 'Test kernel', content: 'Execute tasks using available tools.',
      }],
    ]));

    const modelInputBuilder = new ModelInputBuilder({
      templateRegistry: testRegistry,
      templateLoader: new TemplateLoader(),
    });

    const config: KernelConfig = {
      llmAdapter: adapter,
      toolExecutor: harness.toolExecutor as unknown as KernelConfig['toolExecutor'],
      contextManager: contextManager as unknown as KernelConfig['contextManager'],
      dispatcher: fakeDispatcher as unknown as KernelConfig['dispatcher'],
      modelInputBuilder,
      maxIterations: 10,
      timeoutMs: 60000,
    };

    const kernel = new AgentKernel(config);

    const run = () => kernel.run({
      contextBundle: contextManager.assembleBundle(),
      runId: 'e2e-run',
      agentId: 'e2e-agent',
      agentType: 'main',
      userId,
      sessionId,
      maxIterations: 10,
      timeoutMs: 60000,
    });

    return { kernel, run };
  }

  describe('Scenario 1: Full loop closure', () => {
    it('completes tool call → result → LLM text response cycle', async () => {
      harness.registerTool(createMockSearchTool());

      const toolCalls: ToolCall[] = [
        makeToolCall('call-search-1', 'web_search', { query: 'TypeScript performance' }),
      ];

      const adapter = new FakeToolLoopLLMAdapter([
        makeToolUseResponse(toolCalls),
        makeTextResponse('Based on search results, TypeScript has excellent performance.'),
      ]);

      const { run } = createKernel(adapter, 'user-loop-1', 'sess-loop-1');
      const result = await run();

      expect(result.finalStatus).toBe('completed');
      expect(result.iterationsUsed).toBe(2);
      expect(result.finalResponse).toContain('TypeScript');
      expect(result.finalResponse).not.toContain('Processing tool request...');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe('web_search');
      expect(result.toolCalls[0].toolCallId).toBe('call-search-1');

      const types = result.transcript.map((e) => e.type);
      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');
      expect(types.filter((t) => t === 'llm_response')).toHaveLength(2);

      const toolExec = harness.stores.toolExecutionStore.getById('call-search-1');
      expect(toolExec).toBeDefined();

      const pairing = validateToolResultPairing(result.transcript);
      expect(pairing.valid).toBe(true);
      expect(pairing.warnings).toHaveLength(0);
    });

    it('returns LLM response from read-tool dispatch without ack message', async () => {
      harness.registerTool(createMockReadTool());

      const toolCalls: ToolCall[] = [
        makeToolCall('call-read-1', 'file_read', { path: '/tmp/test.txt' }),
      ];

      const adapter = new FakeToolLoopLLMAdapter([
        makeToolUseResponse(toolCalls),
        makeTextResponse('The file contains greeting text.'),
      ]);

      const { run } = createKernel(adapter, 'user-loop-2', 'sess-loop-2');
      const result = await run();

      expect(result.finalStatus).toBe('completed');
      expect(result.finalResponse).toContain('greeting');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe('file_read');

      const pairing = validateToolResultPairing(result.transcript);
      expect(pairing.valid).toBe(true);

      const toolExec = harness.stores.toolExecutionStore.getById('call-read-1');
      expect(toolExec).toBeDefined();
    });
  });

  describe('Scenario 2: toolCallSummaries visible in transcript API', () => {
    it('persists toolCallSummaries in transcript when tool loop completes', async () => {
      harness.registerTool(createMockSearchTool());

      const toolCalls: ToolCall[] = [
        makeToolCall('call-ts-1', 'web_search', { query: 'weather today' }),
      ];

      const adapter = new FakeToolLoopLLMAdapter([
        makeToolUseResponse(toolCalls),
        makeTextResponse('The weather today is sunny with a high of 75°F.'),
      ]);

      const { run } = createKernel(adapter, 'user-ts-1', 'sess-ts-1');
      const result = await run();

      expect(result.finalStatus).toBe('completed');

      const transcript: TurnTranscript = {
        turnId: 'turn-ts-1',
        sessionId: 'sess-ts-1',
        userId: 'user-ts-1',
        input: { userMessageSummary: 'weather today' },
        output: {
          visibleMessages: [
            { messageId: 'msg-ts-1', role: 'assistant', content: result.finalResponse ?? '' },
          ],
        },
        runtimeSummary: {
          toolCallSummaries: result.toolCalls.map((tc: ToolUseRequest) => ({ toolCallId: tc.toolCallId, toolName: tc.toolName, status: 'completed' as const })),
        },
        visibility: 'public',
        createdAt: new Date().toISOString(),
      };

      harness.stores.transcriptStore.saveTurn(transcript);

      const transcripts = harness.stores.transcriptStore.findBySession('sess-ts-1');
      expect(transcripts).toHaveLength(1);

      const savedTranscript = transcripts[0];
      expect(savedTranscript.runtimeSummary).toBeDefined();
      expect(savedTranscript.runtimeSummary?.toolCallSummaries).toHaveLength(1);
      expect(savedTranscript.runtimeSummary?.toolCallSummaries![0]).toEqual({ toolCallId: 'call-ts-1', toolName: 'web_search', status: 'completed' });
    });

    it('omits runtimeSummary from transcript when not provided', async () => {
      const transcript: TurnTranscript = {
        turnId: 'turn-ts-off-1',
        sessionId: 'sess-ts-off',
        userId: 'user-ts-off',
        input: { userMessageSummary: 'hello' },
        output: {
          visibleMessages: [
            { messageId: 'msg-off-1', role: 'assistant', content: 'Hello!' },
          ],
        },
        visibility: 'public',
        createdAt: new Date().toISOString(),
      };

      harness.stores.transcriptStore.saveTurn(transcript);

      const transcripts = harness.stores.transcriptStore.findBySession('sess-ts-off');
      expect(transcripts).toHaveLength(1);
      expect(transcripts[0].runtimeSummary).toBeUndefined();
    });
  });

  describe('Scenario 3: Multiple parallel tools paired correctly (EC-5)', () => {
    it('pairs 3 parallel tool calls and stores all results', async () => {
      harness.registerTool(createMockSearchTool());
      harness.registerTool(createMockReadTool());
      harness.registerTool(createMockStatusTool());

      const toolCalls: ToolCall[] = [
        makeToolCall('call-p1', 'web_search', { query: 'test' }),
        makeToolCall('call-p2', 'file_read', { path: '/tmp/a.txt' }),
        makeToolCall('call-p3', 'status_query', {}),
      ];

      const adapter = new FakeToolLoopLLMAdapter([
        makeToolUseResponse(toolCalls),
        makeTextResponse('All three tools completed. Here is the summary.'),
      ]);

      const { run } = createKernel(adapter, 'user-ec5-1', 'sess-ec5-1');
      const result = await run();

      expect(result.finalStatus).toBe('completed');
      expect(result.toolCalls).toHaveLength(3);

      const toolNames = result.toolCalls.map((tc: ToolUseRequest) => tc.toolName).sort();
      expect(toolNames).toEqual(['file_read', 'status_query', 'web_search']);

      expect(result.transcript.filter((e) => e.type === 'tool_call')).toHaveLength(3);
      expect(result.transcript.filter((e) => e.type === 'tool_result')).toHaveLength(3);

      const pairing = validateToolResultPairing(result.transcript);
      expect(pairing.valid).toBe(true);
      expect(pairing.warnings).toHaveLength(0);

      for (const tc of result.toolCalls) {
        const toolExec = harness.stores.toolExecutionStore.getById(tc.toolCallId);
        expect(toolExec).toBeDefined();
      }

      const transcript: TurnTranscript = {
        turnId: 'turn-ec5-1',
        sessionId: 'sess-ec5-1',
        userId: 'user-ec5-1',
        input: { userMessageSummary: 'parallel tools test' },
        output: {
          visibleMessages: [
            { messageId: 'msg-ec5-1', role: 'assistant', content: result.finalResponse ?? '' },
          ],
        },
        runtimeSummary: {
          toolCallSummaries: result.toolCalls.map((tc: ToolUseRequest) => ({ toolCallId: tc.toolCallId, toolName: tc.toolName, status: 'completed' as const })),
        },
        visibility: 'public',
        createdAt: new Date().toISOString(),
      };
      harness.stores.transcriptStore.saveTurn(transcript);

      const transcripts = harness.stores.transcriptStore.findBySession('sess-ec5-1');
      expect(transcripts).toHaveLength(1);
      expect(transcripts[0].runtimeSummary?.toolCallSummaries).toHaveLength(3);
    });

    it('detects orphan results via PairingGuard', async () => {
      harness.registerTool(createMockSearchTool());

      const toolCalls: ToolCall[] = [
        makeToolCall('call-orp-1', 'web_search', { query: 'test' }),
      ];

      const adapter = new FakeToolLoopLLMAdapter([
        makeToolUseResponse(toolCalls),
        makeTextResponse('Search completed.'),
      ]);

      const { run } = createKernel(adapter, 'user-orp-1', 'sess-orp-1');
      const result = await run();

      const orphanedTranscript = [
        ...result.transcript,
        {
          iteration: 2,
          timestamp: new Date().toISOString(),
          type: 'tool_result' as const,
          content: { toolCallId: 'call-orp-orphan', result: { fake: true } },
        },
      ];

      const pairing = validateToolResultPairing(orphanedTranscript);
      expect(pairing.valid).toBe(false);
      expect(pairing.warnings).toHaveLength(1);
      expect(pairing.warnings[0].type).toBe('orphan_result');
      expect(pairing.warnings[0].toolCallId).toBe('call-orp-orphan');
    });

    it('detects missing results via PairingGuard', async () => {
      harness.registerTool(createMockSearchTool());

      const toolCalls: ToolCall[] = [
        makeToolCall('call-mis-1', 'web_search', { query: 'test' }),
      ];

      const adapter = new FakeToolLoopLLMAdapter([
        makeToolUseResponse(toolCalls),
        makeTextResponse('Search completed.'),
      ]);

      const { run } = createKernel(adapter, 'user-mis-1', 'sess-mis-1');
      const result = await run();

      const resultWithoutMatch = result.transcript.filter(
        (e) => !(e.type === 'tool_result' && (e.content as { toolCallId?: string }).toolCallId === 'call-mis-1'),
      );

      const pairing = validateToolResultPairing(resultWithoutMatch);
      expect(pairing.valid).toBe(false);
      expect(pairing.warnings).toHaveLength(1);
      expect(pairing.warnings[0].type).toBe('missing_result');
      expect(pairing.warnings[0].toolCallId).toBe('call-mis-1');
    });
  });

  describe('Edge cases', () => {
    it('handles empty tool_calls array without stalling (EC-1)', async () => {
      harness.registerTool(createMockSearchTool());

      const emptyToolCallResponse: LLMResponse = {
        id: 'resp-empty-tc',
        model: 'test-model',
        content: '',
        role: 'assistant',
        toolCalls: [],
        finishReason: 'tool_calls',
        createdAt: new Date().toISOString(),
      };

      const adapter = new FakeToolLoopLLMAdapter([
        emptyToolCallResponse,
        makeTextResponse('No tools were needed for this request.'),
      ]);

      const { run } = createKernel(adapter, 'user-ec1', 'sess-ec1');
      const result = await run();

      expect(result.finalStatus).toBe('completed');
      expect(result.finalResponse).toBe('No tools were needed for this request.');
      expect(result.toolCalls).toHaveLength(0);
      expect(result.transcript.map((e) => e.type)).not.toContain('tool_call');
      expect(result.transcript.map((e) => e.type)).not.toContain('tool_result');
    });

    it('handles tool execution error gracefully', async () => {
      harness.registerTool({
        name: 'web_search',
        description: 'Search',
        category: 'search',
        sensitivity: 'low',
        schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        handler: async () => ({
          success: false,
          error: { code: 'SEARCH_FAILED', message: 'Search service unavailable', recoverable: true },
          resultPreview: 'Search failed',
        }),
      });

      const toolCalls: ToolCall[] = [
        makeToolCall('call-err-1', 'web_search', { query: 'fail' }),
      ];

      const adapter = new FakeToolLoopLLMAdapter([
        makeToolUseResponse(toolCalls),
        makeTextResponse('The search failed. Let me try another approach.'),
      ]);

      const { run } = createKernel(adapter, 'user-err', 'sess-err');
      const result = await run();

      expect(result.finalStatus).toBe('completed');
      expect(result.finalResponse).toContain('Let me try another approach');
      expect(result.toolCalls).toHaveLength(1);

      const toolExec = harness.stores.toolExecutionStore.getById('call-err-1');
      expect(toolExec).toBeDefined();

      const toolResultEntry = result.transcript.find((e) => e.type === 'tool_result');
      expect(toolResultEntry).toBeDefined();

      const pairing = validateToolResultPairing(result.transcript);
      expect(pairing.valid).toBe(true);
    });

    it('completes multi-turn tool loop with multiple tool rounds', async () => {
      harness.registerTool(createMockSearchTool());
      harness.registerTool(createMockReadTool());

      const toolCalls1: ToolCall[] = [
        makeToolCall('call-mt-1', 'web_search', { query: 'step 1' }),
      ];
      const toolCalls2: ToolCall[] = [
        makeToolCall('call-mt-2', 'file_read', { path: '/tmp/result.txt' }),
      ];

      const adapter = new FakeToolLoopLLMAdapter([
        makeToolUseResponse(toolCalls1),
        makeToolUseResponse(toolCalls2),
        makeTextResponse('Both steps completed. Results are ready.'),
      ]);

      const { run } = createKernel(adapter, 'user-mt', 'sess-mt');
      const result = await run();

      expect(result.finalStatus).toBe('completed');
      expect(result.toolCalls).toHaveLength(2);
      expect(result.iterationsUsed).toBe(3);
      expect(result.transcript.filter((e) => e.type === 'tool_call')).toHaveLength(2);
      expect(result.transcript.filter((e) => e.type === 'tool_result')).toHaveLength(2);

      const pairing = validateToolResultPairing(result.transcript);
      expect(pairing.valid).toBe(true);
    });
  });
});
