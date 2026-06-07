/**
 * Runtime timeline builder for observability.
 * Provides a unified view of events, audits, and traces for a specific root context.
 */

import type { EventStore, EventRecord, SourceModule } from '../storage/event-store.js'
import type { AuditStore, AuditRecord, AuditSourceModule } from './audit-types.js'
import type { TraceStore, RuntimeSpan } from './types.js'
import type { RuntimeActionStore, RuntimeAction } from '../storage/runtime-action-store.js'

// ============================================================================
// Timeline Types
// ============================================================================

export type TimelineRootType =
  | 'session'
  | 'planner_run'
  | 'workflow_run'
  | 'background_run'
  | 'subagent_run'
  | 'tool_call'
  | 'approval'
  | 'memory'

export type TimelineEventType = 'event' | 'audit' | 'span' | 'action'

export type TimelineEventStatus = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled' | 'blocked'

export interface RelatedRef {
  refType: 'audit' | 'span' | 'event' | 'action'
  refId: string
}

export interface TimelineEvent {
  eventId: string
  eventType: TimelineEventType
  timestamp: string
  module: SourceModule | AuditSourceModule | string
  description: string
  status: TimelineEventStatus
  relatedRefs?: RelatedRef[]
  sourceData?: unknown
}

export interface RuntimeTimeline {
  rootType: TimelineRootType
  rootId: string
  events: TimelineEvent[]
  startTime: string
  endTime?: string
  durationMs?: number
  status: TimelineEventStatus
}

export interface TimelineBuilderConfig {
  eventStore: EventStore
  auditStore: AuditStore
  traceStore: TraceStore
  actionStore: RuntimeActionStore
}

export interface TimelineQueryOptions {
  limit?: number
  offset?: number
}

// ============================================================================
// Timeline Builder
// ============================================================================

export class TimelineBuilder {
  private config: TimelineBuilderConfig

  constructor(config: TimelineBuilderConfig) {
    this.config = config
  }

  /**
   * Build a timeline for a specific root type and ID.
   */
  buildTimeline(rootType: TimelineRootType, rootId: string): RuntimeTimeline {
    const events: TimelineEvent[] = []

    this.addEventsFromStore(events, rootType, rootId)
    this.addAuditsFromStore(events, rootType, rootId)
    this.addAuditRefs(events)
    this.addSpanRefs(events)
    this.addActionRefs(events, rootType, rootId)

    this.sortEvents(events)

    const startTime = this.calculateStartTime(events)
    const endTime = this.calculateEndTime(events)
    const durationMs = this.calculateDuration(startTime, endTime)
    const status = this.calculateStatus(events)

    return {
      rootType,
      rootId,
      events,
      startTime,
      endTime,
      durationMs,
      status,
    }
  }

  queryBySessionId(sessionId: string, _options: TimelineQueryOptions = {}): RuntimeTimeline {
    return this.buildTimeline('session', sessionId)
  }

  queryByRunId(runId: string, _options: TimelineQueryOptions = {}): RuntimeTimeline {
    return this.buildTimeline('planner_run', runId)
  }

  queryByWorkflowRunId(workflowRunId: string, _options: TimelineQueryOptions = {}): RuntimeTimeline {
    return this.buildTimeline('workflow_run', workflowRunId)
  }

  queryByBackgroundRunId(backgroundRunId: string, _options: TimelineQueryOptions = {}): RuntimeTimeline {
    return this.buildTimeline('background_run', backgroundRunId)
  }

  queryByToolCallId(toolCallId: string, _options: TimelineQueryOptions = {}): RuntimeTimeline {
    return this.buildTimeline('tool_call', toolCallId)
  }

  queryByApprovalId(approvalId: string, _options: TimelineQueryOptions = {}): RuntimeTimeline {
    return this.buildTimeline('approval', approvalId)
  }

