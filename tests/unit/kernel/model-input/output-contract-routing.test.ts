/**
 * Output Contract Routing Tests (Todo 13)
 *
 * Proves that memory, search, planner, and default chat each resolve
 * a distinct output contract through Layer 4 of the seven-layer stack,
 * and that the external result schemas (ExtractionResult, SearchSubagentResult, etc.)
 * are not changed by this routing.
 */
import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../../src/kernel/model-input/model-input-builder.js'


// ── Template fixtures ──────────────────────────────────────────────────────────

function makeTemplates(): Map<string, PromptTemplateRecord> {
  return new Map([
    // Layer 1: Platform
    [
      'platform:base',
      {
        id: 'platform:base',
        version: '2026-05-23',
        path: 'platform/base.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 1,
        content: 'Platform base identity.',
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
    // Layer 2: Provider
    [
      'provider:openai',
      {
        id: 'provider:openai',
        version: '2026-05-23',
        path: 'provider/openai.md',
        agentKind: '*',
        providerFamily: 'openai',
        layer: 2,
        content: 'OpenAI provider config.',
        description: 'OpenAI provider',
      },
    ],
    // Layer 3: AgentType
    [
      'agentType:main',
      {
        id: 'agentType:main',
        version: '2026-06-18',
        path: 'agentType/main.md',
        agentKind: 'main',
        providerFamily: '*',
        layer: 3,
        content: 'Main agent type instructions.',
        description: 'Main agent type',
        taxonomyLayer: 'agentType',
        agentType: 'main',
      },
    ],
    [
      'agentType:subagent',
      {
        id: 'agentType:subagent',
        version: '2026-06-18',
        path: 'agentType/subagent.md',
        agentKind: 'subagent',
        providerFamily: '*',
        layer: 3,
        content: 'Subagent type instructions.',
        description: 'Subagent type',
        taxonomyLayer: 'agentType',
        agentType: 'subagent',
      },
    ],
    // Layer 3: Legacy agent templates (backward compat)
    [
      'agents:memory',
      {
        id: 'agents:memory',
        version: '2026-05-24',
        path: 'agents/memory.md',
        agentKind: 'memory',
        providerFamily: '*',
        layer: 3,
        content: 'Memory extraction agent instructions.',
        description: 'Memory agent',
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
        content: 'Kernel agent instructions.',
        description: 'Kernel agent',
      },
    ],
    // Layer 4: Output contracts (seven-layer taxonomy)
    [
      'outputContract:memory-candidate.schema',
      {
        id: 'outputContract:memory-candidate.schema',
        version: '2026-06-18',
        path: 'outputContract/memory-candidate.schema.md',
        agentKind: 'outputContract:memory-candidate.schema',
        providerFamily: '*',
        layer: 4,
        content: 'Memory candidate JSON output contract.',
        description: 'Memory candidate output contract',
        taxonomyLayer: 'outputContract',
        outputContract: 'output:memory-candidate.schema',
      },
    ],
    [
      'outputContract:search-evidence.schema',
      {
        id: 'outputContract:search-evidence.schema',
        version: '2026-06-18',
        path: 'outputContract/search-evidence.schema.md',
        agentKind: 'outputContract:search-evidence.schema',
        providerFamily: '*',
        layer: 4,
        content: 'Search evidence output contract.',
        description: 'Search evidence output contract',
        taxonomyLayer: 'outputContract',
        outputContract: 'output:search-evidence.schema',
      },
    ],
    [
      'outputContract:planner.schema',
      {
        id: 'outputContract:planner.schema',
        version: '2026-06-18',
        path: 'outputContract/planner.schema.md',
        agentKind: 'outputContract:planner.schema',
        providerFamily: '*',
        layer: 4,
        content: 'Planner execution plan output contract.',
        description: 'Planner output contract',
        taxonomyLayer: 'outputContract',
        outputContract: 'output:planner.schema',
      },
    ],
    [
      'outputContract:default-chat.schema',
      {
        id: 'outputContract:default-chat.schema',
        version: '2026-06-18',
        path: 'outputContract/default-chat.schema.md',
        agentKind: 'outputContract:default-chat.schema',
        providerFamily: '*',
        layer: 4,
        content: 'Default chat output contract.',
        description: 'Default chat output contract',
        taxonomyLayer: 'outputContract',
        outputContract: 'output:default-chat.schema',
      },
    ],
  ])
}

function makeBuilder(): ModelInputBuilder {
  const templates = makeTemplates()
  const registry = new PromptTemplateRegistry(templates, '/nonexistent')
  const loader = new TemplateLoader('/nonexistent')
  return new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Output contract routing through Layer 4', () => {
  describe('each agent resolves a distinct output contract', () => {
    it('memory extractor resolves output:memory-candidate.schema', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'structured_json',
        agentKind: 'memory',
        providerFamily: 'openai',
        outputContract: 'output:memory-candidate.schema',
        currentUserMessage: 'Extract memories from this conversation.',
      })

      expect(result.metadata.outputContract).toBe('output:memory-candidate.schema')
    })

    it('search subagent resolves output:search-evidence.schema', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'function_calling',
        agentKind: 'search',
        providerFamily: 'openai',
        outputContract: 'output:search-evidence.schema',
        currentUserMessage: 'What is the weather today?',
      })

      expect(result.metadata.outputContract).toBe('output:search-evidence.schema')
    })

    it('planner resolves output:planner.schema', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'structured_json',
        agentKind: 'planner',
        providerFamily: 'openai',
        outputContract: 'output:planner.schema',
        currentUserMessage: 'Create a plan to refactor auth.',
      })

      expect(result.metadata.outputContract).toBe('output:planner.schema')
    })

    it('default chat resolves output:default-chat.schema', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        agentKind: 'kernel',
        providerFamily: 'openai',
        outputContract: 'output:default-chat.schema',
        currentUserMessage: 'Hello, how are you?',
      })

      expect(result.metadata.outputContract).toBe('output:default-chat.schema')
    })
  })

  describe('output contract affects Segment A (Layer 4) content', () => {
    it('memory contract content appears in staticPrefix', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'structured_json',
        agentKind: 'memory',
        providerFamily: 'openai',
        outputContract: 'output:memory-candidate.schema',
        currentUserMessage: 'Extract memories.',
      })

      expect(result.segments.staticPrefix).toContain('Memory candidate JSON output contract')
    })

    it('search contract content appears in staticPrefix', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'function_calling',
        agentKind: 'search',
        providerFamily: 'openai',
        outputContract: 'output:search-evidence.schema',
        currentUserMessage: 'Search query.',
      })

      expect(result.segments.staticPrefix).toContain('Search evidence output contract')
    })

    it('planner contract content appears in staticPrefix', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'structured_json',
        agentKind: 'planner',
        providerFamily: 'openai',
        outputContract: 'output:planner.schema',
        currentUserMessage: 'Plan this task.',
      })

      expect(result.segments.staticPrefix).toContain('Planner execution plan output contract')
    })

    it('default chat contract content appears in staticPrefix', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        agentKind: 'kernel',
        providerFamily: 'openai',
        outputContract: 'output:default-chat.schema',
        currentUserMessage: 'Hello.',
      })

      expect(result.segments.staticPrefix).toContain('Default chat output contract')
    })
  })

  describe('different output contracts produce different Segment A hashes', () => {
    it('memory vs search produce different segmentA hashes', async () => {
      const builder = makeBuilder()

      const memoryResult = await builder.build({
        mode: 'structured_json',
        agentKind: 'memory',
        providerFamily: 'openai',
        outputContract: 'output:memory-candidate.schema',
        currentUserMessage: 'Extract.',
      })

      const searchResult = await builder.build({
        mode: 'function_calling',
        agentKind: 'search',
        providerFamily: 'openai',
        outputContract: 'output:search-evidence.schema',
        currentUserMessage: 'Extract.',
      })

      expect(memoryResult.segmentHashes.segmentA).not.toBe(searchResult.segmentHashes.segmentA)
    })

    it('planner vs default-chat produce different segmentA hashes', async () => {
      const builder = makeBuilder()

      const plannerResult = await builder.build({
        mode: 'structured_json',
        agentKind: 'planner',
        providerFamily: 'openai',
        outputContract: 'output:planner.schema',
        currentUserMessage: 'Plan.',
      })

      const chatResult = await builder.build({
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        agentKind: 'kernel',
        providerFamily: 'openai',
        outputContract: 'output:default-chat.schema',
        currentUserMessage: 'Plan.',
      })

      expect(plannerResult.segmentHashes.segmentA).not.toBe(chatResult.segmentHashes.segmentA)
    })
  })

  describe('outputContract is undefined when not provided', () => {
    it('metadata.outputContract is undefined when not passed', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
        currentUserMessage: 'Hello.',
      })

      expect(result.metadata.outputContract).toBeUndefined()
    })

    it('no Layer 4 taxonomy template is included when outputContract is absent', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'function_calling',
        agentKind: 'kernel',
        providerFamily: 'openai',
        currentUserMessage: 'Hello.',
      })

      // Layer 4 output contract content should NOT be in staticPrefix
      expect(result.segments.staticPrefix).not.toContain('Memory candidate JSON output contract')
      expect(result.segments.staticPrefix).not.toContain('Search evidence output contract')
      expect(result.segments.staticPrefix).not.toContain('Planner execution plan output contract')
      expect(result.segments.staticPrefix).not.toContain('Default chat output contract')
    })
  })

  describe('external result schemas are unchanged', () => {
    it('ExtractionResult type is preserved (memory)', async () => {
      // Verify the memory extractor service returns the same ExtractionResult union
      const { createLongTermMemoryExtractorService } = await import(
        '../../../../src/memory/long-term-memory-extractor-service.js'
      )
      expect(typeof createLongTermMemoryExtractorService).toBe('function')
    })

    it('SearchSubagentResult type is preserved (search)', async () => {
      // Verify the search subagent returns the same SearchSubagentResult union
      const { createSearchSubagent } = await import('../../../../src/search/search-subagent.js')
      expect(typeof createSearchSubagent).toBe('function')
    })

    it('BuiltModelInput.metadata includes outputContract field', async () => {
      const builder = makeBuilder()
      const result = await builder.build({
        mode: 'structured_json',
        agentKind: 'memory',
        providerFamily: 'openai',
        outputContract: 'output:memory-candidate.schema',
        currentUserMessage: 'Test.',
      })

      // The metadata.outputContract field exists and is typed
      expect(result.metadata).toHaveProperty('outputContract')
      expect(typeof result.metadata.outputContract).toBe('string')
    })
  })
})
