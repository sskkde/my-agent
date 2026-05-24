import { describe, it, expect } from 'vitest';
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../../src/prompt/prompt-template-registry.js';
import { TemplateLoader } from '../../../../src/prompt/template-loader.js';
import { ModelInputBuilder } from '../../../../src/kernel/model-input/model-input-builder.js';
import type { ModelInputBuildInput, ToolSelectionPolicyProjection } from '../../../../src/kernel/model-input/model-input-types.js';
import { renderToolSelectionPolicy } from '../../../../src/kernel/model-input/model-input-types.js';

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

describe('ToolSelectionPolicyProjection', () => {
  describe('renderToolSelectionPolicy', () => {
    it('renders heuristics', () => {
      const policy: ToolSelectionPolicyProjection = {
        heuristics: 'Direct answers first.',
      };

      const result = renderToolSelectionPolicy(policy);

      expect(result).toContain('Tool Selection Policy:');
      expect(result).toContain('Direct answers first.');
    });

    it('renders priority rules as bullet list', () => {
      const policy: ToolSelectionPolicyProjection = {
        heuristics: 'Be careful.',
        priorityRules: ['Read before write', 'Low risk first'],
      };

      const result = renderToolSelectionPolicy(policy);

      expect(result).toContain('Priority Rules:');
      expect(result).toContain('- Read before write');
      expect(result).toContain('- Low risk first');
    });

    it('renders risk rules as bullet list', () => {
      const policy: ToolSelectionPolicyProjection = {
        heuristics: 'Stay safe.',
        riskRules: ['Cross-system writes need approval', 'External API calls need caution'],
      };

      const result = renderToolSelectionPolicy(policy);

      expect(result).toContain('Risk Rules:');
      expect(result).toContain('- Cross-system writes need approval');
      expect(result).toContain('- External API calls need caution');
    });

    it('omits priority rules section when not provided', () => {
      const policy: ToolSelectionPolicyProjection = {
        heuristics: 'Be helpful.',
      };

      const result = renderToolSelectionPolicy(policy);

      expect(result).not.toContain('Priority Rules:');
    });

    it('omits risk rules section when not provided', () => {
      const policy: ToolSelectionPolicyProjection = {
        heuristics: 'Be helpful.',
      };

      const result = renderToolSelectionPolicy(policy);

      expect(result).not.toContain('Risk Rules:');
    });

    it('omits priority rules section when empty array', () => {
      const policy: ToolSelectionPolicyProjection = {
        heuristics: 'Be helpful.',
        priorityRules: [],
      };

      const result = renderToolSelectionPolicy(policy);

      expect(result).not.toContain('Priority Rules:');
    });
  });

  describe('ModelInputBuilder with toolSelectionPolicy', () => {
    it('includes policy content in Segment C when toolSelectionPolicy is provided', async () => {
      const builder = makeBuilder();
      const policy: ToolSelectionPolicyProjection = {
        heuristics: 'Direct answers preferred.',
        priorityRules: ['Read before write'],
      };

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolSelectionPolicy: policy,
      };

      const result = await builder.build(input);

      expect(result.segments.toolPlane).toContain('Tool Selection Policy:');
      expect(result.segments.toolPlane).toContain('Direct answers preferred.');
      expect(result.segments.toolPlane).toContain('Priority Rules:');
    });

    it('does not include policy in Segment A', async () => {
      const builder = makeBuilder();
      const policy: ToolSelectionPolicyProjection = {
        heuristics: 'Direct answers preferred.',
      };

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolSelectionPolicy: policy,
      };

      const result = await builder.build(input);

      expect(result.segments.staticPrefix).not.toContain('Tool Selection Policy:');
      expect(result.segments.staticPrefix).not.toContain('Direct answers preferred.');
    });

    it('does not include policy in Segment B', async () => {
      const builder = makeBuilder();
      const policy: ToolSelectionPolicyProjection = {
        heuristics: 'Direct answers preferred.',
      };

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolSelectionPolicy: policy,
      };

      const result = await builder.build(input);

      expect(result.segments.tenantProject).not.toContain('Tool Selection Policy:');
      expect(result.segments.tenantProject).not.toContain('Direct answers preferred.');
    });

    it('does not include policy in Segment D', async () => {
      const builder = makeBuilder();
      const policy: ToolSelectionPolicyProjection = {
        heuristics: 'Direct answers preferred.',
      };

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolSelectionPolicy: policy,
        currentUserMessage: 'Help me',
      };

      const result = await builder.build(input);

      expect(result.segments.contextBundle).not.toContain('Tool Selection Policy:');
      expect(result.segments.contextBundle).not.toContain('Direct answers preferred.');
    });

    it('Segment C hash stability: same toolSelectionPolicy + same toolProjection yields same hash', async () => {
      const builder = makeBuilder();
      const policy: ToolSelectionPolicyProjection = {
        heuristics: 'Be careful.',
        priorityRules: ['Rule 1'],
      };

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['tool1', 'tool2'] },
        toolSelectionPolicy: policy,
      };

      const result1 = await builder.build(input);
      const result2 = await builder.build(input);

      expect(result1.segmentHashes.segmentC).toBe(result2.segmentHashes.segmentC);
    });

    it('Segment C is unchanged when toolSelectionPolicy is not provided', async () => {
      const builder = makeBuilder();

      const input1: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['tool1'] },
      };

      const input2: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['tool1'] },
        toolSelectionPolicy: undefined,
      };

      const result1 = await builder.build(input1);
      const result2 = await builder.build(input2);

      expect(result1.segments.toolPlane).toBe(result2.segments.toolPlane);
      expect(result1.segmentHashes.segmentC).toBe(result2.segmentHashes.segmentC);
    });

    it('combines toolProjection and toolSelectionPolicy in Segment C', async () => {
      const builder = makeBuilder();
      const policy: ToolSelectionPolicyProjection = {
        heuristics: 'Use tools wisely.',
      };

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['search', 'read'] },
        toolSelectionPolicy: policy,
      };

      const result = await builder.build(input);

      expect(result.segments.toolPlane).toContain('Available Tool IDs: search, read');
      expect(result.segments.toolPlane).toContain('Tool Selection Policy:');
      expect(result.segments.toolPlane).toContain('Use tools wisely.');
    });
  });
});
