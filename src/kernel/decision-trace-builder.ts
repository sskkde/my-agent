import type { KernelRunState, KernelRunInput, KernelTranscriptEntry, ToolUseResult } from './types.js'
import type { StructuredDecisionTrace, ToolSelectionRecord, RiskAssessmentRecord } from './decision-trace-types.js'
import { buildObservationSummary } from './observation-summary-builder.js'

function isHighRiskTool(toolName: string): boolean {
  const highRiskPrefixes = ['write', 'delete', 'send', 'execute', 'admin']
  return highRiskPrefixes.some((prefix) => toolName.startsWith(prefix) || toolName.includes(prefix))
}

function buildRiskAssessment(toolName: string, toolCallId: string): RiskAssessmentRecord {
  return { toolName, toolCallId, riskLevel: 'high', riskReason: `${toolName} belongs to a high-risk tool category`, approvalStatus: 'not_required' }
}

function isToolResultEntry(entry: KernelTranscriptEntry): entry is KernelTranscriptEntry & { content: ToolUseResult } {
  return entry.type === 'tool_result' && typeof entry.content === 'object' && entry.content !== null
}

export function buildDecisionTrace(
  state: KernelRunState,
  input: KernelRunInput,
  finalContent?: string,
): StructuredDecisionTrace {
  const candidateTools = input.toolProjection?.toolIds ?? []

  const selectedTools: ToolSelectionRecord[] = state.toolCalls.map((tc) => ({
    toolName: tc.toolName,
    toolCallId: tc.toolCallId,
    selectionReason: 'llm_choice' as const,
  }))

  const selectedNames = new Set(selectedTools.map((s) => s.toolName))
  const rejectedTools: ToolSelectionRecord[] = candidateTools
    .filter((name) => !selectedNames.has(name))
    .map((name) => ({ toolName: name, selectionReason: 'llm_choice' as const, rejectionReason: 'not_called' as const }))

  const observationSummaries = state.transcript
    .filter(isToolResultEntry)
    .map((entry) => {
      const tc = state.toolCalls.find((t) => t.toolCallId === (entry.content as ToolUseResult).toolCallId)
      return buildObservationSummary(tc?.toolName ?? 'unknown', entry.content as ToolUseResult)
    })

  const riskAssessments: RiskAssessmentRecord[] = selectedTools
    .filter((st) => st.toolCallId && isHighRiskTool(st.toolName))
    .map((st) => buildRiskAssessment(st.toolName, st.toolCallId!))

  const hasToolCalls = state.toolCalls.length > 0
  const route = hasToolCalls ? 'tool_loop' : state.status === 'failed' ? 'failed' : 'answer_directly'
  const finalAnswerSource = hasToolCalls && finalContent ? 'tool_synthesized' : state.status === 'failed' ? 'error' : 'llm_direct'
  const intent = (input.contextBundle?.agentType as string) ?? 'unknown'

  return { route, intent, candidateTools, selectedTools, rejectedTools, observationSummaries, riskAssessments, finalAnswerSource }
}
