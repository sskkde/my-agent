/**
 * Replay service for observability.
 * Provides timeline_only and state_rebuild replay modes with safety controls.
 */

import type { TimelineBuilder, TimelineRootType, RuntimeTimeline, TimelineEvent } from './timeline.js'
import type { EventStore, EventRecord } from '../storage/event-store.js'
import type { AuditStore, AuditRecord } from './audit-types.js'
import type { TraceStore, RuntimeSpan } from './types.js'
import { ReplaySafetyGuard } from '../replay/replay-safety-guard.js'

// ============================================================================
// Replay Types
// ============================================================================

export type ReplayMode = 'timeline_only' | 'state_rebuild'

export type ReplayRootType = TimelineRootType

export interface SafetyPolicy {
  allowExternalWrites: boolean
  allowToolExecution: boolean
  allowConnectorAccess: boolean
  maxReplayDepth: number
  requireApprovalForSideEffects?: boolean
  redactSensitivePayloads?: boolean
}

export interface ReplayRequest {
  rootType: ReplayRootType
  rootId: string
  replayMode: ReplayMode
  safetyPolicy?: SafetyPolicy
  includeSensitiveData?: boolean
}

export type ReplayStatus = 'success' | 'partial' | 'blocked' | 'error'

export interface BlockedAction {
  eventId: string
  eventType: string
  action: string
  reason: string
  module: string
}

export interface OriginalTraceRef {
  traceId: string
  spanId?: string
  correlationId?: string
}

export interface StateSnapshot {
  workflowRun?: WorkflowRunState
  backgroundRun?: BackgroundRunState
  plannerRun?: PlannerRunState
  timestamp: string
}

export interface WorkflowRunState {
  workflowRunId: string
  status: string
  steps: WorkflowStepState[]
  variables: Record<string, unknown>
  startedAt: string
  completedAt?: string
}

export interface WorkflowStepState {
  stepRunId: string
  stepId: string
  status: string
  input: Record<string, unknown>
  output?: Record<string, unknown>
  startedAt: string
  completedAt?: string
}

export interface BackgroundRunState {
  backgroundRunId: string
  status: string
  taskType: string
  parameters: Record<string, unknown>
  results?: Record<string, unknown>
  startedAt: string
  completedAt?: string
}

export interface PlannerRunState {
  plannerRunId: string
  status: string
  objective?: string
  planId?: string
  stepsCompleted: number
  totalSteps: number
  startedAt: string
  completedAt?: string
}

export interface ReplayResult {
  status: ReplayStatus
  timeline: RuntimeTimeline
  stateSnapshot?: StateSnapshot
  blockedActions: BlockedAction[]
  originalTraceRefs: OriginalTraceRef[]
  warnings: string[]
}

// ============================================================================
// Default Safety Policy
// ============================================================================

export const DEFAULT_SAFETY_POLICY: SafetyPolicy = {
  allowExternalWrites: false,
  allowToolExecution: false,
  allowConnectorAccess: false,
  maxReplayDepth: 10,
  requireApprovalForSideEffects: true,
  redactSensitivePayloads: true,
}

// ============================================================================
// Replay Service Configuration
// ============================================================================

export interface ReplayServiceConfig {
  timelineBuilder: TimelineBuilder
  eventStore: EventStore
  auditStore: AuditStore
  traceStore: TraceStore
}

// ============================================================================
// Replay Service
// ============================================================================

export class ReplayService {
  private config: ReplayServiceConfig
  private safetyGuard: ReplaySafetyGuard

  constructor(config: ReplayServiceConfig) {
    this.config = config
    this.safetyGuard = new ReplaySafetyGuard()
  }

