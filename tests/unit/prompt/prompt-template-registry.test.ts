import { describe, it, expect, beforeEach } from 'vitest'
import {
  PromptTemplateRegistry,
  PROMPT_TEMPLATE_REGISTRY,
} from '../../../src/prompt/prompt-template-registry.js'

describe('prompt-template-registry (taxonomy)', () => {
  let registry: PromptTemplateRegistry

  beforeEach(() => {
    registry = new PromptTemplateRegistry()
  })

  describe('taxonomy record presence', () => {
    it('has agentType:main record', () => {
      const record = registry.getTemplate('agentType:main')
      expect(record).toBeDefined()
      expect(record?.taxonomyLayer).toBe('agentType')
      expect(record?.agentType).toBe('main')
      expect(record?.layer).toBe(3)
    })

    it('has agentType:subagent record', () => {
      const record = registry.getTemplate('agentType:subagent')
      expect(record).toBeDefined()
      expect(record?.taxonomyLayer).toBe('agentType')
      expect(record?.agentType).toBe('subagent')
      expect(record?.layer).toBe(3)
    })

    it('has agentType:background record', () => {
      const record = registry.getTemplate('agentType:background')
      expect(record).toBeDefined()
      expect(record?.taxonomyLayer).toBe('agentType')
      expect(record?.agentType).toBe('background')
      expect(record?.layer).toBe(3)
    })

    it('has outputContract:planner.schema record', () => {
      const record = registry.getTemplate('outputContract:planner.schema')
      expect(record).toBeDefined()
      expect(record?.taxonomyLayer).toBe('outputContract')
      expect(record?.outputContract).toBe('output:planner.schema')
      expect(record?.layer).toBe(4)
    })

    it('has outputContract:memory-candidate.schema record', () => {
      const record = registry.getTemplate('outputContract:memory-candidate.schema')
      expect(record).toBeDefined()
      expect(record?.taxonomyLayer).toBe('outputContract')
      expect(record?.outputContract).toBe('output:memory-candidate.schema')
      expect(record?.layer).toBe(4)
    })

    it('has all agentProfile records', () => {
      const profiles = [
        'default_main', 'foreground', 'planner', 'memory',
        'search', 'research_processor', 'search_processor',
      ]
      for (const profile of profiles) {
        const record = registry.getTemplate(`agentProfile:${profile}`)
        expect(record).toBeDefined()
        expect(record?.taxonomyLayer).toBe('agentProfile')
        expect(record?.agentProfile).toBe(profile)
        expect(record?.layer).toBe(5)
      }
    })

    it('has toolProjection:default record', () => {
      const record = registry.getTemplate('toolProjection:default')
      expect(record).toBeDefined()
      expect(record?.taxonomyLayer).toBe('toolProjection')
      expect(record?.layer).toBe(6)
    })

    it('has runtimeContext:default record', () => {
      const record = registry.getTemplate('runtimeContext:default')
      expect(record).toBeDefined()
      expect(record?.taxonomyLayer).toBe('runtimeContext')
      expect(record?.layer).toBe(7)
    })
  })

  describe('legacy agents:* templates removed', () => {
    it('no longer has agents:foreground', () => {
      expect(registry.hasTemplate('agents:foreground')).toBe(false)
    })

    it('no longer has agents:kernel', () => {
      expect(registry.hasTemplate('agents:kernel')).toBe(false)
    })

    it('no longer has agents:memory', () => {
      expect(registry.hasTemplate('agents:memory')).toBe(false)
    })

    it('retires legacy output:* templates (replaced by outputContract:*)', () => {
      expect(registry.hasTemplate('output:planner.schema')).toBe(false)
      expect(registry.hasTemplate('output:memory-candidate.schema')).toBe(false)
      expect(registry.hasTemplate('outputContract:planner.schema')).toBe(true)
      expect(registry.hasTemplate('outputContract:memory-candidate.schema')).toBe(true)
    })

    it('keeps persona:default with taxonomyLayer', () => {
      const record = registry.getTemplate('persona:default')
      expect(record).toBeDefined()
      expect(record?.taxonomyLayer).toBe('agentProfile')
    })
  })

  describe('PROMPT_TEMPLATE_REGISTRY has 38 templates', () => {
    it('contains 14 cross-cutting + 24 taxonomy records', () => {
      expect(PROMPT_TEMPLATE_REGISTRY.size).toBe(38)
    })

    it('has all taxonomy IDs', () => {
      expect(PROMPT_TEMPLATE_REGISTRY.has('agentType:main')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('agentType:subagent')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('agentType:background')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('outputContract:planner.schema')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('outputContract:memory-candidate.schema')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('agentProfile:default_main')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('agentProfile:foreground')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('agentProfile:planner')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('agentProfile:memory')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('agentProfile:search')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('agentProfile:research_processor')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('agentProfile:search_processor')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('toolProjection:default')).toBe(true)
      expect(PROMPT_TEMPLATE_REGISTRY.has('runtimeContext:default')).toBe(true)
    })
  })

  describe('deterministic layer ordering', () => {
    it('resolveSevenLayer returns results sorted by layer', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      })

      for (let i = 1; i < templates.length; i++) {
        expect(templates[i].layer).toBeGreaterThanOrEqual(templates[i - 1].layer)
      }
    })

    it('resolveSevenLayerGrouped returns a map with layers 1-7', () => {
      const grouped = registry.resolveSevenLayerGrouped({
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      })

      expect(grouped.has(1)).toBe(true)
      expect(grouped.has(2)).toBe(true)
      expect(grouped.has(3)).toBe(true)
      expect(grouped.has(5)).toBe(true)
      expect(grouped.has(6)).toBe(true)
      expect(grouped.has(7)).toBe(true)
    })
  })
})
