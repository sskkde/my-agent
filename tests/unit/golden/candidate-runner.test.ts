import { describe, it, expect, beforeEach } from 'vitest'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { runCandidate } from '../../../src/golden/candidate-runner.js'
import type { PromptCandidate } from '../../../src/golden/candidate-types.js'
import type { GoldenCaseResult } from '../../../src/golden/regression-runner.js'

describe('runCandidate', () => {
  let baseline: GoldenCaseResult[]
  let templateRegistry: PromptTemplateRegistry
  let templateLoader: TemplateLoader
  let builder: ModelInputBuilder

  beforeEach(() => {
    baseline = []
    const templates = new Map([
      ['platform:base', {
        id: 'platform:base', version: '2026-06-01', path: 'platform/base.md',
        agentKind: '*', providerFamily: '*', layer: 1, taxonomyLayer: 'platform' as const,
        content: 'You are a helpful assistant.',
        description: 'Test platform base',
      }],
    ])
    templateRegistry = new PromptTemplateRegistry(templates, '/nonexistent')
    templateLoader = new TemplateLoader('/nonexistent')
    builder = new ModelInputBuilder({ templateRegistry, templateLoader })
  })

  it('returns a CandidateResult with diff report', async () => {
    const candidate: PromptCandidate = {
      candidateId: 'test-candidate-1',
      description: 'Test candidate with template override',
      templateOverrides: [
        {
          templateId: 'platform:base',
          content: 'You are a modified assistant.',
        },
      ],
      featureFlagOverrides: {},
      createdAt: new Date().toISOString(),
    }

    const result = await runCandidate(candidate, baseline, { templateRegistry, templateLoader, builder })

    expect(result.candidate.candidateId).toBe('test-candidate-1')
    expect(result.goldenResults).toBeDefined()
    expect(result.diffReport).toBeDefined()
    expect(result.diffReport.summary.totalCases).toBe(baseline.length)
    expect(result.approved).toBe(false)
  })

  it('applies template overrides to the registry', async () => {
    const candidate: PromptCandidate = {
      candidateId: 'test-override',
      description: 'Test template override application',
      templateOverrides: [
        {
          templateId: 'platform:base',
          content: 'OVERRIDDEN CONTENT',
        },
      ],
      featureFlagOverrides: {},
      createdAt: new Date().toISOString(),
    }

    const result = await runCandidate(candidate, baseline, { templateRegistry, templateLoader, builder })

    expect(result.candidate.templateOverrides[0].content).toBe('OVERRIDDEN CONTENT')
    expect(result.approved).toBe(false)
  })

  it('does not modify the original template registry', async () => {
    const originalRecord = templateRegistry.getTemplate('platform:base')
    const originalContent = originalRecord?.content

    const candidate: PromptCandidate = {
      candidateId: 'test-no-mutate',
      description: 'Test that original registry is not modified',
      templateOverrides: [
        {
          templateId: 'platform:base',
          content: 'Modified content',
        },
      ],
      featureFlagOverrides: {},
      createdAt: new Date().toISOString(),
    }

    await runCandidate(candidate, baseline, { templateRegistry, templateLoader, builder })

    const recordAfter = templateRegistry.getTemplate('platform:base')
    expect(recordAfter?.content).toBe(originalContent)
  })
})
