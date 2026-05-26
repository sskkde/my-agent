import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import type {
  LLMResponse,
  ToolCall,
} from '../../../src/llm/types.js';
import type { ContextItem } from '../../../src/context/types.js';
import type { DispatchRequest } from '../../../src/dispatcher/types.js';
import type {
  KernelRunInput,
  KernelRunResult,
  KernelConfig,
  ToolExecutor,
  ContextManager,
  RuntimeDispatcher,
} from '../../../src/kernel/types.js';
import { AgentKernel } from '../../../src/kernel/agent-kernel.js';
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js';
import type { LLMResult } from '../../../src/llm/types.js';
import type { LLMProvider } from '../../../src/llm/provider';
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js';
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js';
import { TemplateLoader } from '../../../src/prompt/template-loader.js';

class FakeLLMAdapter implements LLMAdapter {
  private responses: LLMResponse[];
  private currentIndex = 0;
  config: LLMAdapterConfig;
  providers: LLMProvider[] = [];

  constructor(responses: LLMResponse[]) {
    this.responses = responses;
    this.config = {
      providers: [],
      defaultTimeoutMs: 60000,
      enableCircuitBreaker: false,
    };
  }

  async complete(): Promise<LLMResult> {
    const response = this.responses[this.currentIndex++];
    if (this.currentIndex >= this.responses.length) {
      this.currentIndex = this.responses.length - 1;
    }
    return {
      success: true,
      response,
      providerId: 'fake-provider',
    };
  }

  async *stream(): AsyncGenerator<{ delta: string; providerId: string; model?: string; usage?: import('../../../src/api/types.js').ExactContextUsage }> {
  }

  addProvider(provider: LLMProvider): void {
    this.providers.push(provider);
  }

  removeProvider(providerId: string): void {
    this.providers = this.providers.filter((p) => p.id !== providerId);
  }

  getProvider(providerId: string): LLMProvider | undefined {
    return this.providers.find((p) => p.id === providerId);
  }

  getHealthyProviders(): LLMProvider[] {
    return this.providers;
  }

  updateProviderPriority(providerId: string, priority: number): void {
    const provider = this.getProvider(providerId);
    if (provider) {
      provider.updateConfig({ ...provider.config, priority });
    }
  }
}

class FakeToolExecutor {
  private tools: Map<
    string,
    (params: unknown) => Promise<{
      success: boolean;
      data?: unknown;
      error?: { code: string; message: string; recoverable: boolean };
      resultPreview?: string;
    }>
  > = new Map();

  registerTool(
    name: string,
    handler: (params: unknown) => Promise<{
      success: boolean;
      data?: unknown;
      error?: { code: string; message: string; recoverable: boolean };
      resultPreview?: string;
    }>
  ): void {
    this.tools.set(name, handler);
  }