  /**
   * Query and add events from the EventStore based on root type and ID.
   */
  addEventsFromStore(events: TimelineEvent[], rootType: TimelineRootType, rootId: string): void {
    const { eventStore } = this.config
    let eventRecords: EventRecord[] = []

    switch (rootType) {
      case 'session':
        eventRecords = eventStore.query({ sessionId: rootId })
        break
      case 'planner_run':
        eventRecords = [...eventStore.query({ plannerRunId: rootId }), ...eventStore.query({ runId: rootId })]
        break
      case 'workflow_run':
        eventRecords = eventStore.query({
          correlationId: rootId,
        })
        // Also query by workflow_run_id via relatedRefs
        const workflowEvents = eventStore.query({})
        const filteredWorkflowEvents = workflowEvents.filter((e) => e.relatedRefs?.workflowRunId === rootId)
        eventRecords = [...eventRecords, ...filteredWorkflowEvents]
        break
      case 'background_run':
        const bgEvents = eventStore.query({})
        eventRecords = bgEvents.filter((e) => e.relatedRefs?.backgroundRunId === rootId)
        break
      case 'subagent_run':
        const subEvents = eventStore.query({})
        eventRecords = subEvents.filter((e) => e.relatedRefs?.subagentRunId === rootId)
        break
      case 'tool_call':
        const toolEvents = eventStore.query({})
        eventRecords = toolEvents.filter((e) => e.relatedRefs?.toolCallId === rootId)
        break
      case 'approval':
        const approvalEvents = eventStore.query({})
        eventRecords = approvalEvents.filter((e) => e.relatedRefs?.approvalId === rootId)
        break
      case 'memory':
        const memEvents = eventStore.query({})
        eventRecords = memEvents.filter((e) => e.relatedRefs?.memoryId === rootId)
        break
    }

    // Remove duplicates based on eventId
    const seen = new Set<string>()
    eventRecords = eventRecords.filter((e) => {
      if (seen.has(e.eventId)) {
        return false
      }
      seen.add(e.eventId)
      return true
    })

    for (const record of eventRecords) {
      events.push(this.eventRecordToTimelineEvent(record))
    }
  }

  addAuditsFromStore(events: TimelineEvent[], rootType: TimelineRootType, rootId: string): void {
    const { auditStore } = this.config
    let auditRecords: AuditRecord[] = []

    switch (rootType) {
      case 'session':
        auditRecords = auditStore.findBySession(rootId)
        break
      case 'approval':
        auditRecords = auditStore.findByApprovalId(rootId)
        break
      case 'tool_call':
        auditRecords = auditStore.findByToolCallId(rootId)
        break
      case 'planner_run':
        auditRecords = auditStore.findByCorrelationId(rootId)
        break
      case 'workflow_run':
      case 'background_run':
      case 'subagent_run':
      case 'memory':
        auditRecords = auditStore.findByCorrelationId(rootId)
        break
    }

    for (const record of auditRecords) {
      const existingEvent = events.find((e) => e.eventType === 'audit' && e.eventId === record.auditId)
      if (!existingEvent) {
        events.push(this.auditRecordToTimelineEvent(record))
      }
    }
  }

  /**
   * Attach audit records to events based on correlation/causation IDs.
   */
  addAuditRefs(events: TimelineEvent[]): void {
    const { auditStore } = this.config

    for (const event of events) {
      const correlationId = (event.sourceData as EventRecord | undefined)?.correlationId
      const sessionId = (event.sourceData as EventRecord | undefined)?.sessionId

      let auditRecords: AuditRecord[] = []

      if (correlationId) {
        auditRecords = auditStore.findByCorrelationId(correlationId)
      }

      // If no correlation matches but we have sessionId, try that
      if (auditRecords.length === 0 && sessionId) {
        auditRecords = auditStore.findBySession(sessionId)
      }

      for (const audit of auditRecords) {
        // Check if this audit is already in events
        const existingEvent = events.find((e) => e.eventType === 'audit' && e.eventId === audit.auditId)

        if (!existingEvent) {
          events.push(this.auditRecordToTimelineEvent(audit))
        }

        // Add related ref
        if (!event.relatedRefs) {
          event.relatedRefs = []
        }
        if (!event.relatedRefs.some((r) => r.refId === audit.auditId)) {
          event.relatedRefs.push({
            refType: 'audit',
            refId: audit.auditId,
          })
        }
      }
    }
  }

