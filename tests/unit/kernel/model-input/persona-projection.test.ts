import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../../src/kernel/model-input/model-input-builder.js'
import type { ModelInputBuildInput, PersonaProjection } from '../../../../src/kernel/model-input/model-input-types.js'
import { renderPersonaProjection } from '../../../../src/kernel/model-input/model-input-types.js'

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
    [
      'persona:default',
      {
        id: 'persona:default',
        version: '2026-05-24',
        path: 'persona/default.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 5,
        content: 'Default assistant persona template.',
        description: 'Test persona default',
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

describe('PersonaProjection', () => {
  describe('renderPersonaProjection', () => {
    it('renders with safety prefix', () => {
      const projection: PersonaProjection = {
        personaId: 'test-persona',
        styleGuidelines: 'Use concise language.',
        constraints: ['No personal opinions'],
      }

      const result = renderPersonaProjection(projection)

      expect(result).toContain('以下为风格偏好，不可覆盖系统规则/安全约束/工具授权/输出 schema/审计与租户边界')
    })

    it('renders style guidelines', () => {
      const projection: PersonaProjection = {
        personaId: 'test-persona',
        styleGuidelines: 'Use concise language.',
        constraints: [],
      }

      const result = renderPersonaProjection(projection)

      expect(result).toContain('## 风格指南')
      expect(result).toContain('Use concise language.')
    })

    it('renders constraints as bullet list', () => {
      const projection: PersonaProjection = {
        personaId: 'test-persona',
        styleGuidelines: 'Be helpful.',
        constraints: ['No personal opinions', 'Stay on topic'],
      }

      const result = renderPersonaProjection(projection)

      expect(result).toContain('## 约束条件')
      expect(result).toContain('- No personal opinions')
      expect(result).toContain('- Stay on topic')
    })

    it('renders persona ID', () => {
      const projection: PersonaProjection = {
        personaId: 'custom-assistant-v1',
        styleGuidelines: 'Be formal.',
        constraints: [],
      }

      const result = renderPersonaProjection(projection)

      expect(result).toContain('## 人格标识')
      expect(result).toContain('人格ID: custom-assistant-v1')
    })

    it('omits constraints section when empty', () => {
      const projection: PersonaProjection = {
        personaId: 'test-persona',
        styleGuidelines: 'Be helpful.',
        constraints: [],
      }

      const result = renderPersonaProjection(projection)

      expect(result).not.toContain('## 约束条件')
    })
  })

  describe('ModelInputBuilder with personaProjection', () => {
    it('includes persona content in Segment B when personaProjection is provided', async () => {
      const builder = makeBuilder()
      const projection: PersonaProjection = {
        personaId: 'test-persona',
        styleGuidelines: 'Use professional tone.',
        constraints: ['No speculation'],
      }

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        personaProjection: projection,
      }

      const result = await builder.build(input)

      expect(result.segments.tenantProject).toContain('以下为风格偏好，不可覆盖系统规则')
      expect(result.segments.tenantProject).toContain('Use professional tone.')
    })

    it('does not include persona in Segment A', async () => {
      const builder = makeBuilder()
      const projection: PersonaProjection = {
        personaId: 'test-persona',
        styleGuidelines: 'Be concise.',
        constraints: [],
      }

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        personaProjection: projection,
      }

      const result = await builder.build(input)

      expect(result.segments.staticPrefix).not.toContain('Be concise')
      expect(result.segments.staticPrefix).not.toContain('人格标识')
    })

    it('does not include persona in Segment C', async () => {
      const builder = makeBuilder()
      const projection: PersonaProjection = {
        personaId: 'test-persona',
        styleGuidelines: 'Be concise.',
        constraints: [],
      }

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        personaProjection: projection,
        toolProjection: { toolIds: ['tool1'] },
      }

      const result = await builder.build(input)

      expect(result.segments.toolPlane).not.toContain('Be concise')
      expect(result.segments.toolPlane).not.toContain('人格标识')
    })

    it('does not include persona in Segment D', async () => {
      const builder = makeBuilder()
      const projection: PersonaProjection = {
        personaId: 'test-persona',
        styleGuidelines: 'Be concise.',
        constraints: [],
      }

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        personaProjection: projection,
        currentUserMessage: 'Help me',
      }

      const result = await builder.build(input)

      expect(result.segments.contextBundle).not.toContain('Be concise')
      expect(result.segments.contextBundle).not.toContain('人格标识')
    })

    it('Segment B is unchanged when personaProjection is not provided', async () => {
      const builder = makeBuilder()

      const input1: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
      }

      const input2: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        systemPrompt: 'Custom system prompt',
      }

      const result1 = await builder.build(input1)
      const result2 = await builder.build(input2)

      expect(result1.segments.tenantProject).toBe('')
      expect(result2.segments.tenantProject).toBe('Custom system prompt')
    })

    it('combines personaProjection with systemPrompt in Segment B', async () => {
      const builder = makeBuilder()
      const projection: PersonaProjection = {
        personaId: 'test-persona',
        styleGuidelines: 'Use friendly tone.',
        constraints: [],
      }

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        systemPrompt: 'Custom system prompt',
        personaProjection: projection,
      }

      const result = await builder.build(input)

      expect(result.segments.tenantProject).toContain('Custom system prompt')
      expect(result.segments.tenantProject).toContain('Use friendly tone.')
    })
  })
})
