import { PromptTemplateRegistry } from '../prompt/prompt-template-registry.js'
import { TemplateLoader } from '../prompt/template-loader.js'
import { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import type { PromptCandidate, CandidateResult } from './candidate-types.js'
import type { GoldenCaseResult } from './regression-runner.js'
import type { GoldenCase } from './golden-case-types.js'
import { runGoldenCase } from './regression-runner.js'
import { generateDiffReport } from './diff-report-generator.js'

export interface CandidateRunnerDeps {
  templateRegistry: PromptTemplateRegistry
  templateLoader: TemplateLoader
  builder: ModelInputBuilder
}

export async function runCandidate(
  candidate: PromptCandidate,
  baseline: GoldenCaseResult[],
  deps: CandidateRunnerDeps,
  goldenCases?: GoldenCase[],
): Promise<CandidateResult> {
  const { templateRegistry, templateLoader } = deps

  const originalEnv: Record<string, string | undefined> = {}

  for (const [key, value] of Object.entries(candidate.featureFlagOverrides)) {
    originalEnv[key] = process.env[key]
    process.env[key] = value
  }

  try {
    const registryCopy = new PromptTemplateRegistry(new Map(), templateLoader.getBasePath())

    // Copy all templates from the original registry
    for (const templateId of templateRegistry.getAllTemplateIds()) {
      const existing = templateRegistry.getTemplate(templateId)
      if (existing) {
        registryCopy.register(templateId, existing)
      }
    }

    for (const override of candidate.templateOverrides) {
      const existing = registryCopy.getTemplate(override.templateId)
      if (existing) {
        registryCopy.register(override.templateId, { ...existing, content: override.content })
      } else {
        registryCopy.register(override.templateId, {
          id: override.templateId,
          version: new Date().toISOString().split('T')[0],
          path: '',
          agentKind: '*',
          providerFamily: '*',
          layer: 0,
          description: 'Candidate override',
          content: override.content,
        })
      }
    }

    const candidateLoader = new TemplateLoader(templateLoader.getBasePath())
    const candidateBuilder = new ModelInputBuilder({
      templateRegistry: registryCopy,
      templateLoader: candidateLoader,
    })

    const goldenResults: GoldenCaseResult[] = []
    if (goldenCases) {
      for (const gc of goldenCases) {
        const result = await runGoldenCase(gc, { builder: candidateBuilder })
        goldenResults.push(result)
      }
    }

    const diffReport = generateDiffReport(baseline, goldenResults, 'baseline', candidate.candidateId)

    return {
      candidate,
      goldenResults,
      diffReport,
      approved: false,
    }
  } finally {
    for (const [key] of Object.entries(candidate.featureFlagOverrides)) {
      if (originalEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalEnv[key]!
      }
    }
  }
}
