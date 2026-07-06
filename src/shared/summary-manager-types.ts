import type { SourceRefs, SummaryRecord, SummaryType } from '../storage/summary-store.js'
import type {
  WorkingSummaryRequest,
  WorkingSummary,
  SessionMemory,
  SummaryWriteResult,
  SummaryWriteOptions,
  SummaryContent,
  RollingSummaryContent,
  WorkflowRunSummaryContent,
  BackgroundSubagentSummaryContent,
  CompactSummaryContent,
  WeeklySummaryContent,
  PlannerRunSummaryContent,
  SummaryVersionEntry,
} from '../memory/types.js'

export interface SummaryManager {
  generateWorkingSummary(request: WorkingSummaryRequest): WorkingSummary

  validateSourceRefs(sourceRefs: SourceRefs): boolean

  writeWorkingSummary(
    sessionId: string,
    runId: string,
    userId: string,
    content: SummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<WorkingSummary>>

  writeSessionMemory(
    sessionId: string,
    userId: string,
    content: SummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SessionMemory>>

  writeRollingSummary(
    sessionId: string,
    userId: string,
    summaryType: 'rolling_5_turns' | 'rolling_10_turns',
    content: RollingSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  writeDailySummary(
    userId: string,
    content: SummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  writeWeeklySummary(
    userId: string,
    content: WeeklySummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  writeWorkflowRunSummary(
    workflowRunId: string,
    userId: string,
    content: WorkflowRunSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  writeBackgroundSubagentSummary(
    backgroundRunId: string,
    userId: string,
    content: BackgroundSubagentSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  writeCompactSummary(
    sessionId: string,
    userId: string,
    content: CompactSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  writePlannerRunSummary(
    userId: string,
    content: PlannerRunSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  getVersionHistory(summaryId: string, limit?: number): SummaryVersionEntry[]

  getCurrentVersion(summaryId: string): number

  storeLowConfidenceFallback(
    summaryType: SummaryType,
    userId: string,
    rawContent: unknown,
    validationErrors: string[],
    options: SummaryWriteOptions,
  ): SummaryRecord
}
