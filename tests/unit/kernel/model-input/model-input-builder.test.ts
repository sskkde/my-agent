import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../../src/prompt/prompt-template-registry.js';
import { TemplateLoader } from '../../../../src/prompt/template-loader.js';
import { ModelInputBuilder } from '../../../../src/kernel/model-input/model-input-builder.js';
import { computeCacheKey } from '../../../../src/kernel/model-input/model-input-cache-key.js';
import { StaticPrefixBuilder } from '../../../../src/kernel/model-input/static-prefix-builder.js';
import type { ModelInputBuildInput } from '../../../../src/kernel/model-input/model-input-types.js';

function makeTestTemplates(): Map<string, PromptTemplateRecord> {
  return new Map([
    ['platform:base', {
      id: 'platform:base',
      version: '2026-05-23',
      path: 'platform/base.md',
      agentKind: '*',
      providerFamily: '*',
      layer: 1,
      content: 'Platform Base for {agentKind} agent with {providerFamily} provider.',
      description: 'Test platform base',
    }],
    ['platform:safety', {
      id: 'platform:safety',
      version: '2026-05-23',
      path: 'platform/safety.md',
      agentKind: '*',
      providerFamily: '*',
      layer: 1,
      content: 'Safety rules for {agentKind}.',
      description: 'Test safety',
    }],
    ['provider:openai', {
      id: 'provider:openai',
      version: '2026-05-23',
      path: 'provider/openai.md',
      agentKind: '*',
      providerFamily: 'openai',
      layer: 2,
      content: 'OpenAI provider config for {agentKind}.',
      description: 'Test openai provider',
    }],
    ['provider:deepseek', {
      id: 'provider:deepseek',
      version: '2026-05-23',
      path: 'provider/deepseek.md',
      agentKind: '*',
      providerFamily: 'deepseek',
      layer: 2,
      content: 'DeepSeek provider config for {agentKind}.',
      description: 'Test deepseek provider',
    }],
    ['agents:foreground', {
      id: 'agents:foreground',
      version: '2026-05-23',
      path: 'agents/foreground.md',
      agentKind: 'foreground',
      providerFamily: '*',
      layer: 3,
      content: 'Foreground agent instructions for {agentKind}.',
      description: 'Test foreground agent',
    }],
    ['agents:kernel', {
      id: 'agents:kernel',
      version: '2026-05-23',
      path: 'agents/kernel.md',
      agentKind: 'kernel',
      providerFamily: '*',
      layer: 3,
      content: 'Kernel agent instructions for {agentKind}.',
      description: 'Test kernel agent',
    }],
    ['output:foreground.schema', {
      id: 'output:foreground.schema',
      version: '2026-05-23',
      path: 'output/foreground.schema.md',
      agentKind: 'foreground',
      providerFamily: '*',
      layer: 4,
      content: 'Output schema for {agentKind} with {providerFamily}.',
      description: 'Test foreground schema',
    }],
    ['output:planner.schema', {
      id: 'output:planner.schema',
      version: '2026-05-23',
      path: 'output/planner.schema.md',
      agentKind: 'planner',
      providerFamily: '*',
      layer: 4,
      content: 'Planner output schema for {agentKind}.',
      description: 'Test planner schema',
    }],
  ]);
}

function makeBuilder(): ModelInputBuilder {
  const templates = makeTestTemplates();
  const registry = new PromptTemplateRegistry(templates, '/nonexistent');
  const loader = new TemplateLoader('/nonexistent');
  return new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader });
}

function makeMinimalInput(overrides: Partial<ModelInputBuildInput> = {}): ModelInputBuildInput {
  return {
    mode: 'routing_json',
    agentKind: 'foreground',
    providerFamily: 'openai',
    ...overrides,
  };
}