  /**
   * Main entry point for replay functionality.
   * Performs replay based on the requested mode and safety policy.
   */
  replay(request: ReplayRequest): ReplayResult {
    const warnings: string[] = []

    try {
      const safetyPolicy = { ...DEFAULT_SAFETY_POLICY, ...request.safetyPolicy }
      // Build the timeline first (needed for both modes)
      const timeline = this.buildTimelineOnly(request.rootType, request.rootId)

      // Check safety and identify blocked actions
      const blockedActions = this.checkSafety(timeline, safetyPolicy)

      // Preserve original trace references
      const originalTraceRefs = this.preserveTraceRefs(timeline)

      // Determine replay status based on blocked actions
      let status: ReplayStatus = 'success'
      if (blockedActions.length > 0) {
        status = 'partial'
        warnings.push(`${blockedActions.length} action(s) blocked due to safety policy`)
      }

      // For timeline_only mode, return timeline with potential redaction
      if (request.replayMode === 'timeline_only') {
        const processedTimeline =
          request.includeSensitiveData || !safetyPolicy.redactSensitivePayloads
            ? timeline
            : this.redactSensitiveData(timeline)

        return {
          status,
          timeline: processedTimeline,
          blockedActions,
          originalTraceRefs,
          warnings,
        }
      }

      // For state_rebuild mode, reconstruct state from events
      if (request.replayMode === 'state_rebuild') {
        const stateSnapshot = this.buildStateRebuild(request.rootType, request.rootId)

        // Redact sensitive data if not explicitly allowed
        const processedTimeline =
          request.includeSensitiveData || !safetyPolicy.redactSensitivePayloads
            ? timeline
            : this.redactSensitiveData(timeline)

        const processedSnapshot =
          request.includeSensitiveData || !safetyPolicy.redactSensitivePayloads
            ? stateSnapshot
            : this.redactStateSnapshot(stateSnapshot)

        return {
          status,
          timeline: processedTimeline,
          stateSnapshot: processedSnapshot,
          blockedActions,
          originalTraceRefs,
          warnings,
        }
      }

      // Should not reach here due to type safety
      warnings.push('Unknown replay mode specified')
      return {
        status: 'error',
        timeline,
        blockedActions,
        originalTraceRefs,
        warnings,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      warnings.push(`Replay failed: ${errorMessage}`)

      // Return minimal result on error
      const emptyTimeline: RuntimeTimeline = {
        rootType: request.rootType,
        rootId: request.rootId,
        events: [],
        startTime: new Date().toISOString(),
        status: 'failed',
      }

      return {
        status: 'error',
        timeline: emptyTimeline,
        blockedActions: [],
        originalTraceRefs: [],
        warnings,
      }
    }
  }

  replayTimelineOnly(_replayId: string, sessionId: string): TimelineEvent[] {
    return this.redactSensitiveData(this.buildTimelineOnly('session', sessionId)).events
  }

  replayStateRebuild(runId: string): StateSnapshot {
    return this.buildStateRebuild('planner_run', runId)
  }

  /**
   * Build a timeline-only replay for the given root context.
   * Returns the timeline without reconstructing state.
   */
  buildTimelineOnly(rootType: TimelineRootType, rootId: string): RuntimeTimeline {
    return this.config.timelineBuilder.buildTimeline(rootType, rootId)
  }

  /**
   * Reconstruct state from events for state_rebuild replay mode.
   * Queries EventStore for state-changing events and reconstructs the active state snapshot.
   */
  buildStateRebuild(rootType: TimelineRootType, rootId: string): StateSnapshot {
    const { eventStore } = this.config
    const timestamp = new Date().toISOString()

    // Query events based on root type
    const events = this.queryStateChangingEvents(eventStore, rootType, rootId)

    // Reconstruct state based on root type
    switch (rootType) {
      case 'workflow_run':
        return {
          workflowRun: this.reconstructWorkflowRunState(events, rootId),
          timestamp,
        }

      case 'background_run':
        return {
          backgroundRun: this.reconstructBackgroundRunState(events, rootId),
          timestamp,
        }

      case 'planner_run':
        return {
          plannerRun: this.reconstructPlannerRunState(events, rootId),
          timestamp,
        }

      default:
        // For other types, return empty state snapshot
        return { timestamp }
    }
  }

  /**
   * Check timeline events against safety policy to identify blocked actions.
   * Blocks external writes, tool execution, and connector access by default.
   */
  checkSafety(timeline: RuntimeTimeline, policy: SafetyPolicy): BlockedAction[] {
    const blockedActions: BlockedAction[] = []
    const guard = new ReplaySafetyGuard({
      allowExternalWrites: policy.allowExternalWrites,
      requireApprovalForSideEffects: policy.requireApprovalForSideEffects ?? true,
      redactSensitivePayloads: policy.redactSensitivePayloads ?? true,
    })

    for (const event of timeline.events) {
      const blockedReason = this.checkEventSafety(event, policy, guard)
      if (blockedReason) {
        blockedActions.push({
          eventId: event.eventId,
          eventType: event.eventType,
          action: event.description,
          reason: blockedReason,
          module: event.module,
        })
      }
    }

    return blockedActions
  }

  /**
   * Preserve original trace references from the timeline.
   * Extracts trace IDs, span IDs, and correlation IDs for audit trail.
   */
  preserveTraceRefs(timeline: RuntimeTimeline): OriginalTraceRef[] {
    const traceRefs = new Map<string, OriginalTraceRef>()
    const processedCorrelationIds = new Set<string>()

    for (const event of timeline.events) {
      // Extract trace info from source data
      const sourceData = event.sourceData as EventRecord | AuditRecord | RuntimeSpan | undefined

      if (sourceData) {
        const correlationId = this.extractCorrelationId(sourceData)
        const spanId = this.extractSpanId(sourceData)

        // Look up traces by correlationId
        if (correlationId && !processedCorrelationIds.has(correlationId)) {
          processedCorrelationIds.add(correlationId)
          const traces = this.config.traceStore.findTracesByCorrelation(correlationId)

          for (const trace of traces) {
            if (!traceRefs.has(trace.traceId)) {
              traceRefs.set(trace.traceId, {
                traceId: trace.traceId,
                correlationId,
              })
            }

            // Also get spans for this trace
            const spans = this.config.traceStore.findSpansByTrace(trace.traceId)
            for (const span of spans) {
              const spanKey = `${trace.traceId}-${span.spanId}`
              if (!traceRefs.has(spanKey)) {
                traceRefs.set(spanKey, {
                  traceId: trace.traceId,
                  spanId: span.spanId,
                  correlationId,
                })
              }
            }
          }
        }

        // Handle direct span references
        if (spanId) {
          const span = this.config.traceStore.getSpan(spanId)
          if (span) {
            const spanKey = `${span.traceId}-${span.spanId}`
            if (!traceRefs.has(spanKey)) {
              traceRefs.set(spanKey, {
                traceId: span.traceId,
                spanId: span.spanId,
                correlationId,
              })
            }
          }
        }
      }
    }

    return Array.from(traceRefs.values())
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private queryStateChangingEvents(eventStore: EventStore, rootType: TimelineRootType, rootId: string): EventRecord[] {
    // Query events with correlation ID matching the rootId
    const events = eventStore.findByCorrelationId(rootId)

    // Also query all events and filter by relatedRefs for the rootId
    const allEvents = eventStore.query({})
    const relatedEvents = allEvents.filter((event) => {
      const refs = event.relatedRefs
      if (!refs) return false

      switch (rootType) {
        case 'workflow_run':
          return refs.workflowRunId === rootId
        case 'background_run':
          return refs.backgroundRunId === rootId
        case 'planner_run':
          return refs.plannerRunId === rootId
        case 'subagent_run':
          return refs.subagentRunId === rootId
        case 'tool_call':
          return refs.toolCallId === rootId
        case 'approval':
          return refs.approvalId === rootId
        case 'memory':
          return refs.memoryId === rootId
        default:
          return false
      }
    })

    // Combine and deduplicate events
    const combined = [...events, ...relatedEvents]
    const seen = new Set<string>()
    const uniqueEvents = combined.filter((event) => {
      if (seen.has(event.eventId)) {
        return false
      }
      seen.add(event.eventId)
      return true
    })

    // Filter for state-changing event types
    const stateChangingEventTypes = [
      'workflow_started',
      'workflow_step_started',
      'workflow_step_completed',
      'workflow_step_failed',
      'workflow_completed',
      'workflow_failed',
      'background_task_started',
      'background_task_progress',
      'background_task_completed',
      'background_task_failed',
      'planner_started',
      'planner_step_completed',
      'planner_completed',
      'planner_failed',
      'variable_set',
      'state_changed',
    ]

    return uniqueEvents.filter((event) => stateChangingEventTypes.includes(event.eventType))
  }

  private reconstructWorkflowRunState(events: EventRecord[], workflowRunId: string): WorkflowRunState {
    const steps: WorkflowStepState[] = []
    const variables: Record<string, unknown> = {}
    let status = 'unknown'
    let startedAt = new Date().toISOString()
    let completedAt: string | undefined

    // Sort events by timestamp
    events.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    for (const event of events) {
      // Track workflow start
      if (event.eventType === 'workflow_started') {
        startedAt = event.createdAt
        status = 'active'
      }

      // Track step states
      if (event.eventType === 'workflow_step_started') {
        const payload = event.payload as Record<string, unknown>
        steps.push({
          stepRunId: (payload.stepRunId as string) ?? `step_${steps.length}`,
          stepId: (payload.stepId as string) ?? 'unknown',
          status: 'active',
          input: (payload.input as Record<string, unknown>) ?? {},
          startedAt: event.createdAt,
        })
      }

      if (event.eventType === 'workflow_step_completed') {
        const payload = event.payload as Record<string, unknown>
        const stepRunId = (payload.stepRunId as string) ?? ''
        const step = steps.find((s) => s.stepRunId === stepRunId)
        if (step) {
          step.status = 'completed'
          step.output = (payload.output as Record<string, unknown>) ?? {}
          step.completedAt = event.createdAt
        }
      }

      if (event.eventType === 'workflow_step_failed') {
        const payload = event.payload as Record<string, unknown>
        const stepRunId = (payload.stepRunId as string) ?? ''
        const step = steps.find((s) => s.stepRunId === stepRunId)
        if (step) {
          step.status = 'failed'
          step.completedAt = event.createdAt
        }
      }

      // Track variable changes
      if (event.eventType === 'variable_set') {
        const payload = event.payload as Record<string, unknown>
        const varName = payload.name as string
        const varValue = payload.value
        if (varName) {
          variables[varName] = varValue
        }
      }

      // Track workflow completion
      if (event.eventType === 'workflow_completed') {
        status = 'completed'
        completedAt = event.createdAt
      }

      if (event.eventType === 'workflow_failed') {
        status = 'failed'
        completedAt = event.createdAt
      }
    }

    return {
      workflowRunId,
      status,
      steps,
      variables,
      startedAt,
      completedAt,
    }
  }

  private reconstructBackgroundRunState(events: EventRecord[], backgroundRunId: string): BackgroundRunState {
    let status = 'unknown'
    let taskType = 'unknown'
    let parameters: Record<string, unknown> = {}
    let results: Record<string, unknown> | undefined
    let startedAt = new Date().toISOString()
    let completedAt: string | undefined

    // Sort events by timestamp
    events.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    for (const event of events) {
      if (event.eventType === 'background_task_started') {
        startedAt = event.createdAt
        status = 'active'
        const payload = event.payload as Record<string, unknown>
        taskType = (payload.taskType as string) ?? 'unknown'
        parameters = (payload.parameters as Record<string, unknown>) ?? {}
      }

      if (event.eventType === 'background_task_progress') {
        const payload = event.payload as Record<string, unknown>
        const progress = payload.progress as Record<string, unknown>
        if (progress) {
          parameters = { ...parameters, ...progress }
        }
      }

      if (event.eventType === 'background_task_completed') {
        status = 'completed'
        completedAt = event.createdAt
        const payload = event.payload as Record<string, unknown>
        results = (payload.results as Record<string, unknown>) ?? {}
      }

      if (event.eventType === 'background_task_failed') {
        status = 'failed'
        completedAt = event.createdAt
        const payload = event.payload as Record<string, unknown>
        results = { error: payload.error }
      }
    }

    return {
      backgroundRunId,
      status,
      taskType,
      parameters,
      results,
      startedAt,
      completedAt,
    }
  }

  private reconstructPlannerRunState(events: EventRecord[], plannerRunId: string): PlannerRunState {
    let status = 'unknown'
    let objective: string | undefined
    let planId: string | undefined
    let stepsCompleted = 0
    let totalSteps = 0
    let startedAt = new Date().toISOString()
    let completedAt: string | undefined

    // Sort events by timestamp
    events.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    for (const event of events) {
      if (event.eventType === 'planner_started') {
        startedAt = event.createdAt
        status = 'active'
        const payload = event.payload as Record<string, unknown>
        objective = payload.objective as string
        planId = payload.planId as string
        totalSteps = (payload.totalSteps as number) ?? 0
      }

      if (event.eventType === 'planner_step_completed') {
        stepsCompleted++
        const payload = event.payload as Record<string, unknown>
        if (payload.totalSteps && typeof payload.totalSteps === 'number') {
          totalSteps = payload.totalSteps
        }
      }

      if (event.eventType === 'planner_completed') {
        status = 'completed'
        completedAt = event.createdAt
        const payload = event.payload as Record<string, unknown>
        if (payload.totalSteps && typeof payload.totalSteps === 'number') {
          totalSteps = payload.totalSteps
        }
        stepsCompleted = totalSteps
      }

      if (event.eventType === 'planner_failed') {
        status = 'failed'
        completedAt = event.createdAt
      }
    }

    return {
      plannerRunId,
      status,
      objective,
      planId,
      stepsCompleted,
      totalSteps,
      startedAt,
      completedAt,
    }
  }

  private checkEventSafety(
    event: TimelineEvent,
    policy: SafetyPolicy,
    guard: ReplaySafetyGuard = this.safetyGuard,
  ): string | null {
    const sourceData = event.sourceData as Record<string, unknown> | undefined
    const eventType = event.eventType
    const module = event.module.toLowerCase()

    // Audit-specific checks run FIRST for precise blocking reasons.
    if (eventType === 'audit' && sourceData) {
      const auditData = sourceData as unknown as AuditRecord

      if (auditData.auditType === 'external_write') {
        return policy.allowExternalWrites ? null : 'External write operation blocked by default safety policy'
      }

      if (auditData.auditType === 'tool_call') {
        return policy.allowToolExecution ? null : 'Tool execution blocked by default safety policy'
      }

      if (auditData.auditType === 'connector_access') {
        return policy.allowConnectorAccess ? null : 'Connector access blocked by default safety policy'
      }
    }

    // Guard check for non-audit events and audit events that passed audit-specific checks.
    const payload = this.extractSafetyPayload(event)
    const guardResult = guard.check(`${eventType}:${event.description}`, payload)
    if (!guardResult.allowed) {
      return guardResult.reason ?? 'Replay action blocked by safety policy'
    }

    // Check event description for external write indicators
    if (!policy.allowExternalWrites) {
      const externalWriteIndicators = [
        'external_write',
        'file_write',
        'database_write',
        'api_write',
        'send_email',
        'send_message',
      ]

      const description = event.description.toLowerCase()

      if (externalWriteIndicators.some((indicator) => description.includes(indicator))) {
        return 'External write operation blocked by default safety policy'
      }
    }

    // Check for tool execution by module (only for non-audit events)
    if (!policy.allowToolExecution && eventType !== 'audit' && module === 'tool') {
      return 'Tool execution blocked by default safety policy'
    }

    // Check for connector access by module (only for non-audit events)
    if (!policy.allowConnectorAccess && eventType !== 'audit' && module === 'connector') {
      return 'Connector access blocked by default safety policy'
    }

    return null
  }

  private extractSafetyPayload(event: TimelineEvent): unknown {
    const sourceData = event.sourceData as Record<string, unknown> | undefined
    if (!sourceData) {
      return { description: event.description, module: event.module }
    }

    return {
      ...sourceData,
      description: event.description,
      module: event.module,
    }
  }

  private extractCorrelationId(sourceData: EventRecord | AuditRecord | RuntimeSpan): string | undefined {
    if ('correlationId' in sourceData) {
      return sourceData.correlationId
    }
    return undefined
  }

  private extractSpanId(sourceData: EventRecord | AuditRecord | RuntimeSpan): string | undefined {
    if ('spanId' in sourceData) {
      return sourceData.spanId
    }
    return undefined
  }

  private redactSensitiveData(timeline: RuntimeTimeline): RuntimeTimeline {
    const redactedEvents = timeline.events.map((event) => {
      const sourceData = event.sourceData as Record<string, unknown> | undefined

      if (!sourceData) {
        return event
      }

      // Check sensitivity level
      const sensitivity = (sourceData as { sensitivity?: string }).sensitivity
      if (sensitivity === 'high' || sensitivity === 'restricted') {
        return {
          ...event,
          sourceData: {
            ...sourceData,
            payload: '[REDACTED]',
          },
        }
      }

      // Redact payload for events with sensitive data patterns
      const payload = sourceData.payload as Record<string, unknown> | undefined
      if (payload) {
        const redactedPayload = this.redactPayload(payload)
        if (redactedPayload !== payload) {
          return {
            ...event,
            sourceData: {
              ...sourceData,
              payload: redactedPayload,
            },
          }
        }
      }

      return event
    })

    return {
      ...timeline,
      events: redactedEvents,
    }
  }

  private redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'credential',
      'apiKey',
      'api_key',
      'auth',
      'private',
      'sensitive',
    ]

    const redacted: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(payload)) {
      const lowerKey = key.toLowerCase()
      if (sensitiveFields.some((field) => lowerKey.includes(field))) {
        redacted[key] = '[REDACTED]'
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = this.redactPayload(value as Record<string, unknown>)
      } else {
        redacted[key] = value
      }
    }

    return redacted
  }

  private redactStateSnapshot(snapshot: StateSnapshot): StateSnapshot {
    const redacted: StateSnapshot = {
      timestamp: snapshot.timestamp,
    }

    if (snapshot.workflowRun) {
      redacted.workflowRun = {
        ...snapshot.workflowRun,
        variables: this.redactPayload({ ...snapshot.workflowRun.variables }),
      }
    }

    if (snapshot.backgroundRun) {
      redacted.backgroundRun = {
        ...snapshot.backgroundRun,
        parameters: this.redactPayload({ ...snapshot.backgroundRun.parameters }),
      }
    }

    if (snapshot.plannerRun) {
      redacted.plannerRun = {
        ...snapshot.plannerRun,
      }
      if (snapshot.plannerRun.objective?.includes('secret')) {
        redacted.plannerRun.objective = '[REDACTED]'
      }
    }

    return redacted
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createReplayService(config: ReplayServiceConfig): ReplayService {
  return new ReplayService(config)
}
