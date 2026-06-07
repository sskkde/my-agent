import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../../src/kernel/model-input/model-input-builder.js'
import type {
  ModelInputBuildInput,
  MemoryPolicyProjection,
} from '../../../../src/kernel/model-input/model-input-types.js'
import { renderMemoryPolicyProjection } from '../../../../src/kernel/model-input/model-input-types.js'

function makeTestTemplates(): Map<string, PromptTemplateRecord> {
  return new Map([
    [
      'platform:base',
      {
        id: 'platform:base',
        version: '2026-05-23',
        path: 'platform/base.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 1,
        content: 'Platform Base for {agentKind} agent with {providerFamily} provider.',
        description: 'Test platform base',
      },
    ],
    [
      'platform:safety',
      {
        id: 'platform:safety',
        version: '2026-05-23',
        path: 'platform/safety.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 1,
        content: 'Safety rules for {agentKind}.',
        description: 'Test safety',
      },
    ],
    [
      'provider:openai',
      {
        id: 'provider:openai',
        version: '2026-05-23',
        path: 'provider/openai.md',
        agentKind: '*',
        providerFamily: 'openai',
        layer: 2,
        content: 'OpenAI provider config for {agentKind}.',
        description: 'Test openai provider',
      },
    ],
    [
      'provider:deepseek',
      {
        id: 'provider:deepseek',
        version: '2026-05-23',
        path: 'provider/deepseek.md',
        agentKind: '*',
        providerFamily: 'deepseek',
        layer: 2,
        content: 'DeepSeek provider config for {agentKind}.',
        description: 'Test deepseek provider',
      },
    ],
    [
      'agents:foreground',
      {
        id: 'agents:foreground',
        version: '2026-05-23',
        path: 'agents/foreground.md',
        agentKind: 'foreground',
        providerFamily: '*',
        layer: 3,
        content: 'Foreground agent instructions for {agentKind}.',
        description: 'Test foreground agent',
      },
    ],
    [
      'agents:kernel',
      {
        id: 'agents:kernel',
        version: '2026-05-23',
        path: 'agents/kernel.md',
        agentKind: 'kernel',
        providerFamily: '*',
        layer: 3,
        content: 'Kernel agent instructions for {agentKind}.',
        description: 'Test kernel agent',
      },
    ],
    [
      'output:foreground.schema',
      {
        id: 'output:foreground.schema',
        version: '2026-05-23',
        path: 'output/foreground.schema.md',
        agentKind: 'foreground',
        providerFamily: '*',
        layer: 4,
        content: 'Output schema for {agentKind} with {providerFamily}.',
        description: 'Test foreground schema',
      },
    ],
    [
      'output:planner.schema',
      {
        id: 'output:planner.schema',
        version: '2026-05-23',
        path: 'output/planner.schema.md',
        agentKind: 'planner',
        providerFamily: '*',
        layer: 4,
        content: 'Planner output schema for {agentKind}.',
        description: 'Test planner schema',
      },
    ],
  ])
}

function makeBuilder(): ModelInputBuilder {
  const templates = makeTestTemplates()
  const registry = new PromptTemplateRegistry(templates, '/nonexistent')
  const loader = new TemplateLoader('/nonexistent')
  return new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })
}

