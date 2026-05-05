import { describe, it, expect } from 'vitest';
import {
  PROMPT_REGISTRY,
  resolvePrompt,
  getPromptForAgent,
  DEFAULT_PROMPT_TYPE_BY_AGENT_ID,
  DEFAULT_PROMPT_VERSION_BY_TYPE,
} from '../../../src/agents/prompt-registry.js';

describe('prompt-registry', () => {
  describe('PROMPT_REGISTRY', () => {
    it('contains foreground.router:2026-05-05', () => {
      const record = PROMPT_REGISTRY.get('foreground.router:2026-05-05');
      expect(record).toBeDefined();
      expect(record?.id).toBe('foreground.router');
      expect(record?.version).toBe('2026-05-05');
      expect(record?.runtimeEnabled).toBe(true);
    });

    it('contains planner.executor:2026-05-05 with runtimeEnabled false', () => {
      const record = PROMPT_REGISTRY.get('planner.executor:2026-05-05');
      expect(record).toBeDefined();
      expect(record?.id).toBe('planner.executor');
      expect(record?.runtimeEnabled).toBe(false);
    });

    it('contains subagent.executor:2026-05-05 with runtimeEnabled false', () => {
      const record = PROMPT_REGISTRY.get('subagent.executor:2026-05-05');
      expect(record).toBeDefined();
      expect(record?.id).toBe('subagent.executor');
      expect(record?.runtimeEnabled).toBe(false);
    });
  });

  describe('resolvePrompt', () => {
    it('resolves known foreground.router version correctly', () => {
      const result = resolvePrompt('foreground.router', '2026-05-05');
      expect(result.record.id).toBe('foreground.router');
      expect(result.record.version).toBe('2026-05-05');
      expect(result.fallbackReason).toBeUndefined();
    });

    it('falls back to default for unknown foreground.router version', () => {
      const result = resolvePrompt('foreground.router', 'unknown-version');
      expect(result.record.id).toBe('foreground.router');
      expect(result.record.version).toBe('2026-05-05');
      expect(result.fallbackReason).toBe('UNKNOWN_PROMPT_VERSION');
    });

    it('falls back to default when version is omitted', () => {
      const result = resolvePrompt('foreground.router');
      expect(result.record.id).toBe('foreground.router');
      expect(result.record.version).toBe('2026-05-05');
      expect(result.fallbackReason).toBeUndefined();
    });

    it('falls back to default when version is null', () => {
      const result = resolvePrompt('foreground.router', null);
      expect(result.record.id).toBe('foreground.router');
      expect(result.record.version).toBe('2026-05-05');
      expect(result.fallbackReason).toBeUndefined();
    });

    it('falls back to foreground.router for unknown prompt type', () => {
      const result = resolvePrompt('unknown.type', '2026-05-05');
      expect(result.record.id).toBe('foreground.router');
      expect(result.fallbackReason).toBe('UNKNOWN_PROMPT_TYPE');
    });
  });

  describe('getPromptForAgent', () => {
    it('returns foreground.router for foreground.default agent', () => {
      const result = getPromptForAgent('foreground.default');
      expect(result.record.id).toBe('foreground.router');
      expect(result.record.version).toBe('2026-05-05');
      expect(result.fallbackReason).toBeUndefined();
    });

    it('falls back to foreground.router for unknown agent ID', () => {
      const result = getPromptForAgent('unknown.agent');
      expect(result.record.id).toBe('foreground.router');
      expect(result.fallbackReason).toBe('UNKNOWN_PROMPT_TYPE');
    });
  });

  describe('foreground.router prompt content', () => {
    it('base system prompt contains "valid JSON only"', () => {
      const record = PROMPT_REGISTRY.get('foreground.router:2026-05-05');
      expect(record?.baseSystemPrompt).toContain('valid JSON only');
    });

    it('routing overlay contains "Routing priority order"', () => {
      const record = PROMPT_REGISTRY.get('foreground.router:2026-05-05');
      expect(record?.routingOverlayPrompt).toContain('Routing priority order');
    });

    it('base system prompt contains all required rules', () => {
      const record = PROMPT_REGISTRY.get('foreground.router:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('route schema');
      expect(prompt).toContain('available tool section');
      expect(prompt).toContain('answer_directly');
      expect(prompt).toContain('runtimeAction');
    });

    it('routing overlay contains all priority items', () => {
      const record = PROMPT_REGISTRY.get('foreground.router:2026-05-05');
      const overlay = record?.routingOverlayPrompt ?? '';

      expect(overlay).toContain('approval_handler');
      expect(overlay).toContain('status_query');
      expect(overlay).toContain('cancel_or_modify_task');
      expect(overlay).toContain('resume_existing_planner');
      expect(overlay).toContain('spawn_planner');
      expect(overlay).toContain('dispatch_subagent');
      expect(overlay).toContain('dispatch_tool');
      expect(overlay).toContain('answer_directly');
    });
  });

  describe('planner.executor prompt content', () => {
    it('has runtimeEnabled false', () => {
      const record = PROMPT_REGISTRY.get('planner.executor:2026-05-05');
      expect(record?.runtimeEnabled).toBe(false);
    });

    it('contains identity section', () => {
      const record = PROMPT_REGISTRY.get('planner.executor:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('IDENTITY');
      expect(prompt).toContain('planning specialist');
    });

    it('contains responsibilities section', () => {
      const record = PROMPT_REGISTRY.get('planner.executor:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('RESPONSIBILITIES');
      expect(prompt).toContain('Analyze the objective');
      expect(prompt).toContain('Break work into atomic');
      expect(prompt).toContain('Identify dependencies');
    });

    it('contains forbidden actions section', () => {
      const record = PROMPT_REGISTRY.get('planner.executor:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('FORBIDDEN ACTIONS');
      expect(prompt).toContain('Do not execute write tools');
      expect(prompt).toContain('Do not interact with the user directly');
    });

    it('contains tool policy section', () => {
      const record = PROMPT_REGISTRY.get('planner.executor:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('TOOL POLICY');
      expect(prompt).toContain('Read-only tools');
      expect(prompt).toContain('Write tools require explicit runtime grant');
    });

    it('contains output contract section with plan schema', () => {
      const record = PROMPT_REGISTRY.get('planner.executor:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('OUTPUT CONTRACT');
      expect(prompt).toContain('planId');
      expect(prompt).toContain('objective');
      expect(prompt).toContain('steps');
      expect(prompt).toContain('dependencies');
      expect(prompt).toContain('successCriteria');
    });

    it('contains runtime requirements section', () => {
      const record = PROMPT_REGISTRY.get('planner.executor:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('RUNTIME REQUIREMENTS');
      expect(prompt).toContain('planner runtime');
      expect(prompt).toContain('Checkpoint support');
      expect(prompt).toContain('Cancellation handling');
    });

    it('description indicates spec-only status', () => {
      const record = PROMPT_REGISTRY.get('planner.executor:2026-05-05');
      expect(record?.description).toContain('Spec-only');
      expect(record?.description).toContain('not available in V1');
    });
  });

  describe('subagent.executor prompt content', () => {
    it('has runtimeEnabled false', () => {
      const record = PROMPT_REGISTRY.get('subagent.executor:2026-05-05');
      expect(record?.runtimeEnabled).toBe(false);
    });

    it('contains identity section', () => {
      const record = PROMPT_REGISTRY.get('subagent.executor:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('IDENTITY');
      expect(prompt).toContain('execution specialist');
    });

    it('contains responsibilities section', () => {
      const record = PROMPT_REGISTRY.get('subagent.executor:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('RESPONSIBILITIES');
      expect(prompt).toContain('Execute the assigned task');
      expect(prompt).toContain('Report progress');
      expect(prompt).toContain('Collect and report evidence');
    });

    it('contains forbidden actions section', () => {
      const record = PROMPT_REGISTRY.get('subagent.executor:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('FORBIDDEN ACTIONS');
      expect(prompt).toContain('Do not interact with the user directly');
      expect(prompt).toContain('Do not use tools outside your granted scope');
      expect(prompt).toContain('Do not exceed resource limits');
    });

    it('contains tool policy section', () => {
      const record = PROMPT_REGISTRY.get('subagent.executor:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('TOOL POLICY');
      expect(prompt).toContain('Execute only tools explicitly listed');
      expect(prompt).toContain('Respect rate limits');
    });

    it('contains output contract section with result schema', () => {
      const record = PROMPT_REGISTRY.get('subagent.executor:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('OUTPUT CONTRACT');
      expect(prompt).toContain('taskId');
      expect(prompt).toContain('status');
      expect(prompt).toContain('progress');
      expect(prompt).toContain('evidence');
      expect(prompt).toContain('metrics');
    });

    it('contains runtime requirements section', () => {
      const record = PROMPT_REGISTRY.get('subagent.executor:2026-05-05');
      const prompt = record?.baseSystemPrompt ?? '';

      expect(prompt).toContain('RUNTIME REQUIREMENTS');
      expect(prompt).toContain('subagent runtime');
      expect(prompt).toContain('Checkpoint support');
      expect(prompt).toContain('Cancellation handling');
      expect(prompt).toContain('Resource monitoring');
    });

    it('description indicates spec-only status', () => {
      const record = PROMPT_REGISTRY.get('subagent.executor:2026-05-05');
      expect(record?.description).toContain('Spec-only');
      expect(record?.description).toContain('not available in V1');
    });
  });

  describe('constants', () => {
    it('DEFAULT_PROMPT_TYPE_BY_AGENT_ID maps foreground.default to foreground.router', () => {
      expect(DEFAULT_PROMPT_TYPE_BY_AGENT_ID['foreground.default']).toBe(
        'foreground.router'
      );
    });

    it('DEFAULT_PROMPT_VERSION_BY_TYPE maps foreground.router to 2026-05-05', () => {
      expect(DEFAULT_PROMPT_VERSION_BY_TYPE['foreground.router']).toBe(
        '2026-05-05'
      );
    });
  });
});
