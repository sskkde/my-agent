import { describe, it, expect } from 'vitest';
import {
  resolveSubagentProvider,
  validateProviderCapabilities,
  type SubagentProviderPreferenceStore,
  type SubagentProviderPreference,
} from '../../../src/subagents/provider-policy.js';
import type { SubagentDefinition } from '../../../src/subagents/registry.js';
import type { SubagentTaskSpec } from '../../../src/subagents/types.js';

function createDefinition(overrides?: Partial<SubagentDefinition>): SubagentDefinition {
  return {
    agentType: 'test_agent',
    displayName: 'Test Agent',
    description: 'A test subagent',
    modality: 'text',
    promptId: 'test-prompt',
    allowedToolIds: [],
    defaultMaxIterations: 10,
    defaultTimeoutMs: 60000,
    supportedExecutionModes: ['sync'],
    canRunInBackground: false,
    providerPolicy: {
      fallbackMode: 'any_compatible',
    },
    permissionProfile: 'read_only',
    summaryPolicy: {
      returnMode: 'summary_only',
      maxSummaryTokens: 500,
    },
    ...overrides,
  };
}

function createTaskSpec(overrides?: Partial<SubagentTaskSpec>): SubagentTaskSpec {
  return {
    objective: 'Test task',
    ...overrides,
  };
}

function createMockProviderConfigStore(
  providers: Array<{ providerId: string; enabled: boolean; selectedModel?: string }>,
) {
  return {
    getByUser: (_userId: string) => providers,
  };
}

function createMockAgentConfigStore(
  globalConfig: { providerId?: string; model?: string } | null,
) {
  return {
    getGlobal: () => globalConfig,
  };
}

function createMockPreferenceStore(
  entries: Map<string, SubagentProviderPreference>,
): SubagentProviderPreferenceStore {
  return {
    get(userId: string, agentType: string): SubagentProviderPreference | null {
      return entries.get(`${userId}:${agentType}`) ?? null;
    },
    set(_userId: string, _agentType: string, _preference: SubagentProviderPreference): void {},
  };
}

