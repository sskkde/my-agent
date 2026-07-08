export type DecisionRoute = 'answer_directly' | 'tool_loop' | 'failed'

export interface ToolSelectionRecord {
  toolName: string
  toolCallId?: string
  selectionReason: 'llm_choice' | 'internal_handler' | 'auto_approved'
  rejectionReason?: 'not_called' | 'permission_denied' | 'unprojected'
}

export interface ObservationSummary {
  toolName: string
  toolCallId: string
  summaryType: 'search_facts' | 'file_preview' | 'memory_keywords' | 'generic'
  summary: string
  evidenceCount?: number
}

export interface RiskAssessmentRecord {
  toolName: string
  toolCallId: string
  riskLevel: 'high' | 'medium' | 'low'
  riskReason: string
  approvalStatus: 'auto_approved' | 'pending' | 'approved' | 'denied' | 'not_required'
  denialReason?: string
}

export interface StructuredDecisionTrace {
  route: DecisionRoute
  intent: string
  candidateTools: string[]
  selectedTools: ToolSelectionRecord[]
  rejectedTools: ToolSelectionRecord[]
  observationSummaries: ObservationSummary[]
  riskAssessments: RiskAssessmentRecord[]
  finalAnswerSource: 'llm_direct' | 'tool_synthesized' | 'error'
  reasoningSummary?: string
}
