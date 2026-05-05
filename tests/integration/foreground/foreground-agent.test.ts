import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createForegroundAgent, mergeDelegationPolicies } from '../../../src/foreground/foreground-agent.js';
import { DEFAULT_ASSISTANT_PERSONA, DEFAULT_DIRECT_DELEGATION_POLICY } from '../../../src/foreground/types.js';
import type { ForegroundMessageInput, ForegroundSessionState } from '../../../src/foreground/types.js';
import type { LLMAdapter } from '../../../src/llm/adapter.js';
import type { LLMRequest, LLMResult, LLMResponse } from '../../../src/llm/types.js';
import type { AgentConfig } from '../../../src/storage/agent-config-store.js';

describe('Foreground Conversation Agent', () => {
  let agent: ReturnType<typeof createForegroundAgent>;
  let baseState: ForegroundSessionState;
  let mockLLMAdapter: LLMAdapter;

  function createBaseState(options?: { activePlannerRunIds?: string[]; activeBackgroundRunIds?: string[] }): ForegroundSessionState {
    return {
      hydratedSession: {
        userContext: {
          userId: 'user_001',
          sessionId: 'sess_001',
        },
        sessionContext: {
          messageCount: 0,
          lastActivityAt: new Date().toISOString(),
          activePlannerRunIds: options?.activePlannerRunIds ?? [],
          activeBackgroundRunIds: options?.activeBackgroundRunIds ?? [],
        },
        activeWorkRefs: {
          pendingApprovals: [],
          activeRuns: [],
        },
      },
      activeWorkRefs: {
        pendingApprovals: [],
        activeRuns: [],
      },
      currentPersona: DEFAULT_ASSISTANT_PERSONA,
      effectivePolicy: DEFAULT_DIRECT_DELEGATION_POLICY,
    };
  }

  function createInput(message: string, metadata?: ForegroundMessageInput['metadata']): ForegroundMessageInput {
    return {
      message,
      userId: 'user_001',
      sessionId: 'sess_001',
      turnId: 'turn_001',
      timestamp: new Date().toISOString(),
      metadata,
    };
  }

  function createMockLLMAdapter(responseContent: string, options?: { supportsJsonMode?: boolean }): LLMAdapter {
    const supportsJsonMode = options?.supportsJsonMode ?? true;
    return {
      config: {
        providers: [],
        defaultTimeoutMs: 10000,
        enableCircuitBreaker: false,
      },
      providers: [],
      complete: vi.fn(async (_request: LLMRequest): Promise<LLMResult> => {
        const response: LLMResponse = {
          id: 'test-response-id',
          model: 'gpt-4o-mini',
          content: responseContent,
          role: 'assistant',
          finishReason: 'stop',
          createdAt: new Date().toISOString(),
        };
          return {
            success: true,
            response,
            providerId: 'mock-provider',
          };
        }),
        stream: async function* () {},
        addProvider: vi.fn(),
        removeProvider: vi.fn(),
        getProvider: vi.fn(),
        getHealthyProviders: vi.fn(() => [{
          id: 'mock-provider',
          config: {
            id: 'mock-provider',
            name: 'Mock Provider',
            enabled: true,
            priority: 1,
            timeoutMs: 10000,
            retries: 2,
            capabilities: {
              supportsStreaming: false,
              supportsFunctionCalling: true,
              supportsJsonMode,
              supportsVision: false,
              maxTokens: 4096,
              supportedModels: [],
            },
          },
          circuitBreaker: { state: 'CLOSED', canExecute: () => true, recordSuccess: () => {}, recordFailure: () => {} } as unknown as LLMAdapter['providers'][0]['circuitBreaker'],
          health: 'healthy',
          stats: { totalRequests: 0, successfulRequests: 0, failedRequests: 0, timeoutRequests: 0, averageLatencyMs: 0, healthStatus: 'healthy' },
          isHealthy: () => true,
          getStats: () => ({ totalRequests: 0, successfulRequests: 0, failedRequests: 0, timeoutRequests: 0, averageLatencyMs: 0, healthStatus: 'healthy' }),
          updateConfig: () => {},
          resetStats: () => {},
          complete: async () => ({ success: true, response: { id: '', model: '', content: '', role: 'assistant', finishReason: 'stop', createdAt: '' }, providerId: 'mock-provider' }),
        }]),
        updateProviderPriority: vi.fn(),
      };
    }


  beforeEach(() => {
    baseState = createBaseState();
  });

  describe('answer_directly route', () => {
    it('should route simple QA to answer_directly', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Simple question about PlannerRun',
        userVisibleResponse: 'PlannerRun is a task execution unit.',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('解释一下 PlannerRun 是什么？');
      const decision = await agent.processMessage(input, baseState);

      expect(decision.route).toBe('answer_directly');
      expect(decision.requiresPlanner).toBe(false);
      expect(decision.userVisibleResponse).toBeDefined();
    });

    it('should route short question to answer_directly using LLM adapter', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Simple greeting',
        userVisibleResponse: '你好！很高兴见到你。',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('你好');
      const decision = await agent.processMessage(input, baseState);

      // Assert fake LLM adapter is called
      expect(mockLLMAdapter.complete).toHaveBeenCalledTimes(1);
      expect(mockLLMAdapter.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          responseFormat: { type: 'json_object' },
        })
      );

      // Assert returned text from LLM is used
      expect(decision.route).toBe('answer_directly');
      expect(decision.userVisibleResponse).toBe('你好！很高兴见到你。');
    });

    it('should route question with question particle to answer_directly', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Question about weather',
        userVisibleResponse: '今天天气不错！',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('今天天气好吗');
      const decision = await agent.processMessage(input, baseState);

      expect(decision.route).toBe('answer_directly');
    });
  });

  describe('spawn_planner route', () => {
    it('should route complex trip task to spawn_planner', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'spawn_planner',
        reason: 'Complex multi-step trip planning task',
        userVisibleResponse: 'I will create a plan for your trip to Shanghai.',
        estimatedSteps: 5,
        complexity: 'high',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('帮我规划下周去上海出差，包括日程、酒店、会议资料');
      const decision = await agent.processMessage(input, baseState);

      expect(decision.route).toBe('spawn_planner');
      expect(decision.requiresPlanner).toBe(true);
    });

    it('should route multi-step task to spawn_planner', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'spawn_planner',
        reason: 'Multi-step task requiring multiple actions',
        userVisibleResponse: 'Planning your multi-step task...',
        estimatedSteps: 3,
        complexity: 'medium',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('请帮我搜索资料、写报告和发送邮件');
      const decision = await agent.processMessage(input, baseState);

      expect(decision.route).toBe('spawn_planner');
    });

    it('should respect estimatedStepsGte policy', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'spawn_planner',
        reason: 'Multi-step task',
        estimatedSteps: 2,
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const state = {
        ...baseState,
        effectivePolicy: mergeDelegationPolicies(DEFAULT_DIRECT_DELEGATION_POLICY, { estimatedStepsGte: 2 }),
      };
      const input = createInput('帮我搜索资料然后写报告');
      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('spawn_planner');
    });
  });

  describe('dispatch_tool route', () => {
    it('includes exact tool IDs in the routing prompt', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Simple search operation',
        suggestedTools: ['docs.search'],
        estimatedSteps: 1,
        complexity: 'low',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('搜索一下文档');
      await agent.processMessage(input, baseState);

      const request = vi.mocked(mockLLMAdapter.complete).mock.calls[0]?.[0];
      const prompt = request?.messages.find((message) => message.role === 'user')?.content;

      expect(prompt).toContain('AVAILABLE TOOL IDS');
      expect(prompt).toContain('docs.search');
      expect(prompt).toContain('transcript.search');
      expect(prompt).toContain('suggestedTools must use only the exact tool IDs');
    });

    it('should route simple read task to dispatch_tool', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Simple search operation',
        suggestedTools: ['memory.retrieve', 'transcript.search'],
        estimatedSteps: 1,
        complexity: 'low',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('搜索一下最近的会议记录');
      const decision = await agent.processMessage(input, baseState);

      expect(decision.route).toBe('dispatch_tool');
      expect(decision.suggestedTools).toContain('memory.retrieve');
      expect(decision.suggestedTools).toContain('transcript.search');
    });

    it('normalizes generic search tool suggestions to known tool IDs', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Simple search operation with generic tool naming',
        suggestedTools: ['search'],
        estimatedSteps: 1,
        complexity: 'low',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('搜索一下最近的会议记录');
      const decision = await agent.processMessage(input, baseState);

      expect(decision.route).toBe('dispatch_tool');
      expect(decision.suggestedTools).toEqual(['docs.search']);
    });
  });

  describe('approval_handler route', () => {
    it('should route approval response to approval_handler without LLM', async () => {
      // No LLM adapter needed - should bypass
      agent = createForegroundAgent();

      const input = createInput('同意', {
        isApprovalResponse: true,
        approvalResponse: {
          requestId: 'appr_001',
          approved: true,
        },
      });
      const decision = await agent.processMessage(input, baseState);

      expect(decision.route).toBe('approval_handler');
      expect(decision.userVisibleResponse).toBe('Processing your approval response...');
    });
  });

  describe('cancel_or_modify_task route', () => {
    it('should route cancel request with active work to cancel_or_modify_task', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested cancellation',
        userVisibleResponse: 'Cancelling the active task...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const state = createBaseState({ activePlannerRunIds: ['pl_run_001'] });
      const input = createInput('取消刚才的任务');
      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.targetRef?.plannerRunId).toBe('pl_run_001');
    });

    it('should route stop request with active background work', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested to stop background work',
        userVisibleResponse: 'Stopping the background task...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const state = createBaseState({ activeBackgroundRunIds: ['bg_run_001'] });
      const input = createInput('停止后台任务');
      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
    });
  });

  describe('status_query route', () => {
    it('should route status query to status_query', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'status_query',
        reason: 'User asking about task progress',
        userVisibleResponse: 'Checking status...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('任务进度怎么样了');
      const decision = await agent.processMessage(input, baseState);

      expect(decision.route).toBe('status_query');
    });

    it('should route progress question to status_query', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'status_query',
        reason: 'User asking about current status',
        userVisibleResponse: 'Let me check...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('现在是什么状态');
      const decision = await agent.processMessage(input, baseState);

      expect(decision.route).toBe('status_query');
    });
  });

  describe('resume_existing_planner route', () => {
    it('should resume existing planner when message is ambiguous', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'resume_existing_planner',
        reason: 'User wants to continue existing session',
        userVisibleResponse: 'Resuming your session...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const state = createBaseState({ activePlannerRunIds: ['pl_run_001'] });
      const input = createInput('继续');
      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('resume_existing_planner');
      expect(decision.targetRef?.plannerRunId).toBe('pl_run_001');
    });
  });

  describe('persona policy', () => {
    it('should use system policy over persona policy', () => {
      const systemPolicy = { estimatedStepsGte: 1 };
      const persona = {
        ...DEFAULT_ASSISTANT_PERSONA,
        directDelegationPolicy: DEFAULT_DIRECT_DELEGATION_POLICY,
      };
      const merged = mergeDelegationPolicies(persona.directDelegationPolicy, systemPolicy);

      expect(merged.estimatedStepsGte).toBe(1);
    });
  });

  describe('no-provider bypass', () => {
    it('should return error when no LLM provider is configured', async () => {
      agent = createForegroundAgent();

      const input = createInput('Hello');
      const decision = await agent.processMessage(input, baseState);

      expect(decision.route).toBe('answer_directly');
      expect(decision.userVisibleResponse).toContain('no AI provider');
    });
  });

  describe('retry logic', () => {
    it('should retry once with repair prompt on parse failure', async () => {
      let callCount = 0;
      mockLLMAdapter = {
        config: {
          providers: [],
          defaultTimeoutMs: 10000,
          enableCircuitBreaker: false,
        },
        providers: [],
        complete: vi.fn(async (): Promise<LLMResult> => {
          callCount++;
          if (callCount === 1) {
            return {
              success: true,
              response: {
                id: 'test-response-1',
                model: 'gpt-4o-mini',
                content: 'invalid json',
                role: 'assistant',
                finishReason: 'stop',
                createdAt: new Date().toISOString(),
              },
              providerId: 'mock-provider',
            };
          }
          return {
            success: true,
            response: {
              id: 'test-response-2',
              model: 'gpt-4o-mini',
              content: JSON.stringify({
                route: 'answer_directly',
                reason: 'Fixed response',
                userVisibleResponse: 'Hello!',
              }),
              role: 'assistant',
              finishReason: 'stop',
              createdAt: new Date().toISOString(),
            },
            providerId: 'mock-provider',
          };
        }),
        stream: async function* () {},
        addProvider: vi.fn(),
        removeProvider: vi.fn(),
        getProvider: vi.fn(),
        getHealthyProviders: vi.fn(() => []),
        updateProviderPriority: vi.fn(),
      };
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('Hello');
      const decision = await agent.processMessage(input, baseState);

      expect(callCount).toBe(2);
      expect(decision.route).toBe('answer_directly');
      expect(decision.userVisibleResponse).toBe('Hello!');
    });

    it('should retry once when the LLM request itself times out', async () => {
      mockLLMAdapter = {
        config: {
          providers: [],
          defaultTimeoutMs: 10000,
          enableCircuitBreaker: false,
        },
        providers: [],
        complete: vi.fn(async (): Promise<LLMResult> => ({
          success: false,
          error: {
            errorId: 'timeout-test-error',
            category: 'timeout',
            code: 'ROUTER_TIMEOUT',
            message: 'LLM router timeout after 10000ms',
            recoverability: 'retryable_later',
            source: { module: 'foreground_agent' },
            createdAt: new Date().toISOString(),
          },
          providerId: 'mock-provider',
        })),
        stream: async function* () {},
        addProvider: vi.fn(),
        removeProvider: vi.fn(),
        getProvider: vi.fn(),
        getHealthyProviders: vi.fn(() => []),
        updateProviderPriority: vi.fn(),
      };
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('你现在使用的是什么模型？');
      const decision = await agent.processMessage(input, baseState);

      expect(mockLLMAdapter.complete).toHaveBeenCalledTimes(2);
      expect(decision.route).toBe('answer_directly');
      expect(decision.reason).toBe('LLM routing temporarily unavailable');
      expect(decision.userVisibleResponse).toBe('The AI provider did not respond in time. Please try again in a moment.');
    });

    it('should return router output when retry after timeout succeeds', async () => {
      let callCount = 0;
      mockLLMAdapter = {
        config: {
          providers: [],
          defaultTimeoutMs: 10000,
          enableCircuitBreaker: false,
        },
        providers: [],
        complete: vi.fn(async (): Promise<LLMResult> => {
          callCount++;
          if (callCount === 1) {
            return {
              success: false,
              error: {
                errorId: 'timeout-test-error',
                category: 'timeout',
                code: 'ROUTER_TIMEOUT',
                message: 'LLM router timeout after 10000ms',
                recoverability: 'retryable_later',
                source: { module: 'foreground_agent' },
                createdAt: new Date().toISOString(),
              },
              providerId: 'mock-provider',
            };
          }
          return {
            success: true,
            response: {
              id: 'test-response-2',
              model: 'gpt-4o-mini',
              content: JSON.stringify({
                route: 'answer_directly',
                reason: 'Recovered after retry',
                userVisibleResponse: 'OK',
              }),
              role: 'assistant',
              finishReason: 'stop',
              createdAt: new Date().toISOString(),
            },
            providerId: 'mock-provider',
          };
        }),
        stream: async function* () {},
        addProvider: vi.fn(),
        removeProvider: vi.fn(),
        getProvider: vi.fn(),
        getHealthyProviders: vi.fn(() => []),
        updateProviderPriority: vi.fn(),
      };
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('Reply exactly with OK.');
      const decision = await agent.processMessage(input, baseState);

      expect(mockLLMAdapter.complete).toHaveBeenCalledTimes(2);
      expect(decision.route).toBe('answer_directly');
      expect(decision.userVisibleResponse).toBe('OK');
    });
  });

  describe('userVisibleResponse', () => {
    it('should use LLM response for answer_directly', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Simple greeting',
        userVisibleResponse: 'Custom greeting from LLM',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('你好');
      const decision = await agent.processMessage(input, baseState);

      expect(decision.userVisibleResponse).toBe('Custom greeting from LLM');
    });

    it('should use LLM response for spawn_planner', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'spawn_planner',
        reason: 'Complex trip planning',
        userVisibleResponse: 'Planning your Shanghai trip with LLM',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('帮我规划下周去上海出差，包括日程、酒店、会议资料');
      const decision = await agent.processMessage(input, baseState);

      expect(decision.userVisibleResponse).toBe('Planning your Shanghai trip with LLM');
    });
  });

  describe('agentConfig from state', () => {
    it('should use agentConfig from state over constructor config', async () => {
      const constructorConfig: AgentConfig = {
        agentConfigId: 'constructor-config',
        agentId: 'foreground.default',
        scope: 'global',
        userId: null,
        displayName: 'Constructor Config',
        enabled: true,
        systemPrompt: 'Constructor system prompt',
        routingPrompt: 'Constructor routing prompt',
        providerId: null,
        model: 'constructor-model',
        allowedToolIds: [],
        allowedSkillIds: [],
        routingTimeoutMs: 5000,
        repairAttempts: 1,
        promptType: null,
        promptVersion: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const stateConfig: AgentConfig = {
        agentConfigId: 'state-config',
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user_001',
        displayName: 'State Config',
        enabled: true,
        systemPrompt: 'State system prompt',
        routingPrompt: 'State routing prompt',
        providerId: null,
        model: 'state-model',
        allowedToolIds: [],
        allowedSkillIds: [],
        routingTimeoutMs: 15000,
        repairAttempts: 2,
        promptType: null,
        promptVersion: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      let capturedRequest: LLMRequest | undefined;
      let capturedTimeout: number | undefined;
      mockLLMAdapter = {
        config: {
          providers: [],
          defaultTimeoutMs: 10000,
          enableCircuitBreaker: false,
        },
        providers: [],
        complete: vi.fn(async (request: LLMRequest): Promise<LLMResult> => {
          capturedRequest = request;
          const response: LLMResponse = {
            id: 'test-response-id',
            model: request.model,
            content: JSON.stringify({
              route: 'answer_directly',
              reason: 'Test',
              userVisibleResponse: 'Response',
            }),
            role: 'assistant',
            finishReason: 'stop',
            createdAt: new Date().toISOString(),
          };
          return {
            success: true,
            response,
            providerId: 'mock-provider',
          };
        }),
        stream: async function* () {},
        addProvider: vi.fn(),
        removeProvider: vi.fn(),
        getProvider: vi.fn(),
        getHealthyProviders: vi.fn(() => []),
        updateProviderPriority: vi.fn(),
      };

      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter, agentConfig: constructorConfig });

      const originalSetTimeout = global.setTimeout;
      const mockSetTimeout = vi.fn((fn: () => void, ms: number) => {
        capturedTimeout = ms;
        return originalSetTimeout(fn, ms);
      });
      global.setTimeout = mockSetTimeout as unknown as typeof setTimeout;

      try {
        const stateWithConfig: ForegroundSessionState = {
          ...baseState,
          agentConfig: stateConfig,
        };

        const input = createInput('Hello');
        await agent.processMessage(input, stateWithConfig);

        expect(capturedRequest).toBeDefined();
        expect(capturedRequest!.model).toBe('state-model');
        // First system message is now the registry base prompt, not agentConfig.systemPrompt
        expect(capturedRequest!.messages[0].content).toContain('foreground routing agent');
        // State config routingPrompt appears as overlay (after registry base + overlay)
        const routingOverlayMsg = capturedRequest!.messages.find(
          (m) => m.role === 'system' && m.content === 'State routing prompt'
        );
        expect(routingOverlayMsg).toBeDefined();
        expect(capturedTimeout).toBe(15000);
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    });

    it('should use agentConfig.repairAttempts from state', async () => {
      const constructorConfig: AgentConfig = {
        agentConfigId: 'constructor-config',
        agentId: 'foreground.default',
        scope: 'global',
        userId: null,
        displayName: 'Constructor Config',
        enabled: true,
        systemPrompt: 'Constructor prompt',
        routingPrompt: null,
        providerId: null,
        model: null,
        allowedToolIds: [],
        allowedSkillIds: [],
        routingTimeoutMs: 10000,
        repairAttempts: 1,
        promptType: null,
        promptVersion: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const stateConfig: AgentConfig = {
        ...constructorConfig,
        agentConfigId: 'state-config',
        scope: 'user',
        userId: 'user_001',
        displayName: 'State Config',
        repairAttempts: 0,
      };

      mockLLMAdapter = createMockLLMAdapter('invalid json');
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter, agentConfig: constructorConfig });

      const decision = await agent.processMessage(createInput('Hello'), {
        ...baseState,
        agentConfig: stateConfig,
      });

      expect(mockLLMAdapter.complete).toHaveBeenCalledTimes(1);
      expect(decision.reason).toBe('LLM routing temporarily unavailable');
    });
  });

  describe('responseFormat conditional on provider capabilities', () => {
    it('should include responseFormat when provider supports JSON mode', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Simple greeting',
        userVisibleResponse: 'Hello!',
      }), { supportsJsonMode: true });
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('你好');
      await agent.processMessage(input, baseState);

      expect(mockLLMAdapter.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          responseFormat: { type: 'json_object' },
        })
      );
    });

    it('should omit responseFormat when provider does not support JSON mode', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Simple greeting',
        userVisibleResponse: 'Hello!',
      }), { supportsJsonMode: false });
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('你好');
      await agent.processMessage(input, baseState);

      const callArgs = vi.mocked(mockLLMAdapter.complete).mock.calls[0]?.[0];
      expect(callArgs?.responseFormat).toBeUndefined();
    });

    it('should omit responseFormat when first healthy provider lacks JSON mode even if fallback supports it', async () => {
      const makeProvider = (id: string, supportsJsonMode: boolean) => ({
        id,
        config: {
          id,
          name: `${id} Provider`,
          enabled: true,
          priority: supportsJsonMode ? 2 : 1,
          timeoutMs: 10000,
          retries: 2,
          capabilities: {
            supportsStreaming: false,
            supportsFunctionCalling: true,
            supportsJsonMode,
            supportsVision: false,
            maxTokens: 4096,
            supportedModels: [],
          },
        },
        circuitBreaker: { state: 'CLOSED', canExecute: () => true, recordSuccess: () => {}, recordFailure: () => {} } as unknown as LLMAdapter['providers'][0]['circuitBreaker'],
        health: 'healthy' as const,
        stats: { totalRequests: 0, successfulRequests: 0, failedRequests: 0, timeoutRequests: 0, averageLatencyMs: 0, healthStatus: 'healthy' as const },
        isHealthy: () => true,
        getStats: () => ({ totalRequests: 0, successfulRequests: 0, failedRequests: 0, timeoutRequests: 0, averageLatencyMs: 0, healthStatus: 'healthy' as const }),
        updateConfig: () => {},
        resetStats: () => {},
        complete: async () => ({ success: true as const, response: { id: '', model: '', content: '', role: 'assistant' as const, finishReason: 'stop' as const, createdAt: '' }, providerId: id }),
      });

      const customProvider = makeProvider('custom-siliconflow', false);
      const fallbackProvider = makeProvider('openrouter-fallback', true);

      mockLLMAdapter = {
        config: {
          providers: [],
          defaultTimeoutMs: 10000,
          enableCircuitBreaker: false,
        },
        providers: [],
        complete: vi.fn(async (_request: LLMRequest): Promise<LLMResult> => ({
          success: true,
          response: {
            id: 'test-response-id',
            model: 'gpt-4o-mini',
            content: JSON.stringify({
              route: 'answer_directly',
              reason: 'Simple greeting',
              userVisibleResponse: 'Hello!',
            }),
            role: 'assistant',
            finishReason: 'stop',
            createdAt: new Date().toISOString(),
          },
          providerId: 'openrouter-fallback',
        })),
        stream: async function* () {},
        addProvider: vi.fn(),
        removeProvider: vi.fn(),
        getProvider: vi.fn(),
        getHealthyProviders: vi.fn(() => [customProvider, fallbackProvider]),
        updateProviderPriority: vi.fn(),
      };
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const input = createInput('你好');
      await agent.processMessage(input, baseState);

      const callArgs = vi.mocked(mockLLMAdapter.complete).mock.calls[0]?.[0];
      expect(callArgs?.responseFormat).toBeUndefined();
    });
  });

  describe('effective allowed tool IDs in routing prompt', () => {
    it('should list all known tools when agentConfig.allowedToolIds is null (inherit)', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Simple question',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const stateWithNullAllowed: ForegroundSessionState = {
        ...baseState,
        agentConfig: {
          agentConfigId: 'cfg-1',
          agentId: 'foreground.default',
          scope: 'global',
          userId: null,
          displayName: 'Test',
          enabled: true,
          systemPrompt: 'sys',
          routingPrompt: null,
          providerId: null,
          model: null,
          allowedToolIds: null,
          allowedSkillIds: [],
          routingTimeoutMs: 60000,
          repairAttempts: 1,
          promptType: null,
          promptVersion: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      await agent.processMessage(createInput('Hello'), stateWithNullAllowed);

      const request = vi.mocked(mockLLMAdapter.complete).mock.calls[0]?.[0];
      const prompt = request?.messages.find((m) => m.role === 'user')?.content;

      expect(prompt).toContain('docs.search');
      expect(prompt).toContain('transcript.search');
      expect(prompt).toContain('memory.retrieve');
    });

    it('should render "none" when agentConfig.allowedToolIds is empty array', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Simple question',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const stateWithEmptyAllowed: ForegroundSessionState = {
        ...baseState,
        agentConfig: {
          agentConfigId: 'cfg-1b',
          agentId: 'foreground.default',
          scope: 'global',
          userId: null,
          displayName: 'Test',
          enabled: true,
          systemPrompt: 'sys',
          routingPrompt: null,
          providerId: null,
          model: null,
          allowedToolIds: [],
          allowedSkillIds: [],
          routingTimeoutMs: 60000,
          repairAttempts: 1,
          promptType: null,
          promptVersion: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      await agent.processMessage(createInput('Hello'), stateWithEmptyAllowed);

      const request = vi.mocked(mockLLMAdapter.complete).mock.calls[0]?.[0];
      const prompt = request?.messages.find((m) => m.role === 'user')?.content;

      const toolIdsSection = prompt?.split('AVAILABLE TOOL IDS')[1]?.split('When using dispatch_tool')[0] ?? '';
      expect(toolIdsSection).toContain('none');
      expect(toolIdsSection).not.toContain('docs.search');
      expect(toolIdsSection).not.toContain('transcript.search');
    });

    it('should only list allowed tools when agentConfig.allowedToolIds restricts tools', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Simple question',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const stateWithRestricted: ForegroundSessionState = {
        ...baseState,
        agentConfig: {
          agentConfigId: 'cfg-2',
          agentId: 'foreground.default',
          scope: 'global',
          userId: null,
          displayName: 'Test',
          enabled: true,
          systemPrompt: 'sys',
          routingPrompt: null,
          providerId: null,
          model: null,
          allowedToolIds: ['ask_user', 'status.query'],
          allowedSkillIds: [],
          routingTimeoutMs: 60000,
          repairAttempts: 1,
          promptType: null,
          promptVersion: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      await agent.processMessage(createInput('Hello'), stateWithRestricted);

      const request = vi.mocked(mockLLMAdapter.complete).mock.calls[0]?.[0];
      const prompt = request?.messages.find((m) => m.role === 'user')?.content;

      expect(prompt).toContain('ask_user');
      expect(prompt).toContain('status.query');

      const toolIdsSection = prompt?.split('AVAILABLE TOOL IDS')[1]?.split('When using dispatch_tool')[0] ?? '';
      expect(toolIdsSection).not.toContain('docs.search');
      expect(toolIdsSection).not.toContain('transcript.search');
      expect(toolIdsSection).not.toContain('memory.retrieve');
    });

    it('should include weather/real-time guidance in the prompt', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Weather question',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      await agent.processMessage(createInput('当前北京天气如何？'), baseState);

      const request = vi.mocked(mockLLMAdapter.complete).mock.calls[0]?.[0];
      const prompt = request?.messages.find((m) => m.role === 'user')?.content;

      expect(prompt).toContain('live web search');
      expect(prompt).toContain('real-time weather');
      expect(prompt).toContain('answer_directly');
      expect(prompt).toContain('Do NOT use docs.search, transcript.search, or memory.retrieve for real-time web/weather queries');
    });

    it('should use registry base prompt as first system message', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Simple question',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      await agent.processMessage(createInput('Hello'), baseState);

      const request = vi.mocked(mockLLMAdapter.complete).mock.calls[0]?.[0];
      const firstSystemMsg = request?.messages.find((m) => m.role === 'system');

      expect(firstSystemMsg).toBeDefined();
      expect(firstSystemMsg!.content).toContain('foreground routing agent');
      expect(firstSystemMsg!.content).toContain('classify');
    });

    it('should source tool IDs from getToolCatalog, not hardcoded list', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'Simple question',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      await agent.processMessage(createInput('Hello'), baseState);

      const request = vi.mocked(mockLLMAdapter.complete).mock.calls[0]?.[0];
      const prompt = request?.messages.find((m) => m.role === 'user')?.content;

      expect(prompt).toContain('artifact.create');
      expect(prompt).toContain('plan.patch');
      expect(prompt).toContain('docs.search');
    });
  });

  describe('deterministic safety for disallowed dispatch_tool', () => {
    it('should convert dispatch_tool with disallowed suggested tools to answer_directly', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Weather lookup',
        suggestedTools: ['docs.search'],
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const stateWithRestricted: ForegroundSessionState = {
        ...baseState,
        agentConfig: {
          agentConfigId: 'cfg-3',
          agentId: 'foreground.default',
          scope: 'global',
          userId: null,
          displayName: 'Test',
          enabled: true,
          systemPrompt: 'sys',
          routingPrompt: null,
          providerId: null,
          model: null,
          allowedToolIds: ['ask_user', 'status.query'],
          allowedSkillIds: [],
          routingTimeoutMs: 60000,
          repairAttempts: 1,
          promptType: null,
          promptVersion: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const decision = await agent.processMessage(createInput('当前北京天气如何？'), stateWithRestricted);

      expect(decision.route).toBe('answer_directly');
      expect(decision.suggestedTools).toBeUndefined();
      expect(decision.reason).toContain('no allowed tools suggested');
    });

    it('should convert dispatch_tool with empty suggested tools to answer_directly', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'dispatch_tool',
        reason: 'No tools suggested',
        suggestedTools: [],
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const decision = await agent.processMessage(createInput('当前北京天气如何？'), baseState);

      expect(decision.route).toBe('answer_directly');
      expect(decision.suggestedTools).toBeUndefined();
    });

    it('should convert dispatch_tool with undefined suggested tools to answer_directly', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'dispatch_tool',
        reason: 'No tools suggested',
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const decision = await agent.processMessage(createInput('当前北京天气如何？'), baseState);

      expect(decision.route).toBe('answer_directly');
      expect(decision.suggestedTools).toBeUndefined();
    });

    it('should keep dispatch_tool when suggested tools are all allowed', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Search docs',
        suggestedTools: ['docs.search'],
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const stateWithDocsAllowed: ForegroundSessionState = {
        ...baseState,
        agentConfig: {
          agentConfigId: 'cfg-4',
          agentId: 'foreground.default',
          scope: 'global',
          userId: null,
          displayName: 'Test',
          enabled: true,
          systemPrompt: 'sys',
          routingPrompt: null,
          providerId: null,
          model: null,
          allowedToolIds: ['docs.search', 'ask_user'],
          allowedSkillIds: [],
          routingTimeoutMs: 60000,
          repairAttempts: 1,
          promptType: null,
          promptVersion: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const decision = await agent.processMessage(createInput('搜索文档'), stateWithDocsAllowed);

      expect(decision.route).toBe('dispatch_tool');
      expect(decision.suggestedTools).toContain('docs.search');
    });

    it('should convert dispatch_tool with only disallowed tools in mixed list to answer_directly', async () => {
      mockLLMAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Mixed tools',
        suggestedTools: ['docs.search', 'transcript.search'],
      }));
      agent = createForegroundAgent({ llmAdapter: mockLLMAdapter });

      const stateWithRestricted: ForegroundSessionState = {
        ...baseState,
        agentConfig: {
          agentConfigId: 'cfg-5',
          agentId: 'foreground.default',
          scope: 'global',
          userId: null,
          displayName: 'Test',
          enabled: true,
          systemPrompt: 'sys',
          routingPrompt: null,
          providerId: null,
          model: null,
          allowedToolIds: ['ask_user'],
          allowedSkillIds: [],
          routingTimeoutMs: 60000,
          repairAttempts: 1,
          promptType: null,
          promptVersion: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const decision = await agent.processMessage(createInput('搜索'), stateWithRestricted);

      expect(decision.route).toBe('answer_directly');
      expect(decision.suggestedTools).toBeUndefined();
    });
  });
});