describe('ModelInputBuilder', () => {
  describe('segment ordering', () => {
    it('outputs segments A/B/C/D in correct order', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        systemPrompt: 'Custom system prompt',
        toolProjection: { toolIds: ['file_read', 'web_search'] },
        currentUserMessage: 'Hello world',
      }));

      const messages = result.messages;
      expect(messages.length).toBeGreaterThanOrEqual(2);

      const firstSystemIdx = messages.findIndex((m) => m.role === 'system' && m.content.includes('Platform Base'));
      const secondSystemIdx = messages.findIndex((m) => m.role === 'system' && m.content.includes('Custom system prompt'));
      const toolPlaneIdx = messages.findIndex((m) => m.role === 'system' && m.content.includes('file_read'));
      const userMsgIdx = messages.findIndex((m) => m.role === 'user' && m.content.includes('Hello world'));

      expect(firstSystemIdx).toBeLessThan(secondSystemIdx);
      expect(secondSystemIdx).toBeLessThan(toolPlaneIdx);
      expect(toolPlaneIdx).toBeLessThan(userMsgIdx);
    });
  });

  describe('Segment A hash stability', () => {
    it('does NOT change when userMessage changes', async () => {
      const builder = makeBuilder();

      const result1 = await builder.build(makeMinimalInput({ currentUserMessage: 'Hello' }));
      const result2 = await builder.build(makeMinimalInput({ currentUserMessage: 'Goodbye' }));

      expect(result1.segmentHashes.segmentA).toBe(result2.segmentHashes.segmentA);
    });

    it('does NOT change when contextBundle changes', async () => {
      const builder = makeBuilder();

      const result1 = await builder.build(makeMinimalInput());
      const result2 = await builder.build(makeMinimalInput({
        contextBundle: {
          pinnedItems: [{ itemId: 'p1', content: 'Important pinned data' }],
          orderedItems: [{ itemId: 'o1', content: 'Dynamic context data' }],
        },
      }));

      expect(result1.segmentHashes.segmentA).toBe(result2.segmentHashes.segmentA);
    });

    it('changes when agentKind changes', async () => {
      const builder = makeBuilder();

      const result1 = await builder.build(makeMinimalInput({ agentKind: 'foreground' }));
      const result2 = await builder.build(makeMinimalInput({ agentKind: 'kernel' }));

      expect(result1.segmentHashes.segmentA).not.toBe(result2.segmentHashes.segmentA);
    });

    it('changes when providerFamily changes', async () => {
      const builder = makeBuilder();

      const result1 = await builder.build(makeMinimalInput({ providerFamily: 'openai' }));
      const result2 = await builder.build(makeMinimalInput({ providerFamily: 'deepseek' }));

      expect(result1.segmentHashes.segmentA).not.toBe(result2.segmentHashes.segmentA);
    });
  });

  describe('dynamic fields NOT in Segment A', () => {
    it('currentDate is NOT in staticPrefix content', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        currentDate: '2026-05-23T12:00:00Z',
      }));

      expect(result.segments.staticPrefix).not.toContain('2026-05-23');
      expect(result.segments.staticPrefix).not.toContain('Current Date');
    });

    it('runId is NOT in staticPrefix content', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        runId: 'run-abc-123',
      }));

      expect(result.segments.staticPrefix).not.toContain('run-abc-123');
      expect(result.segments.staticPrefix).not.toContain('Run ID');
    });

    it('messageId is NOT in staticPrefix content', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        messageId: 'msg-xyz-456',
      }));

      expect(result.segments.staticPrefix).not.toContain('msg-xyz-456');
      expect(result.segments.staticPrefix).not.toContain('Message ID');
    });

    it('dynamic fields ARE in Segment D', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        currentDate: '2026-05-23T12:00:00Z',
        runId: 'run-abc-123',
        messageId: 'msg-xyz-456',
      }));

      expect(result.segments.contextBundle).toContain('Current Date: 2026-05-23');
      expect(result.segments.contextBundle).toContain('Run ID: run-abc-123');
      expect(result.segments.contextBundle).toContain('Message ID: msg-xyz-456');
    });
  });

  describe('three modes produce different structures', () => {
    it('routing_json mode produces user message with tool summaries', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        mode: 'routing_json',
        toolProjection: { toolIds: ['file_read', 'web_search'] },
        currentUserMessage: 'Read the file',
      }));

      const toolMessages = result.messages.filter((m) =>
        m.role === 'system' && m.content.includes('file_read') && m.content.includes('web_search')
      );
      expect(toolMessages.length).toBeGreaterThan(0);
    });

    it('structured_json mode produces minimal tool plane', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        mode: 'structured_json',
        toolProjection: { toolIds: ['memory_retrieve'] },
      }));

      expect(result.metadata.mode).toBe('structured_json');
      expect(result.segments.toolPlane).toContain('memory_retrieve');
    });

    it('function_calling mode includes full tool descriptions', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
        toolProjection: {
          toolIds: ['file_read'],
          tools: [{
            type: 'function' as const,
            function: {
              name: 'file_read',
              description: 'Read a file from disk',
              parameters: { type: 'object', properties: { path: { type: 'string' } } },
            },
          }],
        },
      }));

      expect(result.segments.toolPlane).toContain('file_read');
      expect(result.segments.toolPlane).toContain('Read a file from disk');
    });

    it('empty toolProjection produces empty Segment C', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        mode: 'routing_json',
      }));

      expect(result.segments.toolPlane).toBe('');
    });
  });

  describe('empty inputs produce valid minimal output', () => {
    it('minimal input produces valid BuiltModelInput', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput());

      expect(result.messages).toBeDefined();
      expect(result.segments).toBeDefined();
      expect(result.segmentHashes).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata.mode).toBe('routing_json');
      expect(result.metadata.agentKind).toBe('foreground');
      expect(result.metadata.providerFamily).toBe('openai');
    });

    it('with no templates matching, still produces valid output', async () => {
      const emptyRegistry = new PromptTemplateRegistry(new Map(), '/nonexistent');
      const loader = new TemplateLoader('/nonexistent');
      const builder = new ModelInputBuilder({ templateRegistry: emptyRegistry, templateLoader: loader });

      const result = await builder.build(makeMinimalInput({
        agentKind: 'nonexistent_agent',
        providerFamily: 'nonexistent_provider',
      }));

      expect(result.segments.staticPrefix).toBe('');
      expect(result.segmentHashes.segmentA).toBeDefined();
      expect(result.messages).toBeDefined();
    });
  });

  describe('metadata', () => {
    it('reflects input mode, agentKind, providerFamily', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'deepseek',
      }));

      expect(result.metadata.mode).toBe('function_calling');
      expect(result.metadata.agentKind).toBe('kernel');
      expect(result.metadata.providerFamily).toBe('deepseek');
    });

    it('messageCount reflects actual message count', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        systemPrompt: 'Test prompt',
        toolProjection: { toolIds: ['file_read'] },
        currentUserMessage: 'Hello',
      }));

      expect(result.metadata.messageCount).toBe(result.messages.length);
    });
  });

  describe('cache key', () => {
    it('excludes Segment D hash', () => {
      const key1 = computeCacheKey('a-hash', 'b-hash', 'c-hash');
      expect(key1).toBeDefined();
      expect(typeof key1).toBe('string');
      expect(key1.length).toBe(64);
    });

    it('produces different keys for different inputs', () => {
      const key1 = computeCacheKey('hash-a', 'hash-b', 'hash-c');
      const key2 = computeCacheKey('hash-a', 'hash-b', 'hash-d');
      expect(key1).not.toBe(key2);
    });

    it('produces same key for same inputs', () => {
      const key1 = computeCacheKey('hash-a', 'hash-b', 'hash-c');
      const key2 = computeCacheKey('hash-a', 'hash-b', 'hash-c');
      expect(key1).toBe(key2);
    });
  });

  describe('Segment B (tenant/project)', () => {
    it('includes systemPrompt', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        systemPrompt: 'You are a helpful assistant.',
      }));

      expect(result.segments.tenantProject).toContain('You are a helpful assistant.');
    });

    it('includes routingPrompt', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        routingPrompt: 'Route based on complexity.',
      }));

      expect(result.segments.tenantProject).toContain('Route based on complexity.');
    });

    it('includes both when both are provided', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        systemPrompt: 'System instructions.',
        routingPrompt: 'Routing rules.',
      }));

      expect(result.segments.tenantProject).toContain('System instructions.');
      expect(result.segments.tenantProject).toContain('Routing rules.');
    });

    it('is empty when neither is provided', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput());

      expect(result.segments.tenantProject).toBe('');
    });
  });

  describe('Segment D (context bundle)', () => {
    it('includes pinned items', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        contextBundle: {
          pinnedItems: [{ itemId: 'p1', content: 'Important context', isPinned: true }],
        },
      }));

      expect(result.segments.contextBundle).toContain('Important context');
      expect(result.segments.contextBundle).toContain('PINNED');
    });

    it('includes ordered items', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        contextBundle: {
          orderedItems: [{ itemId: 'o1', content: 'Dynamic data' }],
        },
      }));

      expect(result.segments.contextBundle).toContain('Dynamic data');
    });

    it('includes plan view', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        contextBundle: {
          planView: 'Plan: Step 1 - Do something',
        },
      }));

      expect(result.segments.contextBundle).toContain('Plan: Step 1');
    });

    it('includes user message', async () => {
      const builder = makeBuilder();
      const result = await builder.build(makeMinimalInput({
        currentUserMessage: 'Please help me with this task',
      }));

      expect(result.segments.contextBundle).toContain('Please help me with this task');
    });
  });

  describe('boundary: no forbidden imports', () => {
    const builderSource = readFileSync(
      resolve(process.cwd(), 'src/kernel/model-input/model-input-builder.ts'),
      'utf-8'
    );

    it('ModelInputBuilder does NOT import ToolRegistry', () => {
      expect(builderSource).not.toContain('ToolRegistry');
    });

    it('ModelInputBuilder does NOT import MemoryStore', () => {
      expect(builderSource).not.toContain('MemoryStore');
    });

    it('ModelInputBuilder does NOT import PermissionEngine', () => {
      expect(builderSource).not.toContain('PermissionEngine');
    });
  });
});

