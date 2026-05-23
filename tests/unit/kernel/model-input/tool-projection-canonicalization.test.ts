import { describe, it, expect } from 'vitest';
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../../src/prompt/prompt-template-registry.js';
import { TemplateLoader } from '../../../../src/prompt/template-loader.js';
import { ModelInputBuilder } from '../../../../src/kernel/model-input/model-input-builder.js';
import { computeTemplateHash } from '../../../../src/prompt/template-hash.js';
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
    mode: 'function_calling',
    agentKind: 'foreground',
    providerFamily: 'openai',
    ...overrides,
  };
}

describe('Tool Projection Canonicalization', () => {
  describe('tool ordering stability', () => {
    it('same tool definitions in same order → same segmentC hash', async () => {
      const builder = makeBuilder();

      const toolA = {
        type: 'function' as const,
        function: {
          name: 'alpha.tool',
          description: 'Alpha tool description',
          parameters: { type: 'object' as const, properties: { x: { type: 'string' } } },
        },
      };

      const toolB = {
        type: 'function' as const,
        function: {
          name: 'beta.tool',
          description: 'Beta tool description',
          parameters: { type: 'object' as const, properties: { y: { type: 'number' } } },
        },
      };

      const result1 = await builder.build(makeMinimalInput({
        toolProjection: {
          toolIds: ['alpha.tool', 'beta.tool'],
          tools: [toolA, toolB],
        },
      }));

      const result2 = await builder.build(makeMinimalInput({
        toolProjection: {
          toolIds: ['alpha.tool', 'beta.tool'],
          tools: [toolA, toolB],
        },
      }));

      expect(result1.segmentHashes.segmentC).toBe(result2.segmentHashes.segmentC);
    });

    it('different tool ordering → different segmentC hash (order-sensitive)', async () => {
      const builder = makeBuilder();

      const result1 = await builder.build(makeMinimalInput({
        mode: 'routing_json',
        toolProjection: { toolIds: ['file.read', 'web.search', 'memory.retrieve'] },
      }));

      const result2 = await builder.build(makeMinimalInput({
        mode: 'routing_json',
        toolProjection: { toolIds: ['memory.retrieve', 'file.read', 'web.search'] },
      }));

      expect(result1.segmentHashes.segmentC).not.toBe(result2.segmentHashes.segmentC);
    });

    it('same toolIds in same order → same segmentC hash deterministically', async () => {
      const builder = makeBuilder();

      const results = await Promise.all([
        builder.build(makeMinimalInput({
          mode: 'routing_json',
          toolProjection: { toolIds: ['file.read', 'web.search'] },
        })),
        builder.build(makeMinimalInput({
          mode: 'routing_json',
          toolProjection: { toolIds: ['file.read', 'web.search'] },
        })),
      ]);

      expect(results[0].segmentHashes.segmentC).toBe(results[1].segmentHashes.segmentC);
    });
  });

  describe('tool property ordering does not affect serialization', () => {
    it('same tool with different property order in parameters → same segmentC hash', async () => {
      const builder = makeBuilder();

      const toolWithOrder1 = {
        type: 'function' as const,
        function: {
          name: 'test.tool',
          description: 'Test tool',
          parameters: {
            type: 'object' as const,
            properties: { alpha: { type: 'string' }, beta: { type: 'number' } },
          },
        },
      };

      const toolWithOrder2 = {
        type: 'function' as const,
        function: {
          name: 'test.tool',
          description: 'Test tool',
          parameters: {
            type: 'object' as const,
            properties: { beta: { type: 'number' }, alpha: { type: 'string' } },
          },
        },
      };

      const result1 = await builder.build(makeMinimalInput({
        toolProjection: {
          toolIds: ['test.tool'],
          tools: [toolWithOrder1],
        },
      }));

      const result2 = await builder.build(makeMinimalInput({
        toolProjection: {
          toolIds: ['test.tool'],
          tools: [toolWithOrder2],
        },
      }));

      expect(result1.segmentHashes.segmentC).toBe(result2.segmentHashes.segmentC);
    });
  });

  describe('empty tool list stability', () => {
    it('empty toolIds in structured_json mode → empty output', async () => {
      const builder = makeBuilder();

      const result = await builder.build({
        mode: 'structured_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: [] },
      });

      expect(result.segments.toolPlane).toBe('');
    });

    it('undefined toolProjection → empty Segment C', async () => {
      const builder = makeBuilder();

      const result = await builder.build(makeMinimalInput({
        toolProjection: undefined,
      }));

      expect(result.segments.toolPlane).toBe('');
    });
  });

  describe('single tool stability', () => {
    it('single tool → stable serialization across calls', async () => {
      const builder = makeBuilder();

      const tool = {
        type: 'function' as const,
        function: {
          name: 'single.tool',
          description: 'Single tool for testing',
          parameters: { type: 'object' as const, properties: { input: { type: 'string' } } },
        },
      };

      const results = await Promise.all([
        builder.build(makeMinimalInput({
          toolProjection: { toolIds: ['single.tool'], tools: [tool] },
        })),
        builder.build(makeMinimalInput({
          toolProjection: { toolIds: ['single.tool'], tools: [tool] },
        })),
      ]);

      expect(results[0].segments.toolPlane).toBe(results[1].segments.toolPlane);
      expect(results[0].segmentHashes.segmentC).toBe(results[1].segmentHashes.segmentC);
    });
  });

  describe('computeTemplateHash canonicalization', () => {
    it('same content always produces same hash', () => {
      const content = 'Available Tool IDs: file.read, web.search';
      const hash1 = computeTemplateHash(content);
      const hash2 = computeTemplateHash(content);

      expect(hash1).toBe(hash2);
    });

    it('different content produces different hash', () => {
      const hash1 = computeTemplateHash('Tools: alpha, beta');
      const hash2 = computeTemplateHash('Tools: gamma, delta');

      expect(hash1).not.toBe(hash2);
    });

    it('hash is 64-character hex string', () => {
      const hash = computeTemplateHash('test content');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});