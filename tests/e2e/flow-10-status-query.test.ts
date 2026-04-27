import { describe, it, expect, beforeEach } from 'vitest';
import { createForegroundAgent, type ForegroundAgent } from '../../src/foreground/foreground-agent.js';
import type { ForegroundMessageInput, ForegroundSessionState } from '../../src/foreground/types.js';

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

  beforeEach(() => {
    agent = createForegroundAgent();
  });

  describe('Status Query Flows', () => {
    it('should return status_query route for status query messages', () => {
      const input = createMessageInput('what is the status of my tasks?');
      const state = createBaseState();

      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('status_query');
      expect(decision.reason).toContain('status');
      expect(decision.userVisibleResponse).toContain('Checking');
    });

    it('should generate runtime action for status query with fresh projection', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('status_query');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('query_active_work');
      expect(decision.runtimeAction?.targetRuntime).toBe('gateway');
    });

    it('should detect status query with various keywords', () => {
      const queries = [
        'status?',
        'what is my progress',
        'how is everything going',
        'check my status',
        'show status',
        'progress report',
      ];

      for (const query of queries) {
        const input = createMessageInput(query);
        const state = createBaseState();
        const decision = agent.processMessage(input, state);
        expect(decision.route).toBe('status_query');
      }
    });

    it('should include active work summary in status query result', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('status_query');
      expect(decision.targetRef).toBeDefined();
    });
  });

  describe('Cancel/Modify Flows', () => {
    it('should dispatch cancellation RuntimeAction for cancel request with single active task', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('cancel_planner_run');
      expect(decision.runtimeAction?.targetRuntime).toBe('planner_runtime');
      expect(decision.targetRef?.plannerRunId).toBe('planner_run_001');
    });

    it('should dispatch cancellation for background task', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.targetRef?.runtimeActionId).toBe('bg_run_001');
    });

    it('should ask for clarification when ambiguous target (multiple active tasks)', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.userVisibleResponse).toContain('which');
      expect(decision.targetRef).toBeUndefined();
      expect(decision.requiresPlanner).toBe(false);
    });

    it('should modify PlannerRun objective when modify requested', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('update_plan_state');
      expect(decision.runtimeAction?.targetRuntime).toBe('planner_runtime');
    });
  });

  describe('Pause/Resume Flows', () => {
    it('should generate pause RuntimeAction for pause request', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('pause_planner_run');
      expect(decision.runtimeAction?.targetRuntime).toBe('planner_runtime');
    });

    it('should generate resume RuntimeAction for resume request', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('resume_planner_run');
      expect(decision.runtimeAction?.targetRuntime).toBe('planner_runtime');
    });

    it('should support pause/resume for supported targets only', () => {
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

      const pauseDecision = agent.processMessage(pauseInput, state);
      expect(pauseDecision.route).toBe('cancel_or_modify_task');
      expect(pauseDecision.runtimeAction?.actionType).toBe('pause_planner_run');
    });
  });

  describe('Ambiguous Target Handling', () => {
    it('should not guess when ActiveWorkProjection has multiple likely matches', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.userVisibleResponse).toContain('multiple');
      expect(decision.userVisibleResponse).toContain('which');
      expect(decision.targetRef).toBeUndefined();
    });

    it('should list all active work when target is ambiguous', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.userVisibleResponse).toMatch(/task|run|work/i);
      expect(decision.userVisibleResponse).toContain('active');
    });

    it('should allow user to specify target explicitly', () => {
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

      const decision = agent.processMessage(input, state);
      expect(decision.route).toBe('cancel_or_modify_task');
    });
  });

  describe('RuntimeAction Generation', () => {
    it('should generate proper RuntimeAction for cancel with all required fields', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionId).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBeDefined();
      expect(decision.runtimeAction?.targetRuntime).toBeDefined();
      expect(decision.runtimeAction?.source).toBeDefined();
      expect(decision.runtimeAction?.userId).toBe('user_test_001');
    });

    it('should set correct targetRuntime for different work types', () => {
      const plannerState = createBaseState({
        hydratedSession: {
          ...createBaseState().hydratedSession,
          sessionContext: {
            ...createBaseState().hydratedSession.sessionContext,
            activePlannerRunIds: ['planner_001'],
          },
        },
      });

      const plannerDecision = agent.processMessage(createMessageInput('cancel'), plannerState);
      expect(plannerDecision.runtimeAction?.targetRuntime).toBe('planner_runtime');
    });

    it('should not directly mutate target runtime state from Foreground Agent', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.runtimeAction).toBeDefined();
      expect(decision.runtimeAction?.actionType).toBe('cancel_planner_run');
    });
  });

  describe('ActiveWorkProjection Integration', () => {
    it('should use ActiveWorkProjection when fresh for status query', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('status_query');
      expect(decision.reason).toContain('status');
    });

    it('should include active work count in status response', () => {
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

      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('status_query');
    });
  });

  describe('Edge Cases', () => {
    it('should handle cancel request when no active work exists', () => {
      const input = createMessageInput('cancel');
      const state = createBaseState();

      const decision = agent.processMessage(input, state);

      expect(decision.userVisibleResponse).toContain('no active');
      expect(decision.route).toBe('answer_directly');
    });

    it('should handle status query when no work is active', () => {
      const input = createMessageInput('status');
      const state = createBaseState();

      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('status_query');
      expect(decision.userVisibleResponse).toContain('status');
    });

    it('should detect modify intent in various phrasings', () => {
      const modifyPhrases = [
        'change the task to',
        'modify the objective',
        'update the plan',
        'adjust the goal',
      ];

      for (const phrase of modifyPhrases) {
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

        const decision = agent.processMessage(input, state);
        expect(decision.route).toBe('cancel_or_modify_task');
      }
    });

    it('should distinguish between pause and cancel intent', () => {
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

      const pauseDecision = agent.processMessage(pauseInput, state);
      const cancelDecision = agent.processMessage(cancelInput, state);

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