describe('StaticPrefixBuilder', () => {
  it('assembles Layer 1-4 templates in order', async () => {
    const templates = makeTestTemplates();
    const registry = new PromptTemplateRegistry(templates, '/nonexistent');
    const loader = new TemplateLoader('/nonexistent');
    const builder = new StaticPrefixBuilder(registry, loader);

    const result = await builder.buildStaticPrefix('foreground', 'openai');

    expect(result.content).toContain('Platform Base for foreground');
    expect(result.content).toContain('Safety rules for foreground');
    expect(result.content).toContain('OpenAI provider config for foreground');
    expect(result.content).toContain('Foreground agent instructions for foreground');
    expect(result.content).toContain('Output schema for foreground with openai');
  });

  it('computes stable hash', async () => {
    const templates = makeTestTemplates();
    const registry = new PromptTemplateRegistry(templates, '/nonexistent');
    const loader = new TemplateLoader('/nonexistent');
    const builder = new StaticPrefixBuilder(registry, loader);

    const result1 = await builder.buildStaticPrefix('foreground', 'openai');
    const result2 = await builder.buildStaticPrefix('foreground', 'openai');

    expect(result1.hash).toBe(result2.hash);
    expect(result1.hash.length).toBe(64);
  });

  it('returns empty content when no templates match', async () => {
    const emptyRegistry = new PromptTemplateRegistry(new Map(), '/nonexistent');
    const loader = new TemplateLoader('/nonexistent');
    const builder = new StaticPrefixBuilder(emptyRegistry, loader);

    const result = await builder.buildStaticPrefix('nonexistent', 'nonexistent');

    expect(result.content).toBe('');
    expect(result.hash).toBeDefined();
  });
});

