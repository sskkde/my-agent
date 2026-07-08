import { describe, it, expect } from 'vitest'
import { generateDiffReport } from '../../../src/golden/diff-report-generator.js'
import type { GoldenCaseResult } from '../../../src/golden/regression-runner.js'

describe('generateDiffReport', () => {
  const makeBaselineResult = (caseId: string, passed: boolean): GoldenCaseResult => ({
    caseId,
    passed,
    diffs: [],
  })

  const makeCurrentResult = (caseId: string, passed: boolean, diffs?: Array<{ path: string; expected: unknown; actual: unknown; message: string }>): GoldenCaseResult => ({
    caseId,
    passed,
    diffs: diffs ?? [],
  })

  it('returns empty changes when baseline and current are identical', () => {
    const baseline: GoldenCaseResult[] = [
      makeBaselineResult('case-1', true),
      makeBaselineResult('case-2', true),
    ]
    const current: GoldenCaseResult[] = [
      makeCurrentResult('case-1', true),
      makeCurrentResult('case-2', true),
    ]

    const report = generateDiffReport(baseline, current)

    expect(report.baselineId).toBe('baseline')
    expect(report.currentId).toBe('current')
    expect(report.timestamp).toBeDefined()
    expect(report.segmentHashChanges).toEqual([])
    expect(report.tokenChanges).toEqual([])
    expect(report.toolSelectionChanges).toEqual([])
    expect(report.schemaFailureRateChanges).toEqual([])
    expect(report.summary.totalCases).toBe(2)
    expect(report.summary.changed).toBe(0)
    expect(report.summary.regressions).toBe(0)
    expect(report.summary.improvements).toBe(0)
  })

  it('detects a regression when a case goes from passed to failed', () => {
    const baseline: GoldenCaseResult[] = [
      makeBaselineResult('case-1', true),
    ]
    const current: GoldenCaseResult[] = [
      makeCurrentResult('case-1', false, [
        { path: 'expectedTools', expected: ['web.search'], actual: [], message: 'Missing tool' },
      ]),
    ]

    const report = generateDiffReport(baseline, current)

    expect(report.summary.regressions).toBe(1)
    expect(report.summary.changed).toBe(1)
    expect(report.toolSelectionChanges.length).toBeGreaterThanOrEqual(1)
  })

  it('detects an improvement when a case goes from failed to passed', () => {
    const baseline: GoldenCaseResult[] = [
      makeBaselineResult('case-1', false),
    ]
    const current: GoldenCaseResult[] = [
      makeCurrentResult('case-1', true),
    ]

    const report = generateDiffReport(baseline, current)

    expect(report.summary.improvements).toBe(1)
    expect(report.summary.changed).toBe(1)
  })

  it('reports segment hash changes', () => {
    const baseline: GoldenCaseResult[] = [
      makeBaselineResult('case-1', true),
    ]
    const current: GoldenCaseResult[] = [
      makeCurrentResult('case-1', false, [
        { path: 'segmentHash.segmentA', expected: 'abcdef', actual: '123456', message: 'Hash mismatch' },
      ]),
    ]

    const report = generateDiffReport(baseline, current)

    expect(report.segmentHashChanges.length).toBe(1)
    expect(report.segmentHashChanges[0].caseId).toBe('case-1')
    expect(report.segmentHashChanges[0].segment).toBe('segmentA')
    expect(report.segmentHashChanges[0].baselineHash).toBe('abcdef')
    expect(report.segmentHashChanges[0].currentHash).toBe('123456')
  })
})
