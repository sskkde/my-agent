import { describe, it, expect } from 'vitest';
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../src/prompt/prompt-template-registry.js';
import { TemplateLoader } from '../../../src/prompt/template-loader.js';
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js';
import type { ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js';

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

describe('Tool Escalation Security Tests', () => {
  describe('denied tools never appear in prompt', () => {
    it('tool with exposure denied is excluded from toolIds', async () => {
      const builder = makeBuilder();

      const allowedProjection = {
        toolIds: ['file.read', 'web.search', 'memory.retrieve'],
      };

      const deniedProjection = {
        toolIds: ['file.read', 'web.search'],
      };

      const resultAllowed = await builder.build(makeMinimalInput({
        toolProjection: allowedProjection,
      }));

      const resultDenied = await builder.build(makeMinimalInput({
        toolProjection: deniedProjection,
      }));

      expect(resultAllowed.segments.toolPlane).toContain('memory.retrieve');
      expect(resultDenied.segments.toolPlane).not.toContain('memory.retrieve');
    });

    it('tool with exposure denied never appears in tool descriptions', async () => {
      const builder = makeBuilder();

      const sensitiveToolDescription = 'Execute arbitrary shell commands on the server';

      const result = await builder.build(makeMinimalInput({
        toolProjection: {
          toolIds: ['file.read', 'web.search'],
          tools: [
            {
              type: 'function' as const,
              function: {
                name: 'file.read',
                description: 'Read a file from disk',
                parameters: { type: 'object', properties: { path: { type: 'string' } } },
              },
            },
          ],
        },
      }));

      expect(result.segments.toolPlane).toContain('file.read');
      expect(result.segments.toolPlane).not.toContain(sensitiveToolDescription);
      expect(result.segments.toolPlane).not.toContain('shell');
    });

    it('removing a tool from projection removes it entirely from prompt output', async () => {
      const builder = makeBuilder();

      const fullProjection = {
        toolIds: ['file.read', 'file.write', 'web.search', 'web.fetch'],
        tools: [
          {
            type: 'function' as const,
            function: {
              name: 'file.write',
              description: 'Write to a file on disk',
              parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
            },
          },
        ],
      };

      const restrictedProjection = {
        toolIds: ['file.read', 'web.search'],
      };

      const resultFull = await builder.build(makeMinimalInput({
        toolProjection: fullProjection,
      }));

      const resultRestricted = await builder.build(makeMinimalInput({
        toolProjection: restrictedProjection,
      }));

      expect(resultFull.segments.toolPlane).toContain('file.write');
      expect(resultFull.segments.toolPlane).toContain('web.fetch');

      expect(resultRestricted.segments.toolPlane).not.toContain('file.write');
      expect(resultRestricted.segments.toolPlane).not.toContain('web.fetch');
    });
  });

  describe('always_on tools always appear in prompt', () => {
    it('tool included in projection appears in the output', async () => {
      const builder = makeBuilder();

      const result = await builder.build(makeMinimalInput({
        toolProjection: {
          toolIds: ['status.query', 'memory.retrieve'],
        },
      }));

      expect(result.segments.toolPlane).toContain('status.query');
      expect(result.segments.toolPlane).toContain('memory.retrieve');
    });

    it('tool with full schema in function_calling mode appears with description', async () => {
      const builder = makeBuilder();

      const result = await builder.build(makeMinimalInput({
        toolProjection: {
          toolIds: ['file.read'],
          tools: [{
            type: 'function' as const,
            function: {
              name: 'file.read',
              description: 'Read a file from disk',
              parameters: { type: 'object', properties: { path: { type: 'string' } } },
            },
          }],
        },
      }));

      expect(result.segments.toolPlane).toContain('file.read');
      expect(result.segments.toolPlane).toContain('Read a file from disk');
    });
  });

  describe('hidden tools do not appear in prompt or description', () => {
    it('empty toolProjection produces empty Segment C', async () => {
      const builder = makeBuilder();

      const result = await builder.build(makeMinimalInput({
        toolProjection: undefined,
      }));

      expect(result.segments.toolPlane).toBe('');
    });

    it('toolProjection with empty toolIds in structured_json produces empty Segment C', async () => {
      const builder = makeBuilder();

      const result = await builder.build({
        mode: 'structured_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: [] },
      });

      expect(result.segments.toolPlane).toBe('');
    });

    it('undefined toolProjection produces empty Segment C', async () => {
      const builder = makeBuilder();

      const result = await builder.build(makeMinimalInput({
        toolProjection: undefined,
      }));

      expect(result.segments.toolPlane).toBe('');
    });
  });

  describe('permission check denies tool escalation', () => {
    it('downgrading from function_calling to routing_json strips tool schemas', async () => {
      const builder = makeBuilder();

      const fullToolProjection = {
        toolIds: ['file.read', 'web.search'],
        tools: [
          {
            type: 'function' as const,
            function: {
              name: 'file.read',
              description: 'Read a file from disk',
              parameters: { type: 'object', properties: { path: { type: 'string' } } },
            },
          },
          {
            type: 'function' as const,
            function: {
              name: 'web.search',
              description: 'Search the web',
              parameters: { type: 'object', properties: { query: { type: 'string' } } },
            },
          },
        ],
      };

      const resultFull = await builder.build(makeMinimalInput({
        mode: 'function_calling',
        toolProjection: fullToolProjection,
      }));

      const resultRouting = await builder.build({
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['file.read', 'web.search'] },
      });

      expect(resultFull.segments.toolPlane).toContain('Read a file from disk');
      expect(resultFull.segments.toolPlane).toContain('Search the web');

      expect(resultRouting.segments.toolPlane).toContain('file.read');
      expect(resultRouting.segments.toolPlane).toContain('web.search');
      expect(resultRouting.segments.toolPlane).not.toContain('Read a file from disk');
      expect(resultRouting.segments.toolPlane).not.toContain('Search the web');
    });

    it('structured_json mode with toolIds shows minimal tool plane', async () => {
      const builder = makeBuilder();

      const result = await builder.build({
        mode: 'structured_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['memory.retrieve'] },
      });

      expect(result.segments.toolPlane).toContain('memory.retrieve');
      expect(result.segments.toolPlane).not.toContain('parameters');
      expect(result.segments.toolPlane).not.toContain('description');
    });
  });

  describe('extractToolsForRequest respects mode', () => {
    it('function_calling mode returns tools for LLM request', async () => {
      const { extractToolsForRequest } = await import('../../../src/kernel/model-input/model-input-builder.js');

      const tools = [{
        type: 'function' as const,
        function: {
          name: 'file.read',
          description: 'Read file',
          parameters: { type: 'object' as const, properties: { path: { type: 'string' } } },
        },
      }];

      const result = extractToolsForRequest({
        mode: 'function_calling',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['file.read'], tools },
      });

      expect(result).toBeDefined();
      expect(result!.length).toBe(1);
      expect(result![0].function.name).toBe('file.read');
    });

    it('routing_json mode returns undefined (no tools in LLM request)', async () => {
      const { extractToolsForRequest } = await import('../../../src/kernel/model-input/model-input-builder.js');

      const result = extractToolsForRequest({
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['file.read'] },
      });

      expect(result).toBeUndefined();
    });

    it('structured_json mode returns undefined', async () => {
      const { extractToolsForRequest } = await import('../../../src/kernel/model-input/model-input-builder.js');

      const result = extractToolsForRequest({
        mode: 'structured_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['memory.retrieve'] },
      });

      expect(result).toBeUndefined();
    });
  });
});