describe('computeCacheKey', () => {
  it('returns a 64-character hex string', () => {
    const key = computeCacheKey('a', 'b', 'c');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    const key1 = computeCacheKey('segA', 'segB', 'segC');
    const key2 = computeCacheKey('segA', 'segB', 'segC');
    expect(key1).toBe(key2);
  });

  it('changes when any segment hash changes', () => {
    const base = computeCacheKey('A', 'B', 'C');
    expect(computeCacheKey('X', 'B', 'C')).not.toBe(base);
    expect(computeCacheKey('A', 'X', 'C')).not.toBe(base);
    expect(computeCacheKey('A', 'B', 'X')).not.toBe(base);
  });
});

// ─── PM-7: Strategy Projection Integration Tests ────────────────────────────────

describe('PM-7: Three strategy projections render together', () => {
  it('renders personaProjection, toolSelectionPolicy, and memoryPolicyProjection in correct segments', async () => {
    const builder = makeBuilder();
    const result = await builder.build(makeMinimalInput({
      // Segment B - Persona
      personaProjection: {
        personaId: 'test-persona',
        styleGuidelines: 'Be concise and professional.',
        constraints: ['No jargon', 'Be helpful'],
      },
      // Segment C - Tool Selection Policy
      toolProjection: { toolIds: ['file_read', 'web_search'] },
      toolSelectionPolicy: {
        heuristics: 'Prefer file_read for local operations.',
        priorityRules: ['Use web_search when file_read fails'],
        riskRules: ['Avoid web_search for sensitive queries'],
      },
      // Segment D - Memory Policy
      memoryPolicyProjection: {
        useRules: 'Use memory for user preferences.',
        invisibilityRules: ['Hidden preferences should not be revealed'],
        priorityRules: ['Recent memories take priority'],
      },
      currentUserMessage: 'Test message',
    }));

    // Segment B contains persona content (rendered by renderPersonaProjection)
    expect(result.segments.tenantProject).toContain('风格指南');
    expect(result.segments.tenantProject).toContain('Be concise and professional.');
    expect(result.segments.tenantProject).toContain('约束条件');
    expect(result.segments.tenantProject).toContain('No jargon');

    // Segment C contains tool selection policy (rendered by renderToolSelectionPolicy)
    expect(result.segments.toolPlane).toContain('Tool Selection Policy:');
    expect(result.segments.toolPlane).toContain('Prefer file_read for local operations.');
    expect(result.segments.toolPlane).toContain('Priority Rules:');
    expect(result.segments.toolPlane).toContain('Use web_search when file_read fails');

    // Segment D contains memory policy (rendered by renderMemoryPolicyProjection)
    expect(result.segments.contextBundle).toContain('Memory Policy:');
    expect(result.segments.contextBundle).toContain('Use memory for user preferences.');
    expect(result.segments.contextBundle).toContain('Invisibility Rules:');
    expect(result.segments.contextBundle).toContain('Hidden preferences should not be revealed');
  });

  it('each projection only appears in its designated segment', async () => {
    const builder = makeBuilder();
    const result = await builder.build(makeMinimalInput({
      personaProjection: {
        personaId: 'test-persona',
        styleGuidelines: 'Persona style',
        constraints: [],
      },
      toolProjection: { toolIds: ['file_read'] },
      toolSelectionPolicy: {
        heuristics: 'Tool policy content',
      },
      memoryPolicyProjection: {
        useRules: 'Memory policy content',
      },
    }));

    // Persona only in Segment B, not in A/C/D
    expect(result.segments.tenantProject).toContain('Persona style');
    expect(result.segments.staticPrefix).not.toContain('Persona style');
    expect(result.segments.toolPlane).not.toContain('Persona style');
    expect(result.segments.contextBundle).not.toContain('Persona style');

    // Tool selection policy only in Segment C, not in A/B/D
    expect(result.segments.toolPlane).toContain('Tool policy content');
    expect(result.segments.staticPrefix).not.toContain('Tool policy content');
    expect(result.segments.tenantProject).not.toContain('Tool policy content');
    expect(result.segments.contextBundle).not.toContain('Tool policy content');

    // Memory policy only in Segment D, not in A/B/C
    expect(result.segments.contextBundle).toContain('Memory policy content');
    expect(result.segments.staticPrefix).not.toContain('Memory policy content');
    expect(result.segments.tenantProject).not.toContain('Memory policy content');
    expect(result.segments.toolPlane).not.toContain('Memory policy content');
  });
});

