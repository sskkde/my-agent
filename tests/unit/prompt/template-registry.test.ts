import { describe, it, expect, beforeEach } from 'vitest'
import {
  PromptTemplateRegistry,
  PROMPT_TEMPLATE_REGISTRY,
  createPromptTemplateRegistry,
  type PromptTemplateRecord,
} from '../../../src/prompt/prompt-template-registry.js'

describe('prompt-template-registry', () => {
  let registry: PromptTemplateRegistry

  beforeEach(() => {
    registry = new PromptTemplateRegistry()
  })

  describe('getTemplate', () => {
    it('returns platform:base template', () => {
      const template = registry.getTemplate('platform:base')
      expect(template).toBeDefined()
      expect(template?.id).toBe('platform:base')
      expect(template?.layer).toBe(1)
      expect(template?.agentKind).toBe('*')
      expect(template?.providerFamily).toBe('*')
    })

    it('returns platform:safety template', () => {
      const template = registry.getTemplate('platform:safety')
      expect(template).toBeDefined()
      expect(template?.id).toBe('platform:safety')
      expect(template?.layer).toBe(1)
    })

    it('returns provider:openai template', () => {
      const template = registry.getTemplate('provider:openai')
      expect(template).toBeDefined()
      expect(template?.id).toBe('provider:openai')
      expect(template?.layer).toBe(2)
      expect(template?.providerFamily).toBe('openai')
    })

    it('returns provider:deepseek template', () => {
      const template = registry.getTemplate('provider:deepseek')
      expect(template).toBeDefined()
      expect(template?.id).toBe('provider:deepseek')
      expect(template?.layer).toBe(2)
      expect(template?.providerFamily).toBe('deepseek')
    })

    it('returns agents:foreground template', () => {
      const template = registry.getTemplate('agents:foreground')
      expect(template).toBeDefined()
      expect(template?.id).toBe('agents:foreground')
      expect(template?.layer).toBe(3)
      expect(template?.agentKind).toBe('foreground')
    })

    it('returns agents:kernel template', () => {
      const template = registry.getTemplate('agents:kernel')
      expect(template).toBeDefined()
      expect(template?.id).toBe('agents:kernel')
      expect(template?.layer).toBe(3)
      expect(template?.agentKind).toBe('kernel')
    })

    it('returns outputContract:planner.schema template', () => {
      const template = registry.getTemplate('outputContract:planner.schema')
      expect(template).toBeDefined()
      expect(template?.id).toBe('outputContract:planner.schema')
      expect(template?.layer).toBe(4)
      expect(template?.agentKind).toBe('outputContract:planner.schema')
    })

    it('returns undefined for missing template', () => {
      const template = registry.getTemplate('nonexistent:template')
      expect(template).toBeUndefined()
    })
  })

  describe('resolveTemplate', () => {
    it('returns Layer 1-7 templates for foreground + openai', () => {
      const templates = registry.resolveTemplate('foreground', 'openai')

      expect(templates.length).toBe(12)

      expect(templates[0].layer).toBe(1)
      expect(templates[0].id).toBe('platform:base')

      expect(templates[1].layer).toBe(1)
      expect(templates[1].id).toBe('platform:safety')

      expect(templates[2].layer).toBe(2)
      expect(templates[2].id).toBe('provider:openai')

      expect(templates[3].layer).toBe(3)
      expect(templates[3].id).toBe('agents:foreground')

      expect(templates[4].layer).toBe(5)
      expect(templates[4].id).toBe('persona:default')

      expect(templates[5].layer).toBe(6)
      expect(templates[5].id).toBe('heuristics:tool-usage.common')

      // Layer 7 templates (all agentKind: '*')
      expect(templates[6].layer).toBe(7)
      expect(templates[7].layer).toBe(7)
      expect(templates[8].layer).toBe(7)
      expect(templates[9].layer).toBe(7)
      expect(templates[10].layer).toBe(7)
      expect(templates[11].layer).toBe(7)
    })

    it('returns Layer 1-7 templates for foreground + deepseek', () => {
      const templates = registry.resolveTemplate('foreground', 'deepseek')

      expect(templates.length).toBe(12)

      expect(templates[0].layer).toBe(1)
      expect(templates[0].id).toBe('platform:base')

      expect(templates[1].layer).toBe(1)
      expect(templates[1].id).toBe('platform:safety')

      expect(templates[2].layer).toBe(2)
      expect(templates[2].id).toBe('provider:deepseek')

      expect(templates[3].layer).toBe(3)
      expect(templates[3].id).toBe('agents:foreground')

      expect(templates[4].layer).toBe(5)
      expect(templates[4].id).toBe('persona:default')

      expect(templates[5].layer).toBe(6)
      expect(templates[5].id).toBe('heuristics:tool-usage.common')

      // Layer 7 templates (all agentKind: '*')
      expect(templates[6].layer).toBe(7)
      expect(templates[7].layer).toBe(7)
      expect(templates[8].layer).toBe(7)
      expect(templates[9].layer).toBe(7)
      expect(templates[10].layer).toBe(7)
      expect(templates[11].layer).toBe(7)
    })

    it('returns Layer 1-7 templates for kernel + openai', () => {
      const templates = registry.resolveTemplate('kernel', 'openai')

      expect(templates.length).toBe(12)

      expect(templates[0].layer).toBe(1)
      expect(templates[0].id).toBe('platform:base')

      expect(templates[1].layer).toBe(1)
      expect(templates[1].id).toBe('platform:safety')

      expect(templates[2].layer).toBe(2)
      expect(templates[2].id).toBe('provider:openai')

      expect(templates[3].layer).toBe(3)
      expect(templates[3].id).toBe('agents:kernel')

      expect(templates[4].layer).toBe(5)
      expect(templates[4].id).toBe('persona:default')

      expect(templates[5].layer).toBe(6)
      expect(templates[5].id).toBe('heuristics:tool-usage.common')

      // Layer 7 templates (all agentKind: '*')
      expect(templates[6].layer).toBe(7)
      expect(templates[7].layer).toBe(7)
      expect(templates[8].layer).toBe(7)
      expect(templates[9].layer).toBe(7)
      expect(templates[10].layer).toBe(7)
      expect(templates[11].layer).toBe(7)
    })

    it('returns templates sorted by layer', () => {
      const templates = registry.resolveTemplate('foreground', 'openai')

      for (let i = 1; i < templates.length; i++) {
        expect(templates[i].layer).toBeGreaterThanOrEqual(templates[i - 1].layer)
      }
    })

    it('returns Layer 1-7 templates for unknown agent kind', () => {
      const templates = registry.resolveTemplate('unknown', 'openai')
      expect(templates.length).toBe(11)
      expect(templates[0].layer).toBe(1)
      expect(templates[1].layer).toBe(1)
      expect(templates[2].layer).toBe(2)
      expect(templates[3].layer).toBe(5)
      expect(templates[4].layer).toBe(6)
      // Layer 7 templates
      expect(templates[5].layer).toBe(7)
      expect(templates[6].layer).toBe(7)
      expect(templates[7].layer).toBe(7)
      expect(templates[8].layer).toBe(7)
      expect(templates[9].layer).toBe(7)
      expect(templates[10].layer).toBe(7)
    })
  })

  describe('register', () => {
    it('registers a new template', () => {
      const newTemplate: PromptTemplateRecord = {
        id: 'custom:test',
        version: '2026-01-01',
        path: 'custom/test.md',
        agentKind: 'custom',
        providerFamily: '*',
        layer: 5,
        description: 'Custom test template',
      }

      registry.register('custom:test', newTemplate)

      const retrieved = registry.getTemplate('custom:test')
      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe('custom:test')
    })

    it('overwrites existing template', () => {
      const original = registry.getTemplate('platform:base')
      expect(original?.version).toBe('2026-05-23')

      const updated: PromptTemplateRecord = {
        id: 'platform:base',
        version: '2026-12-31',
        path: 'platform/base.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 1,
        description: 'Updated description',
      }

      registry.register('platform:base', updated)

      const retrieved = registry.getTemplate('platform:base')
      expect(retrieved?.version).toBe('2026-12-31')
    })
  })

  describe('getAllTemplateIds', () => {
    it('returns all template IDs', () => {
      const ids = registry.getAllTemplateIds()

      expect(ids).toContain('platform:base')
      expect(ids).toContain('platform:safety')
      expect(ids).toContain('provider:openai')
      expect(ids).toContain('provider:deepseek')
      expect(ids).toContain('agents:foreground')
      expect(ids).toContain('agents:kernel')
      expect(ids).not.toContain('output:foreground.schema')
      expect(ids).toContain('outputContract:planner.schema')
      expect(ids).toContain('persona:default')
      expect(ids).toContain('heuristics:tool-usage.common')
      expect(ids).toContain('context:memory-use-rules')
      expect(ids).toContain('summary:session')
      expect(ids).toContain('summary:daily')
      expect(ids).toContain('summary:weekly')
      expect(ids).toContain('summary:long-term')
      expect(ids).toContain('summary:atomic-facts')

      expect(ids.length).toBe(31)
    })
  })

  describe('hasTemplate', () => {
    it('returns true for existing template', () => {
      expect(registry.hasTemplate('platform:base')).toBe(true)
    })

    it('returns false for missing template', () => {
      expect(registry.hasTemplate('nonexistent')).toBe(false)
    })
  })

  describe('getTemplatesByLayer', () => {
    it('returns Layer 1 templates', () => {
      const templates = registry.getTemplatesByLayer(1)
      expect(templates.length).toBe(2)
      expect(templates.every((t) => t.layer === 1)).toBe(true)
    })

    it('returns Layer 2 templates', () => {
      const templates = registry.getTemplatesByLayer(2)
      expect(templates.length).toBe(2)
      expect(templates.every((t) => t.layer === 2)).toBe(true)
    })

    it('returns Layer 3 templates', () => {
      const templates = registry.getTemplatesByLayer(3)
      expect(templates.length).toBe(6)
      expect(templates.every((t) => t.layer === 3)).toBe(true)
    })

    it('returns Layer 4 templates', () => {
      const templates = registry.getTemplatesByLayer(4)
      expect(templates.length).toBe(4)
      expect(templates.every((t) => t.layer === 4)).toBe(true)
    })

    it('returns Layer 5 templates', () => {
      const templates = registry.getTemplatesByLayer(5)
      expect(templates.length).toBe(8)
      expect(templates.every((t) => t.layer === 5)).toBe(true)
    })

    it('returns Layer 6 templates', () => {
      const templates = registry.getTemplatesByLayer(6)
      expect(templates.length).toBe(2)
      expect(templates.every((t) => t.layer === 6)).toBe(true)
    })

    it('returns Layer 7 templates', () => {
      const templates = registry.getTemplatesByLayer(7)
      expect(templates.length).toBe(7)
      expect(templates.every((t) => t.layer === 7)).toBe(true)
    })
  })

  describe('PROMPT_TEMPLATE_REGISTRY constant', () => {
    it('contains 31 templates', () => {
      expect(PROMPT_TEMPLATE_REGISTRY.size).toBe(31)
    })

    it('has all required templates', () => {
      expect(PROMPT_TEMPLATE_REGISTRY.has('platform:base')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('platform:safety')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('provider:openai')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('provider:deepseek')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('agents:foreground')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('agents:kernel')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('output:foreground.schema')).toBe(false)
      expect(PROMPT_TEMPLATE_REGISTRY.has('outputContract:planner.schema')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('persona:default')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('heuristics:tool-usage.common')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('context:memory-use-rules')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('summary:session')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('summary:daily')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('summary:weekly')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('summary:long-term')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('summary:atomic-facts')).toBe(true)
    })
  })

  describe('createPromptTemplateRegistry', () => {
    it('creates registry with default templates', () => {
      const reg = createPromptTemplateRegistry()
      expect(reg.getAllTemplateIds().length).toBe(31)
    })

    it('creates registry with custom templates', () => {
      const customTemplates = new Map<string, PromptTemplateRecord>()
      customTemplates.set('test:custom', {
        id: 'test:custom',
        version: '2026-01-01',
        path: 'test.md',
        agentKind: 'test',
        providerFamily: '*',
        layer: 1,
        description: 'Test',
      })

      const reg = createPromptTemplateRegistry(customTemplates)
      expect(reg.getAllTemplateIds().length).toBe(1)
      expect(reg.hasTemplate('test:custom')).toBe(true)
    })
  })
})
