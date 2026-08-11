import type { PlanGenerator } from './plan-generator-interface.js'
import type { PlanGenerationInput, PlanGenerationOutput, ExecutionPlan } from './plan-schema.js'
import { PlanValidator } from './plan-validator.js'
import { DeterministicPlanGenerator } from './deterministic-plan-generator.js'

export interface LLMAdapter {
  generatePlan(input: PlanGenerationInput): Promise<ExecutionPlan | null>
}

export class LLMPlanGenerator implements PlanGenerator {
  private llmAdapter: LLMAdapter | null
  private fallbackGenerator: DeterministicPlanGenerator
  private validator: PlanValidator

  constructor(deps: {
    llmAdapter?: LLMAdapter | null
    deterministicGenerator: DeterministicPlanGenerator
    validator: PlanValidator
  }) {
    this.llmAdapter = deps.llmAdapter ?? null
    this.fallbackGenerator = deps.deterministicGenerator
    this.validator = deps.validator
  }

  async generate(input: PlanGenerationInput): Promise<PlanGenerationOutput> {
    if (!this.llmAdapter) {
      return this.fallbackGenerator.generate(input)
    }

    let plan: ExecutionPlan | null = null
    let validationPassed = false
    let attempts = 0

    try {
      plan = await this.callLLMAdapter(input)
    } catch {
      plan = null
    }

    while (plan !== null && !validationPassed && attempts < 2) {
      attempts++
      const validationResult = this.validator.validate(plan)

      if (validationResult.valid) {
        validationPassed = true
      } else if (attempts < 2) {
        try {
          plan = await this.callLLMAdapter(input)
        } catch {
          plan = null
          break
        }
      }
    }

    if (plan !== null && validationPassed) {
      return { plan }
    }

    return this.fallbackGenerator.generate(input)
  }

  private async callLLMAdapter(input: PlanGenerationInput): Promise<ExecutionPlan | null> {
    if (!this.llmAdapter) return null
    return this.llmAdapter.generatePlan(input)
  }
}
