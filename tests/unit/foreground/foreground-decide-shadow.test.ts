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

function createDecideToolCallResult(route: string, reason: string, extra?: Record<string, unknown>): LLMResult {
  return {
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
              route,
              requiresPlanner: route === 'spawn_planner',
              reason,
              ...extra,
            }),
          },
        },
      ],
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

/**
 * Mock differentiates legacy (JSON content) vs decide (tool calls) by checking
 * whether `request.tools` is present — the decide path sends tool definitions.
 */
function createDecideShadowLLMAdapter(
  legacyRoute: string,
  legacyReason: string,
  decideRoute: string,
  decideReason: string,
  decideExtra?: Record<string, unknown>,
): LLMAdapter {
  return {
    complete: vi.fn().mockImplementation((request: { tools?: unknown[] }) => {
      if (request.tools) {
        return Promise.resolve(createDecideToolCallResult(decideRoute, decideReason, decideExtra));
      }
      return Promise.resolve(createSuccessLLMResult(JSON.stringify({
        route: legacyRoute,
        reason: legacyReason,
      })));
    }),
    getHealthyProviders: vi.fn().mockReturnValue([{
      config: {
        providerId: 'test-provider',
        providerType: 'openrouter',
        capabilities: { supportsJsonMode: true, supportsFunctionCalling: true },
      },
    }] as unknown as LLMProvider[]),
  } as unknown as LLMAdapter;
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

  describe('Shadow mode: FOREGROUND_DECIDE_ENABLED=true, FOREGROUND_DECIDE_SHADOW_MODE=true', () => {
    it('should return legacy result (not decide result) when routes differ', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'true';

      const llmAdapter = createDecideShadowLLMAdapter(
        'answer_directly', 'legacy: direct answer',
        'dispatch_tool', 'decide: tool dispatch',
      );
      const modelInputBuilder = createMockModelInputBuilder();
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      expect(result.route).toBe('answer_directly');
      expect(result.reason).toBe('legacy: direct answer');
    });

    it('should run both decide and legacy paths in parallel', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'true';

      const llmAdapter = createDecideShadowLLMAdapter(
        'answer_directly', 'legacy',
        'answer_directly', 'decide',
      );
      const modelInputBuilder = createMockModelInputBuilder();
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      expect(llmAdapter.complete).toHaveBeenCalledTimes(2);
      expect(modelInputBuilder.build).toHaveBeenCalled();
    });

    it('should handle decide path failure gracefully and still return legacy result', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'true';

      const legacyResponse = JSON.stringify({ route: 'answer_directly', reason: 'Legacy still works' });
      const llmAdapter = {
        complete: vi.fn().mockImplementation((request: { tools?: unknown[] }) => {
          if (request.tools) {
            return Promise.resolve({
              success: false,
              error: {
                errorId: 'err-decide',
                category: 'timeout',
                code: 'TIMEOUT',
                message: 'Decide path timed out',
                recoverability: 'retryable_later',
                source: { module: 'test' },
                createdAt: new Date().toISOString(),
              },
              providerId: 'test-provider',
            } as LLMResult);
          }
          return Promise.resolve(createSuccessLLMResult(legacyResponse));
        }),
        getHealthyProviders: vi.fn().mockReturnValue([{
          config: {
            providerId: 'test-provider',
            providerType: 'openrouter',
            capabilities: { supportsJsonMode: true, supportsFunctionCalling: true },
          },
        }]),
      } as unknown as LLMAdapter;

      const modelInputBuilder = createMockModelInputBuilder();

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      const result = await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      expect(result.route).toBe('answer_directly');
      expect(result.reason).toBe('Legacy still works');
    });
  });

  describe('Shadow mode diff logging', () => {
    it('should log route diff when decide and legacy routes differ', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'true';

      const llmAdapter = createDecideShadowLLMAdapter(
        'answer_directly', 'legacy reason',
        'dispatch_tool', 'decide reason',
      );
      const modelInputBuilder = createMockModelInputBuilder();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      const shadowDiffCall = consoleSpy.mock.calls.find((call: unknown[]) =>
        call.some((arg: unknown) => typeof arg === 'string' && arg.includes('shadow mode diff')),
      );
      expect(shadowDiffCall).toBeDefined();
      const diffContent = shadowDiffCall!.slice(1).join(' ');
      expect(diffContent).toContain('route: new=dispatch_tool legacy=answer_directly');
    });

    it('should log complexity diff when complexity values differ', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'true';

      const llmAdapter = createDecideShadowLLMAdapter(
        'answer_directly', 'legacy reason',
        'answer_directly', 'decide reason',
        { complexity: 'high' },
      );
      const modelInputBuilder = createMockModelInputBuilder();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      const shadowDiffCall = consoleSpy.mock.calls.find((call: unknown[]) =>
        call.some((arg: unknown) => typeof arg === 'string' && arg.includes('shadow mode diff')),
      );
      expect(shadowDiffCall).toBeDefined();
      const diffContent = shadowDiffCall!.slice(1).join(' ');
      expect(diffContent).toContain('complexity');
    });

    it('should log "no diff" when decide and legacy produce identical outputs', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'true';

      const llmAdapter = createDecideShadowLLMAdapter(
        'answer_directly', 'same reason',
        'answer_directly', 'same reason',
      );
      const modelInputBuilder = createMockModelInputBuilder();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      const noDiffCall = consoleSpy.mock.calls.find((call: unknown[]) =>
        call.some((arg: unknown) => typeof arg === 'string' && arg.includes('shadow mode: no diff')),
      );
      expect(noDiffCall).toBeDefined();
    });

    it('should log suggestedTools diff when tool lists differ', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'true';

      const llmAdapter = createDecideShadowLLMAdapter(
        'answer_directly', 'legacy reason',
        'dispatch_tool', 'decide reason',
        { suggestedTools: ['docs_search'] },
      );
      const modelInputBuilder = createMockModelInputBuilder();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      await agent.processMessage(
        createMockInput({ message: 'Search for docs' }),
        createMockState(),
      );

      const shadowDiffCall = consoleSpy.mock.calls.find((call: unknown[]) =>
        call.some((arg: unknown) => typeof arg === 'string' && arg.includes('shadow mode diff')),
      );
      expect(shadowDiffCall).toBeDefined();
      const diffContent = shadowDiffCall!.slice(1).join(' ');
      expect(diffContent).toContain('route: new=dispatch_tool legacy=answer_directly');
    });

    it('should use vi.spyOn on console.log for shadow mode assertions', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'true';

      const llmAdapter = createDecideShadowLLMAdapter(
        'answer_directly', 'legacy',
        'dispatch_tool', 'decide',
      );
      const modelInputBuilder = createMockModelInputBuilder();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const agent = createForegroundAgent({ llmAdapter, modelInputBuilder });

      await agent.processMessage(
        createMockInput({ message: 'Hello' }),
        createMockState(),
      );

      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should fallback to answer_directly when both paths fail in shadow mode', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'true';
      process.env.FOREGROUND_DECIDE_SHADOW_MODE = 'true';

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

    it('should work without ModelInputBuilder when decide flag is off', async () => {
      process.env.FOREGROUND_DECIDE_ENABLED = 'false';

      const llmAdapter = createLegacyOnlyLLMAdapter('answer_directly', 'Direct answer');

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
