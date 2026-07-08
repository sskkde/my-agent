import { describe, expect, it } from 'vitest'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { ContextBundle } from '../../../src/context/types.js'
import type { KernelConfig, KernelRunInput } from '../../../src/kernel/types.js'
import type { ModelInputBuildInput, BuiltModelInput } from '../../../src/kernel/model-input/model-input-types.js'
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js'
import type { LLMProvider } from '../../../src/llm/provider.js'
import type { LLMRequest, LLMResult } from '../../../src/llm/types.js'

class StaticLLMAdapter implements LLMAdapter {
  config: LLMAdapterConfig = { providers: [], defaultTimeoutMs: 10000, enableCircuitBreaker: false }
  providers: LLMProvider[] = []

  constructor(private readonly content: string) {}

  async complete(request: LLMRequest): Promise<LLMResult> {
    return {
      success: true,
      response: {
        id: 'response-contract-test',
        model: request.model,
        content: this.content,
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      },
      providerId: 'test-provider',
    }
  }

  async *stream(): AsyncGenerator<{ delta: string; providerId: string }> {}
  addProvider(provider: LLMProvider): void {
    this.providers.push(provider)
  }
  removeProvider(providerId: string): void {
    this.providers = this.providers.filter((provider) => provider.id !== providerId)
  }
  getProvider(providerId: string): LLMProvider | undefined {
    return this.providers.find((provider) => provider.id === providerId)
  }
  getHealthyProviders(): LLMProvider[] {
    return this.providers
  }
  updateProviderPriority(_providerId: string, _priority: number): void {}
}

function createBuiltModelInput(input: ModelInputBuildInput): BuiltModelInput {
  return {
    messages: [{ role: 'user', content: input.currentUserMessage ?? 'test' }],
    segments: {
      staticPrefix: 'test-static-prefix',
      tenantProject: '',
      toolPlane: '',
      contextBundle: input.currentUserMessage ?? 'test',
    },
    segmentHashes: {
      segmentA: 'a'.repeat(64),
      segmentB: 'b'.repeat(64),
      segmentC: 'c'.repeat(64),
      segmentD: 'd'.repeat(64),
    },
    metadata: {
      mode: input.mode,
      agentKind: input.agentKind ?? 'kernel',
      agentType: input.agentType ?? 'main',
      agentProfile: input.agentProfile ?? 'default_main',
      providerFamily: input.providerFamily,
      outputContract: input.outputContract,
      messageCount: 1,
    },
  }
}

function createContextBundle(): ContextBundle {
  return {
    bundleId: 'bundle-contract-test',
    runId: 'run-contract-test',
    agentId: 'agent-contract-test',
    agentType: 'main',
    userId: 'user-contract-test',
    invocationSource: 'gateway_intent',
    pinnedItems: [],
    orderedItems: [],
    tokenEstimate: 100,
  }
}

function createKernel(content: string): AgentKernel {
  const config: KernelConfig = {
    llmAdapter: new StaticLLMAdapter(content),
    toolExecutor: { execute: async () => ({ success: true }) },
    contextManager: {
      assembleBundle: createContextBundle,
      getItems: () => [],
      addItem: () => {},
      applyDelta: () => {},
    },
    dispatcher: {
      dispatch: async () => ({
        requestId: 'req-contract-test',
        actionId: 'act-contract-test',
        status: 'completed',
        targetRuntime: 'tool_plane',
        createdAt: new Date().toISOString(),
      }),
    },
    modelInputBuilder: { build: async (input: ModelInputBuildInput) => createBuiltModelInput(input) } as unknown as ModelInputBuilder,
    maxIterations: 1,
    timeoutMs: 5000,
    defaultModel: 'test-model',
    providerFamily: 'openai',
  }
  return new AgentKernel(config)
}

function createRunInput(modelInputOverride: ModelInputBuildInput): KernelRunInput {
  return {
    contextBundle: createContextBundle(),
    runId: 'run-contract-test',
    agentId: 'agent-contract-test',
    agentType: 'main',
    userId: 'user-contract-test',
    modelInputOverride,
    maxIterations: 1,
    timeoutMs: 5000,
  }
}

const validMemoryEnvelope = {
  candidates: [
    {
      memoryType: 'user_preference',
      text: 'User prefers concise summaries',
      confidence: 0.91,
      importance: 'medium',
      sensitivity: 'low',
      keywords: ['concise', 'summaries'],
      scope: { visibility: 'private_user' },
      sourceRefs: { transcriptRefs: ['turn-1'] },
    },
  ],
}

describe('AgentKernel output contract validation', () => {
  it('returns parsed structuredResult for valid structured_json final content', async () => {
    const kernel = createKernel(JSON.stringify(validMemoryEnvelope))

    const result = await kernel.run(
      createRunInput({
        mode: 'structured_json',
        agentType: 'background',
        agentProfile: 'memory',
        providerFamily: 'openai',
        outputContract: 'output:memory-candidate.schema',
        currentUserMessage: 'extract memory',
      }),
    )

    expect(result.finalStatus).toBe('completed')
    expect(result.structuredResult).toEqual(validMemoryEnvelope)
  })

  it('fails structured_json final content when the output contract schema fails', async () => {
    const kernel = createKernel(JSON.stringify({ candidates: [{ text: 'missing fields' }] }))

    const result = await kernel.run(
      createRunInput({
        mode: 'structured_json',
        agentType: 'background',
        agentProfile: 'memory',
        providerFamily: 'openai',
        outputContract: 'output:memory-candidate.schema',
        currentUserMessage: 'extract memory',
      }),
    )

    expect(result.finalStatus).toBe('failed')
    expect(result.error?.code).toBe('SCHEMA_MISMATCH')
    expect(result.transcript.some((entry) => entry.type === 'error')).toBe(true)
  })

  it('keeps default chat natural-language responses unchanged', async () => {
    const kernel = createKernel('Plain text response')

    const result = await kernel.run(
      createRunInput({
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
        outputContract: 'output:default-chat.schema',
        currentUserMessage: 'hello',
      }),
    )

    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Plain text response')
    expect(result.structuredResult).toBeUndefined()
  })
})
