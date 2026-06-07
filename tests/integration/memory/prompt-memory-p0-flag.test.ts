import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createForegroundAgent } from '../../../src/foreground/foreground-agent.js'
import type { ForegroundMessageInput, ForegroundSessionState } from '../../../src/foreground/types.js'
import type { LLMAdapter } from '../../../src/llm/adapter.js'
import type { LLMProvider } from '../../../src/llm/provider.js'
import type { LLMResult } from '../../../src/llm/types.js'
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import type { BuiltModelInput, ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js'
import type {
  PromptProjectionResolver,
  PromptProjectionResolveResult,
} from '../../../src/prompt/prompt-projection-types.js'
import {
  DEFAULT_PERSONA_PROJECTION,
  DEFAULT_TOOL_SELECTION_POLICY,
  DEFAULT_MEMORY_POLICY_PROJECTION,
} from '../../../src/prompt/prompt-projection-defaults.js'

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

function createCapturingMockBuilder(): { builder: ModelInputBuilder; capturedInputs: ModelInputBuildInput[] } {
  const capturedInputs: ModelInputBuildInput[] = []

  const builtOutput: BuiltModelInput = {
    messages: [
      { role: 'system', content: 'You are a routing agent.' },
      { role: 'user', content: 'Route this message.' },
    ],
    segments: {
      staticPrefix: 'system-prompt',
      tenantProject: '',
      toolPlane: 'Available Tool IDs: docs.search',
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

  const builder = {
    build: vi.fn().mockImplementation((input: ModelInputBuildInput) => {
      capturedInputs.push(input)
      return Promise.resolve(builtOutput)
    }),
  } as unknown as ModelInputBuilder

  return { builder, capturedInputs }
}

function createMockPromptProjectionResolver(result?: PromptProjectionResolveResult): PromptProjectionResolver {
  const defaultResult: PromptProjectionResolveResult = {
    personaProjection: DEFAULT_PERSONA_PROJECTION,
    toolSelectionPolicy: DEFAULT_TOOL_SELECTION_POLICY,
    memoryPolicyProjection: DEFAULT_MEMORY_POLICY_PROJECTION,
  }

  return {
    resolve: vi.fn().mockResolvedValue(result ?? defaultResult),
  } as unknown as PromptProjectionResolver
}

describe('PROMPT_MEMORY_P0_ENABLED feature flag', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('flag OFF (default)', () => {
    it('should not inject strategy projections when PROMPT_MEMORY_P0_ENABLED is not set', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true'
      delete process.env.PROMPT_MEMORY_P0_ENABLED

      const { builder, capturedInputs } = createCapturingMockBuilder()
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Test response',
        }),
      )

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder: builder })

      await agent.processMessage(createMockInput(), createMockState())

      expect(capturedInputs).toHaveLength(1)
      const input = capturedInputs[0]
      expect(input.personaProjection).toBeUndefined()
      expect(input.toolSelectionPolicy).toBeUndefined()
      expect(input.memoryPolicyProjection).toBeUndefined()
    })

    it('should not inject strategy projections when PROMPT_MEMORY_P0_ENABLED=false', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true'
      process.env.PROMPT_MEMORY_P0_ENABLED = 'false'

      const { builder, capturedInputs } = createCapturingMockBuilder()
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Test response',
        }),
      )

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder: builder })

      await agent.processMessage(createMockInput(), createMockState())

      expect(capturedInputs).toHaveLength(1)
      const input = capturedInputs[0]
      expect(input.personaProjection).toBeUndefined()
      expect(input.toolSelectionPolicy).toBeUndefined()
      expect(input.memoryPolicyProjection).toBeUndefined()
    })

    it('should produce stable hashes when flag is OFF (no undefined-vs-empty-string issue)', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true'
      delete process.env.PROMPT_MEMORY_P0_ENABLED

      const { builder: builder1, capturedInputs: inputs1 } = createCapturingMockBuilder()
      const { builder: builder2, capturedInputs: inputs2 } = createCapturingMockBuilder()

      const llmAdapter1 = createMockLLMAdapter(JSON.stringify({ route: 'answer_directly', reason: 'r1' }))
      const llmAdapter2 = createMockLLMAdapter(JSON.stringify({ route: 'answer_directly', reason: 'r2' }))

      const agent1 = createForegroundAgent({ llmAdapter: llmAdapter1, modelInputBuilder: builder1 })
      const agent2 = createForegroundAgent({ llmAdapter: llmAdapter2, modelInputBuilder: builder2 })

      await agent1.processMessage(createMockInput(), createMockState())
      await agent2.processMessage(createMockInput(), createMockState())

      const keys1 = Object.keys(inputs1[0])
      const keys2 = Object.keys(inputs2[0])
      expect(keys1).toEqual(keys2)
      expect(keys1).not.toContain('personaProjection')
      expect(keys1).not.toContain('toolSelectionPolicy')
      expect(keys1).not.toContain('memoryPolicyProjection')
    })
  })

  describe('flag ON', () => {
    it('should inject all three strategy projections when PROMPT_MEMORY_P0_ENABLED=true', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true'
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'

      const { builder, capturedInputs } = createCapturingMockBuilder()
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Test response',
        }),
      )
      const mockResolver = createMockPromptProjectionResolver()

      const agent = createForegroundAgent({
        llmAdapter,
        modelInputBuilder: builder,
        promptProjectionResolver: mockResolver,
      })

      await agent.processMessage(createMockInput(), createMockState())

      expect(capturedInputs).toHaveLength(1)
      const input = capturedInputs[0]

      expect(input.personaProjection).toBeDefined()
      expect(input.personaProjection?.personaId).toBe('default-assistant')
      expect(input.personaProjection?.styleGuidelines).toBe('沉稳、清晰、尊重边界')
      expect(input.personaProjection?.constraints).toEqual(['不可覆盖系统规则', '不可越过安全约束'])

      expect(input.toolSelectionPolicy).toBeDefined()
      expect(input.toolSelectionPolicy?.heuristics).toBe('直接回答优先，读优先于写，低风险优先')

      expect(input.memoryPolicyProjection).toBeDefined()
      expect(input.memoryPolicyProjection?.useRules).toBe('记忆为私有背景上下文，默认不主动声明"我记得"')
    })

    it('should have projection fields as actual objects, not empty strings', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true'
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'

      const { builder, capturedInputs } = createCapturingMockBuilder()
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Test response',
        }),
      )
      const mockResolver = createMockPromptProjectionResolver()

      const agent = createForegroundAgent({
        llmAdapter,
        modelInputBuilder: builder,
        promptProjectionResolver: mockResolver,
      })

      await agent.processMessage(createMockInput(), createMockState())

      const input = capturedInputs[0]
      expect(typeof input.personaProjection).toBe('object')
      expect(typeof input.toolSelectionPolicy).toBe('object')
      expect(typeof input.memoryPolicyProjection).toBe('object')
    })
  })

  describe('MEMORY_SEMANTIC_POLICY_ENABLED flag', () => {
    it('should have isMemorySemanticPolicyEnabled defined alongside isPromptMemoryP0Enabled', () => {
      process.env.MEMORY_SEMANTIC_POLICY_ENABLED = 'true'
      expect(process.env.MEMORY_SEMANTIC_POLICY_ENABLED).toBe('true')
    })
  })
})
