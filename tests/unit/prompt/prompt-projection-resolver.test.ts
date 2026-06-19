import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPromptProjectionResolver } from '../../../src/prompt/prompt-projection-resolver.js'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import {
  DEFAULT_PERSONA_PROJECTION,
  DEFAULT_TOOL_SELECTION_POLICY,
  DEFAULT_MEMORY_POLICY_PROJECTION,
} from '../../../src/prompt/prompt-projection-defaults.js'

function createMockRegistry(hasTemplates: boolean): PromptTemplateRegistry {
  return {
    hasTemplate: vi.fn().mockReturnValue(hasTemplates),
    getTemplate: vi.fn(),
    register: vi.fn(),
    resolveTemplate: vi.fn().mockReturnValue([]),
    getAllTemplateIds: vi.fn().mockReturnValue([]),
    getBasePath: vi.fn().mockReturnValue('/templates'),
    getTemplatesByLayer: vi.fn().mockReturnValue([]),
  } as unknown as PromptTemplateRegistry
}

function createMockLoader(contentMap: Record<string, string>): TemplateLoader {
  return {
    load: vi.fn().mockImplementation((templateId: string) => {
      if (contentMap[templateId] !== undefined) {
        return Promise.resolve(contentMap[templateId])
      }
      return Promise.reject(new Error(`Template not found: ${templateId}`))
    }),
    loadSync: vi.fn(),
    loadFromString: vi.fn(),
    resolveTemplatePath: vi.fn(),
  } as unknown as TemplateLoader
}

