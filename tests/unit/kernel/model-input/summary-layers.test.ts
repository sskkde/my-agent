import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../../src/kernel/model-input/model-input-builder.js'
import type {
  ModelInputBuildInput,
  SummaryLayerProjection,
} from '../../../../src/kernel/model-input/model-input-types.js'
import { renderSummaryLayers } from '../../../../src/kernel/model-input/model-input-types.js'

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

describe('SummaryLayerProjection', () => {
  describe('renderSummaryLayers', () => {
    it('renders session summary', () => {
      const projection: SummaryLayerProjection = {
        session: 'Key decision: Use TypeScript for the project.',
      }

      const result = renderSummaryLayers(projection)

      expect(result).toContain('## Session Summary')
      expect(result).toContain('Key decision: Use TypeScript for the project.')
    })

    it('renders daily summary', () => {
      const projection: SummaryLayerProjection = {
        daily: 'Completed 3 major features today.',
      }

      const result = renderSummaryLayers(projection)

      expect(result).toContain('## Daily Summary')
      expect(result).toContain('Completed 3 major features today.')
    })

    it('renders weekly summary', () => {
      const projection: SummaryLayerProjection = {
        weekly: 'Productive week with 15 PRs merged.',
      }

      const result = renderSummaryLayers(projection)

      expect(result).toContain('## Weekly Summary')
      expect(result).toContain('Productive week with 15 PRs merged.')
    })

    it('renders long-term profile', () => {
      const projection: SummaryLayerProjection = {
        longTerm: 'User prefers functional programming style.',
      }

      const result = renderSummaryLayers(projection)

      expect(result).toContain('## Long-Term Profile')
      expect(result).toContain('User prefers functional programming style.')
    })

    it('renders atomic facts', () => {
      const projection: SummaryLayerProjection = {
        atomicFacts: 'User timezone is UTC+8. User uses VS Code.',
      }

      const result = renderSummaryLayers(projection)

      expect(result).toContain('## Atomic Facts')
      expect(result).toContain('User timezone is UTC+8')
    })

    it('renders multiple layers together', () => {
      const projection: SummaryLayerProjection = {
        session: 'Session content',
        daily: 'Daily content',
        weekly: 'Weekly content',
      }

      const result = renderSummaryLayers(projection)

      expect(result).toContain('## Session Summary')
      expect(result).toContain('Session content')
      expect(result).toContain('## Daily Summary')
      expect(result).toContain('Daily content')
      expect(result).toContain('## Weekly Summary')
      expect(result).toContain('Weekly content')
    })

    it('returns empty string when all fields are null', () => {
      const projection: SummaryLayerProjection = {
        session: null,
        daily: null,
      }

      const result = renderSummaryLayers(projection)

      expect(result).toBe('')
    })

    it('returns empty string when all fields are undefined', () => {
      const projection: SummaryLayerProjection = {}

      const result = renderSummaryLayers(projection)

      expect(result).toBe('')
    })

    it('skips null fields but renders defined ones', () => {
      const projection: SummaryLayerProjection = {
        session: 'Session content',
        daily: null,
        weekly: 'Weekly content',
      }

      const result = renderSummaryLayers(projection)

      expect(result).toContain('## Session Summary')
      expect(result).toContain('Session content')
      expect(result).toContain('## Weekly Summary')
      expect(result).toContain('Weekly content')
      expect(result).not.toContain('## Daily Summary')
    })
  })

  describe('ModelInputBuilder with summaryLayers', () => {
    it('includes top-level summaryLayers in Segment D when provided', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'Current session summary',
        },
      }

      const result = await builder.build(input)

      expect(result.segments.contextBundle).toContain('## Session Summary')
      expect(result.segments.contextBundle).toContain('Current session summary')
    })

    it('does not include summaryLayers in Segment A', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'Session summary',
        },
      }

      const result = await builder.build(input)

      expect(result.segments.staticPrefix).not.toContain('## Session Summary')
      expect(result.segments.staticPrefix).not.toContain('Session summary')
    })

    it('does not include summaryLayers in Segment B', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'Session summary',
        },
      }

      const result = await builder.build(input)

      expect(result.segments.tenantProject).not.toContain('## Session Summary')
      expect(result.segments.tenantProject).not.toContain('Session summary')
    })

    it('does not include summaryLayers in Segment C', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'Session summary',
        },
      }

      const result = await builder.build(input)

      expect(result.segments.toolPlane).not.toContain('## Session Summary')
      expect(result.segments.toolPlane).not.toContain('Session summary')
    })

    it('Segment D is unchanged when summaryLayers is not provided', async () => {
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
        contextBundle: {},
      }

      const result1 = await builder.build(input1)
      const result2 = await builder.build(input2)

      expect(result1.segments.contextBundle).toBe(result2.segments.contextBundle)
      expect(result1.segmentHashes.segmentD).toBe(result2.segmentHashes.segmentD)
    })

    it('Segment D hash stability: same summaryLayers yields same hash', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'Stable session content',
          daily: 'Stable daily content',
        },
      }

      const result1 = await builder.build(input)
      const result2 = await builder.build(input)

      expect(result1.segmentHashes.segmentD).toBe(result2.segmentHashes.segmentD)
    })

    it('summaryLayers appears after memoryPolicyProjection in Segment D', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        memoryPolicyProjection: {
          useRules: 'Memory rules here.',
        },
        summaryLayers: {
          session: 'Session summary here.',
        },
      }

      const result = await builder.build(input)

      const memoryPolicyIndex = result.segments.contextBundle.indexOf('Memory Policy:')
      const summaryIndex = result.segments.contextBundle.indexOf('## Session Summary')

      expect(memoryPolicyIndex).toBeLessThan(summaryIndex)
      expect(memoryPolicyIndex).toBeGreaterThanOrEqual(0)
    })

    it('summaryLayers appears before context items in Segment D', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'Session summary here.',
        },
        contextBundle: {
          orderedItems: [{ itemId: 'item1', content: 'Context item content' }],
        },
      }

      const result = await builder.build(input)

      const summaryIndex = result.segments.contextBundle.indexOf('## Session Summary')
      const contextIndex = result.segments.contextBundle.indexOf('--- Context ---')

      expect(summaryIndex).toBeLessThan(contextIndex)
      expect(summaryIndex).toBeGreaterThanOrEqual(0)
    })

    it('combines summaryLayers with contextBundle data in Segment D', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'Session summary',
          daily: 'Daily summary',
        },
        contextBundle: {
          pinnedItems: [{ itemId: 'pin1', content: 'Pinned item' }],
          orderedItems: [{ itemId: 'item1', content: 'Context item' }],
        },
        currentUserMessage: 'What do you know?',
      }

      const result = await builder.build(input)

      expect(result.segments.contextBundle).toContain('## Session Summary')
      expect(result.segments.contextBundle).toContain('Session summary')
      expect(result.segments.contextBundle).toContain('## Daily Summary')
      expect(result.segments.contextBundle).toContain('Daily summary')
      expect(result.segments.contextBundle).toContain('Pinned Context')
      expect(result.segments.contextBundle).toContain('Pinned item')
      expect(result.segments.contextBundle).toContain('--- Context ---')
      expect(result.segments.contextBundle).toContain('Context item')
      expect(result.segments.contextBundle).toContain('User Message: What do you know?')
    })

    it('falls back to contextBundle.summaryLayers when top-level is absent', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        contextBundle: {
          summaryLayers: {
            session: 'Nested session summary',
          },
        },
      }

      const result = await builder.build(input)

      expect(result.segments.contextBundle).toContain('## Session Summary')
      expect(result.segments.contextBundle).toContain('Nested session summary')
    })

    it('top-level summaryLayers takes precedence over nested', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'TOP-LEVEL session summary',
        },
        contextBundle: {
          summaryLayers: {
            session: 'NESTED session summary',
          },
        },
      }

      const result = await builder.build(input)

      expect(result.segments.contextBundle).toContain('TOP-LEVEL session summary')
      expect(result.segments.contextBundle).not.toContain('NESTED session summary')
    })
  })

  describe('Template Registry', () => {
    it('has summary:session template registered', () => {
      const registry = new PromptTemplateRegistry()
      expect(registry.hasTemplate('summary:session')).toBe(true)
    })

    it('has summary:daily template registered', () => {
      const registry = new PromptTemplateRegistry()
      expect(registry.hasTemplate('summary:daily')).toBe(true)
    })

    it('has summary:weekly template registered', () => {
      const registry = new PromptTemplateRegistry()
      expect(registry.hasTemplate('summary:weekly')).toBe(true)
    })

    it('has summary:long-term template registered', () => {
      const registry = new PromptTemplateRegistry()
      expect(registry.hasTemplate('summary:long-term')).toBe(true)
    })

    it('has summary:atomic-facts template registered', () => {
      const registry = new PromptTemplateRegistry()
      expect(registry.hasTemplate('summary:atomic-facts')).toBe(true)
    })

    it('all summary templates are layer 7', () => {
      const registry = new PromptTemplateRegistry()
      const summaryTemplates = registry.getTemplatesByLayer(7).filter((t) => t.id.startsWith('summary:'))

      expect(summaryTemplates).toHaveLength(5)
      summaryTemplates.forEach((t) => {
        expect(t.layer).toBe(7)
        expect(t.agentKind).toBe('*')
        expect(t.providerFamily).toBe('*')
      })
    })
  })
})
