import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  LLMResult,
  LLMRequest,
  ToolCall,
} from '../../../src/llm/types.js';
import type { ContextBundle } from '../../../src/context/types.js';
import type {
  KernelRunInput,
  KernelConfig,
  ToolExecutor,
  ContextManager,
  RuntimeDispatcher,
} from '../../../src/kernel/types.js';
import { AgentKernel } from '../../../src/kernel/agent-kernel.js';
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js';
import type { LLMProvider } from '../../../src/llm/provider.js';
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js';
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js';
import { TemplateLoader } from '../../../src/prompt/template-loader.js';

class FakeLLMAdapter implements LLMAdapter {
  private responses: LLMRequest[] = [];
  private responseQueue: Array<() => Promise<LLMResult>> = [];
  config: LLMAdapterConfig = {
    providers: [],
    defaultTimeoutMs: 60000,
    enableCircuitBreaker: false,
  };
  providers: LLMProvider[] = [];

  setResponseQueue(queue: Array<() => Promise<LLMResult>>): void {
    this.responseQueue = queue;
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.responses.push(request);
    if (this.responseQueue.length > 0) {
      const handler = this.responseQueue.shift()!;
      return handler();
    }
    return {
      success: true,
      response: {
        id: 'resp-test',
        model: request.model,
        content: 'done',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      },
      providerId: 'fake',
    };
  }

  async *stream(): AsyncGenerator<{ delta: string; providerId: string }> {}

  addProvider(provider: LLMProvider): void { this.providers.push(provider); }
  removeProvider(providerId: string): void { this.providers = this.providers.filter(p => p.id !== providerId); }
  getProvider(providerId: string): LLMProvider | undefined { return this.providers.find(p => p.id === providerId); }
  getHealthyProviders(): LLMProvider[] { return this.providers; }
  updateProviderPriority(_providerId: string, _priority: number): void {}

  getLastRequest(): LLMRequest | undefined { return this.responses[this.responses.length - 1]; }
  getAllRequests(): LLMRequest[] { return this.responses; }
}

class FakeToolExecutor implements ToolExecutor {
  async execute() {
    return { success: true, data: { result: 'ok' } };
  }
}

class FakeContextManager implements ContextManager {
  assembleBundle(): ContextBundle {
    return {
      bundleId: 'test-bundle',
      runId: 'test-run',
      agentId: 'test-agent',
      agentType: 'main',
      userId: 'test-user',
      invocationSource: 'gateway_intent',
      pinnedItems: [],
      orderedItems: [],
      tokenEstimate: 100,
    };
  }
  getItems() { return []; }
  addItem() {}
  applyDelta() {}
}

class FakeDispatcher implements RuntimeDispatcher {
  async dispatch() {
    return {
      requestId: 'req-test',
      actionId: 'act-test',
      status: 'completed',
      targetRuntime: 'tool_plane',
      result: { ok: true },
      createdAt: new Date().toISOString(),
    };
  }
}

function createModelInputBuilder(): ModelInputBuilder {
  const registry = new PromptTemplateRegistry(
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
        description: 'Kernel agent instructions.',
        content: 'Execute tasks.',
      }],
    ]),
  );
  return new ModelInputBuilder({
    templateRegistry: registry,
    templateLoader: new TemplateLoader(),
  });
}

function makeBaseConfig(overrides?: Partial<KernelConfig>): KernelConfig {
  return {
    llmAdapter: new FakeLLMAdapter(),
    toolExecutor: new FakeToolExecutor(),
    contextManager: new FakeContextManager(),
    dispatcher: new FakeDispatcher(),
    modelInputBuilder: createModelInputBuilder(),
    maxIterations: 10,
    timeoutMs: 30000,
    ...overrides,
  };
}

function makeRunInput(): KernelRunInput {
  return {
    contextBundle: {
      bundleId: 'test-bundle',
      runId: 'test-run',
      agentId: 'test-agent',
      agentType: 'main',
      userId: 'test-user',
      invocationSource: 'gateway_intent',
      pinnedItems: [],
      orderedItems: [],
      tokenEstimate: 100,
    },
    userId: 'test-user',
    maxIterations: 5,
    timeoutMs: 5000,
  };
}