describe('resolveSubagentProvider', () => {
  describe('user subagent preference', () => {
    it('should use full preference (providerId + model) when both are set', () => {
      const prefs = new Map<string, SubagentProviderPreference>();
      prefs.set('user1:test_agent', {
        providerId: 'openrouter',
        model: 'anthropic/claude-3-opus',
      });

      const result = resolveSubagentProvider({
        userId: 'user1',
        agentType: 'test_agent',
        taskSpec: createTaskSpec(),
        definition: createDefinition(),
        providerConfigStore: createMockProviderConfigStore([
          { providerId: 'openrouter', enabled: true, selectedModel: 'gpt-4' },
        ]),
        agentConfigStore: createMockAgentConfigStore(null),
        preferenceStore: createMockPreferenceStore(prefs),
      });

      expect(result.providerId).toBe('openrouter');
      expect(result.model).toBe('anthropic/claude-3-opus');
      expect(result.source).toBe('user_subagent_preference');
    });

    it('should resolve providerId-only preference using provider selectedModel', () => {
      const prefs = new Map<string, SubagentProviderPreference>();
      prefs.set('user1:test_agent', {
        providerId: 'openrouter',
      });

      const result = resolveSubagentProvider({
        userId: 'user1',
        agentType: 'test_agent',
        taskSpec: createTaskSpec(),
        definition: createDefinition(),
        providerConfigStore: createMockProviderConfigStore([
          { providerId: 'openrouter', enabled: true, selectedModel: 'gpt-4' },
        ]),
        agentConfigStore: createMockAgentConfigStore(null),
        preferenceStore: createMockPreferenceStore(prefs),
      });

      expect(result.providerId).toBe('openrouter');
      expect(result.model).toBe('gpt-4');
      expect(result.source).toBe('user_subagent_preference');
    });

    it('should resolve model-only preference using matching user provider', () => {
      const prefs = new Map<string, SubagentProviderPreference>();
      prefs.set('user1:test_agent', {
        model: 'llama3',
      });

      const result = resolveSubagentProvider({
        userId: 'user1',
        agentType: 'test_agent',
        taskSpec: createTaskSpec(),
        definition: createDefinition(),
        providerConfigStore: createMockProviderConfigStore([
          { providerId: 'openrouter', enabled: true, selectedModel: 'gpt-4' },
          { providerId: 'ollama', enabled: true, selectedModel: 'llama3' },
        ]),
        agentConfigStore: createMockAgentConfigStore(null),
        preferenceStore: createMockPreferenceStore(prefs),
      });

      expect(result.providerId).toBe('ollama');
      expect(result.model).toBe('llama3');
      expect(result.source).toBe('user_subagent_preference');
    });

    it('should skip providerId-only preference when provider has no selectedModel', () => {
      const prefs = new Map<string, SubagentProviderPreference>();
      prefs.set('user1:test_agent', {
        providerId: 'openrouter',
      });

      const result = resolveSubagentProvider({
        userId: 'user1',
        agentType: 'test_agent',
        taskSpec: createTaskSpec(),
        definition: createDefinition(),
        providerConfigStore: createMockProviderConfigStore([
          { providerId: 'openrouter', enabled: true },
        ]),
        agentConfigStore: createMockAgentConfigStore({
          providerId: 'fallback-provider',
          model: 'fallback-model',
        }),
        preferenceStore: createMockPreferenceStore(prefs),
      });

      expect(result.source).not.toBe('user_subagent_preference');
      expect(result.source).toBe('global_default');
    });

    it('should skip model-only preference when no enabled provider offers that model', () => {
      const prefs = new Map<string, SubagentProviderPreference>();
      prefs.set('user1:test_agent', {
        model: 'nonexistent-model',
      });

      const result = resolveSubagentProvider({
        userId: 'user1',
        agentType: 'test_agent',
        taskSpec: createTaskSpec(),
        definition: createDefinition(),
        providerConfigStore: createMockProviderConfigStore([
          { providerId: 'openrouter', enabled: true, selectedModel: 'gpt-4' },
        ]),
        agentConfigStore: createMockAgentConfigStore({
          providerId: 'openrouter',
          model: 'gpt-4',
        }),
        preferenceStore: createMockPreferenceStore(prefs),
      });

      expect(result.source).not.toBe('user_subagent_preference');
      expect(result.source).toBe('global_default');
    });

    it('should skip disabled provider for providerId-only preference', () => {
      const prefs = new Map<string, SubagentProviderPreference>();
      prefs.set('user1:test_agent', {
        providerId: 'disabled-provider',
      });

      const result = resolveSubagentProvider({
        userId: 'user1',
        agentType: 'test_agent',
        taskSpec: createTaskSpec(),
        definition: createDefinition(),
        providerConfigStore: createMockProviderConfigStore([
          { providerId: 'disabled-provider', enabled: false, selectedModel: 'some-model' },
          { providerId: 'openrouter', enabled: true, selectedModel: 'gpt-4' },
        ]),
        agentConfigStore: createMockAgentConfigStore({
          providerId: 'openrouter',
          model: 'gpt-4',
        }),
        preferenceStore: createMockPreferenceStore(prefs),
      });

      expect(result.source).toBe('global_default');
    });

    it('should use user preference fallbackMode to override definition fallbackMode', () => {
      const prefs = new Map<string, SubagentProviderPreference>();
      prefs.set('user1:test_agent', {
        fallbackMode: 'none',
      });

      expect(() =>
        resolveSubagentProvider({
          userId: 'user1',
          agentType: 'test_agent',
          taskSpec: createTaskSpec(),
          definition: createDefinition({
            providerPolicy: {
              fallbackMode: 'any_compatible',
            },
          }),
          providerConfigStore: createMockProviderConfigStore([]),
          agentConfigStore: createMockAgentConfigStore(null),
          preferenceStore: createMockPreferenceStore(prefs),
        }),
      ).toThrow(/fallbackMode is "none"/);
    });
  });

  describe('validateProviderCapabilities with userId', () => {
    it('should find user-specific provider when userId is provided', () => {
      const mockStore = {
        getByUser: (userId: string) => {
          if (userId === 'user1') {
            return [{ providerId: 'user1-provider', enabled: true }];
          }
          return [];
        },
      };

      const result = validateProviderCapabilities(
        'user1-provider',
        'some-model',
        ['text'],
        mockStore,
        'user1',
      );

      expect(result.valid).toBe(true);
    });

    it('should fail to find user-specific provider when userId is empty string', () => {
      const mockStore = {
        getByUser: (userId: string) => {
          if (userId === 'user1') {
            return [{ providerId: 'user1-provider', enabled: true }];
          }
          return [];
        },
      };

      const result = validateProviderCapabilities(
        'user1-provider',
        'some-model',
        ['text'],
        mockStore,
        '',
      );

      expect(result.valid).toBe(false);
      expect(result.missingCapabilities).toEqual(['text']);
    });

    it('should pass when no requiredCapabilities even with empty userId', () => {
      const result = validateProviderCapabilities(
        'any-provider',
        'any-model',
        undefined,
        { getByUser: () => [] },
        '',
      );

      expect(result.valid).toBe(true);
    });
  });

  describe('precedence chain', () => {
    it('should prefer taskSpec.modelOverride over user preference', () => {
      const prefs = new Map<string, SubagentProviderPreference>();
      prefs.set('user1:test_agent', {
        providerId: 'pref-provider',
        model: 'pref-model',
      });

      const result = resolveSubagentProvider({
        userId: 'user1',
        agentType: 'test_agent',
        taskSpec: createTaskSpec({
          objective: 'Test',
        }) as SubagentTaskSpec & {
          modelOverride?: { providerId?: string; model?: string };
        },
        definition: createDefinition(),
        providerConfigStore: createMockProviderConfigStore([
          { providerId: 'pref-provider', enabled: true, selectedModel: 'pref-model' },
          { providerId: 'override-provider', enabled: true, selectedModel: 'override-model' },
        ]),
        agentConfigStore: createMockAgentConfigStore(null),
        preferenceStore: createMockPreferenceStore(prefs),
      });

      expect(result.source).toBe('user_subagent_preference');
      expect(result.providerId).toBe('pref-provider');
    });

    it('should fall back to definition default when no preference exists', () => {
      const result = resolveSubagentProvider({
        userId: 'user1',
        agentType: 'test_agent',
        taskSpec: createTaskSpec(),
        definition: createDefinition({
          providerPolicy: {
            defaultProviderId: 'def-provider',
            defaultModel: 'def-model',
            fallbackMode: 'any_compatible',
          },
        }),
        providerConfigStore: createMockProviderConfigStore([
          { providerId: 'def-provider', enabled: true, selectedModel: 'def-model' },
        ]),
        agentConfigStore: createMockAgentConfigStore(null),
      });

      expect(result.source).toBe('definition_default');
      expect(result.providerId).toBe('def-provider');
      expect(result.model).toBe('def-model');
    });

    it('should fall back to global config when definition default fails policy', () => {
      const result = resolveSubagentProvider({
        userId: 'user1',
        agentType: 'test_agent',
        taskSpec: createTaskSpec(),
        definition: createDefinition({
          providerPolicy: {
            defaultProviderId: 'blocked-provider',
            defaultModel: 'blocked-model',
            allowedProviderIds: ['allowed-provider'],
            fallbackMode: 'any_compatible',
          },
        }),
        providerConfigStore: createMockProviderConfigStore([
          { providerId: 'blocked-provider', enabled: true, selectedModel: 'blocked-model' },
          { providerId: 'allowed-provider', enabled: true, selectedModel: 'global-model' },
        ]),
        agentConfigStore: createMockAgentConfigStore({
          providerId: 'allowed-provider',
          model: 'global-model',
        }),
      });

      expect(result.source).toBe('global_default');
      expect(result.providerId).toBe('allowed-provider');
    });

    it('should use compatible fallback when higher precedence sources fail', () => {
      const result = resolveSubagentProvider({
        userId: 'user1',
        agentType: 'test_agent',
        taskSpec: createTaskSpec(),
        definition: createDefinition(),
        providerConfigStore: createMockProviderConfigStore([
          { providerId: 'fallback-provider', enabled: true, selectedModel: 'fallback-model' },
        ]),
        agentConfigStore: createMockAgentConfigStore(null),
      });

      expect(result.source).toBe('fallback');
      expect(result.providerId).toBe('fallback-provider');
      expect(result.model).toBe('fallback-model');
    });

    it('should throw when fallbackMode is none and nothing matches', () => {
      expect(() =>
        resolveSubagentProvider({
          userId: 'user1',
          agentType: 'test_agent',
          taskSpec: createTaskSpec(),
          definition: createDefinition({
            providerPolicy: {
              fallbackMode: 'none',
            },
          }),
          providerConfigStore: createMockProviderConfigStore([]),
          agentConfigStore: createMockAgentConfigStore(null),
        }),
      ).toThrow(/fallbackMode is "none"/);
    });
  });
});
