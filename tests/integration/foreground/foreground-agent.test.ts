import { describe, it, expect, beforeEach } from 'vitest';
import { createForegroundAgent, mergeDelegationPolicies } from '../../../src/foreground/foreground-agent.js';
import { DEFAULT_ASSISTANT_PERSONA, DEFAULT_DIRECT_DELEGATION_POLICY } from '../../../src/foreground/types.js';
import type { ForegroundMessageInput, ForegroundSessionState } from '../../../src/foreground/types.js';

describe('Foreground Conversation Agent', () => {
  let agent: ReturnType<typeof createForegroundAgent>;
  let baseState: ForegroundSessionState;

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

  beforeEach(() => {
    agent = createForegroundAgent();
    baseState = createBaseState();
  });

  describe('answer_directly route', () => {
    it('should route simple QA to answer_directly', () => {
      const input = createInput('解释一下 PlannerRun 是什么？');
      const decision = agent.processMessage(input, baseState);

      expect(decision.route).toBe('answer_directly');
      expect(decision.requiresPlanner).toBe(false);
      expect(decision.userVisibleResponse).toBeDefined();
    });

    it('should route short question to answer_directly', () => {
      const input = createInput('你好');
      const decision = agent.processMessage(input, baseState);

      expect(decision.route).toBe('answer_directly');
    });

    it('should route question with question particle to answer_directly', () => {
      const input = createInput('今天天气好吗');
      const decision = agent.processMessage(input, baseState);

      expect(decision.route).toBe('answer_directly');
    });
  });

  describe('spawn_planner route', () => {
    it('should route complex trip task to spawn_planner', () => {
      const input = createInput('帮我规划下周去上海出差，包括日程、酒店、会议资料');
      const decision = agent.processMessage(input, baseState);

      expect(decision.route).toBe('spawn_planner');
      expect(decision.requiresPlanner).toBe(true);
    });

    it('should route multi-step task to spawn_planner', () => {
      const input = createInput('请帮我搜索资料、写报告和发送邮件');
      const decision = agent.processMessage(input, baseState);

      expect(decision.route).toBe('spawn_planner');
    });

    it('should respect estimatedStepsGte policy', () => {
      const state = {
        ...baseState,
        effectivePolicy: mergeDelegationPolicies(DEFAULT_DIRECT_DELEGATION_POLICY, { estimatedStepsGte: 2 }),
      };
      const input = createInput('帮我搜索资料然后写报告');
      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('spawn_planner');
    });
  });

  describe('dispatch_tool route', () => {
    it('should route simple read task to dispatch_tool', () => {
      const input = createInput('搜索一下最近的会议记录');
      const decision = agent.processMessage(input, baseState);

      expect(decision.route).toBe('dispatch_tool');
    });
  });

  describe('approval_handler route', () => {
    it('should route approval response to approval_handler', () => {
      const input = createInput('同意', {
        isApprovalResponse: true,
        approvalResponse: {
          requestId: 'appr_001',
          approved: true,
        },
      });
      const decision = agent.processMessage(input, baseState);

      expect(decision.route).toBe('approval_handler');
    });
  });

  describe('cancel_or_modify_task route', () => {
    it('should route cancel request with active work to cancel_or_modify_task', () => {
      const state = createBaseState({ activePlannerRunIds: ['pl_run_001'] });
      const input = createInput('取消刚才的任务');
      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
      expect(decision.targetRef?.plannerRunId).toBe('pl_run_001');
    });

    it('should route stop request with active background work', () => {
      const state = createBaseState({ activeBackgroundRunIds: ['bg_run_001'] });
      const input = createInput('停止后台任务');
      const decision = agent.processMessage(input, state);

      expect(decision.route).toBe('cancel_or_modify_task');
    });
  });

  describe('status_query route', () => {
    it('should route status query to status_query', () => {
      const input = createInput('任务进度怎么样了');
      const decision = agent.processMessage(input, baseState);

      expect(decision.route).toBe('status_query');
    });

    it('should route progress question to status_query', () => {
      const input = createInput('现在是什么状态');
      const decision = agent.processMessage(input, baseState);

      expect(decision.route).toBe('status_query');
    });
  });

  describe('resume_existing_planner route', () => {
    it('should resume existing planner when message is ambiguous', () => {
      const state = createBaseState({ activePlannerRunIds: ['pl_run_001'] });
      const input = createInput('继续');
      const decision = agent.processMessage(input, state);

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

  describe('userVisibleResponse', () => {
    it('should generate response for answer_directly', () => {
      const input = createInput('你好');
      const decision = agent.processMessage(input, baseState);

      expect(decision.userVisibleResponse).toContain('你好');
    });

    it('should generate response for spawn_planner', () => {
      const input = createInput('帮我规划下周去上海出差，包括日程、酒店、会议资料');
      const decision = agent.processMessage(input, baseState);

      expect(decision.userVisibleResponse).toContain('multi-step');
    });
  });
});
