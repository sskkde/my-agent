import type { PlanGenerationInput, PlanGenerationOutput } from './plan-schema.js';

export interface PlanGenerator {
  generate(input: PlanGenerationInput): PlanGenerationOutput;
}
