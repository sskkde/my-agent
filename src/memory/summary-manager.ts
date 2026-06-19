import type { SummaryStore, SourceRefs, SummaryRecord, SummaryType } from '../storage/summary-store.js'
import type { TranscriptStore } from '../storage/transcript-store.js'
import type { TraceStore } from '../observability/types.js'
import type { AuditRecorder } from '../observability/audit-types.js'
import type {
  SummaryManager,
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
  SummaryWriteErrorCode,
} from './types.js'
import { randomUUID } from 'crypto'

export type { SummaryManager } from './types.js'

const DETERMINISTIC_FIELDS = ['summaryId', 'userId', 'sessionId', 'runId', 'createdAt', 'sourceRefs'] as const

type VersionStore = {
  getVersionEntries(summaryId: string, limit?: number): SummaryVersionEntry[]
  addVersionEntry(entry: SummaryVersionEntry): void
  getCurrentVersion(summaryId: string): number
}

function createVersionStore(): VersionStore {
  const versions = new Map<string, SummaryVersionEntry[]>()

  return {
    getVersionEntries(summaryId: string, limit?: number): SummaryVersionEntry[] {
      const entries = versions.get(summaryId) ?? []
      return limit ? entries.slice(0, limit) : entries
    },
    addVersionEntry(entry: SummaryVersionEntry): void {
      const existing = versions.get(entry.summaryId) ?? []
      versions.set(entry.summaryId, [entry, ...existing])
    },
    getCurrentVersion(summaryId: string): number {
      const entries = versions.get(summaryId) ?? []
      return entries.length > 0 ? Math.max(...entries.map((e) => e.version)) : 0
    },
  }
}

function validateSourceRefsOrThrow(sourceRefs: SourceRefs): void {
  if (!sourceRefs || typeof sourceRefs !== 'object') {
    throw createWriteError('MISSING_SOURCE_REFS', 'sourceRefs is required and must be an object')
  }

  const hasTranscriptRefs = Array.isArray(sourceRefs.transcriptRefs) && sourceRefs.transcriptRefs.length > 0

  const hasEventRange =
    sourceRefs.eventRange &&
    typeof sourceRefs.eventRange.startEventId === 'string' &&
    typeof sourceRefs.eventRange.endEventId === 'string'

  const hasPreviousSummaryRefs =
    Array.isArray(sourceRefs.previousSummaryRefs) && sourceRefs.previousSummaryRefs.length > 0

  if (!hasTranscriptRefs && !hasEventRange && !hasPreviousSummaryRefs) {
    throw createWriteError(
      'MISSING_SOURCE_REFS',
      'sourceRefs must contain at least one of: transcriptRefs, eventRange, or previousSummaryRefs',
    )
  }
}

function createWriteError(code: SummaryWriteErrorCode, message: string): Error {
  const error = new Error(message)
  ;(error as Error & { code: SummaryWriteErrorCode }).code = code
  return error
}

function generateSummaryId(): string {
  return `sum-${randomUUID()}`
}

function computeDiff(
  existing: SummaryRecord | null,
  updates: Partial<SummaryRecord>,
): { changedFields: string[]; previousValues: Record<string, unknown> } {
  if (!existing) {
    return { changedFields: Object.keys(updates), previousValues: {} }
  }

  const changedFields: string[] = []
  const previousValues: Record<string, unknown> = {}

  for (const key of Object.keys(updates) as (keyof SummaryRecord)[]) {
    if (JSON.stringify(existing[key]) !== JSON.stringify(updates[key])) {
      changedFields.push(key)
      previousValues[key] = existing[key]
    }
  }

  return { changedFields, previousValues }
}

function protectDeterministicFields(
  existing: SummaryRecord | null,
  updates: Record<string, unknown>,
  isLlmGenerated: boolean,
): Record<string, unknown> {
  if (!isLlmGenerated || !existing) {
    return updates
  }

  const protectedUpdates = { ...updates }
  for (const field of DETERMINISTIC_FIELDS) {
    if (field in protectedUpdates) {
      delete protectedUpdates[field]
    }
  }
  return protectedUpdates
}

