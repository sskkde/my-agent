import type { GoldenCaseResult } from './regression-runner.js'
import type {
  PromptDiffReport,
  SegmentHashDiff,
  TokenDiff,
  ToolSelectionDiff,
  SchemaFailureDiff,
  DiffReportSummary,
} from './diff-report-types.js'

function extractTokenCount(result: GoldenCaseResult): number {
  const tokenDiff = result.diffs.find((d) => d.path === 'maxTokenEstimate')
  return (tokenDiff?.actual as number) ?? 0
}

export function generateDiffReport(
  baseline: GoldenCaseResult[],
  current: GoldenCaseResult[],
  baselineId = 'baseline',
  currentId = 'current',
): PromptDiffReport {
  const baselineMap = new Map(baseline.map((r) => [r.caseId, r]))
  const currentMap = new Map(current.map((r) => [r.caseId, r]))

  const segmentHashChanges: SegmentHashDiff[] = []
  const tokenChanges: TokenDiff[] = []
  const toolSelectionChanges: ToolSelectionDiff[] = []
  const schemaFailureRateChanges: SchemaFailureDiff[] = []

  let changed = 0
  let regressions = 0
  let improvements = 0

  for (const [caseId, currentResult] of currentMap) {
    const baselineResult = baselineMap.get(caseId)
    if (!baselineResult) continue

    if (baselineResult.passed !== currentResult.passed) {
      changed++
      if (currentResult.passed && !baselineResult.passed) {
        improvements++
      } else {
        regressions++
      }
    }

    for (const diff of currentResult.diffs) {
      if (diff.path.startsWith('segmentHash.')) {
        const segment = diff.path.replace('segmentHash.', '')
        segmentHashChanges.push({
          caseId,
          segment,
          baselineHash: diff.expected as string,
          currentHash: diff.actual as string,
        })
      }
    }

    const baselineTokens = extractTokenCount(baselineResult)
    const currentTokens = extractTokenCount(currentResult)
    if (baselineTokens !== currentTokens) {
      tokenChanges.push({
        caseId,
        baselineTokens,
        currentTokens,
        delta: currentTokens - baselineTokens,
      })
    }

    const baselineToolDiff = baselineResult.diffs.find((d) => d.path === 'expectedTools')
    const currentToolDiff = currentResult.diffs.find((d) => d.path === 'expectedTools')
    if (baselineToolDiff || currentToolDiff) {
      const baselineTools: string[] = baselineToolDiff
        ? (baselineToolDiff.actual as string[])
        : (currentToolDiff!.expected as string[])
      const currentTools: string[] = currentToolDiff
        ? (currentToolDiff.actual as string[])
        : (baselineToolDiff!.expected as string[])
      const addedTools = currentTools.filter((t) => !baselineTools.includes(t))
      const removedTools = baselineTools.filter((t) => !currentTools.includes(t))
      if (addedTools.length > 0 || removedTools.length > 0) {
        toolSelectionChanges.push({ caseId, addedTools, removedTools })
      }
    }

    const baselineSchemaFailed = baselineResult.diffs.some((d) => d.path === 'outputContract')
    const currentSchemaFailed = currentResult.diffs.some((d) => d.path === 'outputContract')
    if (baselineSchemaFailed !== currentSchemaFailed) {
      schemaFailureRateChanges.push({
        caseId,
        baselineFailed: baselineSchemaFailed,
        currentFailed: currentSchemaFailed,
      })
    }
  }

  const summary: DiffReportSummary = {
    totalCases: current.length,
    changed,
    regressions,
    improvements,
  }

  return {
    baselineId,
    currentId,
    timestamp: new Date().toISOString(),
    segmentHashChanges,
    tokenChanges,
    toolSelectionChanges,
    schemaFailureRateChanges,
    summary,
  }
}