  /**
   * Attach trace spans to events based on trace/span IDs.
   */
  addSpanRefs(events: TimelineEvent[]): void {
    const { traceStore } = this.config

    for (const event of events) {
      const correlationId = (event.sourceData as EventRecord | undefined)?.correlationId

      if (!correlationId) {
        continue
      }

      // Find traces by correlation
      const traces = traceStore.findTracesByCorrelation(correlationId)

      for (const trace of traces) {
        // Get all spans for this trace
        const spans = traceStore.findSpansByTrace(trace.traceId)

        for (const span of spans) {
          // Check if this span is already in events
          const existingEvent = events.find((e) => e.eventType === 'span' && e.eventId === span.spanId)

          if (!existingEvent) {
            events.push(this.spanToTimelineEvent(span))
          }

          // Add related ref
          if (!event.relatedRefs) {
            event.relatedRefs = []
          }
          if (!event.relatedRefs.some((r) => r.refId === span.spanId)) {
            event.relatedRefs.push({
              refType: 'span',
              refId: span.spanId,
            })
          }
        }
      }
    }
  }

  /**
   * Attach action references to events.
   */
  addActionRefs(events: TimelineEvent[], rootType: TimelineRootType, rootId: string): void {
    const { actionStore } = this.config
    let actions: RuntimeAction[] = []

    switch (rootType) {
      case 'planner_run':
        actions = this.dedupeActions([
          ...actionStore.query({ plannerRunId: rootId }),
          ...actionStore.query({ sessionId: rootId }),
        ])
        break
      case 'workflow_run':
        actions = actionStore.query({ workflowRunId: rootId })
        break
      case 'session':
        actions = actionStore.query({ sessionId: rootId })
        break
    }

    for (const action of actions) {
      // Check if this action is already in events
      const existingEvent = events.find((e) => e.eventType === 'action' && e.eventId === action.actionId)

      if (!existingEvent) {
        events.push(this.actionToTimelineEvent(action))
      }
    }
  }