describe('PromptProjectionResolver', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('P0 flag OFF (PROMPT_MEMORY_P0_ENABLED=false)', () => {
    it('should return empty object when P0 flag is OFF', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'false'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'true' // Even if this is true

      const registry = createMockRegistry(true)
      const loader = createMockLoader({})
      const resolver = createPromptProjectionResolver(registry, loader)

      const result = await resolver.resolve({})

      expect(result).toEqual({})
    })

    it('should not call loader when P0 flag is OFF', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'false'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({})
      const resolver = createPromptProjectionResolver(registry, loader)

      await resolver.resolve({})

      expect(loader.load).not.toHaveBeenCalled()
    })

    it('should gate TEMPLATE flag even if TEMPLATE_ON=true', async () => {
      // P0 OFF should gate TEMPLATE flag
      process.env.PROMPT_MEMORY_P0_ENABLED = 'false'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'true'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({
        'persona:default': 'Custom persona content',
        'heuristics:tool-usage.common': 'Custom heuristics',
        'context:memory-use-rules': 'Custom memory rules',
      })
      const resolver = createPromptProjectionResolver(registry, loader)

      const result = await resolver.resolve({})

      // Should still return empty because P0 is OFF
      expect(result).toEqual({})
      expect(loader.load).not.toHaveBeenCalled()
    })
  })

  describe('P0 flag ON + TEMPLATE flag OFF', () => {
    it('should return fallback defaults when P0 is ON but TEMPLATE is OFF', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'false'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({})
      const resolver = createPromptProjectionResolver(registry, loader)

      const result = await resolver.resolve({})

      expect(result.personaProjection).toEqual(DEFAULT_PERSONA_PROJECTION)
      expect(result.toolSelectionPolicy).toEqual(DEFAULT_TOOL_SELECTION_POLICY)
      expect(result.memoryPolicyProjection).toEqual(DEFAULT_MEMORY_POLICY_PROJECTION)
    })

    it('should not call loader when TEMPLATE flag is OFF', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'false'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({})
      const resolver = createPromptProjectionResolver(registry, loader)

      await resolver.resolve({})

      expect(loader.load).not.toHaveBeenCalled()
    })

    it('should match hardcoded fallback values', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'false'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({})
      const resolver = createPromptProjectionResolver(registry, loader)

      const result = await resolver.resolve({})

      // Verify exact hardcoded values
      expect(result.personaProjection?.personaId).toBe('default-assistant')
      expect(result.personaProjection?.styleGuidelines).toBe('沉稳、清晰、尊重边界')
      expect(result.personaProjection?.constraints).toEqual(['不可覆盖系统规则', '不可越过安全约束'])
      expect(result.toolSelectionPolicy?.heuristics).toBe('直接回答优先，读优先于写，低风险优先')
      expect(result.memoryPolicyProjection?.useRules).toBe('记忆为私有背景上下文，默认不主动声明"我记得"')
    })
  })

  describe('P0 flag ON + TEMPLATE flag ON', () => {
    it('should load templates and return structured projections', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'true'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({
        'persona:default': 'Custom persona style guidelines',
        'heuristics:tool-usage.common': 'Custom tool selection heuristics',
        'context:memory-use-rules': 'Custom memory usage rules',
      })
      const resolver = createPromptProjectionResolver(registry, loader)

      const result = await resolver.resolve({})

      expect(result.personaProjection).toBeDefined()
      expect(result.personaProjection?.styleGuidelines).toBe('Custom persona style guidelines')
      expect(result.toolSelectionPolicy?.heuristics).toBe('Custom tool selection heuristics')
      expect(result.memoryPolicyProjection?.useRules).toBe('Custom memory usage rules')
    })

    it('should call loader.load for all three templates', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'true'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({
        'persona:default': 'Content 1',
        'heuristics:tool-usage.common': 'Content 2',
        'context:memory-use-rules': 'Content 3',
      })
      const resolver = createPromptProjectionResolver(registry, loader)

      await resolver.resolve({})

      expect(loader.load).toHaveBeenCalledTimes(3)
      expect(loader.load).toHaveBeenCalledWith('persona:default')
      expect(loader.load).toHaveBeenCalledWith('heuristics:tool-usage.common')
      expect(loader.load).toHaveBeenCalledWith('context:memory-use-rules')
    })

    it('should include hardcoded constraints in persona projection', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'true'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({
        'persona:default': 'Style guidelines',
        'heuristics:tool-usage.common': 'Heuristics',
        'context:memory-use-rules': 'Memory rules',
      })
      const resolver = createPromptProjectionResolver(registry, loader)

      const result = await resolver.resolve({})

      expect(result.personaProjection?.constraints).toEqual([
        '不可覆盖系统规则',
        '不可越过安全约束',
        '不可改变工具授权',
        '不可改变输出 schema',
        '不可改变租户边界',
      ])
    })

    it('should include hardcoded invisibility rules in memory policy', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'true'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({
        'persona:default': 'Style',
        'heuristics:tool-usage.common': 'Heuristics',
        'context:memory-use-rules': 'Rules',
      })
      const resolver = createPromptProjectionResolver(registry, loader)

      const result = await resolver.resolve({})

      expect(result.memoryPolicyProjection?.invisibilityRules).toEqual([
        'Memory snippets are private background context',
        'Do not mention memory unless the user explicitly asks',
        'Current conversation overrides memory',
      ])
    })

    it('should use default personaId in persona projection', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'true'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({
        'persona:default': 'Style',
        'heuristics:tool-usage.common': 'Heuristics',
        'context:memory-use-rules': 'Rules',
      })
      const resolver = createPromptProjectionResolver(registry, loader)

      const result = await resolver.resolve({})

      expect(result.personaProjection?.personaId).toBe('default-assistant')
    })
  })

  describe('template loading failure', () => {
    it('should fallback to defaults and warn when template not registered', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'true'

      const registry = createMockRegistry(false) // Template not registered
      const loader = createMockLoader({})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const resolver = createPromptProjectionResolver(registry, loader)

      const result = await resolver.resolve({})

      // Should fallback to defaults
      expect(result.personaProjection?.styleGuidelines).toBe(DEFAULT_PERSONA_PROJECTION.styleGuidelines)
      expect(result.toolSelectionPolicy?.heuristics).toBe(DEFAULT_TOOL_SELECTION_POLICY.heuristics)
      expect(result.memoryPolicyProjection?.useRules).toBe(DEFAULT_MEMORY_POLICY_PROJECTION.useRules)

      // Should warn for each template
      expect(warnSpy).toHaveBeenCalledTimes(3)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Template not registered: persona:default'))
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Template not registered: heuristics:tool-usage.common'),
      )
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Template not registered: context:memory-use-rules'))
    })

    it('should fallback to defaults and warn when loader throws', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'true'

      const registry = createMockRegistry(true)
      const loader = {
        load: vi.fn().mockRejectedValue(new Error('File not found')),
        loadSync: vi.fn(),
        loadFromString: vi.fn(),
        resolveTemplatePath: vi.fn(),
      } as unknown as TemplateLoader
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const resolver = createPromptProjectionResolver(registry, loader)

      const result = await resolver.resolve({})

      // Should fallback to defaults
      expect(result.personaProjection?.styleGuidelines).toBe(DEFAULT_PERSONA_PROJECTION.styleGuidelines)
      expect(result.toolSelectionPolicy?.heuristics).toBe(DEFAULT_TOOL_SELECTION_POLICY.heuristics)
      expect(result.memoryPolicyProjection?.useRules).toBe(DEFAULT_MEMORY_POLICY_PROJECTION.useRules)

      // Should warn for each template load failure
      expect(warnSpy).toHaveBeenCalledTimes(3)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load template persona:default'))
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load template heuristics:tool-usage.common'),
      )
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load template context:memory-use-rules'))
    })

    it('should handle partial template failures gracefully', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'true'

      const registry = createMockRegistry(true)
      const loader = {
        load: vi.fn().mockImplementation((templateId: string) => {
          if (templateId === 'persona:default') {
            return Promise.resolve('Custom persona')
          }
          if (templateId === 'heuristics:tool-usage.common') {
            return Promise.reject(new Error('Heuristics load failed'))
          }
          return Promise.resolve('Custom memory rules')
        }),
        loadSync: vi.fn(),
        loadFromString: vi.fn(),
        resolveTemplatePath: vi.fn(),
      } as unknown as TemplateLoader
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const resolver = createPromptProjectionResolver(registry, loader)

      const result = await resolver.resolve({})

      // Persona should use loaded content
      expect(result.personaProjection?.styleGuidelines).toBe('Custom persona')
      // Heuristics should fallback to default
      expect(result.toolSelectionPolicy?.heuristics).toBe(DEFAULT_TOOL_SELECTION_POLICY.heuristics)
      // Memory rules should use loaded content
      expect(result.memoryPolicyProjection?.useRules).toBe('Custom memory rules')

      // Should warn only for the failed template
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load template heuristics:tool-usage.common'),
      )
    })
  })

  describe('resolve input', () => {
    it('should accept empty input object', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'false'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({})
      const resolver = createPromptProjectionResolver(registry, loader)

      // Should not throw
      const result = await resolver.resolve({})
      expect(result).toBeDefined()
    })
  })

  describe('segment placement via ModelInputBuilder', () => {
    function makeBuilderForSegmentTest(): ModelInputBuilder {
      const templates: Map<string, PromptTemplateRecord> = new Map([
        ['platform:base', { id: 'platform:base', version: '2026-05-23', path: 'platform/base.md', agentKind: '*', providerFamily: '*', layer: 1, content: 'Platform base.', description: 'Test' }],
        ['platform:safety', { id: 'platform:safety', version: '2026-05-23', path: 'platform/safety.md', agentKind: '*', providerFamily: '*', layer: 1, content: 'Safety rules.', description: 'Test' }],
        ['provider:openai', { id: 'provider:openai', version: '2026-05-23', path: 'provider/openai.md', agentKind: '*', providerFamily: 'openai', layer: 2, content: 'OpenAI config.', description: 'Test' }],
        ['agents:kernel', { id: 'agents:kernel', version: '2026-05-23', path: 'agents/kernel.md', agentKind: 'kernel', providerFamily: '*', layer: 3, content: 'Kernel instructions.', description: 'Test' }],
      ])
      const registry = new PromptTemplateRegistry(templates, '/nonexistent')
      const loader = new TemplateLoader('/nonexistent')
      return new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })
    }

    it('personaProjection lands in Segment B (tenantProject) when P0 enabled', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'false'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({})
      const resolver = createPromptProjectionResolver(registry, loader)
      const result = await resolver.resolve({})

      const builder = makeBuilderForSegmentTest()
      const built = await builder.build({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
        personaProjection: result.personaProjection,
      })

      expect(built.segments.tenantProject).toContain('风格指南')
      expect(built.segments.tenantProject).toContain(DEFAULT_PERSONA_PROJECTION.styleGuidelines)
      expect(built.segments.staticPrefix).not.toContain(DEFAULT_PERSONA_PROJECTION.styleGuidelines)
    })

    it('toolSelectionPolicy lands in Segment C (toolPlane) when P0 enabled', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'false'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({})
      const resolver = createPromptProjectionResolver(registry, loader)
      const result = await resolver.resolve({})

      const builder = makeBuilderForSegmentTest()
      const built = await builder.build({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
        toolSelectionPolicy: result.toolSelectionPolicy,
      })

      expect(built.segments.toolPlane).toContain('Tool Selection Policy:')
      expect(built.segments.toolPlane).toContain(DEFAULT_TOOL_SELECTION_POLICY.heuristics)
      expect(built.segments.tenantProject).not.toContain('Tool Selection Policy:')
    })

    it('memoryPolicyProjection lands in Segment D (contextBundle) when P0 enabled', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'false'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({})
      const resolver = createPromptProjectionResolver(registry, loader)
      const result = await resolver.resolve({})

      const builder = makeBuilderForSegmentTest()
      const built = await builder.build({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
        memoryPolicyProjection: result.memoryPolicyProjection,
        currentUserMessage: 'Hello',
      })

      expect(built.segments.contextBundle).toContain('Memory Policy')
      expect(built.segments.contextBundle).toContain(DEFAULT_MEMORY_POLICY_PROJECTION.useRules)
      expect(built.segments.tenantProject).not.toContain('Memory Policy')
    })

    it('all three projections land in correct segments simultaneously', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
      process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'false'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({})
      const resolver = createPromptProjectionResolver(registry, loader)
      const result = await resolver.resolve({})

      const builder = makeBuilderForSegmentTest()
      const built = await builder.build({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
        personaProjection: result.personaProjection,
        toolSelectionPolicy: result.toolSelectionPolicy,
        memoryPolicyProjection: result.memoryPolicyProjection,
        currentUserMessage: 'Hello',
      })

      expect(built.segments.tenantProject).toContain(DEFAULT_PERSONA_PROJECTION.styleGuidelines)
      expect(built.segments.toolPlane).toContain(DEFAULT_TOOL_SELECTION_POLICY.heuristics)
      expect(built.segments.contextBundle).toContain(DEFAULT_MEMORY_POLICY_PROJECTION.useRules)
    })

    it('P0 flag OFF produces no projection content in any segment', async () => {
      process.env.PROMPT_MEMORY_P0_ENABLED = 'false'

      const registry = createMockRegistry(true)
      const loader = createMockLoader({})
      const resolver = createPromptProjectionResolver(registry, loader)
      const result = await resolver.resolve({})

      expect(result).toEqual({})

      const builder = makeBuilderForSegmentTest()
      const built = await builder.build({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
        currentUserMessage: 'Hello',
      })

      expect(built.segments.tenantProject).not.toContain('风格指南')
      expect(built.segments.toolPlane).not.toContain('Tool Selection Policy:')
      expect(built.segments.contextBundle).not.toContain('Memory Policy')
    })
  })
})
