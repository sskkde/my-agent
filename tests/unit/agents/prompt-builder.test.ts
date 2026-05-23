import { describe, it, expect } from 'vitest';
import {
  computeEffectiveAllowedToolIds,
  buildRoutingMessages,
} from '../../../src/agents/prompt-builder.js';
import type { AgentConfig } from '../../../src/storage/agent-config-store.js';
import type { ForegroundSessionState } from '../../../src/foreground/types.js';

const DEFAULT_TOOL_CATALOG = ['file.read', 'file.write', 'web.search', 'memory.retrieve'];

function createMockSessionState(): ForegroundSessionState {
  return {
    hydratedSession: {
      userContext: {
        userId: 'test-user',
        sessionId: 'test-session',
      },
      sessionContext: {
        messageCount: 1,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
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
    currentPersona: {
      personaId: 'default',
      name: 'Assistant',
      directDelegationPolicy: {
        estimatedStepsGte: 3,
        maxComplexity: 'medium',
        allowedToolCategories: ['read', 'search'],
      },
    },
    effectivePolicy: {
      estimatedStepsGte: 3,
      maxComplexity: 'medium',
      allowedToolCategories: ['read', 'search'],
    },
  };
}

describe('computeEffectiveAllowedToolIds', () => {
  it('returns all known tools when allowedToolIds is null (inherit semantics)', () => {
    const agentConfig: AgentConfig = {
      agentConfigId: 'test',
      agentId: 'foreground.default',
      scope: 'global',
      userId: null,
      displayName: 'Test',
      enabled: true,
      systemPrompt: null,
      routingPrompt: null,
      providerId: null,
      model: null,
      allowedToolIds: null, // null = inherit all
      allowedSkillIds: null,
      routingTimeoutMs: 60000,
      repairAttempts: 1,
      promptType: null,
      promptVersion: null,
      searchLlmProviderId: null,
      searchLlmModel: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = computeEffectiveAllowedToolIds(agentConfig, DEFAULT_TOOL_CATALOG);

    expect(result).toEqual(DEFAULT_TOOL_CATALOG);
  });

  it('returns all known tools when allowedToolIds is undefined (no config)', () => {
    const result = computeEffectiveAllowedToolIds(undefined, DEFAULT_TOOL_CATALOG);

    expect(result).toEqual(DEFAULT_TOOL_CATALOG);
  });

  it('returns empty array when allowedToolIds is empty (no tools allowed)', () => {
    const agentConfig: AgentConfig = {
      agentConfigId: 'test',
      agentId: 'foreground.default',
      scope: 'global',
      userId: null,
      displayName: 'Test',
      enabled: true,
      systemPrompt: null,
      routingPrompt: null,
      providerId: null,
      model: null,
      allowedToolIds: [], // empty = no tools
      allowedSkillIds: null,
      routingTimeoutMs: 60000,
      repairAttempts: 1,
      promptType: null,
      promptVersion: null,
      searchLlmProviderId: null,
      searchLlmModel: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = computeEffectiveAllowedToolIds(agentConfig, DEFAULT_TOOL_CATALOG);

    expect(result).toEqual([]);
  });

  it('returns intersection when allowedToolIds is explicit list', () => {
    const agentConfig: AgentConfig = {
      agentConfigId: 'test',
      agentId: 'foreground.default',
      scope: 'global',
      userId: null,
      displayName: 'Test',
      enabled: true,
      systemPrompt: null,
      routingPrompt: null,
      providerId: null,
      model: null,
      allowedToolIds: ['file.read', 'web.search', 'unknown.tool'], // explicit list
      allowedSkillIds: null,
      routingTimeoutMs: 60000,
      repairAttempts: 1,
      promptType: null,
      promptVersion: null,
      searchLlmProviderId: null,
      searchLlmModel: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = computeEffectiveAllowedToolIds(agentConfig, DEFAULT_TOOL_CATALOG);

    // Should only include tools that are in both the config and the known catalog
    expect(result).toEqual(['file.read', 'web.search']);
    expect(result).not.toContain('unknown.tool');
  });

  it('returns empty array when explicit list has no intersection with known tools', () => {
    const agentConfig: AgentConfig = {
      agentConfigId: 'test',
      agentId: 'foreground.default',
      scope: 'global',
      userId: null,
      displayName: 'Test',
      enabled: true,
      systemPrompt: null,
      routingPrompt: null,
      providerId: null,
      model: null,
      allowedToolIds: ['nonexistent.tool', 'another.unknown'],
      allowedSkillIds: null,
      routingTimeoutMs: 60000,
      repairAttempts: 1,
      promptType: null,
      promptVersion: null,
      searchLlmProviderId: null,
      searchLlmModel: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = computeEffectiveAllowedToolIds(agentConfig, DEFAULT_TOOL_CATALOG);

    expect(result).toEqual([]);
  });
});

describe('buildRoutingMessages', () => {
  it('builds 4-layer messages: system base + routing overlay + config overlay + user prompt', () => {
    const sessionState = createMockSessionState();
    const agentConfig: AgentConfig = {
      agentConfigId: 'test',
      agentId: 'foreground.default',
      scope: 'global',
      userId: null,
      displayName: 'Test',
      enabled: true,
      systemPrompt: 'Custom system prompt overlay',
      routingPrompt: 'Custom routing instructions',
      providerId: null,
      model: null,
      allowedToolIds: ['file.read', 'web.search'],
      allowedSkillIds: null,
      routingTimeoutMs: 60000,
      repairAttempts: 1,
      promptType: null,
      promptVersion: null,
      searchLlmProviderId: null,
      searchLlmModel: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const messages = buildRoutingMessages({
      message: 'Hello, how are you?',
      sessionState,
      agentConfig,
      toolCatalog: DEFAULT_TOOL_CATALOG,
    });

    // Should have 5 messages: base system + routing overlay + routing prompt + system prompt + user
    expect(messages.length).toBeGreaterThanOrEqual(4);

    // 1. First message should be system with base prompt
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('valid JSON');

    // 2. Second message should be system with routing overlay
    expect(messages[1].role).toBe('system');
    expect(messages[1].content).toContain('Routing priority order');

    // 3. Third message should be system with agent config routing prompt
    expect(messages[2].role).toBe('system');
    expect(messages[2].content).toBe('Custom routing instructions');

    // 4. Fourth message should be system with agent config system prompt
    expect(messages[3].role).toBe('system');
    expect(messages[3].content).toBe('Custom system prompt overlay');

    // 5. Last message should be user with dynamic prompt
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(lastMessage.content).toContain('Hello, how are you?');
    expect(lastMessage.content).toContain('AVAILABLE ROUTES');
  });

  it('builds messages without optional config overlays when not provided', () => {
    const sessionState = createMockSessionState();

    const messages = buildRoutingMessages({
      message: 'Hello',
      sessionState,
      agentConfig: undefined,
      toolCatalog: DEFAULT_TOOL_CATALOG,
    });

    // Should have 3 messages: base system + routing overlay + user
    expect(messages.length).toBe(3);

    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('system');
    expect(messages[2].role).toBe('user');
  });

  it('includes only allowed tool IDs in the dynamic prompt', () => {
    const sessionState = createMockSessionState();
    const agentConfig: AgentConfig = {
      agentConfigId: 'test',
      agentId: 'foreground.default',
      scope: 'global',
      userId: null,
      displayName: 'Test',
      enabled: true,
      systemPrompt: null,
      routingPrompt: null,
      providerId: null,
      model: null,
      allowedToolIds: ['file.read'], // Only one tool allowed
      allowedSkillIds: null,
      routingTimeoutMs: 60000,
      repairAttempts: 1,
      promptType: null,
      promptVersion: null,
      searchLlmProviderId: null,
      searchLlmModel: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const messages = buildRoutingMessages({
      message: 'Read a file',
      sessionState,
      agentConfig,
      toolCatalog: DEFAULT_TOOL_CATALOG,
    });

    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.content).toContain('file.read');
    expect(lastMessage.content).not.toContain('web.search');
    expect(lastMessage.content).not.toContain('memory.retrieve');
  });

  it('shows "none" for tool IDs when no tools are allowed', () => {
    const sessionState = createMockSessionState();
    const agentConfig: AgentConfig = {
      agentConfigId: 'test',
      agentId: 'foreground.default',
      scope: 'global',
      userId: null,
      displayName: 'Test',
      enabled: true,
      systemPrompt: null,
      routingPrompt: null,
      providerId: null,
      model: null,
      allowedToolIds: [], // No tools allowed
      allowedSkillIds: null,
      routingTimeoutMs: 60000,
      repairAttempts: 1,
      promptType: null,
      promptVersion: null,
      searchLlmProviderId: null,
      searchLlmModel: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const messages = buildRoutingMessages({
      message: 'Hello',
      sessionState,
      agentConfig,
      toolCatalog: DEFAULT_TOOL_CATALOG,
    });

    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.content).toContain('AVAILABLE TOOL IDS');
    expect(lastMessage.content).toContain('- none');
  });

  it('includes web.search guidance when web.search is available', () => {
    const sessionState = createMockSessionState();

    const messages = buildRoutingMessages({
      message: 'Search the web',
      sessionState,
      agentConfig: undefined,
      toolCatalog: ['web.search', 'file.read'],
    });

    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.content).toContain('Use web.search for live web search');
  });

  it('includes limitation message when web.search is not available', () => {
    const sessionState = createMockSessionState();
    const agentConfig: AgentConfig = {
      agentConfigId: 'test',
      agentId: 'foreground.default',
      scope: 'global',
      userId: null,
      displayName: 'Test',
      enabled: true,
      systemPrompt: null,
      routingPrompt: null,
      providerId: null,
      model: null,
      allowedToolIds: ['file.read'], // web.search not included
      allowedSkillIds: null,
      routingTimeoutMs: 60000,
      repairAttempts: 1,
      promptType: null,
      promptVersion: null,
      searchLlmProviderId: null,
      searchLlmModel: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const messages = buildRoutingMessages({
      message: 'Hello',
      sessionState,
      agentConfig,
      toolCatalog: DEFAULT_TOOL_CATALOG,
    });

    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.content).toContain('None of the available tools provide live web search');
  });
});
