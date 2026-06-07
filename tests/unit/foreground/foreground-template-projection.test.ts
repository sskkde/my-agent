import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createForegroundAgent } from '../../../src/foreground/foreground-agent.js'
import type { ForegroundMessageInput, ForegroundSessionState } from '../../../src/foreground/types.js'
import type { LLMAdapter } from '../../../src/llm/adapter.js'
import type { LLMProvider } from '../../../src/llm/provider.js'
import type { LLMResult } from '../../../src/llm/types.js'
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import type { BuiltModelInput } from '../../../src/kernel/model-input/model-input-types.js'
import type { PromptProjectionResolver } from '../../../src/prompt/prompt-projection-types.js'

function createMockState(overrides: Partial<ForegroundSessionState> = {}): ForegroundSessionState {
  return {
    hydratedSession: {
      sessionId: 'test-session',
      sessionContext: {
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    },
    activeWorkRefs: {
      activeRuns: [],
      pendingApprovals: [],
    },
    currentPersona: {
      personaId: 'default',
      name: 'Test',
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
    ...overrides,
  } as ForegroundSessionState
}

function createMockInput(overrides: Partial<ForegroundMessageInput> = {}): ForegroundMessageInput {
  return {
    message: 'Hello',
    userId: 'user-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

function createSuccessLLMResult(responseJson: string): LLMResult {
  return {
    success: true,
    response: {
      id: 'resp-1',
      model: 'test-model',
      content: responseJson,
      role: 'assistant',
      finishReason: 'stop',
      createdAt: new Date().toISOString(),
    },
    providerId: 'test-provider',
  }
}

function createMockLLMAdapter(responseJson: string): LLMAdapter {
  return {
    complete: vi.fn().mockResolvedValue(createSuccessLLMResult(responseJson)),
    getHealthyProviders: vi.fn().mockReturnValue([
      {
        config: {
          providerId: 'test-provider',
          providerType: 'openrouter',
          capabilities: { supportsJsonMode: true, supportsFunctionCalling: false },
        },
      },
    ] as unknown as LLMProvider[]),
  } as unknown as LLMAdapter
}

function createMockModelInputBuilder(): ModelInputBuilder {
  const builtOutput: BuiltModelInput = {
    messages: [
      { role: 'system', content: 'You are a routing agent.' },
      { role: 'user', content: 'Route this message.' },
    ],
    segments: {
      staticPrefix: 'system-prompt',
      tenantProject: '',
      toolPlane: 'Available Tool IDs: docs_search',
      contextBundle: 'User Message: Hello',
    },
    segmentHashes: {
      segmentA: 'hash-a',
      segmentB: 'hash-b',
      segmentC: 'hash-c',
      segmentD: 'hash-d',
    },
    metadata: {
      mode: 'routing_json',
      agentKind: 'foreground',
      providerFamily: 'openai',
      messageCount: 2,
    },
  }

  return {
    build: vi.fn().mockResolvedValue(builtOutput),
  } as unknown as ModelInputBuilder
}

function createMockResolver(projections: Record<string, unknown>): PromptProjectionResolver {
  return {
    resolve: vi.fn().mockResolvedValue(projections),
  } as unknown as PromptProjectionResolver
}

describe('ForegroundAgent Template Projection Integration', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('without resolver', () => {
    it('should not inject projections when resolver is not provided', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true'
      process.env.MODEL_INPUT_SHADOW_MODE = 'false'
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'

      let capturedInput: unknown = null
      const modelInputBuilder = {
        build: vi.fn().mockImplementation((input: unknown) => {
          capturedInput = input
          return Promise.resolve({
            messages: [
              { role: 'system', content: 'System' },
              { role: 'user', content: 'User' },
            ],
            segments: { staticPrefix: '', tenantProject: '', toolPlane: '', contextBundle: '' },
            segmentHashes: { segmentA: '', segmentB: '', segmentC: '', segmentD: '' },
            metadata: { mode: 'routing_json', agentKind: 'foreground', providerFamily: 'openai', messageCount: 2 },
          })
        }),
      } as unknown as ModelInputBuilder

      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Direct answer',
        }),
      )

      const agent = createForegroundAgent({
        llmAdapter,
        modelInputBuilder,
        // No resolver provided
      })

      await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      expect(modelInputBuilder.build).toHaveBeenCalled()
      expect(capturedInput).toBeDefined()
      expect((capturedInput as Record<string, unknown>).personaProjection).toBeUndefined()
      expect((capturedInput as Record<string, unknown>).toolSelectionPolicy).toBeUndefined()
      expect((capturedInput as Record<string, unknown>).memoryPolicyProjection).toBeUndefined()
    })
  })

  describe('with resolver but P0 flag OFF', () => {
    it('should not call resolver when P0 flag is OFF', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true'
      process.env.MODEL_INPUT_SHADOW_MODE = 'false'
      process.env.PROMPT_MEMORY_P0_ENABLED = 'false'

      const resolver = createMockResolver({
        personaProjection: { personaId: 'test', styleGuidelines: 'Test style', constraints: [] },
      })

      const modelInputBuilder = createMockModelInputBuilder()
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Direct answer',
        }),
      )

      const agent = createForegroundAgent({
        llmAdapter,
        modelInputBuilder,
        promptProjectionResolver: resolver,
      })

      await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      expect(resolver.resolve).not.toHaveBeenCalled()
    })
  })

  describe('with resolver and P0 flag ON', () => {
    it('should call resolver and spread projections into buildModelInput', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true'
      process.env.MODEL_INPUT_SHADOW_MODE = 'false'
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'

      let capturedInput: unknown = null
      const modelInputBuilder = {
        build: vi.fn().mockImplementation((input: unknown) => {
          capturedInput = input
          return Promise.resolve({
            messages: [
              { role: 'system', content: 'System' },
              { role: 'user', content: 'User' },
            ],
            segments: { staticPrefix: '', tenantProject: '', toolPlane: '', contextBundle: '' },
            segmentHashes: { segmentA: '', segmentB: '', segmentC: '', segmentD: '' },
            metadata: { mode: 'routing_json', agentKind: 'foreground', providerFamily: 'openai', messageCount: 2 },
          })
        }),
      } as unknown as ModelInputBuilder

      const resolver = createMockResolver({
        personaProjection: {
          personaId: 'custom-assistant',
          styleGuidelines: 'Friendly and concise',
          constraints: ['Be helpful', 'Be safe'],
        },
        toolSelectionPolicy: {
          heuristics: 'Prefer read over write',
        },
        memoryPolicyProjection: {
          useRules: 'Use memory sparingly',
          invisibilityRules: ['Do not mention memory'],
        },
      })

      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Direct answer',
        }),
      )

      const agent = createForegroundAgent({
        llmAdapter,
        modelInputBuilder,
        promptProjectionResolver: resolver,
      })

      await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      expect(resolver.resolve).toHaveBeenCalled()
      expect(capturedInput).toBeDefined()
      expect((capturedInput as Record<string, unknown>).personaProjection).toEqual({
        personaId: 'custom-assistant',
        styleGuidelines: 'Friendly and concise',
        constraints: ['Be helpful', 'Be safe'],
      })
      expect((capturedInput as Record<string, unknown>).toolSelectionPolicy).toEqual({
        heuristics: 'Prefer read over write',
      })
      expect((capturedInput as Record<string, unknown>).memoryPolicyProjection).toEqual({
        useRules: 'Use memory sparingly',
        invisibilityRules: ['Do not mention memory'],
      })
    })

    it('should handle empty resolver result gracefully', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true'
      process.env.MODEL_INPUT_SHADOW_MODE = 'false'
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'

      let capturedInput: unknown = null
      const modelInputBuilder = {
        build: vi.fn().mockImplementation((input: unknown) => {
          capturedInput = input
          return Promise.resolve({
            messages: [
              { role: 'system', content: 'System' },
              { role: 'user', content: 'User' },
            ],
            segments: { staticPrefix: '', tenantProject: '', toolPlane: '', contextBundle: '' },
            segmentHashes: { segmentA: '', segmentB: '', segmentC: '', segmentD: '' },
            metadata: { mode: 'routing_json', agentKind: 'foreground', providerFamily: 'openai', messageCount: 2 },
          })
        }),
      } as unknown as ModelInputBuilder

      const resolver = createMockResolver({})

      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Direct answer',
        }),
      )

      const agent = createForegroundAgent({
        llmAdapter,
        modelInputBuilder,
        promptProjectionResolver: resolver,
      })

      await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      expect(resolver.resolve).toHaveBeenCalled()
      expect(capturedInput).toBeDefined()
      expect((capturedInput as Record<string, unknown>).personaProjection).toBeUndefined()
      expect((capturedInput as Record<string, unknown>).toolSelectionPolicy).toBeUndefined()
      expect((capturedInput as Record<string, unknown>).memoryPolicyProjection).toBeUndefined()
    })

    it('should pass empty object to resolver.resolve()', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true'
      process.env.MODEL_INPUT_SHADOW_MODE = 'false'
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'

      const resolver = createMockResolver({})
      const modelInputBuilder = createMockModelInputBuilder()
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Direct answer',
        }),
      )

      const agent = createForegroundAgent({
        llmAdapter,
        modelInputBuilder,
        promptProjectionResolver: resolver,
      })

      await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      expect(resolver.resolve).toHaveBeenCalledWith({})
    })
  })

  describe('MODEL_INPUT_BUILDER_ENABLED flag has no effect', () => {
    it('should still use ModelInputBuilder and resolver when MODEL_INPUT_BUILDER_ENABLED=false', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'false'
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'

      const resolver = createMockResolver({
        personaProjection: { personaId: 'test', styleGuidelines: 'Test', constraints: [] },
      })
      const modelInputBuilder = createMockModelInputBuilder()
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Always new path',
        }),
      )

      const agent = createForegroundAgent({
        llmAdapter,
        modelInputBuilder,
        promptProjectionResolver: resolver,
      })

      await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      // ModelInputBuilder is always used regardless of MODEL_INPUT_BUILDER_ENABLED
      expect(modelInputBuilder.build).toHaveBeenCalled()
      expect(resolver.resolve).toHaveBeenCalled()
    })
  })
})
