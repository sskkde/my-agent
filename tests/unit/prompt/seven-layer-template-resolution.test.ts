import { describe, it, expect, beforeEach } from 'vitest'
import {
  PromptTemplateRegistry,
  createPromptTemplateRegistry,
  type PromptTemplateRecord,
} from '../../../src/prompt/prompt-template-registry.js'

describe('seven-layer-template-resolution', () => {
  let registry: PromptTemplateRegistry

  beforeEach(() => {
    registry = createPromptTemplateRegistry()
  })

  describe('main/default_main with openai', () => {
    it('resolves all seven layers', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      })

      const byLayer = groupByLayer(templates)

      expect(byLayer[1]).toBeDefined()
      expect(byLayer[2]).toBeDefined()
      expect(byLayer[3]).toBeDefined()
      expect(byLayer[5]).toBeDefined()
      expect(byLayer[6]).toBeDefined()
      expect(byLayer[7]).toBeDefined()
    })

    it('Layer 1 includes platform:base and platform:safety', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      })

      const layer1 = templates.filter((t) => t.layer === 1)
      const ids = layer1.map((t) => t.id)
      expect(ids).toContain('platform:base')
      expect(ids).toContain('platform:safety')
    })

    it('Layer 2 includes provider:openai', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      })

      const layer2 = templates.filter((t) => t.layer === 2)
      const ids = layer2.map((t) => t.id)
      expect(ids).toContain('provider:openai')
      expect(ids).not.toContain('provider:deepseek')
    })

    it('Layer 3 includes agentType:main', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      })

      const layer3 = templates.filter((t) => t.layer === 3)
      const ids = layer3.map((t) => t.id)
      expect(ids).toContain('agentType:main')
      expect(ids).not.toContain('agentType:subagent')
      expect(ids).not.toContain('agentType:background')
    })

    it('Layer 4 is empty when no outputContract specified', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      })

      const layer4 = templates.filter((t) => t.layer === 4)
      expect(layer4.length).toBe(0)
    })

    it('Layer 5 includes agentProfile:default_main', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      })

      const layer5 = templates.filter((t) => t.layer === 5)
      const ids = layer5.map((t) => t.id)
      expect(ids).toContain('agentProfile:default_main')
      expect(ids).toContain('persona:default')
    })

    it('Layer 6 includes toolProjection:default', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      })

      const layer6 = templates.filter((t) => t.layer === 6)
      const ids = layer6.map((t) => t.id)
      expect(ids).toContain('toolProjection:default')
      expect(ids).toContain('heuristics:tool-usage.common')
    })

    it('Layer 7 includes runtimeContext:default and summary templates', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      })

      const layer7 = templates.filter((t) => t.layer === 7)
      const ids = layer7.map((t) => t.id)
      expect(ids).toContain('runtimeContext:default')
      expect(ids).toContain('context:memory-use-rules')
      expect(ids).toContain('summary:session')
      expect(ids).toContain('summary:daily')
      expect(ids).toContain('summary:weekly')
      expect(ids).toContain('summary:long-term')
      expect(ids).toContain('summary:atomic-facts')
    })
  })

  describe('subagent/research_processor with openai', () => {
    it('resolves all seven layers', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'subagent',
        agentProfile: 'research_processor',
        providerFamily: 'openai',
      })

      const byLayer = groupByLayer(templates)

      expect(byLayer[1]).toBeDefined()
      expect(byLayer[2]).toBeDefined()
      expect(byLayer[3]).toBeDefined()
      expect(byLayer[5]).toBeDefined()
      expect(byLayer[6]).toBeDefined()
      expect(byLayer[7]).toBeDefined()
    })

    it('Layer 3 includes agentType:subagent', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'subagent',
        agentProfile: 'research_processor',
        providerFamily: 'openai',
      })

      const layer3 = templates.filter((t) => t.layer === 3)
      const ids = layer3.map((t) => t.id)
      expect(ids).toContain('agentType:subagent')
      expect(ids).not.toContain('agentType:main')
    })

    it('Layer 5 includes agentProfile:research_processor', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'subagent',
        agentProfile: 'research_processor',
        providerFamily: 'openai',
      })

      const layer5 = templates.filter((t) => t.layer === 5)
      const ids = layer5.map((t) => t.id)
      expect(ids).toContain('agentProfile:research_processor')
      expect(ids).toContain('persona:default')
    })
  })

  describe('subagent/search with deepseek', () => {
    it('resolves all seven layers', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'subagent',
        agentProfile: 'search',
        providerFamily: 'deepseek',
      })

      const byLayer = groupByLayer(templates)

      expect(byLayer[1]).toBeDefined()
      expect(byLayer[2]).toBeDefined()
      expect(byLayer[3]).toBeDefined()
      expect(byLayer[5]).toBeDefined()
      expect(byLayer[6]).toBeDefined()
      expect(byLayer[7]).toBeDefined()
    })

    it('Layer 2 includes provider:deepseek', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'subagent',
        agentProfile: 'search',
        providerFamily: 'deepseek',
      })

      const layer2 = templates.filter((t) => t.layer === 2)
      const ids = layer2.map((t) => t.id)
      expect(ids).toContain('provider:deepseek')
      expect(ids).not.toContain('provider:openai')
    })

    it('Layer 5 includes agentProfile:search', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'subagent',
        agentProfile: 'search',
        providerFamily: 'deepseek',
      })

      const layer5 = templates.filter((t) => t.layer === 5)
      const ids = layer5.map((t) => t.id)
      expect(ids).toContain('agentProfile:search')
    })
  })

  describe('outputContract resolution', () => {
    it('Layer 4 includes outputContract:planner.schema when specified', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'subagent',
        agentProfile: 'planner',
        providerFamily: 'openai',
        outputContract: 'output:planner.schema',
      })

      const layer4 = templates.filter((t) => t.layer === 4)
      const ids = layer4.map((t) => t.id)
      expect(ids).toContain('outputContract:planner.schema')
    })

    it('Layer 4 includes outputContract:memory-candidate.schema when specified', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'background',
        agentProfile: 'memory',
        providerFamily: 'openai',
        outputContract: 'output:memory-candidate.schema',
      })

      const layer4 = templates.filter((t) => t.layer === 4)
      const ids = layer4.map((t) => t.id)
      expect(ids).toContain('outputContract:memory-candidate.schema')
    })

    it('Layer 4 is empty when outputContract not specified', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'subagent',
        agentProfile: 'planner',
        providerFamily: 'openai',
      })

      const layer4 = templates.filter((t) => t.layer === 4)
      expect(layer4.length).toBe(0)
    })

    it('Layer 4 does not include wrong outputContract', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'subagent',
        agentProfile: 'planner',
        providerFamily: 'openai',
        outputContract: 'output:planner.schema',
      })

      const layer4 = templates.filter((t) => t.layer === 4)
      const ids = layer4.map((t) => t.id)
      expect(ids).not.toContain('outputContract:memory-candidate.schema')
    })
  })

  describe('provider isolation', () => {
    it('openai resolution excludes deepseek provider template', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
      })

      const layer2 = templates.filter((t) => t.layer === 2)
      const ids = layer2.map((t) => t.id)
      expect(ids).toContain('provider:openai')
      expect(ids).not.toContain('provider:deepseek')
    })

    it('deepseek resolution excludes openai provider template', () => {
      const templates = registry.resolveSevenLayer({
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'deepseek',
      })

      const layer2 = templates.filter((t) => t.layer === 2)
      const ids = layer2.map((t) => t.id)
      expect(ids).toContain('provider:deepseek')
      expect(ids).not.toContain('provider:openai')
    })
  })

  describe('deterministic ordering', () => {
    it('results are always sorted by layer ascending', () => {
      const combos = [
        { agentType: 'main', agentProfile: 'default_main', providerFamily: 'openai' },
        { agentType: 'subagent', agentProfile: 'research_processor', providerFamily: 'deepseek' },
        { agentType: 'background', agentProfile: 'memory', providerFamily: 'openai' },
      ]

      for (const input of combos) {
        const templates = registry.resolveSevenLayer(input)
        for (let i = 1; i < templates.length; i++) {
          expect(templates[i].layer).toBeGreaterThanOrEqual(templates[i - 1].layer)
        }
      }
    })
  })
})

function groupByLayer(templates: PromptTemplateRecord[]): Record<number, PromptTemplateRecord[]> {
  const grouped: Record<number, PromptTemplateRecord[]> = {}
  for (const t of templates) {
    if (!grouped[t.layer]) grouped[t.layer] = []
    grouped[t.layer].push(t)
  }
  return grouped
}
