import { describe, it, expect } from 'vitest'
import type {
  StructuredDecisionTrace,
  DecisionRoute,
  ToolSelectionRecord,
  ObservationSummary,
  RiskAssessmentRecord,
} from '../../../src/kernel/decision-trace-types.js'

describe('StructuredDecisionTrace types', () => {
  it('DecisionRoute accepts answer_directly, tool_loop, and failed', () => {
    const routes: DecisionRoute[] = ['answer_directly', 'tool_loop', 'failed']
    expect(routes).toHaveLength(3)
  })

  it('ToolSelectionRecord has required fields', () => {
    const record: ToolSelectionRecord = {
      toolName: 'web_search',
      toolCallId: 'call_123',
      selectionReason: 'llm_choice',
    }
    expect(record.toolName).toBe('web_search')
    expect(record.selectionReason).toBe('llm_choice')
  })

  it('ToolSelectionRecord accepts rejectionReason', () => {
    const record: ToolSelectionRecord = {
      toolName: 'file_write',
      selectionReason: 'llm_choice',
      rejectionReason: 'permission_denied',
    }
    expect(record.rejectionReason).toBe('permission_denied')
  })

  it('ObservationSummary has required fields', () => {
    const summary: ObservationSummary = {
      toolName: 'web_search',
      toolCallId: 'call_456',
      summaryType: 'search_facts',
      summary: 'Found 3 results about TypeScript',
    }
    expect(summary.summaryType).toBe('search_facts')
    expect(summary.evidenceCount).toBeUndefined()
  })

  it('ObservationSummary accepts optional evidenceCount', () => {
    const summary: ObservationSummary = {
      toolName: 'web_search',
      toolCallId: 'call_456',
      summaryType: 'search_facts',
      summary: 'Found 3 results',
      evidenceCount: 3,
    }
    expect(summary.evidenceCount).toBe(3)
  })

  it('RiskAssessmentRecord has all required fields', () => {
    const record: RiskAssessmentRecord = {
      toolName: 'file_write',
      toolCallId: 'call_789',
      riskLevel: 'high',
      riskReason: 'Write operations modify files on disk',
      approvalStatus: 'auto_approved',
    }
    expect(record.riskLevel).toBe('high')
    expect(record.denialReason).toBeUndefined()
  })

  it('RiskAssessmentRecord accepts denialReason', () => {
    const record: RiskAssessmentRecord = {
      toolName: 'file_delete',
      toolCallId: 'call_999',
      riskLevel: 'high',
      riskReason: 'Delete operations remove files',
      approvalStatus: 'denied',
      denialReason: 'User rejected the operation',
    }
    expect(record.denialReason).toBe('User rejected the operation')
  })

  it('StructuredDecisionTrace has all fields', () => {
    const trace: StructuredDecisionTrace = {
      route: 'tool_loop',
      intent: 'search the web for latest news',
      candidateTools: ['web_search', 'file_read'],
      selectedTools: [],
      rejectedTools: [],
      observationSummaries: [],
      riskAssessments: [],
      finalAnswerSource: 'llm_direct',
    }
    expect(trace.route).toBe('tool_loop')
    expect(trace.finalAnswerSource).toBe('llm_direct')
    expect(trace.reasoningSummary).toBeUndefined()
  })

  it('StructuredDecisionTrace accepts optional reasoningSummary', () => {
    const trace: StructuredDecisionTrace = {
      route: 'answer_directly',
      intent: 'greeting',
      candidateTools: [],
      selectedTools: [],
      rejectedTools: [],
      observationSummaries: [],
      riskAssessments: [],
      finalAnswerSource: 'llm_direct',
      reasoningSummary: 'Simple greeting, no tools needed',
    }
    expect(trace.reasoningSummary).toBe('Simple greeting, no tools needed')
  })

  it('all selectionReason values are valid', () => {
    const reasons: ToolSelectionRecord['selectionReason'][] = ['llm_choice', 'internal_handler', 'auto_approved']
    expect(reasons).toHaveLength(3)
  })

  it('all rejectionReason values are valid', () => {
    const reasons: ToolSelectionRecord['rejectionReason'][] = ['not_called', 'permission_denied', 'unprojected']
    expect(reasons).toHaveLength(3)
  })

  it('all approvalStatus values are valid', () => {
    const statuses: RiskAssessmentRecord['approvalStatus'][] = [
      'auto_approved',
      'pending',
      'approved',
      'denied',
      'not_required',
    ]
    expect(statuses).toHaveLength(5)
  })

  it('all summaryType values are valid', () => {
    const types: ObservationSummary['summaryType'][] = ['search_facts', 'file_preview', 'memory_keywords', 'generic']
    expect(types).toHaveLength(4)
  })
})
