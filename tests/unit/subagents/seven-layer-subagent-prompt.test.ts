import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import type { SubagentDefinition } from '../../../src/subagents/registry.js'
import type { SubagentTaskSpec } from '../../../src/subagents/types.js'
import { buildSevenLayerModelInput } from '../../../src/subagents/context-manager.js'

const researchProcessorDef: SubagentDefinition = {
  agentType: 'research_processor',
  agentProfile: 'research_processor',
  displayName: '研究检索',
  description: '执行深度研究检索，包括多源信息聚合、分析和综合报告生成。',
  modality: 'text',
  promptId: 'agentProfile:research_processor',
  allowedToolIds: ['web_search', 'web_fetch', 'docs_search', 'artifact_create', 'artifact_update'],
  defaultMaxIterations: 10,
  defaultTimeoutMs: 180_000,
  supportedExecutionModes: ['sync', 'background'],
  canRunInBackground: true,
  providerPolicy: {
    requiredCapabilities: ['text', 'function_calling', 'long_context'],
    fallbackMode: 'any_compatible',
  },
  permissionProfile: 'ask_on_write',
  summaryPolicy: {
    returnMode: 'summary_with_artifacts',
    maxSummaryTokens: 1800,
  },
}

function buildSystemPrompt(promptId: string, objective: string, definition: SubagentDefinition): string {
  const lines: string[] = []
  lines.push(`You are a "${definition.agentType}" subagent (${definition.displayName}).`)
  lines.push(definition.description)
  lines.push('')
  lines.push('## Objective')
  lines.push(objective)
  lines.push('')
  lines.push(`Prompt ID: ${promptId}`)
  if (definition.allowedToolIds.length > 0) {
    lines.push('')
    lines.push('## Allowed Tools')
    lines.push(definition.allowedToolIds.join(', '))
  }
  lines.push('')
  lines.push('## Configuration')
  lines.push(`Execution modes: ${definition.supportedExecutionModes.join(', ')}`)
  lines.push(`Max iterations: ${definition.defaultMaxIterations}`)
  lines.push(`Timeout: ${definition.defaultTimeoutMs}ms`)
  return lines.join('\n')
}

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
        content: 'Platform base rules.',
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
        content: 'Safety rules.',
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
        content: 'OpenAI provider config.',
        description: 'Test openai provider',
      },
    ],
    [
      'agentProfile:research_processor',
      {
        id: 'agentProfile:research_processor',
        version: '2026-05-23',
        path: 'agentProfile/research_processor.md',
        agentKind: 'research_processor',
        providerFamily: '*',
        layer: 3,
        taxonomyLayer: 'agentProfile',
        agentProfile: 'research_processor',
        content: '执行深度研究检索，包括多源信息聚合、分析和综合报告生成。',
        description: 'Research processor agent profile',
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

describe('Seven-layer subagent prompt - research_processor proof path', () => {
  const objective = 'Analyze the latest AI research papers and produce a summary report'
  const taskSpec: SubagentTaskSpec = {
    objective,
    tools: ['web_search', 'web_fetch'],
    maxIterations: 10,
  }

  describe('parity with old buildSystemPrompt()', () => {
    it('preserves role identification', async () => {
      const builder = makeBuilder()
      const result = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder,
      })

      const oldPrompt = buildSystemPrompt(researchProcessorDef.promptId, objective, researchProcessorDef)
      expect(oldPrompt).toContain('research_processor')
      expect(oldPrompt).toContain('研究检索')

      expect(result.segments.tenantProject).toContain('research_processor')
      expect(result.segments.tenantProject).toContain('研究检索')
    })

    it('preserves allowed tools', async () => {
      const builder = makeBuilder()
      const result = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder,
      })

      const oldPrompt = buildSystemPrompt(researchProcessorDef.promptId, objective, researchProcessorDef)
      expect(oldPrompt).toContain('web_search, web_fetch, docs_search, artifact_create, artifact_update')

      expect(result.segments.toolPlane).toContain('web_search')
      expect(result.segments.toolPlane).toContain('web_fetch')
      expect(result.segments.toolPlane).toContain('docs_search')
      expect(result.segments.toolPlane).toContain('artifact_create')
      expect(result.segments.toolPlane).toContain('artifact_update')
    })

    it('preserves task context (objective)', async () => {
      const builder = makeBuilder()
      const result = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder,
      })

      const oldPrompt = buildSystemPrompt(researchProcessorDef.promptId, objective, researchProcessorDef)
      expect(oldPrompt).toContain(objective)

      expect(result.segments.contextBundle).toContain(objective)
    })

    it('preserves output expectations in metadata', async () => {
      const builder = makeBuilder()
      const result = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder,
      })

      expect(result.metadata.agentType).toBe('subagent')
      expect(result.metadata.agentProfile).toBe('research_processor')
      expect(result.metadata.providerFamily).toBe('openai')
    })

    it('preserves agent description in Layer 3 template', async () => {
      const builder = makeBuilder()
      const result = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder,
      })

      expect(result.segments.staticPrefix).toContain('执行深度研究检索')
    })
  })

  describe('protected layers are separated', () => {
    it('Segment A does NOT contain objective', async () => {
      const builder = makeBuilder()
      const result = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder,
      })

      expect(result.segments.staticPrefix).not.toContain(objective)
    })

    it('Segment B does NOT contain tools', async () => {
      const builder = makeBuilder()
      const result = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder,
      })

      expect(result.segments.tenantProject).not.toContain('web_search')
      expect(result.segments.tenantProject).not.toContain('web_fetch')
    })

    it('Segment C does NOT contain role or objective', async () => {
      const builder = makeBuilder()
      const result = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder,
      })

      expect(result.segments.toolPlane).not.toContain('research_processor')
      expect(result.segments.toolPlane).not.toContain(objective)
    })

    it('Segment D does NOT contain platform rules', async () => {
      const builder = makeBuilder()
      const result = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder,
      })

      expect(result.segments.contextBundle).not.toContain('Platform base rules')
      expect(result.segments.contextBundle).not.toContain('Safety rules')
    })
  })

  describe('seven-layer structure', () => {
    it('produces all four segments', async () => {
      const builder = makeBuilder()
      const result = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder,
      })

      expect(result.segments.staticPrefix).toBeDefined()
      expect(result.segments.tenantProject).toBeDefined()
      expect(result.segments.toolPlane).toBeDefined()
      expect(result.segments.contextBundle).toBeDefined()
    })

    it('produces valid segment hashes', async () => {
      const builder = makeBuilder()
      const result = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder,
      })

      expect(result.segmentHashes.segmentA).toMatch(/^[a-f0-9]{64}$/)
      expect(result.segmentHashes.segmentB).toMatch(/^[a-f0-9]{64}$/)
      expect(result.segmentHashes.segmentC).toMatch(/^[a-f0-9]{64}$/)
      expect(result.segmentHashes.segmentD).toMatch(/^[a-f0-9]{64}$/)
    })

    it('produces LLM messages in correct segment order', async () => {
      const builder = makeBuilder()
      const result = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder,
      })

      const messages = result.messages
      expect(messages.length).toBeGreaterThanOrEqual(3)

      const systemMessages = messages.filter((m) => m.role === 'system')
      const userMessages = messages.filter((m) => m.role === 'user')

      expect(systemMessages.length).toBeGreaterThanOrEqual(2)
      expect(userMessages.length).toBeGreaterThanOrEqual(1)
    })

    it('Segment A hash is stable across calls', async () => {
      const builder1 = makeBuilder()
      const result1 = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder1,
      })

      const builder2 = makeBuilder()
      const result2 = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec: { ...taskSpec, objective: 'Different objective' },
        providerFamily: 'openai',
        modelInputBuilder: builder2,
      })

      expect(result1.segmentHashes.segmentA).toBe(result2.segmentHashes.segmentA)
    })

    it('Segment D hash changes when objective changes', async () => {
      const builder1 = makeBuilder()
      const result1 = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder: builder1,
      })

      const builder2 = makeBuilder()
      const result2 = await buildSevenLayerModelInput({
        definition: researchProcessorDef,
        taskSpec: { ...taskSpec, objective: 'Completely different objective' },
        providerFamily: 'openai',
        modelInputBuilder: builder2,
      })

      expect(result1.segmentHashes.segmentD).not.toBe(result2.segmentHashes.segmentD)
    })
  })
})
