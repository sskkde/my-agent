export interface SegmentHashDiff {
  caseId: string
  segment: string
  baselineHash: string
  currentHash: string
}

export interface TokenDiff {
  caseId: string
  baselineTokens: number
  currentTokens: number
  delta: number
}

export interface ToolSelectionDiff {
  caseId: string
  addedTools: string[]
  removedTools: string[]
}

export interface SchemaFailureDiff {
  caseId: string
  baselineFailed: boolean
  currentFailed: boolean
}

export interface DiffReportSummary {
  totalCases: number
  changed: number
  regressions: number
  improvements: number
}

export interface PromptDiffReport {
  baselineId: string
  currentId: string
  timestamp: string
  segmentHashChanges: SegmentHashDiff[]
  tokenChanges: TokenDiff[]
  toolSelectionChanges: ToolSelectionDiff[]
  schemaFailureRateChanges: SchemaFailureDiff[]
  summary: DiffReportSummary
}
