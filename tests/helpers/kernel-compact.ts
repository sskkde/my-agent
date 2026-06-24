import type { ContextBundle, ContextItem } from '../../src/context/types.js'
import type {
  KernelConfig,
  KernelRunInput,
  ToolExecutor,
  ContextManager,
  RuntimeDispatcher,
} from '../../src/kernel/types.js'
import type { LLMAdapter, LLMAdapterConfig } from '../../src/llm/adapter.js'
import type { LLMProvider } from '../../src/llm/provider.js'
import type { LLMResult, LLMRequest } from '../../src/llm/types.js'
import type { ExactContextUsage } from '../../src/api/types.js'
import { ModelInputBuilder } from '../../src/kernel/model-input/model-input-builder.js'
import { PromptTemplateRegistry } from '../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../src/prompt/template-loader.js'

// ─── Minimal Fakes ────────────────────────────────────────────────────────────

export class FakeLLMAdapter implements LLMAdapter {
  private callCount = 0

  readonly config: LLMAdapterConfig = { providers: [], defaultTimeoutMs: 60000, enableCircuitBreaker: false }
  readonly providers: LLMProvider[] = []

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.callCount++
    if (this.callCount === 1) {
      return {
        success: true,
        response: {
          id: 'resp-1',
          model: request.model,
          content: '',
          role: 'assistant',
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'tc-1', type: 'function', function: { name: 'noop_tool', arguments: '{}' } }],
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }
    }
    return {
      success: true,
      response: {
        id: 'resp-2',
        model: request.model,
        content: 'done',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      },
      providerId: 'fake',
    }
  }

  async *stream(
    _request: LLMRequest,
  ): AsyncGenerator<{ delta: string; providerId: string; model?: string; usage?: ExactContextUsage }> {
    yield { delta: '', providerId: 'fake' }
  }

  addProvider(): void {}
  removeProvider(): void {}
  getProvider(): LLMProvider | undefined { return undefined }
  getHealthyProviders(): LLMProvider[] { return [] }
  updateProviderPriority(): void {}
}

export class FakeToolExecutor implements ToolExecutor {
  async execute() { return { success: true, data: { result: 'ok' } } }
}

export class FakeContextManager implements ContextManager {
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
    }
  }
  getItems() { return [] }
  addItem() {}
  applyDelta() {}
}

export class FakeDispatcher implements RuntimeDispatcher {
  async dispatch() {
    return {
      requestId: 'req-test',
      actionId: 'act-test',
      status: 'completed',
      targetRuntime: 'tool_plane',
      result: { ok: true },
      createdAt: new Date().toISOString(),
    }
  }
}

export function createModelInputBuilder(): ModelInputBuilder {
  const registry = new PromptTemplateRegistry(
    new Map([
      [
        'platform:base',
        {
          id: 'platform:base',
          version: '2026-05-23',
          path: 'platform/base.md',
          agentKind: '*',
          providerFamily: '*',
          layer: 1,
          taxonomyLayer: 'platform',
          description: 'Test base',
          content: 'You are a helpful assistant.',
        },
      ],
      [
        'agentProfile:default_main',
        {
          id: 'agentProfile:default_main',
          version: '2026-05-23',
          path: 'agents/kernel.md',
          agentKind: 'kernel',
          providerFamily: '*',
          layer: 3,
          taxonomyLayer: 'agentProfile',
          agentProfile: 'default_main',
          description: 'Test kernel',
          content: 'Kernel agent instructions.',
        },
      ],
    ]),
  )
  return new ModelInputBuilder({ templateRegistry: registry, templateLoader: new TemplateLoader() })
}

// ─── Test Helpers ─────────────────────────────────────────────────────────────

export function makeContextItem(itemId: string, estimatedTokens: number): ContextItem {
  return {
    itemId,
    sourceType: 'session_history',
    semanticType: 'summary',
    content: `item-${itemId}`,
    estimatedTokens,
  }
}

export function makeHighUtilizationBundle(overrides?: Partial<ContextBundle>): ContextBundle {
  const items = Array.from({ length: 20 }, (_, i) => makeContextItem(`item-${i}`, 500))
  return {
    bundleId: 'test-bundle',
    runId: 'test-run',
    agentId: 'test-agent',
    agentType: 'main',
    userId: 'test-user',
    invocationSource: 'gateway_intent',
    pinnedItems: [],
    orderedItems: items,
    tokenEstimate: 1000,
    compactHints: {
      shouldCompactSoon: true,
      candidateItemIds: ['item-0', 'item-1', 'item-2'],
      mustKeepItemIds: ['item-18', 'item-19'],
    },
    ...overrides,
  }
}

export function makeRunInput(bundle: ContextBundle): KernelRunInput {
  return {
    contextBundle: bundle,
    runId: 'test-run',
    agentId: 'test-agent',
    agentType: 'main',
    userId: 'test-user',
    sessionId: 'test-session',
    maxIterations: 3,
    timeoutMs: 10000,
  }
}

export function makeBaseConfig(overrides?: Partial<KernelConfig>): KernelConfig {
  return {
    llmAdapter: new FakeLLMAdapter(),
    toolExecutor: new FakeToolExecutor(),
    contextManager: new FakeContextManager(),
    dispatcher: new FakeDispatcher(),
    modelInputBuilder: createModelInputBuilder(),
    maxIterations: 10,
    timeoutMs: 30000,
    ...overrides,
  }
}
