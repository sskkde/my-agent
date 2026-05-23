import { describe, it, expect, beforeEach } from 'vitest';
import type {
  LLMResult,
  LLMRequest,
} from '../../../src/llm/types.js';
import type { ContextBundle } from '../../../src/context/types.js';
import type {
  KernelRunInput,
  KernelConfig,
  ToolExecutor,
  ContextManager,
  RuntimeDispatcher,
} from '../../../src/kernel/types.js';
import type { ToolPlaneProjection } from '../../../src/kernel/model-input/model-input-types.js';
import { AgentKernel } from '../../../src/kernel/agent-kernel.js';
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js';
import type { LLMProvider } from '../../../src/llm/provider.js';
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js';
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js';
import { TemplateLoader } from '../../../src/prompt/template-loader.js';
import { extractToolsForRequest } from '../../../src/kernel/model-input/model-input-builder.js';
import type { ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js';

// ─── Minimal fakes ──────────────────────────────────────────────────────────

class FakeLLMAdapter implements LLMAdapter {
  private lastRequest: LLMRequest | undefined;
  config: LLMAdapterConfig = {
    providers: [],
    defaultTimeoutMs: 60000,
    enableCircuitBreaker: false,
  };
  providers: LLMProvider[] = [];

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.lastRequest = request;
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

  getLastRequest(): LLMRequest | undefined { return this.lastRequest; }
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
        description: 'Test kernel',
        content: 'Kernel agent instructions.',
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
      invocationSource: 'gateway_intent',
      pinnedItems: [],
      orderedItems: [],
      tokenEstimate: 100,
    },
    maxIterations: 1,
    timeoutMs: 5000,
  };
}

const sampleToolProjection: ToolPlaneProjection = {
  toolIds: ['status.query', 'web.search'],
  tools: [
    {
      type: 'function',
      function: {
        name: 'status.query',
        description: 'Query active work status',
        parameters: { type: 'object', properties: { runId: { type: 'string' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web.search',
        description: 'Search the web',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      },
    },
  ],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AgentKernel toolProjection in function_calling mode', () => {
  let fakeLLM: FakeLLMAdapter;

  beforeEach(() => {
    fakeLLM = new FakeLLMAdapter();
  });

  it('passes toolProjection from config to ModelInputBuildInput', async () => {
    const config = makeBaseConfig({
      llmAdapter: fakeLLM,
      toolProjection: sampleToolProjection,
    });
    const kernel = new AgentKernel(config);
    await kernel.run(makeRunInput());

    const request = fakeLLM.getLastRequest();
    expect(request).toBeDefined();
    expect(request!.tools).toBeDefined();
    expect(request!.tools!.length).toBe(2);
    expect(request!.tools![0].function.name).toBe('status.query');
    expect(request!.tools![1].function.name).toBe('web.search');
  });

  it('uses empty fallback when toolProjection is not provided', async () => {
    const config = makeBaseConfig({ llmAdapter: fakeLLM });
    const kernel = new AgentKernel(config);
    await kernel.run(makeRunInput());

    const request = fakeLLM.getLastRequest();
    expect(request).toBeDefined();
    // With empty fallback { toolIds: [], tools: [] }, extractToolsForRequest
    // sees tools as [] (empty array, not undefined), so it returns [] not undefined
    expect(request!.tools).toEqual([]);
  });

  it('function_calling mode with tools produces LLMRequest.tools as non-empty array', async () => {
    const config = makeBaseConfig({
      llmAdapter: fakeLLM,
      toolProjection: sampleToolProjection,
    });
    const kernel = new AgentKernel(config);
    await kernel.run(makeRunInput());

    const request = fakeLLM.getLastRequest();
    expect(request!.tools).toBeDefined();
    expect(request!.tools!.length).toBeGreaterThan(0);
    for (const tool of request!.tools!) {
      expect(tool.type).toBe('function');
      expect(tool.function.name).toBeTypeOf('string');
      expect(tool.function.description).toBeTypeOf('string');
    }
  });

  it('function_calling mode with toolIds-only projection produces LLMRequest.tools as undefined via extractToolsForRequest', () => {
    // When toolProjection has toolIds but no tools field,
    // extractToolsForRequest returns undefined (no full schemas available)
    const projectionWithoutSchemas: ToolPlaneProjection = {
      toolIds: ['status.query', 'web.search'],
    };

    const buildInput: ModelInputBuildInput = {
      mode: 'function_calling',
      agentKind: 'kernel',
      providerFamily: 'openai',
      toolProjection: projectionWithoutSchemas,
      currentDate: new Date().toISOString(),
      sessionId: 'test',
      runId: 'test',
    };

    const tools = extractToolsForRequest(buildInput);
    expect(tools).toBeUndefined();
  });

  it('function_calling mode with empty toolIds and empty tools array produces LLMRequest.tools as empty array', () => {
    const buildInput: ModelInputBuildInput = {
      mode: 'function_calling',
      agentKind: 'kernel',
      providerFamily: 'openai',
      toolProjection: { toolIds: [], tools: [] },
      currentDate: new Date().toISOString(),
      sessionId: 'test',
      runId: 'test',
    };

    const tools = extractToolsForRequest(buildInput);
    // tools is [] (empty array, truthy-ish but length 0)
    // extractToolsForRequest: if input.toolProjection?.tools is truthy (even []), returns it
    expect(tools).toEqual([]);
  });

  it('function_calling mode without toolProjection at all produces LLMRequest.tools as undefined via extractToolsForRequest', () => {
    const buildInput: ModelInputBuildInput = {
      mode: 'function_calling',
      agentKind: 'kernel',
      providerFamily: 'openai',
      currentDate: new Date().toISOString(),
      sessionId: 'test',
      runId: 'test',
    };

    const tools = extractToolsForRequest(buildInput);
    expect(tools).toBeUndefined();
  });
});