describe('AgentKernel buildTranscriptMessages toolCalls replay', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.TOOL_LOOP_V2_ENABLED;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TOOL_LOOP_V2_ENABLED;
    } else {
      process.env.TOOL_LOOP_V2_ENABLED = originalEnv;
    }
  });

  it('when TOOL_LOOP_V2 is OFF, toolCalls are NOT replayed in transcript messages', async () => {
    process.env.TOOL_LOOP_V2_ENABLED = 'false';

    const toolCalls: ToolCall[] = [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'test_tool', arguments: '{}' },
      },
    ];

    const fakeLLM = new FakeLLMAdapter();
    fakeLLM.setResponseQueue([
      async () => ({
        success: true,
        response: {
          id: 'resp-1',
          model: 'test-model',
          content: '',
          role: 'assistant',
          toolCalls,
          finishReason: 'tool_calls',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
    ]);

    const config = makeBaseConfig({ llmAdapter: fakeLLM });
    const kernel = new AgentKernel(config);
    await kernel.run(makeRunInput());

    const requests = fakeLLM.getAllRequests();
    expect(requests.length).toBe(2);

    const secondRequest = requests[1];
    const assistantMessages = secondRequest.messages.filter(m => m.role === 'assistant');
    const hasToolCalls = assistantMessages.some(m => m.toolCalls && m.toolCalls.length > 0);
    expect(hasToolCalls).toBe(false);
  });

  it('when TOOL_LOOP_V2 is ON, toolCalls ARE replayed in transcript messages', async () => {
    process.env.TOOL_LOOP_V2_ENABLED = 'true';

    const toolCalls: ToolCall[] = [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'test_tool', arguments: '{}' },
      },
    ];

    const fakeLLM = new FakeLLMAdapter();
    fakeLLM.setResponseQueue([
      async () => ({
        success: true,
        response: {
          id: 'resp-1',
          model: 'test-model',
          content: '',
          role: 'assistant',
          toolCalls,
          finishReason: 'tool_calls',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
    ]);

    const config = makeBaseConfig({ llmAdapter: fakeLLM });
    const kernel = new AgentKernel(config);
    await kernel.run(makeRunInput());

    const requests = fakeLLM.getAllRequests();
    expect(requests.length).toBe(2);

    const secondRequest = requests[1];
    const assistantMessages = secondRequest.messages.filter(m => m.role === 'assistant');
    const hasToolCalls = assistantMessages.some(m => m.toolCalls && m.toolCalls.length > 0);
    expect(hasToolCalls).toBe(true);

    const toolCallMessage = assistantMessages.find(m => m.toolCalls && m.toolCalls.length > 0);
    expect(toolCallMessage?.toolCalls).toEqual(toolCalls);
  });

  it('when TOOL_LOOP_V2 is ON, empty toolCalls array is filtered (EC-1)', async () => {
    process.env.TOOL_LOOP_V2_ENABLED = 'true';

    const emptyToolCalls: ToolCall[] = [];

    const fakeLLM = new FakeLLMAdapter();
    fakeLLM.setResponseQueue([
      async () => ({
        success: true,
        response: {
          id: 'resp-1',
          model: 'test-model',
          content: '',
          role: 'assistant',
          toolCalls: emptyToolCalls,
          finishReason: 'stop',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
    ]);

    const config = makeBaseConfig({ llmAdapter: fakeLLM });
    const kernel = new AgentKernel(config);
    await kernel.run(makeRunInput());

    const requests = fakeLLM.getAllRequests();
    expect(requests.length).toBe(2);

    const secondRequest = requests[1];
    const assistantMessages = secondRequest.messages.filter(m => m.role === 'assistant');
    const hasEmptyToolCalls = assistantMessages.some(
      m => m.toolCalls !== undefined && m.toolCalls.length === 0
    );
    expect(hasEmptyToolCalls).toBe(false);
  });

  it('when TOOL_LOOP_V2 is ON, assistant message with both content and toolCalls', async () => {
    process.env.TOOL_LOOP_V2_ENABLED = 'true';

    const toolCalls: ToolCall[] = [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'test_tool', arguments: '{}' },
      },
    ];

    const fakeLLM = new FakeLLMAdapter();
    fakeLLM.setResponseQueue([
      async () => ({
        success: true,
        response: {
          id: 'resp-1',
          model: 'test-model',
          content: 'Let me help you.',
          role: 'assistant',
          toolCalls,
          finishReason: 'tool_calls',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
    ]);

    const config = makeBaseConfig({ llmAdapter: fakeLLM });
    const kernel = new AgentKernel(config);
    await kernel.run(makeRunInput());

    const requests = fakeLLM.getAllRequests();
    expect(requests.length).toBe(2);

    const secondRequest = requests[1];
    const assistantMessages = secondRequest.messages.filter(m => m.role === 'assistant');

    const contentMessage = assistantMessages.find(m => m.content === 'Let me help you.');
    expect(contentMessage).toBeDefined();

    const toolCallMessage = assistantMessages.find(m => m.toolCalls && m.toolCalls.length > 0);
    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage?.toolCalls).toEqual(toolCalls);
  });
});

describe('Flag evaluated at buildTranscriptMessages time (EC-6)', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.TOOL_LOOP_V2_ENABLED;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TOOL_LOOP_V2_ENABLED;
    } else {
      process.env.TOOL_LOOP_V2_ENABLED = originalEnv;
    }
  });

  it('flag is read dynamically: if changed mid-run, new value is used', async () => {
    process.env.TOOL_LOOP_V2_ENABLED = 'false';

    const toolCalls: ToolCall[] = [
      {
        id: 'call-ec6-1',
        type: 'function',
        function: { name: 'test_tool', arguments: '{}' },
      },
    ];

    const fakeLLM = new FakeLLMAdapter();
    fakeLLM.setResponseQueue([
      async () => {
        process.env.TOOL_LOOP_V2_ENABLED = 'true';
        return {
          success: true,
          response: {
            id: 'resp-ec6-1',
            model: 'test-model',
            content: '',
            role: 'assistant',
            toolCalls,
            finishReason: 'tool_calls',
            createdAt: new Date().toISOString(),
          },
          providerId: 'fake',
        };
      },
    ]);

    const config = makeBaseConfig({ llmAdapter: fakeLLM });
    const kernel = new AgentKernel(config);
    await kernel.run(makeRunInput());

    const requests = fakeLLM.getAllRequests();
    expect(requests.length).toBe(2);

    const secondRequest = requests[1];
    const assistantMessages = secondRequest.messages.filter(m => m.role === 'assistant');
    const hasToolCalls = assistantMessages.some(m => m.toolCalls && m.toolCalls.length > 0);
    
    expect(hasToolCalls).toBe(true);
  });

  it('flag OFF: toolCalls not replayed when flag is OFF at buildTranscriptMessages time', async () => {
    process.env.TOOL_LOOP_V2_ENABLED = 'true';

    const toolCalls: ToolCall[] = [
      {
        id: 'call-ec6-2',
        type: 'function',
        function: { name: 'test_tool', arguments: '{}' },
      },
    ];

    const fakeLLM = new FakeLLMAdapter();
    fakeLLM.setResponseQueue([
      async () => {
        delete process.env.TOOL_LOOP_V2_ENABLED;
        return {
          success: true,
          response: {
            id: 'resp-ec6-2',
            model: 'test-model',
            content: '',
            role: 'assistant',
            toolCalls,
            finishReason: 'tool_calls',
            createdAt: new Date().toISOString(),
          },
          providerId: 'fake',
        };
      },
    ]);

    const config = makeBaseConfig({ llmAdapter: fakeLLM });
    const kernel = new AgentKernel(config);
    await kernel.run(makeRunInput());

    const requests = fakeLLM.getAllRequests();
    expect(requests.length).toBe(2);

    const secondRequest = requests[1];
    const assistantMessages = secondRequest.messages.filter(m => m.role === 'assistant');
    const hasToolCalls = assistantMessages.some(m => m.toolCalls && m.toolCalls.length > 0);
    
    expect(hasToolCalls).toBe(false);
  });

  it('flag state determines buildTranscriptMessages behavior consistently within run', async () => {
    process.env.TOOL_LOOP_V2_ENABLED = 'true';

    const toolCalls1: ToolCall[] = [
      { id: 'call-consistent-1', type: 'function', function: { name: 'tool1', arguments: '{}' } },
    ];
    const toolCalls2: ToolCall[] = [
      { id: 'call-consistent-2', type: 'function', function: { name: 'tool2', arguments: '{}' } },
    ];

    const fakeLLM = new FakeLLMAdapter();
    fakeLLM.setResponseQueue([
      async () => ({
        success: true,
        response: {
          id: 'resp-consistent-1',
          model: 'test-model',
          content: '',
          role: 'assistant',
          toolCalls: toolCalls1,
          finishReason: 'tool_calls',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
      async () => ({
        success: true,
        response: {
          id: 'resp-consistent-2',
          model: 'test-model',
          content: '',
          role: 'assistant',
          toolCalls: toolCalls2,
          finishReason: 'tool_calls',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
    ]);

    const config = makeBaseConfig({ llmAdapter: fakeLLM, maxIterations: 5 });
    const kernel = new AgentKernel(config);
    await kernel.run(makeRunInput());

    const requests = fakeLLM.getAllRequests();
    expect(requests.length).toBe(3);

    for (let i = 1; i < requests.length; i++) {
      const assistantMessages = requests[i].messages.filter(m => m.role === 'assistant');
      const hasToolCalls = assistantMessages.some(m => m.toolCalls && m.toolCalls.length > 0);
      expect(hasToolCalls).toBe(true);
    }
  });
});
