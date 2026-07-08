import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { runGoldenCase } from '../../../src/golden/regression-runner.js'
import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

function makeMinimalTestTemplates(): Map<string, PromptTemplateRecord> {
  return new Map([
    ['platform:base', {
      id: 'platform:base', version: '2026-06-01', path: 'platform/base.md',
      agentKind: '*', providerFamily: '*', layer: 1, taxonomyLayer: 'platform' as const,
      content: 'You are a helpful assistant.',
      description: 'Test platform base',
    }],
    ['platform:safety', {
      id: 'platform:safety', version: '2026-06-01', path: 'platform/safety.md',
      agentKind: '*', providerFamily: '*', layer: 1, taxonomyLayer: 'platform' as const,
      content: 'Safety rules.',
      description: 'Test safety',
    }],
    ['provider:openai', {
      id: 'provider:openai', version: '2026-06-01', path: 'provider/openai.md',
      agentKind: '*', providerFamily: 'openai', layer: 2, taxonomyLayer: 'provider' as const,
      content: '',
      description: 'Test openai provider',
    }],
    ['agentProfile:default_main', {
      id: 'agentProfile:default_main', version: '2026-06-01', path: 'agents/default_main.md',
      agentKind: 'kernel', providerFamily: '*', layer: 3, taxonomyLayer: 'agentProfile' as const,
      agentProfile: 'default_main',
      content: '',
      description: 'Test default main agent',
    }],
    ['agentProfile:memory', {
      id: 'agentProfile:memory', version: '2026-06-01', path: 'agents/memory.md',
      agentKind: 'kernel', providerFamily: '*', layer: 3, taxonomyLayer: 'agentProfile' as const,
      agentProfile: 'memory',
      content: '',
      description: 'Test memory agent',
    }],
    ['agentProfile:search', {
      id: 'agentProfile:search', version: '2026-06-01', path: 'agents/search.md',
      agentKind: 'kernel', providerFamily: '*', layer: 3, taxonomyLayer: 'agentProfile' as const,
      agentProfile: 'search',
      content: '',
      description: 'Test search agent',
    }],
  ]) as Map<string, PromptTemplateRecord>
}

describe('runGoldenCase', () => {
  it('returns a GoldenCaseResult for a minimal input case', async () => {
    const templates = makeMinimalTestTemplates()
    const registry = new PromptTemplateRegistry(templates, '/nonexistent')
    const loader = new TemplateLoader('/nonexistent')
    const builder = new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })

    const goldenCase: GoldenCase = {
      id: 'test-direct-answer',
      category: 'direct_answer',
      description: 'Simple direct answer test',
      input: {
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
        currentUserMessage: 'Hello, how are you?',
      },
      expectations: {},
    }

    const result = await runGoldenCase(goldenCase, { builder })

    expect(result).toBeDefined()
    expect(result.caseId).toBe('test-direct-answer')
    expect(result.passed).toBe(true)
    expect(result.diffs).toEqual([])
  })

  it('detects forbidden tools in the projection', async () => {
    const templates = makeMinimalTestTemplates()
    const registry = new PromptTemplateRegistry(templates, '/nonexistent')
    const loader = new TemplateLoader('/nonexistent')
    const builder = new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })

    const goldenCase: GoldenCase = {
      id: 'test-forbidden-tool',
      category: 'permission_denial',
      description: 'Test forbidden tool detection',
      input: {
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
        currentUserMessage: 'Delete all files',
        toolProjection: {
          toolIds: ['file.delete', 'file.read', 'web.search'],
          tools: [
            { type: 'function', function: { name: 'file.delete', description: 'Delete a file', parameters: {} } },
            { type: 'function', function: { name: 'file.read', description: 'Read a file', parameters: {} } },
            { type: 'function', function: { name: 'web.search', description: 'Search the web', parameters: {} } },
          ],
        },
      },
      expectations: {
        forbiddenTools: ['file.delete'],
      },
    }

    const result = await runGoldenCase(goldenCase, { builder })

    expect(result.passed).toBe(false)
    expect(result.diffs.length).toBeGreaterThan(0)
    expect(result.diffs.some((d) => d.path === 'forbiddenTools' && Array.isArray(d.expected) && d.expected.includes('file.delete'))).toBe(true)
  })

  it('detects missing expected tools in the projection', async () => {
    const templates = makeMinimalTestTemplates()
    const registry = new PromptTemplateRegistry(templates, '/nonexistent')
    const loader = new TemplateLoader('/nonexistent')
    const builder = new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })

    const goldenCase: GoldenCase = {
      id: 'test-expected-tool',
      category: 'tool_selection',
      description: 'Test expected tool detection',
      input: {
        mode: 'function_calling',
        agentType: 'main',
        agentProfile: 'default_main',
        providerFamily: 'openai',
        currentUserMessage: 'Search the web',
        toolProjection: {
          toolIds: ['file.read'],
          tools: [
            { type: 'function', function: { name: 'file.read', description: 'Read a file', parameters: {} } },
          ],
        },
      },
      expectations: {
        expectedTools: ['web.search'],
      },
    }

    const result = await runGoldenCase(goldenCase, { builder })

    expect(result.passed).toBe(false)
    expect(result.diffs.length).toBeGreaterThan(0)
    expect(result.diffs.some((d) => d.path === 'expectedTools' && Array.isArray(d.expected) && d.expected.includes('web.search'))).toBe(true)
  })
})
