import { describe, it, expect, beforeEach } from 'vitest';
import type {
  LLMResponse,
  ToolCall,
} from '../../../src/llm/types.js';
import type { ContextBundle, ContextItem } from '../../../src/context/types.js';
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
      error?: {
        code: string;
        message: string;
        recoverable: boolean;
      };
      resultPreview?: string;
    }>
  > = new Map();

  registerTool(
    name: string,
    handler: (params: unknown) => Promise<{
      success: boolean;
      data?: unknown;
      error?: {
        code: string;
        message: string;
        recoverable: boolean;
      };
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
    permissionContext: {
      userId: string;
      permissions: string[];
    };
  }): Promise<{
    success: boolean;
    data?: unknown;
    error?: {
      code: string;
      message: string;
      recoverable: boolean;
    };
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

  assembleBundle(): ContextBundle {
    return {
      bundleId: 'test-bundle',
      runId: 'test-run',
      agentId: 'test-agent',
      agentType: 'main',
      userId: 'test-user',
      invocationSource: 'gateway_intent',
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
      error?: {
        code: string;
        message: string;
        recoverable: boolean;
      };
      createdAt: string;
      completedAt?: string;
    }>
  > = new Map();

  /** Last dispatched request - for test assertions */
  lastRequest: DispatchRequest | null = null;

  registerHandler(
    actionType: string,
    handler: (request: DispatchRequest) => Promise<{
      requestId: string;
      actionId: string;
      status: string;
      targetRuntime: string;
      result?: unknown;
      error?: {
        code: string;
        message: string;
        recoverable: boolean;
      };
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
    error?: {
      code: string;
      message: string;
      recoverable: boolean;
    };
    createdAt: string;
    completedAt?: string;
  }> {
    // Capture the request for test assertions
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

describe('Agent Kernel Single-Loop Runtime', () => {
  let fakeToolExecutor: FakeToolExecutor;
  let fakeContextManager: FakeContextManager;
  let fakeDispatcher: FakeDispatcher;
  let modelInputBuilder: ModelInputBuilder;

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

    fakeToolExecutor.registerTool('calculator', async (params) => {
      const { a, b, operation } = params as { a: number; b: number; operation: string };
      let result = 0;
      switch (operation) {
        case 'add':
          result = a + b;
          break;
        case 'subtract':
          result = a - b;
          break;
        case 'multiply':
          result = a * b;
          break;
        default:
          return {
            success: false,
            error: {
              code: 'INVALID_OPERATION',
              message: `Unknown operation: ${operation}`,
              recoverable: false,
            },
          };
      }
      return {
        success: true,
        data: { result },
        resultPreview: `${a} ${operation} ${b} = ${result}`,
      };
    });

    fakeDispatcher.registerHandler('execute_tool', async (request) => {
      const targetAction = request.action.targetAction as { toolName?: string; params?: unknown } | undefined;
      const toolResult = await fakeToolExecutor.execute({
        toolCallId: 'test-call-id',
        toolName: targetAction?.toolName || 'unknown',
        params: targetAction?.params || {},
        userId: request.context.userId || 'test-user',
        sessionId: request.context.sessionId,
        kernelRunId: 'test-run',
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
        result: toolResult,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    });
  });

  describe('Text-only response', () => {
    it('should complete KernelRun with text-only response', async () => {
      const llmResponses: LLMResponse[] = [
        createTextResponse('Hello! I can help you with calculations.'),
      ];
      const fakeLLMAdapter = new FakeLLMAdapter(llmResponses);

      const config: KernelConfig = {
        llmAdapter: fakeLLMAdapter,
        toolExecutor: fakeToolExecutor as unknown as ToolExecutor,
        contextManager: fakeContextManager as unknown as ContextManager,
        dispatcher: fakeDispatcher as unknown as RuntimeDispatcher,
        modelInputBuilder,
        maxIterations: 10,
        timeoutMs: 60000,
      };

      const kernel = new AgentKernel(config);

      const contextBundle = fakeContextManager.assembleBundle();
      const input: KernelRunInput = {
        contextBundle,
        runId: 'test-run',
        agentId: 'test-agent',
        agentType: 'main',
        userId: 'test-user',
        maxIterations: 10,
        timeoutMs: 60000,
      };

      const result: KernelRunResult = await kernel.run(input);

      expect(result.finalStatus).toBe('completed');
      expect(result.finalResponse).toBe('Hello! I can help you with calculations.');
      expect(result.iterationsUsed).toBe(1);
      expect(result.toolCalls).toHaveLength(0);
      expect(result.transcript).toHaveLength(2);
    });
  });

  describe('Tool-use dispatch', () => {
    it('should dispatch tool and return terminal result', async () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'calculator',
            arguments: JSON.stringify({ a: 5, b: 3, operation: 'add' }),
          },
        },
      ];

      const llmResponses: LLMResponse[] = [
        createToolUseResponse(toolCalls),
        createTextResponse('The result of 5 + 3 is 8.'),
      ];
      const fakeLLMAdapter = new FakeLLMAdapter(llmResponses);

      const config: KernelConfig = {
        llmAdapter: fakeLLMAdapter,
        toolExecutor: fakeToolExecutor as unknown as ToolExecutor,
        contextManager: fakeContextManager as unknown as ContextManager,
        dispatcher: fakeDispatcher as unknown as RuntimeDispatcher,
        modelInputBuilder,
        maxIterations: 10,
        timeoutMs: 60000,
      };

      const kernel = new AgentKernel(config);

      const contextBundle = fakeContextManager.assembleBundle();
      const input: KernelRunInput = {
        contextBundle,
        runId: 'test-run',
        agentId: 'test-agent',
        agentType: 'main',
        userId: 'test-user',
        maxIterations: 10,
        timeoutMs: 60000,
      };

      const result: KernelRunResult = await kernel.run(input);

      expect(result.finalStatus).toBe('completed');
      expect(result.finalResponse).toBe('The result of 5 + 3 is 8.');
      expect(result.iterationsUsed).toBe(2);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe('calculator');
      expect(result.transcript.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Max iterations', () => {
    it('should return max_iterations_reached when iterations exceed limit', async () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'call-loop',
          type: 'function',
          function: {
            name: 'calculator',
            arguments: JSON.stringify({ a: 1, b: 1, operation: 'add' }),
          },
        },
      ];

      const llmResponses: LLMResponse[] = [
        createToolUseResponse(toolCalls),
        createToolUseResponse(toolCalls),
        createToolUseResponse(toolCalls),
        createToolUseResponse(toolCalls),
        createToolUseResponse(toolCalls),
      ];
      const fakeLLMAdapter = new FakeLLMAdapter(llmResponses);

      const config: KernelConfig = {
        llmAdapter: fakeLLMAdapter,
        toolExecutor: fakeToolExecutor as unknown as ToolExecutor,
        contextManager: fakeContextManager as unknown as ContextManager,
        dispatcher: fakeDispatcher as unknown as RuntimeDispatcher,
        modelInputBuilder,
        maxIterations: 3,
        timeoutMs: 60000,
      };

      const kernel = new AgentKernel(config);

      const contextBundle = fakeContextManager.assembleBundle();
      const input: KernelRunInput = {
        contextBundle,
        runId: 'test-run',
        agentId: 'test-agent',
        agentType: 'main',
        userId: 'test-user',
        maxIterations: 3,
        timeoutMs: 60000,
      };

      const result: KernelRunResult = await kernel.run(input);

      expect(result.finalStatus).toBe('max_iterations_reached');
      expect(result.iterationsUsed).toBe(3);
    });
  });

  describe('Timeout handling', () => {
    it('should return timeout status when execution exceeds timeout', async () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'call-slow',
          type: 'function',
          function: {
            name: 'calculator',
            arguments: JSON.stringify({ a: 1, b: 1, operation: 'add' }),
          },
        },
      ];

      const llmResponses: LLMResponse[] = [
        createToolUseResponse(toolCalls),
        createTextResponse('Never reached'),
      ];
      const fakeLLMAdapter = new FakeLLMAdapter(llmResponses);

      const config: KernelConfig = {
        llmAdapter: fakeLLMAdapter,
        toolExecutor: fakeToolExecutor as unknown as ToolExecutor,
        contextManager: fakeContextManager as unknown as ContextManager,
        dispatcher: fakeDispatcher as unknown as RuntimeDispatcher,
        modelInputBuilder,
        maxIterations: 10,
        timeoutMs: 0,
      };

      const kernel = new AgentKernel(config);

      const contextBundle = fakeContextManager.assembleBundle();
      const input: KernelRunInput = {
        contextBundle,
        runId: 'test-run',
        agentId: 'test-agent',
        agentType: 'main',
        userId: 'test-user',
        maxIterations: 10,
        timeoutMs: 0,
      };

      const result: KernelRunResult = await kernel.run(input);

      expect(result.finalStatus).toBe('timeout');
    });
  });

  describe('Context bundle consumption', () => {
    it('should consume and respect context bundle from Context Manager', async () => {
      const contextItem: ContextItem = {
        itemId: 'test-item',
        sourceType: 'system_note',
        semanticType: 'instruction',
        content: 'You are a helpful assistant.',
        estimatedTokens: 10,
      };
      fakeContextManager.addItem(contextItem);

      const llmResponses: LLMResponse[] = [
        createTextResponse('Acknowledged.'),
      ];
      const fakeLLMAdapter = new FakeLLMAdapter(llmResponses);

      const config: KernelConfig = {
        llmAdapter: fakeLLMAdapter,
        toolExecutor: fakeToolExecutor as unknown as ToolExecutor,
        contextManager: fakeContextManager as unknown as ContextManager,
        dispatcher: fakeDispatcher as unknown as RuntimeDispatcher,
        modelInputBuilder,
        maxIterations: 10,
        timeoutMs: 60000,
      };

      const kernel = new AgentKernel(config);

      const contextBundle = fakeContextManager.assembleBundle();
      const input: KernelRunInput = {
        contextBundle,
        runId: 'test-run',
        agentId: 'test-agent',
        agentType: 'main',
        userId: 'test-user',
        maxIterations: 10,
        timeoutMs: 60000,
      };

      const result: KernelRunResult = await kernel.run(input);

      expect(result.finalStatus).toBe('completed');
      expect(fakeContextManager.getItems()).toHaveLength(1);
      expect(fakeContextManager.getItems()[0].content).toBe('You are a helpful assistant.');
    });
  });

  describe('Transcript commit', () => {
    it('should commit transcript entries after each turn', async () => {
      const llmResponses: LLMResponse[] = [
        createTextResponse('First response'),
      ];
      const fakeLLMAdapter = new FakeLLMAdapter(llmResponses);

      const config: KernelConfig = {
        llmAdapter: fakeLLMAdapter,
        toolExecutor: fakeToolExecutor as unknown as ToolExecutor,
        contextManager: fakeContextManager as unknown as ContextManager,
        dispatcher: fakeDispatcher as unknown as RuntimeDispatcher,
        modelInputBuilder,
        maxIterations: 10,
        timeoutMs: 60000,
      };

      const kernel = new AgentKernel(config);

      const contextBundle = fakeContextManager.assembleBundle();
      const input: KernelRunInput = {
        contextBundle,
        runId: 'test-run',
        agentId: 'test-agent',
        agentType: 'main',
        userId: 'test-user',
        maxIterations: 10,
        timeoutMs: 60000,
      };

      const result: KernelRunResult = await kernel.run(input);

      expect(result.transcript.length).toBeGreaterThan(0);
      expect(result.transcript[0].type).toBe('llm_request');
      expect(result.transcript[1].type).toBe('llm_response');
      expect(result.transcript[0].iteration).toBe(1);
      expect(result.transcript[1].iteration).toBe(1);
    });
  });

  describe('Dispatch payload verification', () => {
    it('should pass toolCallId, userId, and sessionId in dispatch payload', async () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'call-dispatch-test',
          type: 'function',
          function: {
            name: 'calculator',
            arguments: JSON.stringify({ a: 2, b: 3, operation: 'multiply' }),
          },
        },
      ];

      const llmResponses: LLMResponse[] = [
        createToolUseResponse(toolCalls),
        createTextResponse('The result is 6.'),
      ];
      const fakeLLMAdapter = new FakeLLMAdapter(llmResponses);

      const config: KernelConfig = {
        llmAdapter: fakeLLMAdapter,
        toolExecutor: fakeToolExecutor as unknown as ToolExecutor,
        contextManager: fakeContextManager as unknown as ContextManager,
        dispatcher: fakeDispatcher as unknown as RuntimeDispatcher,
        modelInputBuilder,
        maxIterations: 10,
        timeoutMs: 60000,
      };

      const kernel = new AgentKernel(config);

      const contextBundle = fakeContextManager.assembleBundle();
      const input: KernelRunInput = {
        contextBundle,
        runId: 'test-run',
        agentId: 'test-agent',
        agentType: 'main',
        userId: 'dispatch-test-user',
        sessionId: 'dispatch-test-session',
        maxIterations: 10,
        timeoutMs: 60000,
      };

      await kernel.run(input);

      // Verify the dispatch request was captured
      expect(fakeDispatcher.lastRequest).not.toBeNull();

      const dispatchRequest = fakeDispatcher.lastRequest!;

      // Verify userId from input
      expect(dispatchRequest.action.userId).toBe('dispatch-test-user');
      expect(dispatchRequest.context.userId).toBe('dispatch-test-user');

      // Verify sessionId from input
      expect(dispatchRequest.context.sessionId).toBe('dispatch-test-session');

      // Verify targetAction contains toolCallId
      const targetAction = dispatchRequest.action.targetAction as {
        toolName?: string;
        params?: unknown;
        toolCallId?: string;
        toolDispatchRequest?: {
          runId: string;
          userId: string;
          sessionId?: string;
          agentId: string;
          agentType: string;
          toolUses: Array<{ toolCallId: string; toolName: string; input: unknown }>;
          executionPolicy: {
            maxConcurrency: number;
            allowParallelReadOnly: boolean;
            allowWriteConcurrency: boolean;
          };
        };
      };
      expect(targetAction.toolCallId).toBe('call-dispatch-test');
      expect(targetAction.toolName).toBe('calculator');
      expect(targetAction.toolDispatchRequest).toBeDefined();
      expect(targetAction.toolDispatchRequest?.runId).toBe('test-run');
      expect(targetAction.toolDispatchRequest?.userId).toBe('dispatch-test-user');
      expect(targetAction.toolDispatchRequest?.sessionId).toBe('dispatch-test-session');
      expect(targetAction.toolDispatchRequest?.agentId).toBe('test-agent');
      expect(targetAction.toolDispatchRequest?.agentType).toBe('main');
      expect(targetAction.toolDispatchRequest?.toolUses).toEqual([
        {
          toolCallId: 'call-dispatch-test',
          toolName: 'calculator',
          input: { a: 2, b: 3, operation: 'multiply' },
        },
      ]);
      expect(targetAction.toolDispatchRequest?.executionPolicy.maxConcurrency).toBe(1);
      expect(targetAction.toolDispatchRequest?.executionPolicy.allowParallelReadOnly).toBe(true);
      expect(targetAction.toolDispatchRequest?.executionPolicy.allowWriteConcurrency).toBe(false);
    });
  });
});
