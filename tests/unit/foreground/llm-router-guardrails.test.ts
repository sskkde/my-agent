import { describe, it, expect } from 'vitest';
import type { ForegroundDecision } from '../../../src/foreground/types.js';
import type { AgentConfig } from '../../../src/storage/agent-config-store.js';
import type { RuntimeAction } from '../../../src/dispatcher/types.js';

/**
 * Known tool IDs from the catalog - must match src/processing/processor-orchestration.ts
 */
const KNOWN_TOOL_IDS: string[] = [
  'artifact.create',
  'artifact.update',
  'ask_user',
  'status.query',
  'memory.retrieve',
  'transcript.search',
  'plan.patch',
  'docs.search',
];

/**
 * Known skill IDs from the catalog - must match src/processing/processor-orchestration.ts
 */
const KNOWN_SKILL_IDS: string[] = [
  'artifact.create',
  'artifact.update',
  'ask_user',
  'status.query',
  'memory.retrieve',
  'transcript.search',
  'plan.patch',
  'docs.search',
];

describe('LLM Router Guardrails', () => {
  const createMockAgentConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
    agentConfigId: 'test-config-id',
    agentId: 'foreground.default',
    scope: 'user',
    userId: 'user-123',
    displayName: 'Test Agent',
    enabled: true,
    systemPrompt: 'You are a helpful assistant',
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
    ...overrides,
  });

  const createMockRuntimeAction = (overrides: Partial<RuntimeAction> = {}): RuntimeAction => ({
    actionId: 'action-123',
    actionType: 'execute_tool',
    targetRuntime: 'tool_runtime',
    source: { sourceModule: 'test', sourceAction: 'test' },
    userId: 'user-123',
    sessionId: 'session-123',
    targetRef: {},
    targetAction: 'execute',
    payload: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'created',
    ...overrides,
  });

  describe('Tool Filtering', () => {
    it('should filter out hallucinated tools not in known catalog', () => {
      const suggestedTools = ['hallucinated.tool.that.does.not.exist', 'docs.search', 'another.fake'];
      const filtered = suggestedTools.filter(toolId => KNOWN_TOOL_IDS.includes(toolId));

      expect(filtered).toEqual(['docs.search']);
      expect(filtered).not.toContain('hallucinated.tool.that.does.not.exist');
      expect(filtered).not.toContain('another.fake');
    });

    it('should filter tools against AgentConfig allowlist', () => {
      const agentConfig = createMockAgentConfig({
        allowedToolIds: ['docs.search', 'memory.retrieve'],
      });

      const suggestedTools = ['docs.search', 'plan.patch', 'memory.retrieve', 'unknown.tool'];

      const allowedToolIds = agentConfig.allowedToolIds && agentConfig.allowedToolIds.length > 0
        ? agentConfig.allowedToolIds
        : KNOWN_TOOL_IDS;

      const filtered = suggestedTools.filter(
        toolId => allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId)
      );

      expect(filtered).toEqual(['docs.search', 'memory.retrieve']);
      expect(filtered).not.toContain('plan.patch');
      expect(filtered).not.toContain('unknown.tool');
    });

    it('should return empty array when all tools are disallowed', () => {
      const agentConfig = createMockAgentConfig({
        allowedToolIds: ['docs.search'],
      });

      const suggestedTools = ['plan.patch', 'artifact.create'];

      const allowedToolIds = agentConfig.allowedToolIds && agentConfig.allowedToolIds.length > 0
        ? agentConfig.allowedToolIds
        : KNOWN_TOOL_IDS;

      const filtered = suggestedTools.filter(
        toolId => allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId)
      );

      expect(filtered).toEqual([]);
    });

    it('should allow all known tools when AgentConfig has no restrictions', () => {
      const agentConfig = createMockAgentConfig({
        allowedToolIds: [],
      });

      const suggestedTools = ['docs.search', 'memory.retrieve', 'transcript.search'];

      const allowedToolIds = agentConfig.allowedToolIds && agentConfig.allowedToolIds.length > 0
        ? agentConfig.allowedToolIds
        : KNOWN_TOOL_IDS;

      const filtered = suggestedTools.filter(
        toolId => allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId)
      );

      expect(filtered).toEqual(['docs.search', 'memory.retrieve', 'transcript.search']);
    });

    it('should handle undefined suggestedTools', () => {
      const suggestedTools: string[] | undefined = undefined;
      const arr = suggestedTools as string[] | undefined;
      const filtered = arr ? arr.filter((toolId: string) => KNOWN_TOOL_IDS.includes(toolId)) : undefined;

      expect(filtered).toBeUndefined();
    });

    it('should handle empty suggestedTools', () => {
      const suggestedTools: string[] = [];
      const filtered = suggestedTools.filter(toolId => KNOWN_TOOL_IDS.includes(toolId));

      expect(filtered).toEqual([]);
    });
  });

  describe('Skill Filtering', () => {
    it('should filter out hallucinated skills not in known catalog', () => {
      const suggestedSkills = ['hallucinated.skill', 'docs.search', 'fake.skill'];
      const filtered = suggestedSkills.filter(skillId => KNOWN_SKILL_IDS.includes(skillId));

      expect(filtered).toEqual(['docs.search']);
      expect(filtered).not.toContain('hallucinated.skill');
      expect(filtered).not.toContain('fake.skill');
    });

    it('should filter skills against AgentConfig allowlist', () => {
      const agentConfig = createMockAgentConfig({
        allowedSkillIds: ['docs.search', 'memory.retrieve'],
      });

      const suggestedSkills = ['docs.search', 'plan.patch', 'memory.retrieve'];

      const allowedSkillIds = agentConfig.allowedSkillIds && agentConfig.allowedSkillIds.length > 0
        ? agentConfig.allowedSkillIds
        : KNOWN_SKILL_IDS;

      const filtered = suggestedSkills.filter(
        skillId => allowedSkillIds.includes(skillId) && KNOWN_SKILL_IDS.includes(skillId)
      );

      expect(filtered).toEqual(['docs.search', 'memory.retrieve']);
      expect(filtered).not.toContain('plan.patch');
    });
  });

  describe('RuntimeAction Guardrails', () => {
    it('should reject route when cancel_or_modify_task lacks runtimeAction', () => {
      const decision: ForegroundDecision = {
        route: 'cancel_or_modify_task',
        reason: 'User wants to cancel',
        requiresPlanner: false,
      };

      const validateRouteGuardrails = (decision: ForegroundDecision): string | null => {
        if (decision.route === 'cancel_or_modify_task' || decision.route === 'status_query') {
          if (!decision.runtimeAction) {
            return `Route '${decision.route}' requires a server-created runtimeAction`;
          }
        }
        return null;
      };

      const error = validateRouteGuardrails(decision);

      expect(error).toBe("Route 'cancel_or_modify_task' requires a server-created runtimeAction");
    });

    it('should reject route when status_query lacks runtimeAction', () => {
      const decision: ForegroundDecision = {
        route: 'status_query',
        reason: 'User wants status',
        requiresPlanner: false,
      };

      const validateRouteGuardrails = (decision: ForegroundDecision): string | null => {
        if (decision.route === 'cancel_or_modify_task' || decision.route === 'status_query') {
          if (!decision.runtimeAction) {
            return `Route '${decision.route}' requires a server-created runtimeAction`;
          }
        }
        return null;
      };

      const error = validateRouteGuardrails(decision);

      expect(error).toBe("Route 'status_query' requires a server-created runtimeAction");
    });

    it('should allow cancel_or_modify_task with server-created runtimeAction', () => {
      const decision: ForegroundDecision = {
        route: 'cancel_or_modify_task',
        reason: 'User wants to cancel',
        requiresPlanner: false,
        runtimeAction: createMockRuntimeAction({
          actionType: 'cancel_planner_run',
          source: { sourceModule: 'foreground_conversation_agent', sourceAction: 'cancel' },
        }),
      };

      const validateRouteGuardrails = (decision: ForegroundDecision): string | null => {
        if (decision.route === 'cancel_or_modify_task' || decision.route === 'status_query') {
          if (!decision.runtimeAction) {
            return `Route '${decision.route}' requires a server-created runtimeAction`;
          }
        }
        return null;
      };

      const error = validateRouteGuardrails(decision);

      expect(error).toBeNull();
    });

    it('should allow status_query with server-created runtimeAction', () => {
      const decision: ForegroundDecision = {
        route: 'status_query',
        reason: 'User wants status',
        requiresPlanner: false,
        runtimeAction: createMockRuntimeAction({
          actionType: 'query_active_work',
          source: { sourceModule: 'foreground_conversation_agent', sourceAction: 'status_query' },
        }),
      };

      const validateRouteGuardrails = (decision: ForegroundDecision): string | null => {
        if (decision.route === 'cancel_or_modify_task' || decision.route === 'status_query') {
          if (!decision.runtimeAction) {
            return `Route '${decision.route}' requires a server-created runtimeAction`;
          }
        }
        return null;
      };

      const error = validateRouteGuardrails(decision);

      expect(error).toBeNull();
    });

    it('should ignore LLM-provided runtimeAction for cancel route', () => {
      const serverCreatedAction = createMockRuntimeAction({
        actionId: 'server-created-action',
        actionType: 'cancel_planner_run',
        source: { sourceModule: 'foreground_conversation_agent', sourceAction: 'cancel' },
        targetRef: { runId: 'planner-run-123' },
        payload: { workId: 'planner-run-123', workType: 'planner_run' },
      });

      const decision: ForegroundDecision = {
        route: 'cancel_or_modify_task',
        reason: 'User wants to cancel',
        requiresPlanner: false,
        // Server replaces LLM-provided action with its own
        runtimeAction: serverCreatedAction,
      };

      expect(decision.runtimeAction?.source.sourceModule).toBe('foreground_conversation_agent');
      expect(decision.runtimeAction?.actionType).toBe('cancel_planner_run');
      expect(decision.runtimeAction?.actionId).not.toBe('llm-hallucinated-action');
    });
  });

  describe('Known Catalog Validation', () => {
    it('should only accept tools from known catalog', () => {
      const suggestedTools = [
        'artifact.create',
        'artifact.update',
        'malicious_tool',
        'another.unknown',
        'docs.search',
      ];

      const filtered = suggestedTools.filter(toolId => KNOWN_TOOL_IDS.includes(toolId));

      expect(filtered).toEqual(['artifact.create', 'artifact.update', 'docs.search']);
      expect(filtered).not.toContain('malicious_tool');
      expect(filtered).not.toContain('another.unknown');
    });

    it('should only accept skills from known catalog', () => {
      const suggestedSkills = [
        'artifact.create',
        'malicious_skill',
        'memory.retrieve',
      ];

      const filtered = suggestedSkills.filter(skillId => KNOWN_SKILL_IDS.includes(skillId));

      expect(filtered).toEqual(['artifact.create', 'memory.retrieve']);
      expect(filtered).not.toContain('malicious_skill');
    });

    it('should handle all known tools correctly', () => {
      const allKnownTools = [...KNOWN_TOOL_IDS];
      const filtered = allKnownTools.filter(toolId => KNOWN_TOOL_IDS.includes(toolId));

      expect(filtered).toEqual(KNOWN_TOOL_IDS);
    });

    it('should handle all known skills correctly', () => {
      const allKnownSkills = [...KNOWN_SKILL_IDS];
      const filtered = allKnownSkills.filter(skillId => KNOWN_SKILL_IDS.includes(skillId));

      expect(filtered).toEqual(KNOWN_SKILL_IDS);
    });
  });

  describe('Intersection Logic', () => {
    it('should perform three-way intersection: suggested ∩ allowed ∩ known', () => {
      const agentConfig = createMockAgentConfig({
        allowedToolIds: ['docs.search', 'memory.retrieve', 'transcript.search'],
      });

      const suggestedTools = [
        'docs.search',
        'memory.retrieve',
        'plan.patch',
        'hallucinated.tool',
        'artifact.create',
      ];

      const allowedToolIds = agentConfig.allowedToolIds ?? [];

      const filtered = suggestedTools.filter(
        toolId => allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId)
      );

      expect(filtered).toEqual(['docs.search', 'memory.retrieve']);
      expect(filtered).not.toContain('plan.patch');
      expect(filtered).not.toContain('hallucinated.tool');
      expect(filtered).not.toContain('artifact.create');
    });

    it('should return empty when suggested and allowed have no intersection', () => {
      const agentConfig = createMockAgentConfig({
        allowedToolIds: ['docs.search'],
      });

      const suggestedTools = ['plan.patch', 'artifact.create'];

      const filtered = suggestedTools.filter(
        toolId => (agentConfig.allowedToolIds ?? []).includes(toolId) && KNOWN_TOOL_IDS.includes(toolId)
      );

      expect(filtered).toEqual([]);
    });

    it('should return empty when suggested and known have no intersection', () => {
      const suggestedTools = ['completely.unknown.tool', 'another.fake'];

      const filtered = suggestedTools.filter(toolId => KNOWN_TOOL_IDS.includes(toolId));

      expect(filtered).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null AgentConfig gracefully', () => {
      const agentConfig: AgentConfig | null = null;
      const suggestedTools = ['docs.search', 'plan.patch'];

      const cfg = agentConfig as AgentConfig | null;
      const allowedToolIds: string[] = cfg && cfg.allowedToolIds && cfg.allowedToolIds.length > 0
        ? cfg.allowedToolIds
        : KNOWN_TOOL_IDS;

      const filtered = suggestedTools.filter(
        toolId => allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId)
      );

      expect(filtered).toEqual(['docs.search', 'plan.patch']);
    });

    it('should handle AgentConfig with empty allowedToolIds', () => {
      const agentConfig = createMockAgentConfig({
        allowedToolIds: [],
      });

      const suggestedTools = ['docs.search', 'plan.patch'];

      const allowedToolIds = agentConfig.allowedToolIds && agentConfig.allowedToolIds.length > 0
        ? agentConfig.allowedToolIds
        : KNOWN_TOOL_IDS;

      const filtered = suggestedTools.filter(
        toolId => allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId)
      );

      expect(filtered).toEqual(['docs.search', 'plan.patch']);
    });

    it('should handle duplicate tool suggestions', () => {
      const suggestedTools = ['docs.search', 'docs.search', 'memory.retrieve', 'docs.search'];

      const filtered = suggestedTools.filter(toolId => KNOWN_TOOL_IDS.includes(toolId));

      expect(filtered).toEqual(['docs.search', 'docs.search', 'memory.retrieve', 'docs.search']);
    });

    it('should handle case-sensitive tool IDs', () => {
      const suggestedTools = ['Docs.Search', 'DOCS.SEARCH', 'docs.search'];

      const filtered = suggestedTools.filter(toolId => KNOWN_TOOL_IDS.includes(toolId));

      expect(filtered).toEqual(['docs.search']);
    });
  });
});
