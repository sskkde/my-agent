/**
 * ModelInput-Only Routing Tests
 *
 * Verifies that ForegroundAgent uses ModelInputBuilder as the ONLY routing path.
 * No legacy prompt-builder, no shadow mode, no dual-path, no legacy fallback.
 *
 * After the legacy prompt cleanup (Tasks 4–8), these env flags are dead code:
 *   - MODEL_INPUT_BUILDER_ENABLED
 *   - MODEL_INPUT_SHADOW_MODE
 *   - MODEL_INPUT_LEGACY_FALLBACK
 *
 * processMessage() flow:
 *   1. Bypass: approval metadata → approval_handler
 *   2. Bypass: no LLM provider → answer_directly
 *   3. Bypass: no ModelInputBuilder → deterministic → answer_directly
 *   4. Build model input via ModelInputBuilder.build()
 *   5. Decide path (routing_tool_call): kernel → direct decide → deterministic → answer_directly
 *   6. Non-decide path (routing_json): LLM → deterministic → answer_directly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createForegroundAgent } from '../../../src/foreground/foreground-agent.js'
import type { ForegroundMessageInput, ForegroundSessionState } from '../../../src/foreground/types.js'
import type { LLMAdapter } from '../../../src/llm/adapter.js'
import type { LLMProvider } from '../../../src/llm/provider.js'
import type { LLMResult } from '../../../src/llm/types.js'
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import type { BuiltModelInput } from '../../../src/kernel/model-input/model-input-types.js'

// ─── Shared Mock Factories ──────────────────────────────────────────────────

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

function createFailingMockLLMAdapter(): LLMAdapter {
  const result: LLMResult = {
    success: false,
    error: {
      errorId: 'err-1',
      category: 'timeout',
      code: 'TIMEOUT',
      message: 'LLM request timed out',
      recoverability: 'retryable_later',
      source: { module: 'test' },
      createdAt: new Date().toISOString(),
    },
    providerId: 'test-provider',
  }

  return {
    complete: vi.fn().mockResolvedValue(result),
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

function createDecideLLMAdapter(
  decideRoute: string,
  decideReason: string,
  decideExtra?: Record<string, unknown>,
): LLMAdapter {
  return {
    complete: vi.fn().mockResolvedValue({
      success: true,
      response: {
        id: 'resp-decide-1',
        model: 'test-model',
        content: '',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
        toolCalls: [
          {
            id: 'tc-decide-1',
            type: 'function' as const,
            function: {
              name: 'foreground_decide',
              arguments: JSON.stringify({
                schemaVersion: '1.0',
                route: decideRoute,
                requiresPlanner: decideRoute === 'spawn_planner',
                reason: decideReason,
                ...decideExtra,
              }),
            },
          },
        ],
      },
      providerId: 'test-provider',
    } as LLMResult),
    getHealthyProviders: vi.fn().mockReturnValue([
      {
        config: {
          providerId: 'test-provider',
          providerType: 'openrouter',
          capabilities: { supportsJsonMode: true, supportsFunctionCalling: true },
        },
      },
    ] as unknown as LLMProvider[]),
  } as unknown as LLMAdapter
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('ModelInput-Only Routing (No Legacy Path)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  // ─── Test 1: Always uses ModelInputBuilder.build() ──────────────────────

  describe('always uses ModelInputBuilder', () => {
    it('should call modelInputBuilder.build() to construct routing messages', async () => {
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Simple greeting',
        }),
      )
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      expect(modelInputBuilder.build).toHaveBeenCalledTimes(1)
    })

    it('should use ModelInputBuilder for every message (no caching of builder result)', async () => {
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Direct answer',
        }),
      )
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      await agent.processMessage(createMockInput({ message: 'First' }), createMockState())
      await agent.processMessage(createMockInput({ message: 'Second' }), createMockState())

      expect(modelInputBuilder.build).toHaveBeenCalledTimes(2)
    })
  })

  // ─── Test 2: MODEL_INPUT_BUILDER_ENABLED=false has no effect ────────────

  describe('legacy env flags have no effect', () => {
    it('should use ModelInputBuilder even when MODEL_INPUT_BUILDER_ENABLED=false', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'false'

      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Always new path',
        }),
      )
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      const result = await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      // ModelInputBuilder.build() MUST be called — legacy env flag is ignored
      expect(modelInputBuilder.build).toHaveBeenCalledTimes(1)
      expect(result.route).toBe('answer_directly')
    })

    it('should NOT fall back to legacy when MODEL_INPUT_SHADOW_MODE=true', async () => {
      process.env.MODEL_INPUT_SHADOW_MODE = 'true'

      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'dispatch_tool',
          reason: 'Search query',
          suggestedTools: ['docs_search'],
        }),
      )
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      const result = await agent.processMessage(createMockInput({ message: 'search for docs' }), createMockState())

      // No shadow mode: build called once, no dual-path
      expect(modelInputBuilder.build).toHaveBeenCalledTimes(1)
      expect(result.route).toBe('dispatch_tool')
    })

    it('should NOT use legacy fallback even when MODEL_INPUT_LEGACY_FALLBACK=true', async () => {
      process.env.MODEL_INPUT_LEGACY_FALLBACK = 'true'

      // LLM fails — should go to deterministic fallback, NOT legacy
      const failingLLM = createFailingMockLLMAdapter()
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter: failingLLM, modelInputBuilder })

      const result = await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      // LLM failure → deterministic fallback → answer_directly
      expect(modelInputBuilder.build).toHaveBeenCalledTimes(1)
      expect(result.route).toBe('answer_directly')
      // Reason should indicate LLM failure, not legacy path
      expect(result.reason).toContain('unavailable')
    })

    it('should ignore all legacy env flags simultaneously', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'false'
      process.env.MODEL_INPUT_SHADOW_MODE = 'true'
      process.env.MODEL_INPUT_LEGACY_FALLBACK = 'true'

      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'spawn_planner',
          reason: 'Complex task',
          estimatedSteps: 5,
          complexity: 'high',
        }),
      )
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      const result = await agent.processMessage(createMockInput({ message: 'Plan a trip' }), createMockState())

      // All legacy flags ignored — ModelInputBuilder is the only path
      expect(modelInputBuilder.build).toHaveBeenCalledTimes(1)
      expect(result.route).toBe('spawn_planner')
      expect(result.requiresPlanner).toBe(true)
    })
  })

  // ─── Test 3: routing_json success path ──────────────────────────────────

  describe('routing_json success path', () => {
    it('should route answer_directly when LLM returns answer_directly JSON', async () => {
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Simple greeting response',
        }),
      )
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      const result = await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      expect(result.route).toBe('answer_directly')
      expect(result.reason).toBe('Simple greeting response')
    })

    it('should route dispatch_tool with suggestedTools from JSON', async () => {
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'dispatch_tool',
          reason: 'User wants to search docs',
          suggestedTools: ['docs_search'],
        }),
      )
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      const result = await agent.processMessage(
        createMockInput({ message: 'search for documentation' }),
        createMockState(),
      )

      expect(result.route).toBe('dispatch_tool')
      expect(result.suggestedTools).toContain('docs_search')
    })

    it('should route spawn_planner with requiresPlanner=true', async () => {
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'spawn_planner',
          reason: 'Complex multi-step task',
          estimatedSteps: 5,
          complexity: 'high',
        }),
      )
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      const result = await agent.processMessage(
        createMockInput({ message: 'Plan a complex project' }),
        createMockState(),
      )

      expect(result.route).toBe('spawn_planner')
      expect(result.requiresPlanner).toBe(true)
      expect(result.complexity).toBe('high')
      expect(result.estimatedSteps).toBe(5)
    })
  })

  // ─── Test 4: LLM failure → deterministic fallback (NOT legacy) ──────────

  describe('LLM failure → deterministic fallback', () => {
    it('should fall back to answer_directly when LLM returns error', async () => {
      const failingLLM = createFailingMockLLMAdapter()
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter: failingLLM, modelInputBuilder })

      const result = await agent.processMessage(createMockInput({ message: 'Hello there' }), createMockState())

      expect(modelInputBuilder.build).toHaveBeenCalled()
      expect(result.route).toBe('answer_directly')
      expect(result.reason).toContain('unavailable')
    })

    it('should NOT attempt legacy path on LLM failure', async () => {
      // LLM always fails
      const failingLLM = createFailingMockLLMAdapter()
      const modelInputBuilder = createMockModelInputBuilder()

      // Set all legacy flags to true — they should have no effect
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'false'
      process.env.MODEL_INPUT_LEGACY_FALLBACK = 'true'

      const agent = createForegroundAgent({ llmAdapter: failingLLM, modelInputBuilder })

      const result = await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      // Result is deterministic fallback, NOT legacy
      expect(result.route).toBe('answer_directly')
      expect(result.reason).toContain('unavailable')
      // Build was called — new path was attempted
      expect(modelInputBuilder.build).toHaveBeenCalled()
    })
  })

  // ─── Test 5: No ModelInputBuilder → deterministic fallback ──────────────

  describe('no ModelInputBuilder → deterministic fallback', () => {
    it('should route to dispatch_tool deterministically for search queries', async () => {
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'should not reach here',
        }),
      )

      // No modelInputBuilder provided
      const agent = createForegroundAgent({ llmAdapter })

      const result = await agent.processMessage(
        createMockInput({ message: 'search for information' }),
        createMockState(),
      )

      // Deterministic fallback matches "search" keyword
      expect(result.route).toBe('dispatch_tool')
      expect(result.reason).toContain('Deterministic')
    })

    it('should route to spawn_planner deterministically for plan queries', async () => {
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'should not reach here',
        }),
      )

      const agent = createForegroundAgent({ llmAdapter })

      const result = await agent.processMessage(createMockInput({ message: 'plan a project' }), createMockState())

      expect(result.route).toBe('spawn_planner')
      expect(result.reason).toContain('Deterministic')
      expect(result.requiresPlanner).toBe(true)
    })

    it('should fall back to answer_directly when no pattern matches', async () => {
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'should not reach here',
        }),
      )

      const agent = createForegroundAgent({ llmAdapter })

      const result = await agent.processMessage(createMockInput({ message: 'Hello, how are you?' }), createMockState())

      // No keyword match → answer_directly
      expect(result.route).toBe('answer_directly')
      expect(result.reason).toContain('ModelInputBuilder not available')
    })
  })

  // ─── Test 6: Decide mode (routing_tool_call) ────────────────────────────

  describe('decide mode (routing_tool_call)', () => {
    it('should use routing_tool_call mode when FOREGROUND_DECIDE_ENABLED=true', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true'

      const llmAdapter = createDecideLLMAdapter('answer_directly', 'Simple response')
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      const result = await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      // ModelInputBuilder.build() was called with routing_tool_call mode
      expect(modelInputBuilder.build).toHaveBeenCalledTimes(1)
      const buildArg = (modelInputBuilder.build as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(buildArg.mode).toBe('routing_tool_call')

      expect(result.route).toBe('answer_directly')
    })

    it('should parse foreground_decide tool call correctly', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true'

      const llmAdapter = createDecideLLMAdapter('dispatch_tool', 'User needs docs', {
        suggestedTools: ['docs_search'],
      })
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      const result = await agent.processMessage(createMockInput({ message: 'find documentation' }), createMockState())

      expect(result.route).toBe('dispatch_tool')
      expect(result.suggestedTools).toContain('docs_search')
    })

    it('should use routing_json mode when FOREGROUND_DECIDE_ENABLED is not set', async () => {
      // FOREGROUND_DECIDE_ENABLED not set (default)
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Default mode',
        }),
      )
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      const buildArg = (modelInputBuilder.build as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(buildArg.mode).toBe('routing_json')
    })
  })

  // ─── Test 7: Decide failure → deterministic fallback (NOT legacy) ───────

  describe('decide failure fallback', () => {
    it('should fall back to answer_directly when decide LLM fails', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true'

      const failingLLM = createFailingMockLLMAdapter()
      // Get healthy providers that support function calling
      ;(failingLLM.getHealthyProviders as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          config: {
            providerId: 'test-provider',
            providerType: 'openrouter',
            capabilities: { supportsJsonMode: true, supportsFunctionCalling: true },
          },
        },
      ] as unknown as LLMProvider[])

      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter: failingLLM, modelInputBuilder })

      const result = await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      expect(modelInputBuilder.build).toHaveBeenCalled()
      expect(result.route).toBe('answer_directly')
    })

    it('should NOT fall back to legacy when decide path fails', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true'
      process.env.MODEL_INPUT_LEGACY_FALLBACK = 'true'

      const failingLLM = createFailingMockLLMAdapter()
      ;(failingLLM.getHealthyProviders as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          config: {
            providerId: 'test-provider',
            providerType: 'openrouter',
            capabilities: { supportsJsonMode: true, supportsFunctionCalling: true },
          },
        },
      ] as unknown as LLMProvider[])

      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter: failingLLM, modelInputBuilder })

      const result = await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      // Legacy flag ignored — deterministic fallback, not legacy
      expect(result.route).toBe('answer_directly')
      expect(result.reason).toContain('unavailable')
    })
  })

  // ─── Test 8: No legacy code references ──────────────────────────────────

  describe('no legacy code paths', () => {
    it('should never call buildRoutingMessages (no such function exists)', async () => {
      // This test verifies the legacy path is completely gone.
      // buildRoutingMessages was removed in Task 4 — this test documents that.
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'answer_directly',
          reason: 'Test',
        }),
      )
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      // Should work without any legacy code
      const result = await agent.processMessage(createMockInput({ message: 'Hello' }), createMockState())

      expect(result.route).toBe('answer_directly')
      expect(modelInputBuilder.build).toHaveBeenCalled()
    })

    it('should never call callLLMRouter (no such method exists)', async () => {
      // callLLMRouter was removed in Task 4.
      // The agent uses runNewPath() or runDecidePathWithRepair() instead.
      const llmAdapter = createMockLLMAdapter(
        JSON.stringify({
          route: 'dispatch_tool',
          reason: 'Tool dispatch',
          suggestedTools: ['docs_search'],
        }),
      )
      const modelInputBuilder = createMockModelInputBuilder()

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder })

      const result = await agent.processMessage(createMockInput({ message: 'search docs' }), createMockState())

      expect(result.route).toBe('dispatch_tool')
    })
  })
})