  /**
   * Sort events by timestamp.
   */
  sortEvents(events: TimelineEvent[]): void {
    events.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime()
      const timeB = new Date(b.timestamp).getTime()
      return timeA - timeB
    })
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private eventRecordToTimelineEvent(record: EventRecord): TimelineEvent {
    return {
      eventId: record.eventId,
      eventType: 'event',
      timestamp: record.createdAt,
      module: record.sourceModule,
      description: `${record.eventType} from ${record.sourceModule}`,
      status: this.mapEventStatus(record),
      sourceData: record,
    }
  }

  private auditRecordToTimelineEvent(record: AuditRecord): TimelineEvent {
    return {
      eventId: record.auditId,
      eventType: 'audit',
      timestamp: record.timestamp,
      module: record.sourceModule,
      description: record.actionSummary,
      status: this.mapAuditStatus(record.status),
      sourceData: record,
    }
  }

  private spanToTimelineEvent(span: RuntimeSpan): TimelineEvent {
    return {
      eventId: span.spanId,
      eventType: 'span',
      timestamp: span.startTime,
      module: span.module,
      description: `${span.spanType}: ${span.operation}`,
      status: this.mapSpanStatus(span.status),
      sourceData: span,
    }
  }

  private actionToTimelineEvent(action: RuntimeAction): TimelineEvent {
    return {
      eventId: action.actionId,
      eventType: 'action',
      timestamp: action.createdAt,
      module: action.source.sourceModule as SourceModule,
      description: `${action.actionType} -> ${action.targetRuntime}.${action.targetAction}`,
      status: this.mapActionStatus(action.status),
      sourceData: action,
    }
  }

  private dedupeActions(actions: RuntimeAction[]): RuntimeAction[] {
    const seen = new Set<string>()
    return actions.filter((action) => {
      if (seen.has(action.actionId)) {
        return false
      }
      seen.add(action.actionId)
      return true
    })
  }

  private mapEventStatus(record: EventRecord): TimelineEventStatus {
    // Events don't have explicit status, derive from payload or default to completed
    const payload = record.payload as Record<string, unknown> | undefined
    if (payload?.error) {
      return 'failed'
    }
    if (payload?.status && typeof payload.status === 'string') {
      return this.normalizeStatus(payload.status)
    }
    return 'completed'
  }

  private mapAuditStatus(status: string): TimelineEventStatus {
    switch (status) {
      case 'pending':
        return 'pending'
      case 'completed':
        return 'completed'
      case 'failed':
        return 'failed'
      case 'blocked':
        return 'blocked'
      default:
        return 'completed'
    }
  }

  private mapSpanStatus(status: string): TimelineEventStatus {
    switch (status) {
      case 'started':
        return 'active'
      case 'completed':
        return 'completed'
      case 'failed':
        return 'failed'
      case 'cancelled':
        return 'cancelled'
      default:
        return 'completed'
    }
  }

  private mapActionStatus(status: string): TimelineEventStatus {
    switch (status) {
      case 'created':
      case 'validated':
      case 'duplicate':
        return 'pending'
      case 'accepted':
      case 'queued':
      case 'dispatching':
      case 'waiting_for_approval':
      case 'waiting_for_target':
        return 'active'
      case 'completed':
        return 'completed'
      case 'failed':
      case 'timeout':
        return 'failed'
      case 'cancelled':
      case 'denied':
        return 'cancelled'
      default:
        return 'pending'
    }
  }

  private normalizeStatus(status: string): TimelineEventStatus {
    const normalized = status.toLowerCase()
    if (normalized === 'pending') return 'pending'
    if (normalized === 'active' || normalized === 'started') return 'active'
    if (normalized === 'completed' || normalized === 'success') return 'completed'
    if (normalized === 'failed' || normalized === 'error') return 'failed'
    if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled'
    if (normalized === 'blocked') return 'blocked'
    return 'completed'
  }

  private calculateStartTime(events: TimelineEvent[]): string {
    if (events.length === 0) {
      return new Date().toISOString()
    }

    let earliest = events[0]
    for (const event of events) {
      if (new Date(event.timestamp) < new Date(earliest.timestamp)) {
        earliest = event
      }
    }
    return earliest.timestamp
  }

  private calculateEndTime(events: TimelineEvent[]): string | undefined {
    if (events.length === 0) {
      return undefined
    }

    // Look for terminal status events
    const terminalEvents = events.filter(
      (e) => e.status === 'completed' || e.status === 'failed' || e.status === 'cancelled',
    )

    if (terminalEvents.length === 0) {
      return undefined
    }

    let latest = terminalEvents[0]
    for (const event of terminalEvents) {
      if (new Date(event.timestamp) > new Date(latest.timestamp)) {
        latest = event
      }
    }

    // For spans, use endTime if available
    if (latest.eventType === 'span') {
      const span = latest.sourceData as RuntimeSpan
      if (span.endTime) {
        return span.endTime
      }
    }

    return latest.timestamp
  }

  private calculateDuration(startTime: string, endTime: string | undefined): number | undefined {
    if (!endTime) {
      return undefined
    }
    return new Date(endTime).getTime() - new Date(startTime).getTime()
  }

  private calculateStatus(events: TimelineEvent[]): TimelineEventStatus {
    if (events.length === 0) {
      return 'completed'
    }

    // Check for failed status first
    if (events.some((e) => e.status === 'failed')) {
      return 'failed'
    }

    // Check for cancelled status
    if (events.some((e) => e.status === 'cancelled')) {
      return 'cancelled'
    }

    // Check for blocked status
    if (events.some((e) => e.status === 'blocked')) {
      return 'blocked'
    }

    // Check for active/pending status
    if (events.some((e) => e.status === 'active' || e.status === 'pending')) {
      return 'active'
    }

    return 'completed'
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createTimelineBuilder(config: TimelineBuilderConfig): TimelineBuilder {
  return new TimelineBuilder(config)
}
