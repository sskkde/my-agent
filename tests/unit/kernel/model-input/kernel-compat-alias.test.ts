/**
 * kernel-compat-alias.test.ts
 *
 * Verifies that the deprecated `agentKind: 'kernel'` alias routes through the
 * normalizer to `agentType: 'main', agentProfile: 'default_main'` and produces
 * compatible output with the explicit taxonomy path.
 *
 * Task 9: Route AgentKernel.buildLLMRequest() default through normalizer.
 */
import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../../src/kernel/model-input/model-input-builder.js'
import type { ModelInputBuildInput } from '../../../../src/kernel/model-input/model-input-types.js'

function makeKernelTestTemplates(): Map<string, PromptTemplateRecord> {
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
        content: 'Platform Base rules for {agentKind}.',
        description: 'Platform base',
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
        content: 'Safety rules.',
        description: 'Safety',
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
        content: 'OpenAI provider for {agentKind}.',
        description: 'OpenAI provider',
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
        content: 'Kernel agent template for {agentKind}.',
        description: 'Kernel agent template',
      },
    ],
  ])
}

function makeBuilder(): ModelInputBuilder {
  const templates = makeKernelTestTemplates()
  const registry = new PromptTemplateRegistry(templates, '/nonexistent')
  const loader = new TemplateLoader('/nonexistent')
  return new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })
}

describe('kernel compat alias (Task 9)', () => {
  describe('deprecated agentKind: kernel resolves to main/default_main', () => {
    it('legacy agentKind: kernel normalizes metadata to agentType=main, agentProfile=default_main', async () => {
      const builder = makeBuilder()
      const input: ModelInputBuildInput = {
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
      }

      const result = await builder.build(input)

      expect(result.metadata.agentType).toBe('main')
      expect(result.metadata.agentProfile).toBe('default_main')
    })

    it('explicit agentType+agentProfile produces same metadata taxonomy', async () => {
      const builder = makeBuilder()
      const input: ModelInputBuildInput = {
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      }

      const result = await builder.build(input)

      expect(result.metadata.agentType).toBe('main')
      expect(result.metadata.agentProfile).toBe('default_main')
    })

    it('both paths resolve to identical agentType and agentProfile', async () => {
      const builder = makeBuilder()

      const legacyResult = await builder.build({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
      })

      const explicitResult = await builder.build({
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      })

      expect(legacyResult.metadata.agentType).toBe(explicitResult.metadata.agentType)
      expect(legacyResult.metadata.agentProfile).toBe(explicitResult.metadata.agentProfile)
    })
  })

  describe('legacy kernel alias resolves kernel template for Segment A', () => {
    it('agentKind: kernel includes kernel template content in staticPrefix', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
      })

      expect(result.segments.staticPrefix).toContain('Kernel agent template')
    })

    it('explicit agentType+agentProfile with agentKind: kernel produces same staticPrefix', async () => {
      const builder = makeBuilder()

      const legacyResult = await builder.build({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
      })

      const explicitResult = await builder.build({
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        agentKind: 'kernel',
        providerFamily: 'openai',
      })

      expect(explicitResult.segments.staticPrefix).toBe(legacyResult.segments.staticPrefix)
      expect(explicitResult.segmentHashes.segmentA).toBe(legacyResult.segmentHashes.segmentA)
    })
  })

  describe('Segment A hash stability across both paths', () => {
    it('agentKind: kernel produces stable hash across invocations', async () => {
      const builder = makeBuilder()
      const input: ModelInputBuildInput = {
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
      }

      const result1 = await builder.build(input)
      const result2 = await builder.build(input)

      expect(result1.segmentHashes.segmentA).toBe(result2.segmentHashes.segmentA)
    })

    it('kernel alias and explicit taxonomy with agentKind produce identical segmentA hash', async () => {
      const builder = makeBuilder()

      const legacyResult = await builder.build({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
      })

      const explicitResult = await builder.build({
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        agentKind: 'kernel',
        providerFamily: 'openai',
      })

      expect(legacyResult.segmentHashes.segmentA).toBe(explicitResult.segmentHashes.segmentA)
    })
  })

  describe('both paths produce valid BuiltModelInput', () => {
    it('legacy kernel path produces valid messages', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
      })

      expect(result.messages).toBeDefined()
      expect(Array.isArray(result.messages)).toBe(true)
      expect(result.segments).toBeDefined()
      expect(result.segmentHashes).toBeDefined()
      expect(result.metadata).toBeDefined()
    })

    it('explicit main/default_main path produces valid messages', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        agentKind: 'kernel',
        providerFamily: 'openai',
      })

      expect(result.messages).toBeDefined()
      expect(Array.isArray(result.messages)).toBe(true)
      expect(result.segments).toBeDefined()
      expect(result.segmentHashes).toBeDefined()
      expect(result.metadata).toBeDefined()
    })

    it('both paths produce same message count for same additional inputs', async () => {
      const builder = makeBuilder()
      const sharedOverrides = {
        mode: 'function_calling' as const,
        providerFamily: 'openai',
        systemPrompt: 'Test prompt',
        toolProjection: { toolIds: ['file_read'] },
        currentUserMessage: 'Hello',
      }

      const legacyResult = await builder.build({
        agentKind: 'kernel',
        ...sharedOverrides,
      })

      const explicitResult = await builder.build({
        agentType: 'main' as const,
        agentProfile: 'default_main',
        agentKind: 'kernel',
        ...sharedOverrides,
      })

      expect(legacyResult.messages.length).toBe(explicitResult.messages.length)
      expect(legacyResult.segments.tenantProject).toBe(explicitResult.segments.tenantProject)
      expect(legacyResult.segments.toolPlane).toBe(explicitResult.segments.toolPlane)
      expect(legacyResult.segments.contextBundle).toBe(explicitResult.segments.contextBundle)
    })
  })
})