export function createSummaryManager(
  summaryStore: SummaryStore,
  _transcriptStore: TranscriptStore,
  observability?: { traceStore?: TraceStore; auditRecorder?: AuditRecorder },
): SummaryManager {
  const versionStore = createVersionStore()

  return {
    generateWorkingSummary,
    validateSourceRefs,
    writeWorkingSummary,
    writeSessionMemory,
    writeRollingSummary,
    writeDailySummary,
    writeWeeklySummary,
    writeWorkflowRunSummary,
    writeBackgroundSubagentSummary,
    writeCompactSummary,
    writePlannerRunSummary,
    getVersionHistory,
    getCurrentVersion,
    storeLowConfidenceFallback,
  }

  function generateWorkingSummary(request: WorkingSummaryRequest): WorkingSummary {
    if (!validateSourceRefs(request.sourceRefs)) {
      throw new Error('sourceRefs must contain at least one of: transcriptRefs, eventRange, or previousSummaryRefs')
    }

    const summary: WorkingSummary = {
      summaryId: request.summaryId,
      summaryType: 'working_summary',
      userId: request.userId,
      runId: request.runId,
      sessionId: request.sessionId,
      relatedRefs: request.relatedRefs,
      sourceRefs: request.sourceRefs,
      summary: generateSummaryText(request),
      structuredState: request.structuredState,
      status: 'active',
      retrieval: {
        keywords: extractKeywords(request),
        importance: 'medium',
      },
      createdAt: new Date().toISOString(),
    }

    summaryStore.save({
      summaryId: summary.summaryId,
      summaryType: summary.summaryType,
      userId: summary.userId,
      sessionId: summary.sessionId,
      runId: summary.runId,
      relatedRefs: summary.relatedRefs,
      sourceRefs: summary.sourceRefs,
      summary: summary.summary,
      structuredState: summary.structuredState,
      status: summary.status,
      retrieval: summary.retrieval,
      createdAt: summary.createdAt,
    })

    observability?.traceStore?.createSpan({
      spanId: `span_summary_${summary.summaryId}`,
      traceId: request.runId,
      spanType: 'summary_write',
      module: 'memory',
      operation: 'summary_write',
      status: 'completed',
      startTime: summary.createdAt,
      endTime: summary.createdAt,
      durationMs: 0,
      metadata: {
        summaryType: summary.summaryType,
        sessionId: request.sessionId,
        runId: request.runId,
      },
    })

    observability?.auditRecorder?.recordSummaryWrite({
      summaryId: summary.summaryId,
      summaryType: summary.summaryType,
      userId: request.userId,
      sessionId: request.sessionId,
      runId: request.runId,
      correlationId: request.runId,
    })

    return summary
  }

  function validateSourceRefs(sourceRefs: SourceRefs): boolean {
    if (!sourceRefs || typeof sourceRefs !== 'object') {
      return false
    }

    const hasTranscriptRefs = Array.isArray(sourceRefs.transcriptRefs) && sourceRefs.transcriptRefs.length > 0

    const hasEventRange =
      sourceRefs.eventRange &&
      typeof sourceRefs.eventRange.startEventId === 'string' &&
      typeof sourceRefs.eventRange.endEventId === 'string'

    const hasPreviousSummaryRefs =
      Array.isArray(sourceRefs.previousSummaryRefs) && sourceRefs.previousSummaryRefs.length > 0

    return hasTranscriptRefs || hasEventRange || hasPreviousSummaryRefs
  }

  async function writeWorkingSummary(
    sessionId: string,
    runId: string,
    userId: string,
    content: SummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<WorkingSummary>> {
    try {
      validateSourceRefsOrThrow(options.sourceRefs)
    } catch (error) {
      return errorToResult(error)
    }

    const summaryId = generateSummaryId()
    const now = new Date().toISOString()

    const record: SummaryRecord = {
      summaryId,
      summaryType: 'working_summary',
      userId,
      sessionId,
      runId,
      sourceRefs: options.sourceRefs,
      summary: content.summary,
      structuredState: content.structuredState,
      status: 'active',
      retrieval: content.retrieval ?? { keywords: [], importance: 'medium' },
      createdAt: now,
    }

    summaryStore.save(record)

    const version = recordVersion(record, null, options.sourceRefs, 'system')

    return {
      success: true,
      data: record as WorkingSummary,
      version,
    }
  }

  async function writeSessionMemory(
    sessionId: string,
    userId: string,
    content: SummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SessionMemory>> {
    try {
      validateSourceRefsOrThrow(options.sourceRefs)
    } catch (error) {
      return errorToResult(error)
    }

    const existing = summaryStore.getSessionMemory(sessionId)
    const now = new Date().toISOString()

    const updates: Record<string, unknown> = {
      summary: content.summary,
      structuredState: content.structuredState,
      retrieval: content.retrieval,
      updatedAt: now,
    }

    const protectedUpdates = protectDeterministicFields(existing, updates, options.isLlmGenerated ?? false)

    let record: SummaryRecord

    if (existing) {
      const { changedFields, previousValues } = computeDiff(existing, protectedUpdates)

      record = {
        ...existing,
        ...protectedUpdates,
        updatedAt: now,
      }

      if (changedFields.length > 0) {
        summaryStore.save(record)
        recordVersion(
          record,
          { changedFields, previousValues },
          options.sourceRefs,
          options.isLlmGenerated ? 'llm' : 'system',
        )
      }
    } else {
      record = {
        summaryId: generateSummaryId(),
        summaryType: 'session_memory',
        userId,
        sessionId,
        sourceRefs: options.sourceRefs,
        summary: content.summary,
        structuredState: content.structuredState,
        status: 'active',
        retrieval: content.retrieval ?? { keywords: [], importance: 'medium' },
        createdAt: now,
      }

      summaryStore.save(record)
      recordVersion(record, null, options.sourceRefs, 'system')
    }

    return {
      success: true,
      data: record as SessionMemory,
      version: versionStore.getCurrentVersion(record.summaryId),
    }
  }

  async function writeRollingSummary(
    sessionId: string,
    userId: string,
    summaryType: 'rolling_5_turns' | 'rolling_10_turns',
    content: RollingSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>> {
    try {
      validateSourceRefsOrThrow(options.sourceRefs)
    } catch (error) {
      return errorToResult(error)
    }

    const summaryId = generateSummaryId()
    const now = new Date().toISOString()

    const record: SummaryRecord = {
      summaryId,
      summaryType,
      userId,
      sessionId,
      sourceRefs: options.sourceRefs,
      summary: content.summary,
      structuredState: {
        ...content.structuredState,
        turnRange: content.turnRange,
      },
      status: 'active',
      retrieval: content.retrieval ?? { keywords: [], importance: 'medium' },
      createdAt: now,
    }

    summaryStore.save(record)
    const version = recordVersion(record, null, options.sourceRefs, 'system')

    return { success: true, data: record, version }
  }

  async function writeDailySummary(
    userId: string,
    content: SummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>> {
    try {
      validateSourceRefsOrThrow(options.sourceRefs)
    } catch (error) {
      return errorToResult(error)
    }

    const summaryId = generateSummaryId()
    const now = new Date().toISOString()

    const record: SummaryRecord = {
      summaryId,
      summaryType: 'daily_summary',
      userId,
      sourceRefs: options.sourceRefs,
      summary: content.summary,
      structuredState: content.structuredState,
      status: 'active',
      retrieval: content.retrieval ?? { keywords: [], importance: 'medium' },
      createdAt: now,
    }

    summaryStore.save(record)
    const version = recordVersion(record, null, options.sourceRefs, 'system')

    return { success: true, data: record, version }
  }

  async function writeWeeklySummary(
    userId: string,
    content: WeeklySummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>> {
    try {
      validateSourceRefsOrThrow(options.sourceRefs)
    } catch (error) {
      return errorToResult(error)
    }

    const summaryId = generateSummaryId()
    const now = new Date().toISOString()

    const record: SummaryRecord = {
      summaryId,
      summaryType: 'weekly_summary',
      userId,
      sourceRefs: options.sourceRefs,
      summary: content.summary,
      structuredState: {
        ...content.structuredState,
        weekRange: content.weekRange,
      },
      status: 'active',
      retrieval: content.retrieval ?? { keywords: [], importance: 'medium' },
      createdAt: now,
    }

    summaryStore.save(record)
    const version = recordVersion(record, null, options.sourceRefs, 'system')

    return { success: true, data: record, version }
  }

  async function writeWorkflowRunSummary(
    workflowRunId: string,
    userId: string,
    content: WorkflowRunSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>> {
    try {
      validateSourceRefsOrThrow(options.sourceRefs)
    } catch (error) {
      return errorToResult(error)
    }

    const summaryId = generateSummaryId()
    const now = new Date().toISOString()

    const record: SummaryRecord = {
      summaryId,
      summaryType: 'workflow_run_summary',
      userId,
      relatedRefs: { workflowRunId },
      sourceRefs: options.sourceRefs,
      summary: content.summary,
      structuredState: {
        ...content.structuredState,
        workflowStatus: content.workflowStatus,
        stepSummary: content.stepSummary,
      },
      status: 'active',
      retrieval: content.retrieval ?? { keywords: [], importance: 'medium' },
      createdAt: now,
    }

    summaryStore.save(record)
    const version = recordVersion(record, null, options.sourceRefs, 'system')

    return { success: true, data: record, version }
  }

  async function writeBackgroundSubagentSummary(
    backgroundRunId: string,
    userId: string,
    content: BackgroundSubagentSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>> {
    try {
      validateSourceRefsOrThrow(options.sourceRefs)
    } catch (error) {
      return errorToResult(error)
    }

    const summaryId = generateSummaryId()
    const now = new Date().toISOString()

    const record: SummaryRecord = {
      summaryId,
      summaryType: 'background_subagent_summary',
      userId,
      relatedRefs: { backgroundRunId },
      sourceRefs: options.sourceRefs,
      summary: content.summary,
      structuredState: {
        ...content.structuredState,
        subagentType: content.subagentType,
        agentProfile: content.agentProfile,
        outputContract: content.outputContract,
        taskDescription: content.taskDescription,
      },
      status: 'active',
      retrieval: content.retrieval ?? { keywords: [], importance: 'medium' },
      createdAt: now,
    }

    summaryStore.save(record)
    const version = recordVersion(record, null, options.sourceRefs, 'system')

    return { success: true, data: record, version }
  }

  async function writeCompactSummary(
    sessionId: string,
    userId: string,
    content: CompactSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>> {
    try {
      validateSourceRefsOrThrow(options.sourceRefs)
    } catch (error) {
      return errorToResult(error)
    }

    const summaryId = generateSummaryId()
    const now = new Date().toISOString()

    const record: SummaryRecord = {
      summaryId,
      summaryType: 'compact_summary',
      userId,
      sessionId,
      sourceRefs: options.sourceRefs,
      summary: content.summary,
      structuredState: {
        ...content.structuredState,
        compactedSummaryIds: content.compactedSummaryIds,
        compressionRatio: content.compressionRatio,
      },
      status: 'active',
      retrieval: content.retrieval ?? { keywords: [], importance: 'medium' },
      createdAt: now,
    }

    summaryStore.save(record)
    const version = recordVersion(record, null, options.sourceRefs, 'system')

    return { success: true, data: record, version }
  }

  async function writePlannerRunSummary(
    userId: string,
    content: PlannerRunSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>> {
    try {
      validateSourceRefsOrThrow(options.sourceRefs)
    } catch (error) {
      return errorToResult(error)
    }

    const summaryId = generateSummaryId()
    const now = new Date().toISOString()

    const record: SummaryRecord = {
      summaryId,
      summaryType: 'planner_run_summary',
      userId,
      relatedRefs: { plannerRunId: content.plannerRunId },
      sourceRefs: options.sourceRefs,
      summary: content.summary,
      structuredState: {
        ...content.structuredState,
        planStatus: content.planStatus,
        stepSummary: content.stepSummary,
      },
      status: 'active',
      retrieval: content.retrieval ?? { keywords: [], importance: 'medium' },
      createdAt: now,
    }

    summaryStore.save(record)
    const version = recordVersion(record, null, options.sourceRefs, 'system')

    return { success: true, data: record, version }
  }

  function getVersionHistory(summaryId: string, limit?: number): SummaryVersionEntry[] {
    return versionStore.getVersionEntries(summaryId, limit)
  }

  function getCurrentVersion(summaryId: string): number {
    return versionStore.getCurrentVersion(summaryId)
  }

  function storeLowConfidenceFallback(
    summaryType: SummaryType,
    userId: string,
    rawContent: unknown,
    validationErrors: string[],
    options: SummaryWriteOptions,
  ): SummaryRecord {
    const summaryId = generateSummaryId()
    const now = new Date().toISOString()

    const record: SummaryRecord = {
      summaryId,
      summaryType,
      userId,
      sourceRefs: options.sourceRefs,
      summary: `[LOW_CONFIDENCE] Schema validation failed: ${validationErrors.join('; ')}`,
      structuredState: {
        rawContent,
        validationErrors,
        fallbackReason: 'schema_validation_failed',
      },
      status: 'candidate',
      retrieval: {
        keywords: ['low_confidence', 'fallback'],
        importance: 'low',
      },
      createdAt: now,
    }

    summaryStore.save(record)
    recordVersion(record, null, options.sourceRefs, 'system')

    return record
  }

  function recordVersion(
    record: SummaryRecord,
    diff: { changedFields: string[]; previousValues: Record<string, unknown> } | null,
    sourceRefs: SourceRefs,
    createdBy: 'llm' | 'system',
  ): number {
    const currentVersion = versionStore.getCurrentVersion(record.summaryId)
    const newVersion = currentVersion + 1

    const entry: SummaryVersionEntry = {
      version: newVersion,
      summaryId: record.summaryId,
      summaryType: record.summaryType,
      changedFields: diff?.changedFields ?? [],
      previousValues: diff?.previousValues ?? {},
      sourceRefs,
      createdAt: new Date().toISOString(),
      createdBy,
    }

    versionStore.addVersionEntry(entry)
    return newVersion
  }

  function errorToResult(error: unknown): SummaryWriteResult<never> {
    const code = (error as Error & { code?: SummaryWriteErrorCode }).code ?? 'INVALID_SCHEMA'
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, code, message }
  }

  function generateSummaryText(request: WorkingSummaryRequest): string {
    const parts: string[] = []

    if (request.sourceRefs.transcriptRefs && request.sourceRefs.transcriptRefs.length > 0) {
      parts.push(`Based on ${request.sourceRefs.transcriptRefs.length} transcript references`)
    }

    if (request.sourceRefs.eventRange) {
      parts.push(
        `Covering events from ${request.sourceRefs.eventRange.startEventId} to ${request.sourceRefs.eventRange.endEventId}`,
      )
    }

    if (request.sourceRefs.previousSummaryRefs && request.sourceRefs.previousSummaryRefs.length > 0) {
      parts.push(`Building on ${request.sourceRefs.previousSummaryRefs.length} previous summaries`)
    }

    if (request.structuredState) {
      const stateKeys = Object.keys(request.structuredState)
      if (stateKeys.length > 0) {
        parts.push(`State: ${stateKeys.join(', ')}`)
      }
    }

    parts.push(`Turn count: ${request.currentTurnCount}`)

    return parts.join('. ') + '.'
  }

  function extractKeywords(request: WorkingSummaryRequest): string[] {
    const keywords: string[] = []

    if (request.sessionId) {
      keywords.push('session')
    }

    if (request.structuredState) {
      keywords.push(...Object.keys(request.structuredState))
    }

    if (request.sourceRefs.transcriptRefs) {
      keywords.push('transcript')
    }

    if (request.sourceRefs.previousSummaryRefs) {
      keywords.push('summary')
    }

    return [...new Set(keywords)]
  }
}
