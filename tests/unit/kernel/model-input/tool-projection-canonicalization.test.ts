import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../../src/kernel/model-input/model-input-builder.js'
import { computeTemplateHash } from '../../../../src/prompt/template-hash.js'
import type { ModelInputBuildInput, SkillPlaneProjection } from '../../../../src/kernel/model-input/model-input-types.js'

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
        taxonomyLayer: 'platform',
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
        taxonomyLayer: 'platform',
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
        taxonomyLayer: 'provider',
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
        taxonomyLayer: 'provider',
        content: 'DeepSeek provider config for {agentKind}.',
        description: 'Test deepseek provider',
      },
    ],
    [
      'agentProfile:foreground',
      {
        id: 'agentProfile:foreground',
        version: '2026-05-23',
        path: 'agents/foreground.md',
        agentKind: 'foreground',
        providerFamily: '*',
        layer: 3,
        taxonomyLayer: 'agentProfile',
        agentProfile: 'foreground',
        content: 'Foreground agent instructions for {agentKind}.',
        description: 'Test foreground agent',
      },
    ],
    [
      'agentProfile:default_main',
      {
        id: 'agentProfile:default_main',
        version: '2026-05-23',
        path: 'agents/kernel.md',
        agentKind: 'kernel',
        providerFamily: '*',
        layer: 3,
        taxonomyLayer: 'agentProfile',
        agentProfile: 'default_main',
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

function makeMinimalInput(overrides: Partial<ModelInputBuildInput> = {}): ModelInputBuildInput {
  return {
    mode: 'function_calling',
    agentKind: 'foreground',
    providerFamily: 'openai',
    ...overrides,
  }
}

describe('Tool Projection Canonicalization', () => {
  describe('tool ordering stability', () => {
    it('same tool definitions in same order → same segmentC hash', async () => {
      const builder = makeBuilder()

      const toolA = {
        type: 'function' as const,
        function: {
          name: 'alpha.tool',
          description: 'Alpha tool description',
          parameters: { type: 'object' as const, properties: { x: { type: 'string' } } },
        },
      }

      const toolB = {
        type: 'function' as const,
        function: {
          name: 'beta.tool',
          description: 'Beta tool description',
          parameters: { type: 'object' as const, properties: { y: { type: 'number' } } },
        },
      }

      const result1 = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['alpha.tool', 'beta.tool'],
            tools: [toolA, toolB],
          },
        }),
      )

      const result2 = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['alpha.tool', 'beta.tool'],
            tools: [toolA, toolB],
          },
        }),
      )

      expect(result1.segmentHashes.segmentC).toBe(result2.segmentHashes.segmentC)
    })

    it('different tool ordering → different segmentC hash (order-sensitive)', async () => {
      const builder = makeBuilder()

      const result1 = await builder.build(
        makeMinimalInput({
          mode: 'routing_json',
          toolProjection: { toolIds: ['file_read', 'web_search', 'memory_retrieve'] },
        }),
      )

      const result2 = await builder.build(
        makeMinimalInput({
          mode: 'routing_json',
          toolProjection: { toolIds: ['memory_retrieve', 'file_read', 'web_search'] },
        }),
      )

      expect(result1.segmentHashes.segmentC).not.toBe(result2.segmentHashes.segmentC)
    })

    it('same toolIds in same order → same segmentC hash deterministically', async () => {
      const builder = makeBuilder()

      const results = await Promise.all([
        builder.build(
          makeMinimalInput({
            mode: 'routing_json',
            toolProjection: { toolIds: ['file_read', 'web_search'] },
          }),
        ),
        builder.build(
          makeMinimalInput({
            mode: 'routing_json',
            toolProjection: { toolIds: ['file_read', 'web_search'] },
          }),
        ),
      ])

      expect(results[0].segmentHashes.segmentC).toBe(results[1].segmentHashes.segmentC)
    })
  })

  describe('tool property ordering does not affect serialization', () => {
    it('same tool with different property order in parameters → same segmentC hash', async () => {
      const builder = makeBuilder()

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
      }

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
      }

      const result1 = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['test.tool'],
            tools: [toolWithOrder1],
          },
        }),
      )

      const result2 = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['test.tool'],
            tools: [toolWithOrder2],
          },
        }),
      )

      expect(result1.segmentHashes.segmentC).toBe(result2.segmentHashes.segmentC)
    })
  })

  describe('empty tool list stability', () => {
    it('empty toolIds in structured_json mode → empty output', async () => {
      const builder = makeBuilder()

      const result = await builder.build({
        mode: 'structured_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: [] },
      })

      expect(result.segments.toolPlane).toBe('')
    })

    it('undefined toolProjection → empty Segment C', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: undefined,
        }),
      )

      expect(result.segments.toolPlane).toBe('')
    })
  })

  describe('single tool stability', () => {
    it('single tool → stable serialization across calls', async () => {
      const builder = makeBuilder()

      const tool = {
        type: 'function' as const,
        function: {
          name: 'single.tool',
          description: 'Single tool for testing',
          parameters: { type: 'object' as const, properties: { input: { type: 'string' } } },
        },
      }

      const results = await Promise.all([
        builder.build(
          makeMinimalInput({
            toolProjection: { toolIds: ['single.tool'], tools: [tool] },
          }),
        ),
        builder.build(
          makeMinimalInput({
            toolProjection: { toolIds: ['single.tool'], tools: [tool] },
          }),
        ),
      ])

      expect(results[0].segments.toolPlane).toBe(results[1].segments.toolPlane)
      expect(results[0].segmentHashes.segmentC).toBe(results[1].segmentHashes.segmentC)
    })
  })

  describe('computeTemplateHash canonicalization', () => {
    it('same content always produces same hash', () => {
      const content = 'Available Tool IDs: file_read, web_search'
      const hash1 = computeTemplateHash(content)
      const hash2 = computeTemplateHash(content)

      expect(hash1).toBe(hash2)
    })

    it('different content produces different hash', () => {
      const hash1 = computeTemplateHash('Tools: alpha, beta')
      const hash2 = computeTemplateHash('Tools: gamma, delta')

      expect(hash1).not.toBe(hash2)
    })

    it('hash is 64-character hex string', () => {
      const hash = computeTemplateHash('test content')
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('skill projection does not affect tool hash', () => {
    it('adding skillProjection changes segmentC hash (skill is part of Segment C)', async () => {
      const builder = makeBuilder()

      const resultWithoutSkill = await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: ['file_read', 'web_search'] },
        }),
      )

      const skillProjection: SkillPlaneProjection = {
        skillIds: ['code-review'],
        renderMode: 'summary',
        skillSummaries: 'Code review skill.',
      }

      const resultWithSkill = await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: ['file_read', 'web_search'] },
          skillProjection,
        }),
      )

      expect(resultWithoutSkill.segmentHashes.segmentC).not.toBe(resultWithSkill.segmentHashes.segmentC)
    })

    it('tool schema content is preserved when skillProjection is added', async () => {
      const builder = makeBuilder()

      const tool = {
        type: 'function' as const,
        function: {
          name: 'file_read',
          description: 'Read a file from disk',
          parameters: { type: 'object' as const, properties: { path: { type: 'string' } } },
        },
      }

      const resultWithoutSkill = await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: ['file_read'], tools: [tool] },
        }),
      )

      const resultWithSkill = await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: ['file_read'], tools: [tool] },
          skillProjection: {
            skillIds: ['code-review'],
            renderMode: 'summary',
            skillSummaries: 'Code review skill.',
          },
        }),
      )

      expect(resultWithSkill.segments.toolPlane).toContain('Tool: file_read')
      expect(resultWithSkill.segments.toolPlane).toContain('Read a file from disk')
      expect(resultWithoutSkill.segments.toolPlane).toContain('Tool: file_read')
    })

    it('skill plane heading is separate from tool plane heading', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: ['file_read'] },
          skillProjection: {
            skillIds: ['code-review'],
            renderMode: 'summary',
          },
        }),
      )

      expect(result.segments.toolPlane).toContain('--- Tool Plane (callable tools) ---')
      expect(result.segments.toolPlane).toContain('--- Skill Plane (documentation only) ---')
      expect(result.segments.toolPlane).toContain('Available Tool IDs: file_read')
      expect(result.segments.toolPlane).toContain('Available Skill IDs: code-review')
    })
  })
})
