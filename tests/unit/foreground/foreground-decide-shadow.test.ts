import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createForegroundAgent } from '../../../src/foreground/foreground-agent.js';
import type { ForegroundMessageInput, ForegroundSessionState } from '../../../src/foreground/types.js';
import type { LLMAdapter } from '../../../src/llm/adapter.js';
import type { LLMProvider } from '../../../src/llm/provider.js';
import type { LLMResult } from '../../../src/llm/types.js';
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js';
import type { BuiltModelInput } from '../../../src/kernel/model-input/model-input-types.js';

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
  } as ForegroundSessionState;
}

function createMockInput(overrides: Partial<ForegroundMessageInput> = {}): ForegroundMessageInput {
  return {
    message: 'Hello',
    userId: 'user-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
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
  };
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
      mode: 'routing_tool_call',
      agentKind: 'foreground',
      providerFamily: 'openai',
      messageCount: 2,
    },
  };

  return {
    build: vi.fn().mockResolvedValue(builtOutput),
  } as unknown as ModelInputBuilder;
}

function createLegacyOnlyLLMAdapter(route: string, reason: string): LLMAdapter {
  return {
    complete: vi.fn().mockResolvedValue(createSuccessLLMResult(JSON.stringify({ route, reason }))),
    getHealthyProviders: vi.fn().mockReturnValue([{
      config: {
        providerId: 'test-provider',
        providerType: 'openrouter',
        capabilities: { supportsJsonMode: true, supportsFunctionCalling: false },
      },
    }] as unknown as LLMProvider[]),
  } as unknown as LLMAdapter;
}

describe('Foreground Decide Shadow Mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.MODEL_INPUT_BUILDER_ENABLED = 'true';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Flag OFF: FOREGROUND_DECIDE_ENABLED=false', () => {
    it('should use legacy routing_json path when decide is disabled', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'false';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'false';

      const llmAdapter = createLegacyOnlyLLMAdapter('answer_directly', 'Legacy direct answer');
      const modelInputBuilder = createMockModelInputBuilder();

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      expect(result.route).toBe('answer_directly');
      expect(result.reason).toBe('Legacy direct answer');
    });

    it('should use routing_json mode for dispatch_subagent when decide is disabled', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'false';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'false';

      const llmAdapter = createLegacyOnlyLLMAdapter('dispatch_subagent', 'Background task detected');
      const modelInputBuilder = createMockModelInputBuilder();

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Process this in background' }),
        createMockState(),
      );

      expect(result.route).toBe('dispatch_subagent');
      expect(result.reason).toBe('Background task detected');
    });

    it('should not trigger decide path even when shadow mode env is set', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'false';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'true';

      const llmAdapter = createLegacyOnlyLLMAdapter('answer_directly', 'Legacy response');
      const modelInputBuilder = createMockModelInputBuilder();

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      expect(result.route).toBe('answer_directly');
      expect(result.reason).toBe('Legacy response');
    });

    it('should return same decision as before when flag is OFF', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'false';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'false';

      const llmAdapter = createLegacyOnlyLLMAdapter('spawn_planner', 'Complex multi-step task');
      const modelInputBuilder = createMockModelInputBuilder();

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Plan a complex project' }),
        createMockState(),
      );

      expect(result.route).toBe('spawn_planner');
      expect(result.requiresPlanner).toBe(true);
      expect(result.reason).toBe('Complex multi-step task');
    });
  });

  describe('Edge cases', () => {
    it('should fallback to answer_directly when LLM fails with decide enabled', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true';

      const failingAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: false,
          error: {
            errorId: 'err-both',
            category: 'timeout',
            code: 'TIMEOUT',
            message: 'Both paths timed out',
            recoverability: 'retryable_later',
            source: { module: 'test' },
            createdAt: new Date().toISOString(),
          },
          providerId: 'test-provider',
        } as LLMResult),
        getHealthyProviders: vi.fn().mockReturnValue([{
          config: {
            providerId: 'test-provider',
            providerType: 'openrouter',
            capabilities: { supportsJsonMode: true, supportsFunctionCalling: true },
          },
        }]),
      } as unknown as LLMAdapter;

      const modelInputBuilder = createMockModelInputBuilder();

      const agent = createForegroundAgent({ llmAdapter: failingAdapter, modelInputBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      expect(result.route).toBe('answer_directly');
    });

    it('should return answer_directly with diagnostic reason when ModelInputBuilder is missing', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'false';

      const llmAdapter = createLegacyOnlyLLMAdapter('answer_directly', 'Direct answer');

      const agent = createForegroundAgent({ llmAdapter });

      const result = await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      expect(result.route).toBe('answer_directly');
      expect(result.reason).toBe('ModelInputBuilder not available');
    });
  });
});
