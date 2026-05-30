import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createForegroundAgent } from '../../../src/foreground/foreground-agent.js';
import type { ForegroundMessageInput, ForegroundSessionState } from '../../../src/foreground/types.js';
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js';
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js';
import type { LLMAdapter } from '../../../src/llm/adapter.js';
import type { LLMProvider } from '../../../src/llm/provider.js';
import type { KernelRunInput, KernelRunResult } from '../../../src/kernel/types.js';

function healthyFunctionCallingProvider(): LLMProvider {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    type: 'openai',
    enabled: true,
    priority: 1,
    config: {
      apiKey: 'test-key',
      capabilities: {
        supportsFunctionCalling: true,
        supportsJsonMode: true,
        supportsStreaming: false,
      },
    },
    status: 'healthy',
  } as unknown as LLMProvider;
}

function createMockLlmAdapter(): LLMAdapter {
  return {
    complete: vi.fn(async () => {
      throw new Error('ForegroundAgent should route through AgentKernel in this test');
    }),
    getHealthyProviders: vi.fn(() => [healthyFunctionCallingProvider()]),
  } as unknown as LLMAdapter;
}

function createMockModelInputBuilder(): ModelInputBuilder {
  return {} as unknown as ModelInputBuilder;
}

function createMockState(): ForegroundSessionState {
  return {
    hydratedSession: {
      userContext: {
        userId: 'user-1',
        sessionId: 'session-1',
      },
      sessionContext: {
        messageCount: 1,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
      activeWorkRefs: {
        activeRuns: [],
        pendingApprovals: [],
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
    resolvedProvider: 'test-provider',
    resolvedModel: 'test-model',
  };
}

function createMockInput(): ForegroundMessageInput {
  return {
    message: 'Search the docs for kernel routing',
    userId: 'user-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: new Date().toISOString(),
  };
}

describe('ForegroundAgent kernel-backed foreground.decide routing', () => {
  const originalDecideEnabled = process.env.FOREGROUND_DECIDE_ENABLED;
  const originalModelInputEnabled = process.env.MODEL_INPUT_BUILDER_ENABLED;

  beforeEach(() => {
    process.env.FOREGROUND_DECIDE_ENABLED = 'true';
    process.env.MODEL_INPUT_BUILDER_ENABLED = 'true';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDecideEnabled === undefined) delete process.env.FOREGROUND_DECIDE_ENABLED;
    else process.env.FOREGROUND_DECIDE_ENABLED = originalDecideEnabled;
    if (originalModelInputEnabled === undefined) delete process.env.MODEL_INPUT_BUILDER_ENABLED;
    else process.env.MODEL_INPUT_BUILDER_ENABLED = originalModelInputEnabled;
  });

  it('calls AgentKernel with foreground.decide internal handler and returns the structured decision', async () => {
    let capturedInput: KernelRunInput | undefined;
    const kernelResult: KernelRunResult = {
      finalStatus: 'completed',
      iterationsUsed: 1,
      toolCalls: [],
      transcript: [],
      structuredResult: {
        decision: {
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Needs documentation search',
          suggestedTools: ['docs.search'],
        },
      },
    };
    const agentKernel = {
      run: vi.fn(async (input: KernelRunInput) => {
        capturedInput = input;
        return kernelResult;
      }),
    } as unknown as AgentKernel;

    const agent = createForegroundAgent({
      llmAdapter: createMockLlmAdapter(),
      modelInputBuilder: createMockModelInputBuilder(),
      agentKernel,
    });

    const decision = await agent.processMessage(createMockInput(), createMockState());

    expect(agentKernel.run).toHaveBeenCalledTimes(1);
    expect(decision.route).toBe('dispatch_tool');
    expect(decision.reason).toBe('Needs documentation search');
    expect(decision.suggestedTools).toEqual(['docs.search']);
    expect(capturedInput?.modelInputOverride?.mode).toBe('routing_tool_call');
    expect(capturedInput?.modelInputOverride?.agentKind).toBe('foreground');
    expect(capturedInput?.toolChoice).toEqual({ type: 'function', function: { name: 'foreground.decide' } });
    expect(capturedInput?.temperature).toBe(0.1);
    expect(capturedInput?.maxTokens).toBe(500);
    expect(capturedInput?.model).toBe('test-model');
    expect(capturedInput?.maxIterations).toBe(1);
    expect(capturedInput?.internalToolHandlers?.['foreground.decide']).toBeTypeOf('function');
    expect(capturedInput?.toolProjection?.tools?.[0].function.name).toBe('foreground.decide');
    expect(capturedInput?.toolProjection?.toolIds).toContain('docs.search');
  });
});