  async execute(request: {
    toolCallId: string;
    toolName: string;
    params: unknown;
    userId: string;
    sessionId?: string;
    kernelRunId?: string;
    permissionContext: { userId: string; permissions: string[] };
  }): Promise<{
    success: boolean;
    data?: unknown;
    error?: { code: string; message: string; recoverable: boolean };
    resultPreview?: string;
  }> {
    const handler = this.tools.get(request.toolName);
    if (!handler) {
      return {
        success: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool not found: ${request.toolName}`,
          recoverable: false,
        },
      };
    }
    return handler(request.params);
  }
}

class FakeContextManager {
  private contextItems: ContextItem[] = [];

  addItem(item: ContextItem): void {
    this.contextItems.push(item);
  }

  getItems(): ContextItem[] {
    return this.contextItems;
  }

  assembleBundle() {
    return {
      bundleId: 'test-bundle',
      runId: 'test-run',
      agentId: 'test-agent',
      agentType: 'main',
      userId: 'test-user',
      invocationSource: 'gateway_intent' as const,
      pinnedItems: [],
      orderedItems: this.contextItems,
      tokenEstimate: 100,
    };
  }

  applyDelta(delta: { items?: ContextItem[] }): void {
    if (delta.items) {
      this.contextItems.push(...delta.items);
    }
  }
}

class FakeDispatcher {
  private handlers: Map<
    string,
    (request: DispatchRequest) => Promise<{
      requestId: string;
      actionId: string;
      status: string;
      targetRuntime: string;
      result?: unknown;
      error?: { code: string; message: string; recoverable: boolean };
      createdAt: string;
      completedAt?: string;
    }>
  > = new Map();

  lastRequest: DispatchRequest | null = null;

  registerHandler(
    actionType: string,
    handler: (request: DispatchRequest) => Promise<{
      requestId: string;
      actionId: string;
      status: string;
      targetRuntime: string;
      result?: unknown;
      error?: { code: string; message: string; recoverable: boolean };
      createdAt: string;
      completedAt?: string;
    }>
  ): void {
    this.handlers.set(actionType, handler);
  }

  async dispatch(request: DispatchRequest): Promise<{
    requestId: string;
    actionId: string;
    status: string;
    targetRuntime: string;
    result?: unknown;
    error?: { code: string; message: string; recoverable: boolean };
    createdAt: string;
    completedAt?: string;
  }> {
    this.lastRequest = request;

    const handler = this.handlers.get(request.action.actionType);
    if (handler) {
      return handler(request);
    }
    return {
      requestId: request.requestId,
      actionId: request.action.actionId,
      status: 'failed',
      targetRuntime: request.action.targetRuntime,
      error: {
        code: 'NO_HANDLER',
        message: `No handler for action type: ${request.action.actionType}`,
        recoverable: false,
      },
      createdAt: new Date().toISOString(),
    };
  }
}

function createTextResponse(content: string): LLMResponse {
  return {
    id: `resp-${Date.now()}`,
    model: 'test-model',
    content,
    role: 'assistant',
    finishReason: 'stop',
    createdAt: new Date().toISOString(),
  };
}

function createToolUseResponse(toolCalls: ToolCall[]): LLMResponse {
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

describe('Kernel Tool Loop Closure', () => {
  let fakeToolExecutor: FakeToolExecutor;
  let fakeContextManager: FakeContextManager;
  let fakeDispatcher: FakeDispatcher;
  let modelInputBuilder: ModelInputBuilder;
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
    fakeToolExecutor = new FakeToolExecutor();
    fakeContextManager = new FakeContextManager();
    fakeDispatcher = new FakeDispatcher();

    const testRegistry = new PromptTemplateRegistry(
      new Map([
        ['platform:base', {
          id: 'platform:base',
          version: '2026-05-23',
          path: 'platform/base.md',
          agentKind: '*',
          providerFamily: '*',
          layer: 1,
          description: 'Test base',
          content: 'You are a helpful assistant.',
        }],
        ['agents:kernel', {
          id: 'agents:kernel',
          version: '2026-05-23',
          path: 'agents/kernel.md',
          agentKind: 'kernel',
          providerFamily: '*',
          layer: 3,
          description: 'Test kernel',
          content: 'Execute tasks using available tools.',
        }],
      ])
    );
    modelInputBuilder = new ModelInputBuilder({
      templateRegistry: testRegistry,
      templateLoader: new TemplateLoader(),
    });

    fakeToolExecutor.registerTool('test-tool', async (params) => ({
      success: true,
      data: params,
      resultPreview: JSON.stringify(params),
    }));

    fakeDispatcher.registerHandler('execute_tool', async (request) => {
      const payload = request.action.targetAction as { toolCallId?: string; toolName?: string; params?: unknown } | undefined;
      const toolResult = await fakeToolExecutor.execute({
        toolCallId: payload?.toolCallId || 'test-call-id',
        toolName: payload?.toolName || 'unknown',
        params: payload?.params || {},
        userId: request.context.userId || 'test-user',
        sessionId: request.context.sessionId,
        permissionContext: {
          userId: request.context.userId || 'test-user',
          permissions: ['tool:execute'],
        },
      });
      return {
        requestId: request.requestId,
        actionId: request.action.actionId,
        status: toolResult.success ? 'completed' : 'failed',
        targetRuntime: 'tool_plane',
        result: toolResult.data,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    });
  });

  function createConfig(llmAdapter: FakeLLMAdapter, maxIterations = 10): KernelConfig {
    return {
      llmAdapter,
      toolExecutor: fakeToolExecutor as unknown as ToolExecutor,
      contextManager: fakeContextManager as unknown as ContextManager,
      dispatcher: fakeDispatcher as unknown as RuntimeDispatcher,
      modelInputBuilder,
      maxIterations,
      timeoutMs: 60000,
    };
  }

  function createInput(overrides?: Partial<KernelRunInput>): KernelRunInput {
    return {
      contextBundle: fakeContextManager.assembleBundle(),
      userId: 'test-user',
      sessionId: 'test-session',
      maxIterations: 10,
      timeoutMs: 60000,
      ...overrides,
    };
  }

  // ── Scenario 1: Single-turn tool loop ──────────────────────────────────

  it('should complete single-turn tool loop (tool → result → LLM text response)', async () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'call-single-1',
        type: 'function',
        function: {
          name: 'test-tool',
          arguments: JSON.stringify({ key: 'value' }),
        },
      },
    ];

    const fakeLLMAdapter = new FakeLLMAdapter([
      createToolUseResponse(toolCalls),
      createTextResponse('Tool executed successfully with value.'),
    ]);

    const kernel = new AgentKernel(createConfig(fakeLLMAdapter));
    const result: KernelRunResult = await kernel.run(createInput());

    expect(result.finalStatus).toBe('completed');
    expect(result.finalResponse).toBe('Tool executed successfully with value.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe('test-tool');
    expect(result.toolCalls[0].toolCallId).toBe('call-single-1');
    expect(result.iterationsUsed).toBe(2);

    const types = result.transcript.map((e) => e.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types.filter((t) => t === 'llm_response')).toHaveLength(2);
  });

  // ── Scenario 2: Multi-turn tool loop ───────────────────────────────────

  it('should complete multi-turn tool loop (multiple tool rounds before text)', async () => {
    const toolCalls1: ToolCall[] = [
      {
        id: 'call-multi-1',
        type: 'function',
        function: {
          name: 'test-tool',
          arguments: JSON.stringify({ step: 1 }),
        },
      },
    ];

    const toolCalls2: ToolCall[] = [
      {
        id: 'call-multi-2',
        type: 'function',
        function: {
          name: 'test-tool',
          arguments: JSON.stringify({ step: 2 }),
        },
      },
    ];

    const fakeLLMAdapter = new FakeLLMAdapter([
      createToolUseResponse(toolCalls1),
      createToolUseResponse(toolCalls2),
      createTextResponse('Both tool calls completed successfully.'),
    ]);

    const kernel = new AgentKernel(createConfig(fakeLLMAdapter));
    const result: KernelRunResult = await kernel.run(createInput());

    expect(result.finalStatus).toBe('completed');
    expect(result.finalResponse).toBe('Both tool calls completed successfully.');
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].toolCallId).toBe('call-multi-1');
    expect(result.toolCalls[1].toolCallId).toBe('call-multi-2');
    expect(result.iterationsUsed).toBe(3);

    const types = result.transcript.map((e) => e.type);
    expect(types.filter((t) => t === 'tool_call')).toHaveLength(2);
    expect(types.filter((t) => t === 'tool_result')).toHaveLength(2);
  });

  // ── Scenario 3: maxIterations reached ──────────────────────────────────

  it('should return max_iterations_reached when LLM always returns tool_calls', async () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'call-loop',
        type: 'function',
        function: {
          name: 'test-tool',
          arguments: JSON.stringify({ loop: true }),
        },
      },
    ];

    const fakeLLMAdapter = new FakeLLMAdapter([
      createToolUseResponse(toolCalls),
      createToolUseResponse(toolCalls),
      createToolUseResponse(toolCalls),
    ]);

    const maxIterations = 2;
    const kernel = new AgentKernel(createConfig(fakeLLMAdapter, maxIterations));
    const result: KernelRunResult = await kernel.run(createInput({ maxIterations }));

    expect(result.finalStatus).toBe('max_iterations_reached');
    expect(result.iterationsUsed).toBe(2);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.finalResponse).toBeUndefined();
  });

  // ── Scenario 4: Empty tool_calls array (EC-1) ─────────────────────────

  it('should handle empty tool_calls array without stalling (EC-1)', async () => {
    const emptyToolCallsResponse: LLMResponse = {
      id: `resp-${Date.now()}`,
      model: 'test-model',
      content: '',
      role: 'assistant',
      toolCalls: [],
      finishReason: 'tool_calls',
      createdAt: new Date().toISOString(),
    };

    const fakeLLMAdapter = new FakeLLMAdapter([
      emptyToolCallsResponse,
      createTextResponse('Proceeding without tool calls.'),
    ]);

    const kernel = new AgentKernel(createConfig(fakeLLMAdapter));
    const result: KernelRunResult = await kernel.run(createInput());

    expect(result.finalStatus).toBe('completed');
    expect(result.finalResponse).toBe('Proceeding without tool calls.');
    expect(result.toolCalls).toHaveLength(0);
    const types = result.transcript.map((e) => e.type);
    expect(types).not.toContain('tool_call');
    expect(types).not.toContain('tool_result');
  });
});