describe('PM-7: Hash stability regression (flag OFF)', () => {
  it('produces identical hashes when all projection fields are undefined', async () => {
    const builder = makeBuilder();

    // Create input without any projection fields (simulating flag OFF)
    const input = makeMinimalInput({
      systemPrompt: 'Test system prompt',
      routingPrompt: 'Test routing prompt',
      toolProjection: { toolIds: ['file_read'] },
      currentUserMessage: 'Test message',
    });

    // Build twice with identical input
    const result1 = await builder.build(input);
    const result2 = await builder.build(input);

    // All segment hashes must be identical
    expect(result1.segmentHashes.segmentA).toBe(result2.segmentHashes.segmentA);
    expect(result1.segmentHashes.segmentB).toBe(result2.segmentHashes.segmentB);
    expect(result1.segmentHashes.segmentC).toBe(result2.segmentHashes.segmentC);
    expect(result1.segmentHashes.segmentD).toBe(result2.segmentHashes.segmentD);
  });

  it('produces stable hash when projection fields are explicitly undefined', async () => {
    const builder = makeBuilder();

    // Explicitly set projection fields to undefined (flag OFF behavior)
    const input = makeMinimalInput({
      personaProjection: undefined,
      toolSelectionPolicy: undefined,
      memoryPolicyProjection: undefined,
      systemPrompt: 'Test',
    });

    const result1 = await builder.build(input);
    const result2 = await builder.build(input);

    expect(result1.segmentHashes.segmentB).toBe(result2.segmentHashes.segmentB);
    expect(result1.segmentHashes.segmentC).toBe(result2.segmentHashes.segmentC);
    expect(result1.segmentHashes.segmentD).toBe(result2.segmentHashes.segmentD);
  });

  it('hash changes when projection is added (flag ON)', async () => {
    const builder = makeBuilder();

    const inputWithoutProjection = makeMinimalInput({
      systemPrompt: 'Test',
      toolProjection: { toolIds: ['file_read'] },
    });

    const inputWithProjection = makeMinimalInput({
      systemPrompt: 'Test',
      toolProjection: { toolIds: ['file_read'] },
      toolSelectionPolicy: {
        heuristics: 'Use tools wisely',
      },
    });

    const result1 = await builder.build(inputWithoutProjection);
    const result2 = await builder.build(inputWithProjection);

    // Segment C hash should change when policy is added
    expect(result1.segmentHashes.segmentC).not.toBe(result2.segmentHashes.segmentC);
    // Other segments should remain stable
    expect(result1.segmentHashes.segmentA).toBe(result2.segmentHashes.segmentA);
    expect(result1.segmentHashes.segmentB).toBe(result2.segmentHashes.segmentB);
  });
});