describe('MemoryPolicyProjection', () => {
  describe('renderMemoryPolicyProjection', () => {
    it('renders useRules', () => {
      const policy: MemoryPolicyProjection = {
        useRules: 'Memory is private background context.',
      }

      const result = renderMemoryPolicyProjection(policy)

      expect(result).toContain('Memory Policy:')
      expect(result).toContain('Memory is private background context.')
    })

    it('renders invisibility rules as bullet list', () => {
      const policy: MemoryPolicyProjection = {
        useRules: 'Be careful.',
        invisibilityRules: ['Never mention memory directly', 'No "I remember" phrases'],
      }

      const result = renderMemoryPolicyProjection(policy)

      expect(result).toContain('Invisibility Rules:')
      expect(result).toContain('- Never mention memory directly')
      expect(result).toContain('- No "I remember" phrases')
    })

    it('renders priority rules as bullet list', () => {
      const policy: MemoryPolicyProjection = {
        useRules: 'Prioritize well.',
        priorityRules: ['Current conversation first', 'Recent memories over old ones'],
      }

      const result = renderMemoryPolicyProjection(policy)

      expect(result).toContain('Priority Rules:')
      expect(result).toContain('- Current conversation first')
      expect(result).toContain('- Recent memories over old ones')
    })

    it('omits invisibility rules section when not provided', () => {
      const policy: MemoryPolicyProjection = {
        useRules: 'Be helpful.',
      }

      const result = renderMemoryPolicyProjection(policy)

      expect(result).not.toContain('Invisibility Rules:')
    })

    it('omits priority rules section when not provided', () => {
      const policy: MemoryPolicyProjection = {
        useRules: 'Be helpful.',
      }

      const result = renderMemoryPolicyProjection(policy)

      expect(result).not.toContain('Priority Rules:')
    })

    it('omits invisibility rules section when empty array', () => {
      const policy: MemoryPolicyProjection = {
        useRules: 'Be helpful.',
        invisibilityRules: [],
      }

      const result = renderMemoryPolicyProjection(policy)

      expect(result).not.toContain('Invisibility Rules:')
    })

    it('token budget constraint: rendered text ≤ 480 characters (120 tokens estimate)', () => {
      const policy: MemoryPolicyProjection = {
        useRules:
          'Memory is private background context. Default is not to say "I remember" or "according to my memory". Memory is only used to enhance continuity and assumption calibration. Current conversation takes priority over old memories. No over-evidence inference. Only cite carefully when user explicitly asks.',
        priorityRules: ['Current conversation first', 'Explicit user request required for citation'],
        invisibilityRules: ['No "I remember"', 'No "according to my memory"'],
      }

      const result = renderMemoryPolicyProjection(policy)

      expect(result.length).toBeLessThanOrEqual(480)
    })
  })

  describe('ModelInputBuilder with memoryPolicyProjection', () => {
    it('includes policy content in Segment D when memoryPolicyProjection is provided', async () => {
      const builder = makeBuilder()
      const policy: MemoryPolicyProjection = {
        useRules: 'Memory is private background context.',
        priorityRules: ['Current conversation first'],
      }

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        memoryPolicyProjection: policy,
      }

      const result = await builder.build(input)

      expect(result.segments.contextBundle).toContain('Memory Policy:')
      expect(result.segments.contextBundle).toContain('Memory is private background context.')
      expect(result.segments.contextBundle).toContain('Priority Rules:')
    })

    it('does not include policy in Segment A', async () => {
      const builder = makeBuilder()
      const policy: MemoryPolicyProjection = {
        useRules: 'Memory is private background context.',
      }

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        memoryPolicyProjection: policy,
      }

      const result = await builder.build(input)

      expect(result.segments.staticPrefix).not.toContain('Memory Policy:')
      expect(result.segments.staticPrefix).not.toContain('Memory is private background context.')
    })

    it('does not include policy in Segment B', async () => {
      const builder = makeBuilder()
      const policy: MemoryPolicyProjection = {
        useRules: 'Memory is private background context.',
      }

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        memoryPolicyProjection: policy,
      }

      const result = await builder.build(input)

      expect(result.segments.tenantProject).not.toContain('Memory Policy:')
      expect(result.segments.tenantProject).not.toContain('Memory is private background context.')
    })

    it('does not include policy in Segment C', async () => {
      const builder = makeBuilder()
      const policy: MemoryPolicyProjection = {
        useRules: 'Memory is private background context.',
      }

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        memoryPolicyProjection: policy,
      }

      const result = await builder.build(input)

      expect(result.segments.toolPlane).not.toContain('Memory Policy:')
      expect(result.segments.toolPlane).not.toContain('Memory is private background context.')
    })

    it('Segment D hash stability: same memoryPolicyProjection yields same hash', async () => {
      const builder = makeBuilder()
      const policy: MemoryPolicyProjection = {
        useRules: 'Be careful.',
        priorityRules: ['Rule 1'],
      }

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        memoryPolicyProjection: policy,
      }

      const result1 = await builder.build(input)
      const result2 = await builder.build(input)

      expect(result1.segmentHashes.segmentD).toBe(result2.segmentHashes.segmentD)
    })

    it('Segment D is unchanged when memoryPolicyProjection is not provided', async () => {
      const builder = makeBuilder()

      const input1: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        currentUserMessage: 'Help me',
      }

      const input2: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        currentUserMessage: 'Help me',
        memoryPolicyProjection: undefined,
      }

      const result1 = await builder.build(input1)
      const result2 = await builder.build(input2)

      expect(result1.segments.contextBundle).toBe(result2.segments.contextBundle)
      expect(result1.segmentHashes.segmentD).toBe(result2.segmentHashes.segmentD)
    })

    it('policy appears at the beginning of Segment D before other content', async () => {
      const builder = makeBuilder()
      const policy: MemoryPolicyProjection = {
        useRules: 'Memory rules first.',
      }

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        memoryPolicyProjection: policy,
        currentDate: '2026-05-24',
        sessionId: 'session-123',
      }

      const result = await builder.build(input)

      const memoryPolicyIndex = result.segments.contextBundle.indexOf('Memory Policy:')
      const currentDateIndex = result.segments.contextBundle.indexOf('Current Date:')

      expect(memoryPolicyIndex).toBeLessThan(currentDateIndex)
      expect(memoryPolicyIndex).toBe(0)
    })

    it('combines memoryPolicyProjection with contextBundle data in Segment D', async () => {
      const builder = makeBuilder()
      const policy: MemoryPolicyProjection = {
        useRules: 'Use memory wisely.',
      }

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        memoryPolicyProjection: policy,
        contextBundle: {
          pinnedItems: [{ itemId: 'pin1', content: 'Important fact' }],
        },
        currentUserMessage: 'What do you know?',
      }

      const result = await builder.build(input)

      expect(result.segments.contextBundle).toContain('Memory Policy:')
      expect(result.segments.contextBundle).toContain('Use memory wisely.')
      expect(result.segments.contextBundle).toContain('Pinned Context')
      expect(result.segments.contextBundle).toContain('Important fact')
      expect(result.segments.contextBundle).toContain('User Message: What do you know?')
    })
  })
})
