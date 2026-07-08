import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry } from '../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../src/kernel/model-input/model-input-builder.js'
import { runGoldenCase } from '../../src/golden/regression-runner.js'
import { goldenCases } from './cases/index.js'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('Golden Regression Tests', () => {
  const templatesPath = join(__dirname, '../../src/prompt/templates')
  const registry = new PromptTemplateRegistry(undefined, templatesPath)
  const loader = new TemplateLoader(templatesPath)
  const builder = new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })

  for (const goldenCase of goldenCases) {
    it(`golden case: ${goldenCase.id} (${goldenCase.category})`, async () => {
      const result = await runGoldenCase(goldenCase, { builder })

      if (!result.passed) {
        const diffMessages = result.diffs
          .map((d) => `  - ${d.path}: ${d.message} (expected: ${JSON.stringify(d.expected)}, actual: ${JSON.stringify(d.actual)})`)
          .join('\n')
        console.error(`Golden case "${goldenCase.id}" failed:\n${diffMessages}`)
      }

      expect(result.passed).toBe(true)
    })
  }
})