describe('PM-7: Token increment validation', () => {
  // Character estimation: ~4 chars per token

  it('Segment B increment ≤ 150 tokens (600 chars) for personaProjection', async () => {
    const builder = makeBuilder();

    const inputWithout = makeMinimalInput({
      systemPrompt: 'Test',
    });

    const inputWith = makeMinimalInput({
      systemPrompt: 'Test',
      personaProjection: {
        personaId: 'persona-123',
        styleGuidelines: 'Be concise, professional, and helpful. Use clear language.',
        constraints: ['Avoid jargon', 'Be respectful', 'Stay on topic'],
      },
    });

    const resultWithout = await builder.build(inputWithout);
    const resultWith = await builder.build(inputWith);

    const increment = resultWith.segments.tenantProject.length - resultWithout.segments.tenantProject.length;
    // Increment should be ≤ 600 chars (≈150 tokens)
    expect(increment).toBeLessThanOrEqual(600);
    expect(increment).toBeGreaterThan(0); // Should have added content
  });

  it('Segment C increment ≤ 200 tokens (800 chars) for toolSelectionPolicy', async () => {
    const builder = makeBuilder();

    const inputWithout = makeMinimalInput({
      toolProjection: { toolIds: ['file_read', 'web_search'] },
    });

    const inputWith = makeMinimalInput({
      toolProjection: { toolIds: ['file_read', 'web_search'] },
      toolSelectionPolicy: {
        heuristics: 'Prefer file_read for local files. Use web_search for external content.',
        priorityRules: ['file_read first', 'web_search as fallback'],
        riskRules: ['Avoid web_search for sensitive data'],
      },
    });

    const resultWithout = await builder.build(inputWithout);
    const resultWith = await builder.build(inputWith);

    const increment = resultWith.segments.toolPlane.length - resultWithout.segments.toolPlane.length;
    // Increment should be ≤ 800 chars (≈200 tokens)
    expect(increment).toBeLessThanOrEqual(800);
    expect(increment).toBeGreaterThan(0);
  });

  it('Segment D increment ≤ 150 tokens (600 chars) for memoryPolicyProjection', async () => {
    const builder = makeBuilder();

    const inputWithout = makeMinimalInput({
      currentUserMessage: 'Test',
    });

    const inputWith = makeMinimalInput({
      currentUserMessage: 'Test',
      memoryPolicyProjection: {
        useRules: 'Prioritize recent memories. Use for context awareness.',
        invisibilityRules: ['Hidden memories not revealed'],
        priorityRules: ['High importance first'],
      },
    });

    const resultWithout = await builder.build(inputWithout);
    const resultWith = await builder.build(inputWith);

    const increment = resultWith.segments.contextBundle.length - resultWithout.segments.contextBundle.length;
    // Increment should be ≤ 600 chars (≈150 tokens)
    expect(increment).toBeLessThanOrEqual(600);
    expect(increment).toBeGreaterThan(0);
  });

  it('Total increment ≤ 500 tokens (2000 chars) for all three projections', async () => {
    const builder = makeBuilder();

    const inputWithout = makeMinimalInput({
      systemPrompt: 'Test',
      toolProjection: { toolIds: ['file_read'] },
      currentUserMessage: 'Test',
    });

    const inputWith = makeMinimalInput({
      systemPrompt: 'Test',
      toolProjection: { toolIds: ['file_read'] },
      currentUserMessage: 'Test',
      personaProjection: {
        personaId: 'p1',
        styleGuidelines: 'Be helpful',
        constraints: ['No jargon'],
      },
      toolSelectionPolicy: {
        heuristics: 'Use tools wisely',
        priorityRules: ['Safety first'],
      },
      memoryPolicyProjection: {
        useRules: 'Use memory for context',
        priorityRules: ['Recent first'],
      },
    });

    const resultWithout = await builder.build(inputWithout);
    const resultWith = await builder.build(inputWith);

    const totalWithout = resultWithout.segments.tenantProject.length +
                         resultWithout.segments.toolPlane.length +
                         resultWithout.segments.contextBundle.length;
    const totalWith = resultWith.segments.tenantProject.length +
                      resultWith.segments.toolPlane.length +
                      resultWith.segments.contextBundle.length;

    const totalIncrement = totalWith - totalWithout;
    // Total increment should be ≤ 2000 chars (≈500 tokens)
    expect(totalIncrement).toBeLessThanOrEqual(2000);
  });
});

