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

function createMockLLMAdapter(responseJson: string): LLMAdapter {
  return {
    complete: vi.fn().mockResolvedValue(createSuccessLLMResult(responseJson)),
    getHealthyProviders: vi.fn().mockReturnValue([{
      config: {
        providerId: 'test-provider',
        providerType: 'openrouter',
        capabilities: { supportsJsonMode: true, supportsFunctionCalling: false },
      },
    }] as unknown as LLMProvider[]),
  } as unknown as LLMAdapter;
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
  };

  return {
    complete: vi.fn().mockResolvedValue(result),
    getHealthyProviders: vi.fn().mockReturnValue([]),
  } as unknown as LLMAdapter;
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
  };

  return {
    build: vi.fn().mockResolvedValue(builtOutput),
  } as unknown as ModelInputBuilder;
}

describe('ForegroundAgent Shadow Mode Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('feature flag OFF (MODEL_INPUT_BUILDER_ENABLED=false)', () => {
    it('should use legacy path when feature flag is disabled', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'false';

      const llmAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Legacy path response',
      }));
      const modelInputBuilder = createMockModelInputBuilder();

      const agent = createForegroundAgent({
        llmAdapter,
        modelInputBuilder,
      });

      const result = await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      expect(result.route).toBe('answer_directly');
      expect(result.reason).toBe('Legacy path response');
      expect(modelInputBuilder.build).not.toHaveBeenCalled();
    });

    it('should work normally without ModelInputBuilder when flag is off', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'false';

      const llmAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Search query',
        suggestedTools: ['docs_search'],
      }));

      const agent = createForegroundAgent({ llmAdapter });

      const result = await agent.processMessage(
        createMockInput({ message: 'search for docs' }),
        createMockState(),
      );

      expect(result.route).toBe('dispatch_tool');
    });
  });

  describe('shadow mode (MODEL_INPUT_SHADOW_MODE=true)', () => {
    it('should run both paths and use legacy result', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true';
      process.env.MODEL_INPUT_SHADOW_MODE = 'true';

      const legacyResponse = JSON.stringify({
        route: 'answer_directly',
        reason: 'Legacy answer',
      });

      const llmAdapter = createMockLLMAdapter(legacyResponse);
      const modelInputBuilder = createMockModelInputBuilder();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const agent = createForegroundAgent({
        llmAdapter,
        modelInputBuilder,
      });

      const result = await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      expect(result.route).toBe('answer_directly');
      expect(result.reason).toBe('Legacy answer');
      expect(modelInputBuilder.build).toHaveBeenCalled();
      expect(llmAdapter.complete).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should log diffs when routes differ between paths', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true';
      process.env.MODEL_INPUT_SHADOW_MODE = 'true';

      let callCount = 0;
      const llmAdapter = {
        complete: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve(createSuccessLLMResult(JSON.stringify({
              route: 'answer_directly',
              reason: 'legacy',
            })));
          }
          return Promise.resolve(createSuccessLLMResult(JSON.stringify({
            route: 'spawn_planner',
            reason: 'new path',
          })));
        }),
        getHealthyProviders: vi.fn().mockReturnValue([{
          config: { providerId: 'test', providerType: 'openrouter', capabilities: { supportsJsonMode: true, supportsFunctionCalling: false } },
        }]),
      } as unknown as LLMAdapter;

      const modelInputBuilder = createMockModelInputBuilder();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Plan a trip' }),
        createMockState(),
      );

      expect(result.route).toBe('answer_directly');
      expect(result.reason).toBe('legacy');

      const shadowLogCall = consoleSpy.mock.calls.find(call =>
        call.some((arg: unknown) => typeof arg === 'string' && arg.includes('shadow mode diff')),
      );
      expect(shadowLogCall).toBeDefined();
    });

    it('should handle new path failure gracefully in shadow mode', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true';
      process.env.MODEL_INPUT_SHADOW_MODE = 'true';

      const legacyResponse = JSON.stringify({
        route: 'answer_directly',
        reason: 'Legacy still works',
      });

      const llmAdapter = createMockLLMAdapter(legacyResponse);

      const failingBuilder = {
        build: vi.fn().mockRejectedValue(new Error('Builder crashed')),
      } as unknown as ModelInputBuilder;

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder: failingBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      expect(result.route).toBe('answer_directly');
      expect(result.reason).toBe('Legacy still works');
    });
  });

  describe('new path active (SHADOW=false, ENABLED=true)', () => {
    it('should use new path result when enabled and shadow is off', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true';
      process.env.MODEL_INPUT_SHADOW_MODE = 'false';
      process.env.MODEL_INPUT_LEGACY_FALLBACK = 'true';

      const llmAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'dispatch_tool',
        reason: 'New path tool dispatch',
        suggestedTools: ['docs_search'],
      }));

      const modelInputBuilder = createMockModelInputBuilder();

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Search for info' }),
        createMockState(),
      );

      expect(modelInputBuilder.build).toHaveBeenCalled();
      expect(result.route).toBe('dispatch_tool');
    });
  });

  describe('legacy fallback (LEGACY_FALLBACK=true)', () => {
    it('should fall back to legacy when new path fails', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true';
      process.env.MODEL_INPUT_SHADOW_MODE = 'false';
      process.env.MODEL_INPUT_LEGACY_FALLBACK = 'true';

      let callCount = 0;
      const llmAdapter = {
        complete: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              success: false,
              error: {
                errorId: 'err-1',
                category: 'timeout',
                code: 'TIMEOUT',
                message: 'New path LLM timed out',
                recoverability: 'retryable_later',
                source: { module: 'test' },
                createdAt: new Date().toISOString(),
              },
              providerId: 'test-provider',
            } as LLMResult);
          }
          return Promise.resolve(createSuccessLLMResult(JSON.stringify({
            route: 'answer_directly',
            reason: 'Legacy fallback response',
          })));
        }),
        getHealthyProviders: vi.fn().mockReturnValue([{
          config: { providerId: 'test', providerType: 'openrouter', capabilities: { supportsJsonMode: true, supportsFunctionCalling: false } },
        }]),
      } as unknown as LLMAdapter;

      const modelInputBuilder = createMockModelInputBuilder();

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Hello there' }),
        createMockState(),
      );

      expect(modelInputBuilder.build).toHaveBeenCalled();
      expect(result.route).toBe('answer_directly');
      expect(result.reason).toBe('Legacy fallback response');
    });

    it('should return error when new path fails and fallback is disabled', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true';
      process.env.MODEL_INPUT_SHADOW_MODE = 'false';
      process.env.MODEL_INPUT_LEGACY_FALLBACK = 'false';

      const failingLLM = createFailingMockLLMAdapter();
      const modelInputBuilder = createMockModelInputBuilder();

      const agent = createForegroundAgent({ llmAdapter: failingLLM, modelInputBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Hello there' }),
        createMockState(),
      );

      expect(result.route).toBe('answer_directly');
      expect(result.reason).toContain('unavailable');
    });
  });

  describe('routing contract preservation', () => {
    it('should still output valid JSON routing contract (no function calling)', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true';
      process.env.MODEL_INPUT_SHADOW_MODE = 'false';
      process.env.MODEL_INPUT_LEGACY_FALLBACK = 'true';

      const llmAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'spawn_planner',
        reason: 'Complex task',
        estimatedSteps: 5,
        complexity: 'high',
      }));

      const modelInputBuilder = createMockModelInputBuilder();

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Plan a complex project' }),
        createMockState(),
      );

      expect(result.route).toBe('spawn_planner');
      expect(result.requiresPlanner).toBe(true);
      expect(result.complexity).toBe('high');
      expect(result.estimatedSteps).toBe(5);
    });

    it('should handle no ModelInputBuilder instance gracefully', async () => {
      process.env.MODEL_INPUT_BUILDER_ENABLED = 'true';

      const llmAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Direct answer',
      }));

      const agent = createForegroundAgent({ llmAdapter });

      const result = await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      expect(result.route).toBe('answer_directly');
      expect(result.reason).toBe('Direct answer');
    });
  });
});
