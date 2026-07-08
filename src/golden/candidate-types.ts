import type { GoldenCaseResult } from './regression-runner.js'
import type { PromptDiffReport } from './diff-report-types.js'

export interface TemplateOverride {
  templateId: string
  content: string
}

export interface PromptCandidate {
  candidateId: string
  description: string
  templateOverrides: TemplateOverride[]
  featureFlagOverrides: Record<string, string>
  createdAt: string
}

export interface CandidateResult {
  candidate: PromptCandidate
  goldenResults: GoldenCaseResult[]
  diffReport: PromptDiffReport
  approved: boolean
}