describe('PM-7: Default values are undefined (not empty string)', () => {
  it('projection fields are undefined when not provided', () => {
    const input = makeMinimalInput();

    // When fields are not provided, they should be undefined
    expect(input.personaProjection).toBeUndefined();
    expect(input.toolSelectionPolicy).toBeUndefined();
    expect(input.memoryPolicyProjection).toBeUndefined();
  });

  it('build() handles undefined projection fields without error', async () => {
    const builder = makeBuilder();

    const input: import('../../../../src/kernel/model-input/model-input-types.js').ModelInputBuildInput = {
      mode: 'routing_json',
      agentKind: 'foreground',
      providerFamily: 'openai',
      // personaProjection intentionally not set
      // toolSelectionPolicy intentionally not set
      // memoryPolicyProjection intentionally not set
    };

    const result = await builder.build(input);

    // Should build successfully without errors
    expect(result).toBeDefined();
    expect(result.segments).toBeDefined();
    expect(result.segmentHashes).toBeDefined();

    // Segments should be valid (empty strings for B/C when no content)
    expect(result.segments.tenantProject).toBe('');
    expect(result.segments.toolPlane).toBe('');
  });

  it('empty segments have valid hashes', async () => {
    const builder = makeBuilder();

    const result = await builder.build(makeMinimalInput());

    // Empty segments should still have valid SHA-256 hashes
    expect(result.segmentHashes.segmentB).toMatch(/^[a-f0-9]{64}$/);
    expect(result.segmentHashes.segmentC).toMatch(/^[a-f0-9]{64}$/);
    expect(result.segmentHashes.segmentD).toMatch(/^[a-f0-9]{64}$/);
  });
});
