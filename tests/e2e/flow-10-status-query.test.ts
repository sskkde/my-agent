import { describe, it, expect, vi } from 'vitest';
import { createForegroundAgent, type ForegroundAgent } from '../../src/foreground/foreground-agent.js';
import type { ForegroundMessageInput, ForegroundSessionState } from '../../src/foreground/types.js';
import type { LLMAdapter } from '../../src/llm/adapter.js';
import type { LLMRequest, LLMResult, LLMResponse } from '../../src/llm/types.js';

function createMockLLMAdapter(responseContent: string): LLMAdapter {
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
    getHealthyProviders: vi.fn(() => []),
    updateProviderPriority: vi.fn(),
  };
}

describe('Flow 10: Status Query and User Interrupt Flows', () => {
  let agent: ForegroundAgent;

  function createBaseState(overrides?: Partial<ForegroundSessionState>): ForegroundSessionState {
    return {
      hydratedSession: {
        userContext: {
          userId: 'user_test_001',
          sessionId: 'sess_test_001',
        },
        sessionContext: {
          messageCount: 0,
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
        personaId: 'test-assistant',
        name: 'Test Assistant',
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
    };
  }

  function createMessageInput(message: string, overrides?: Partial<ForegroundMessageInput>): ForegroundMessageInput {
    return {
      message,
      userId: 'user_test_001',
      sessionId: 'sess_test_001',
      turnId: 'turn_test_001',
      timestamp: new Date().toISOString(),
      ...overrides,
    };
  }

  describe('Status Query Flows', () => {
    it('should return status_query route for status query messages', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'status_query',
        reason: 'User asked about task status',
        userVisibleResponse: 'Checking your task status...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('what is the status of my tasks?');
      const state = createBaseState();

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('status_query');
      expect(decision.reason).toContain('status');
      expect(decision.userVisibleResponse).toContain('Checking');
    });

    it('should generate runtime action for status query with fresh projection', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'status_query',
        reason: 'User asked about active work',
        userVisibleResponse: 'Checking active work...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('show me my active work');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['run_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('status_query');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('query_active_work');
      expect(decision.runtimeAction?.targetRuntime).toBe('gateway');
    });

    it('should detect status query with various keywords', async () => {
      const queries = [
        'status?',
        'what is my progress',
        'how is everything going',
        'check my status',
        'show status',
        'progress report',
      ];

      for (const query of queries) {
        const mockAdapter = createMockLLMAdapter(JSON.stringify({
          route: 'status_query',
          reason: 'User asked about status',
          userVisibleResponse: 'Checking status...',
        }));
        agent = createForegroundAgent({ llmAdapter: mockAdapter });

        const input = createMessageInput(query);
        const state = createBaseState();
        const decision = await agent.processMessage(input, state);
        expect(decision.route).toBe('status_query');
      }
    });

    it('should include active work summary in status query result', async () => {
      const input = createMessageInput('status');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['run_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('status_query');
      expect(decision.targetRef).toBeDefined();
    });
  });

  describe('Cancel/Modify Flows', () => {
    it('should dispatch cancellation RuntimeAction for cancel request with single active task', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested cancellation',
        userVisibleResponse: 'Cancelling the active task...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('cancel the current task');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_run_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('cancel_planner_run');
      expect(decision.runtimeAction?.targetRuntime).toBe('planner_runtime');
      expect(decision.targetRef?.plannerRunId).toBe('planner_run_001');
    });

    it('should dispatch cancellation for background task', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested to stop background work',
        userVisibleResponse: 'Stopping the background task...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('stop the background job');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activeBackgroundRunIds: ['bg_run_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.targetRef?.runtimeActionId).toBe('bg_run_001');
    });

    it('should ask for clarification when ambiguous target (multiple active tasks)', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'Cancel request but multiple active tasks',
        userVisibleResponse: 'Which task would you like to cancel?',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('cancel it');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_run_001', 'planner_run_002'],
            activeBackgroundRunIds: ['bg_run_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.userVisibleResponse?.toLowerCase()).toContain('which');
      expect(decision.targetRef).toBeUndefined();
      expect(decision.requiresPlanner).toBe(false);
    });

    it('should modify PlannerRun objective when modify requested', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested to modify task',
        userVisibleResponse: 'Modifying the task...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('change the task objective to process emails instead');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_run_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('update_plan_state');
      expect(decision.runtimeAction?.targetRuntime).toBe('planner_runtime');
    });
  });

  describe('Pause/Resume Flows', () => {
    it('should generate pause RuntimeAction for pause request', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested pause',
        userVisibleResponse: 'Pausing the task...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('pause the current task');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_run_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('pause_planner_run');
      expect(decision.runtimeAction?.targetRuntime).toBe('planner_runtime');
    });

    it('should generate resume RuntimeAction for resume request', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested resume',
        userVisibleResponse: 'Resuming the task...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('resume the paused task');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_run_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('resume_planner_run');
      expect(decision.runtimeAction?.targetRuntime).toBe('planner_runtime');
    });

    it('should support pause/resume for supported targets only', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested pause',
        userVisibleResponse: 'Pausing the task...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const pauseInput = createMessageInput('pause');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_run_001'],
          },
        },
      });

      const pauseDecision = await agent.processMessage(pauseInput, state);
      expect(pauseDecision.route).toBe('cancel_or_modify_task');
      expect(pauseDecision.runtimeAction?.actionType).toBe('pause_planner_run');
    });
  });

  describe('Ambiguous Target Handling', () => {
    it('should not guess when ActiveWorkProjection has multiple likely matches', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'Cancel request with multiple active tasks',
        userVisibleResponse: 'You have multiple active tasks. Which one would you like to cancel?',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('cancel');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['run_doc_processing', 'run_email_sync'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.userVisibleResponse).toContain('multiple');
      expect(decision.userVisibleResponse?.toLowerCase()).toContain('which');
      expect(decision.targetRef).toBeUndefined();
    });

    it('should list all active work when target is ambiguous', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'Stop request with multiple active tasks',
        userVisibleResponse: 'Listing all active work...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('stop');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['run_001', 'run_002'],
            activeBackgroundRunIds: ['bg_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.userVisibleResponse).toMatch(/task|run|work/i);
      expect(decision.userVisibleResponse).toContain('active');
    });

    it('should allow user to specify target explicitly', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'Cancel specific document processing task',
        userVisibleResponse: 'Cancelling the document processing task...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('cancel the document processing task');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['run_doc_processing', 'run_email_sync'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);
      expect(decision.route).toBe('cancel_or_modify_task');
    });
  });

  describe('RuntimeAction Generation', () => {
    it('should generate proper RuntimeAction for cancel with all required fields', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested cancellation',
        userVisibleResponse: 'Cancelling your task...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('cancel my task');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_run_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionId).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBeDefined();
      expect(decision.runtimeAction?.targetRuntime).toBeDefined();
      expect(decision.runtimeAction?.source).toBeDefined();
      expect(decision.runtimeAction?.userId).toBe('user_test_001');
    });

    it('should set correct targetRuntime for different work types', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested cancellation',
        userVisibleResponse: 'Cancelling...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const plannerState = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_001'],
          },
        },
      });

      const plannerDecision = await agent.processMessage(createMessageInput('cancel'), plannerState);
      expect(plannerDecision.runtimeAction?.targetRuntime).toBe('planner_runtime');
    });

    it('should not directly mutate target runtime state from Foreground Agent', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested cancellation',
        userVisibleResponse: 'Cancelling the task...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('cancel the task');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_run_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('cancel_planner_run');
    });
  });

  describe('ActiveWorkProjection Integration', () => {
    it('should use ActiveWorkProjection when fresh for status query', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'status_query',
        reason: 'User asked about status',
        userVisibleResponse: 'Checking status...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('status');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['run_001'],
            activeBackgroundRunIds: ['bg_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('status_query');
      expect(decision.reason).toContain('status');
    });

    it('should include active work count in status response', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'status_query',
        reason: 'User asked to show status',
        userVisibleResponse: 'Showing status...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('show status');
      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['run_001', 'run_002'],
            activeBackgroundRunIds: ['bg_001'],
          },
        },
      });

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('status_query');
    });
  });

  describe('Edge Cases', () => {
    it('should handle cancel request when no active work exists', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'answer_directly',
        reason: 'No active work to cancel',
        userVisibleResponse: 'There is no active work to cancel.',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('cancel');
      const state = createBaseState();

      const decision = await agent.processMessage(input, state);

      expect(decision.userVisibleResponse).toContain('no active');
      expect(decision.route).toBe('answer_directly');
    });

    it('should handle status query when no work is active', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'status_query',
        reason: 'User asked for status when no work active',
        userVisibleResponse: 'No active work status...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const input = createMessageInput('status');
      const state = createBaseState();

      const decision = await agent.processMessage(input, state);

      expect(decision.route).toBe('status_query');
      expect(decision.userVisibleResponse).toContain('status');
    });

    it('should detect modify intent in various phrasings', async () => {
      const modifyPhrases = [
        'change the task to',
        'modify the objective',
        'update the plan',
        'adjust the goal',
      ];

      for (const phrase of modifyPhrases) {
        const mockAdapter = createMockLLMAdapter(JSON.stringify({
          route: 'cancel_or_modify_task',
          reason: 'User wants to modify task',
          userVisibleResponse: 'Modifying...',
        }));
        agent = createForegroundAgent({ llmAdapter: mockAdapter });

        const input = createMessageInput(phrase);
        const state = createBaseState({
          hydratedSession: {
            ...createBaseState().hydratedSession,
            sessionContext: {
              ...createBaseState().hydratedSession.sessionContext,
              activePlannerRunIds: ['run_001'],
            },
          },
        });

        const decision = await agent.processMessage(input, state);
        expect(decision.route).toBe('cancel_or_modify_task');
      }
    });

    it('should distinguish between pause and cancel intent', async () => {
      const mockAdapter = createMockLLMAdapter(JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested pause or cancel',
        userVisibleResponse: 'Processing...',
      }));
      agent = createForegroundAgent({ llmAdapter: mockAdapter });

      const pauseInput = createMessageInput('pause the task');
      const cancelInput = createMessageInput('cancel the task');

      const state = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['run_001'],
          },
        },
      });

      const pauseDecision = await agent.processMessage(pauseInput, state);
      const cancelDecision = await agent.processMessage(cancelInput, state);

      expect(pauseDecision.route).toBe('cancel_or_modify_task');
      expect(cancelDecision.route).toBe('cancel_or_modify_task');

      if (pauseDecision.runtimeAction) {
        expect(pauseDecision.runtimeAction.actionType).toContain('pause');
      }
      if (cancelDecision.runtimeAction) {
        expect(cancelDecision.runtimeAction.actionType).toContain('cancel');
      }
    });
  });
});
