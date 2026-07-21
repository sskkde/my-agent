import type { TranscriptStore, TurnTranscript } from '../storage/transcript-store.js'
import type { EventStore, EventRecord } from '../storage/event-store.js'
import type { FileUploadStore } from '../storage/file-upload-store.js'
import type { ConsoleTimelineEvent, ConsoleTimelineEventType, PaginationParams } from './types.js'
import { redactMcpConfig } from '../connectors/mcp/mcp-secret-redaction.js'
import {
  buildToolCallEventId,
  buildToolResultEventId,
  formatToolRunningContent,
  formatToolTerminalContent,
} from '../foreground/tools/transcript-redaction-mapper.js'

export interface ConsoleTimelineStores {
  transcriptStore: TranscriptStore
  eventStore: EventStore
  fileUploadStore?: FileUploadStore
}

export interface TimelineOptions extends PaginationParams {
  /** Optional filter for specific event types */
  eventTypes?: ConsoleTimelineEventType[]
}

export interface TimelineResult {
  events: ConsoleTimelineEvent[]
  total: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function isAMapMcpToolName(toolName: string): boolean {
  if (typeof toolName !== 'string') return false
  const lower = toolName.toLowerCase()
  return lower.startsWith('mcp.amap-maps.') || lower.startsWith('amap_maps') || lower.startsWith('amap_geocode') || lower.startsWith('amap_poi') || lower.startsWith('amap_route') || lower.startsWith('amap_weather') || lower.startsWith('amap_distance')
}

function tryParseJsonSafe(text: string): unknown | undefined {
  if (typeof text !== 'string' || text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * SAFETY: Extracts only non-secret fields from parsed AMap results.
 * Coordinates, addresses, and POI names are safe. API keys, tokens,
 * and raw config are never included. Documented field lists below
 * are the security allowlist — any new AMap field must be reviewed.
 */
function extractSafeAMapResult(parsed: unknown): Record<string, unknown> | undefined {
  if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
    return undefined
  }

  const obj = parsed as Record<string, unknown>
  const safe: Record<string, unknown> = {}

  if (Array.isArray(obj.geocodes) && obj.geocodes.length > 0) {
    const geocodes = obj.geocodes as Array<Record<string, unknown>>
    safe.resultType = 'geocode'
    safe.geocodes = geocodes.map((g) => ({
      formatted_address: g.formatted_address,
      location: g.location,
      level: g.level,
      province: g.province,
      city: g.city,
      district: g.district,
    }))
    return safe
  }

  if (Array.isArray(obj.pois) && obj.pois.length > 0) {
    const pois = obj.pois as Array<Record<string, unknown>>
    safe.resultType = 'poi'
    safe.pois = pois.map((p) => ({
      name: p.name,
      location: p.location,
      address: p.address,
      type: p.type,
      typecode: p.typecode,
    }))
    return safe
  }

  if (obj.route && typeof obj.route === 'object') {
    const route = obj.route as Record<string, unknown>
    safe.resultType = 'route'
    safe.origin = route.origin
    safe.destination = route.destination
    if (Array.isArray(route.paths)) {
      safe.paths = (route.paths as Array<Record<string, unknown>>).map((p) => ({
        distance: p.distance,
        duration: p.duration,
      }))
    }
    return safe
  }

  if (Array.isArray(obj.lives) && obj.lives.length > 0) {
    const lives = obj.lives as Array<Record<string, unknown>>
    safe.resultType = 'weather'
    safe.lives = lives.map((w) => ({
      city: w.city,
      weather: w.weather,
      temperature: w.temperature,
      winddirection: w.winddirection,
      windpower: w.windpower,
      humidity: w.humidity,
    }))
    return safe
  }

  if (Array.isArray(obj.results) && obj.results.length > 0) {
    const results = obj.results as Array<Record<string, unknown>>
    safe.resultType = 'distance'
    safe.results = results.map((r) => ({
      distance: r.distance,
      duration: r.duration,
    }))
    return safe
  }
  if (obj.distances !== undefined) {
    safe.resultType = 'distance'
    safe.distances = obj.distances
    return safe
  }

  return undefined
}

function buildAMapResultMetadata(content: string): Record<string, unknown> | undefined {
  const parsed = tryParseJsonSafe(content)
  if (parsed === undefined) return undefined

  const safe = extractSafeAMapResult(parsed)
  if (safe === undefined) return undefined

  return redactMcpConfig(safe) as Record<string, unknown>
}

function collectAMapToolNames(turn: TurnTranscript): string[] {
  if (!turn.runtimeSummary?.toolCallSummaries) return []
  return turn.runtimeSummary.toolCallSummaries
    .filter((s) => isAMapMcpToolName(s.toolName))
    .map((s) => s.toolName)
}

/**
 * Maps a transcript turn to console timeline events.
 *
 * Emits:
 * - user_message: for each turn's input (if userMessageSummary exists)
 * - assistant_message: for each visible message with role 'assistant'
 * - tool_call: for each toolCallSummary in runtimeSummary
 * - approval_request: for each approvalSummary in runtimeSummary
 * - artifact_created: for each artifactRef in output
 */
function mapTurnToTimelineEvents(turn: TurnTranscript, fileUploadStore?: FileUploadStore): ConsoleTimelineEvent[] {
  const events: ConsoleTimelineEvent[] = []
  const baseMetadata: Record<string, unknown> = {
    turnId: turn.turnId,
    // Align with kernel token stream attemptId (= runId = turnId) so the UI
    // can clear streaming drafts when the final assistant_message arrives.
    attemptId: turn.turnId,
    userId: turn.userId,
  }

  const userTimestamp = turn.input.inboundTimestamp ?? turn.createdAt
  const outputTimestamp = turn.createdAt
  const amapToolNames = collectAMapToolNames(turn)

  const attachmentFileIds = (turn.input.contentRefs ?? [])
    .filter((ref) => ref.startsWith('attachment:'))
    .map((ref) => ref.slice('attachment:'.length))

  let attachments: Array<{ fileId: string; originalFilename: string; sizeBytes: number; mimeType: string }> | undefined
  if (attachmentFileIds.length > 0 && fileUploadStore) {
    attachments = []
    for (const fileId of attachmentFileIds) {
      const record = fileUploadStore.getById(fileId, { sessionId: turn.sessionId })
      if (record && record.status !== 'deleted') {
        attachments.push({
          fileId: record.fileId,
          originalFilename: record.originalFilename,
          sizeBytes: record.sizeBytes,
          mimeType: record.mimeType,
        })
      }
    }
    if (attachments.length === 0) attachments = undefined
  }

  // User message event from input
  if (turn.input.userMessageSummary) {
    const metadata: Record<string, unknown> = { ...baseMetadata }
    if (attachments) metadata.attachments = attachments
    events.push({
      eventId: `turn-${turn.turnId}-input`,
      eventType: 'user_message',
      sessionId: turn.sessionId,
      timestamp: userTimestamp,
      content: turn.input.userMessageSummary,
      metadata,
      actor: turn.userId,
    })
  }

  // Interleave visible messages with matching tool_call summaries (Plan C).
  const toolCallSummaries = turn.runtimeSummary?.toolCallSummaries ?? []
  const summariesById = new Map(
    toolCallSummaries
      .filter((s) => typeof s.toolCallId === 'string' && s.toolCallId.length > 0)
      .map((s) => [s.toolCallId, s]),
  )
  const emittedSummaryIds = new Set<string>()
  const toolRoleMessages =
    turn.output.visibleMessages?.filter((msg) => msg.role === 'tool') ?? []
  const canAssociateByOrdinal =
    toolCallSummaries.length > 0 && toolCallSummaries.length === toolRoleMessages.length
  const canAssociateSingle =
    toolCallSummaries.length === 1 && toolRoleMessages.length === 1
  let toolResultOrdinal = 0

  // Legacy path: no tool-role messages but toolCallSummaries exist (e.g. final answer only).
  // Emit tools before assistant messages so history matches execution order.
  const hasToolRoleMessages = toolRoleMessages.length > 0
  const legacyToolsOnlyAsSummaries =
    !hasToolRoleMessages && toolCallSummaries.length > 0

  const emitOrphanToolSummary = (
    summary: (typeof toolCallSummaries)[number],
    index: number,
  ): void => {
    if (emittedSummaryIds.has(summary.toolCallId)) return
    emittedSummaryIds.add(summary.toolCallId)
    const status = summary.status === 'pending' ? 'completed' : summary.status
    const ts = summary.startedAt ?? outputTimestamp
    events.push({
      eventId: buildToolCallEventId(turn.turnId, summary.toolCallId),
      eventType: 'tool_call',
      sessionId: turn.sessionId,
      timestamp: ts,
      content: formatToolRunningContent(summary.toolName),
      metadata: {
        ...baseMetadata,
        toolCallIndex: summary.turnSequence ?? index,
        toolCallId: summary.toolCallId,
        toolName: summary.toolName,
        status: 'running',
        turnSequence: summary.turnSequence ?? index,
      },
      actor: 'system',
    })
    events.push({
      eventId: buildToolResultEventId(turn.turnId, summary.toolCallId),
      eventType: 'tool_result',
      sessionId: turn.sessionId,
      timestamp: ts,
      content: formatToolTerminalContent(summary.toolName, status === 'failed'),
      metadata: {
        ...baseMetadata,
        toolCallId: summary.toolCallId,
        toolName: summary.toolName,
        status,
        result: formatToolTerminalContent(summary.toolName, status === 'failed'),
        turnSequence: summary.turnSequence ?? index,
      },
      actor: 'system',
    })
  }

  if (legacyToolsOnlyAsSummaries) {
    toolCallSummaries.forEach((summary, index) => emitOrphanToolSummary(summary, index))
  }

  if (turn.output.visibleMessages && turn.output.visibleMessages.length > 0) {
    turn.output.visibleMessages.forEach((msg, index) => {
      const partTimestamp = msg.timestamp ?? outputTimestamp
      // When legacy tool summaries were emitted first (no tool-role messages),
      // force ALL assistants after every tool pair so multi-tool same-timestamp
      // sorts cannot interleave assistants between tools, even if the persisted
      // message carries its own turnSequence: 0.
      const turnSequence = legacyToolsOnlyAsSummaries
        ? toolCallSummaries.length + index
        : (msg.turnSequence ?? index)

      if (msg.role === 'assistant') {
        events.push({
          eventId: `turn-${turn.turnId}-msg-${index}`,
          eventType: 'assistant_message',
          sessionId: turn.sessionId,
          timestamp: partTimestamp,
          content: msg.content,
          metadata: {
            ...baseMetadata,
            messageId: msg.messageId,
            messageIndex: index,
            turnSequence,
          },
          actor: 'assistant',
        })
      } else if (msg.role === 'thinking') {
        events.push({
          eventId: `turn-${turn.turnId}-thinking-${index}`,
          eventType: 'thinking_summary',
          sessionId: turn.sessionId,
          timestamp: partTimestamp,
          content: msg.content,
          metadata: {
            ...baseMetadata,
            messageId: msg.messageId,
            messageIndex: index,
            turnSequence,
          },
          actor: 'assistant',
        })
      } else if (msg.role === 'system_status') {
        events.push({
          eventId: `turn-${turn.turnId}-status-${index}`,
          eventType: 'system_status',
          sessionId: turn.sessionId,
          timestamp: partTimestamp,
          content: msg.content,
          metadata: {
            ...baseMetadata,
            messageId: msg.messageId,
            messageIndex: index,
            turnSequence,
          },
          actor: 'system',
        })
      } else if (msg.role === 'approval') {
        events.push({
          eventId: `turn-${turn.turnId}-approval-decision-${index}`,
          eventType: 'approval_decision',
          sessionId: turn.sessionId,
          timestamp: partTimestamp,
          content: msg.content,
          metadata: {
            ...baseMetadata,
            messageId: msg.messageId,
            messageIndex: index,
            turnSequence,
          },
          actor: 'system',
        })
      } else if (msg.role === 'tool') {
        const byId =
          typeof msg.toolCallId === 'string' && msg.toolCallId.length > 0
            ? summariesById.get(msg.toolCallId)
            : undefined
        const associatedSummary =
          byId ??
          ((canAssociateByOrdinal || canAssociateSingle)
            ? toolCallSummaries[toolResultOrdinal]
            : undefined)
        if (!byId) toolResultOrdinal += 1

        const toolCallId = msg.toolCallId ?? associatedSummary?.toolCallId
        const toolName = msg.toolName ?? associatedSummary?.toolName ?? 'unknown'
        const status =
          msg.toolStatus ??
          (associatedSummary?.status === 'pending' ? 'completed' : associatedSummary?.status) ??
          'completed'

        if (toolCallId) {
          emittedSummaryIds.add(toolCallId)
          events.push({
            eventId: buildToolCallEventId(turn.turnId, toolCallId),
            eventType: 'tool_call',
            sessionId: turn.sessionId,
            timestamp: associatedSummary?.startedAt ?? partTimestamp,
            content: formatToolRunningContent(toolName),
            metadata: {
              ...baseMetadata,
              toolCallId,
              toolName,
              status: 'running',
              turnSequence,
              toolCallIndex: associatedSummary?.turnSequence,
            },
            actor: 'system',
          })
        }

        const toolResultMetadata: Record<string, unknown> = {
          ...baseMetadata,
          messageId: msg.messageId,
          messageIndex: index,
          status,
          turnSequence,
        }
        if (toolCallId) toolResultMetadata.toolCallId = toolCallId
        if (toolName) toolResultMetadata.toolName = toolName

        // Only attach generic redacted content as result for non-AMap tools.
        // AMap allowlist may enrich structured metadata from content when applicable.
        if (amapToolNames.length > 0) {
          toolResultMetadata.amapToolNames = amapToolNames
          const amapResult = buildAMapResultMetadata(msg.content)
          if (amapResult) {
            toolResultMetadata.amapResult = amapResult
            toolResultMetadata.result = JSON.stringify(amapResult)
          } else {
            toolResultMetadata.result = msg.content
          }
        } else {
          toolResultMetadata.result = msg.content
        }

        events.push({
          eventId: toolCallId
            ? buildToolResultEventId(turn.turnId, toolCallId)
            : `turn-${turn.turnId}-tool-result-${index}`,
          eventType: 'tool_result',
          sessionId: turn.sessionId,
          timestamp: partTimestamp,
          content: msg.content || formatToolTerminalContent(toolName, status === 'failed'),
          metadata: toolResultMetadata,
          actor: 'system',
        })
      } else if (msg.role === 'error') {
        events.push({
          eventId: `turn-${turn.turnId}-error-${index}`,
          eventType: 'error',
          sessionId: turn.sessionId,
          timestamp: partTimestamp,
          content: msg.content,
          metadata: {
            ...baseMetadata,
            messageId: msg.messageId,
            messageIndex: index,
            turnSequence,
          },
          actor: 'system',
        })
      }
    })
  }

  // Remaining orphan tool call summaries (matched path may leave some unmatched)
  if (!legacyToolsOnlyAsSummaries && toolCallSummaries.length > 0) {
    toolCallSummaries.forEach((summary, index) => emitOrphanToolSummary(summary, index))
  }

  // Approval summaries
  if (turn.runtimeSummary?.approvalSummaries && turn.runtimeSummary.approvalSummaries.length > 0) {
    turn.runtimeSummary.approvalSummaries.forEach((summary, index) => {
      events.push({
        eventId: `turn-${turn.turnId}-approval-${index}`,
        eventType: 'approval_request',
        sessionId: turn.sessionId,
        timestamp: outputTimestamp,
        content: summary,
        metadata: {
          ...baseMetadata,
          approvalIndex: index,
        },
        actor: 'system',
      })
    })
  }

  // Artifact references
  if (turn.output.artifactRefs && turn.output.artifactRefs.length > 0) {
    turn.output.artifactRefs.forEach((artifactRef, index) => {
      events.push({
        eventId: `turn-${turn.turnId}-artifact-${index}`,
        eventType: 'artifact_created',
        sessionId: turn.sessionId,
        timestamp: outputTimestamp,
        content: `Artifact created: ${artifactRef}`,
        metadata: {
          ...baseMetadata,
          artifactRef,
          artifactIndex: index,
        },
        actor: 'system',
      })
    })
  }

  return events
}

/**
 * Maps EventStore events to console timeline events.
 *
 * Maps relevant event types:
 * - run_started, run_progress, run_completed, run_failed, run_cancelled
 * - error events
 * - Other events as system_status
 */
function mapEventRecordToTimelineEvent(event: EventRecord): ConsoleTimelineEvent | null {
  const eventType = event.eventType
  const sessionId = event.sessionId

  if (!sessionId) {
    return null
  }

  // Map run events
  const runEventTypes: ConsoleTimelineEventType[] = [
    'run_started',
    'run_progress',
    'run_completed',
    'run_failed',
    'run_cancelled',
  ]

  if (runEventTypes.includes(eventType as ConsoleTimelineEventType)) {
    return {
      eventId: event.eventId,
      eventType: eventType as ConsoleTimelineEventType,
      sessionId,
      timestamp: event.createdAt,
      content: typeof event.payload?.message === 'string' ? event.payload.message : undefined,
      metadata: {
        ...event.payload,
        sourceModule: event.sourceModule,
        ...(event.relatedRefs || {}),
      },
      actor: event.sourceModule,
    }
  }

  // Map error events
  if (eventType === 'error' || eventType.endsWith('_error') || eventType.endsWith('_failed')) {
    return {
      eventId: event.eventId,
      eventType: 'error',
      sessionId,
      timestamp: event.createdAt,
      content:
        typeof event.payload?.error === 'string'
          ? event.payload.error
          : typeof event.payload?.message === 'string'
            ? event.payload.message
            : 'An error occurred',
      metadata: {
        originalEventType: eventType,
        ...event.payload,
        sourceModule: event.sourceModule,
      },
      actor: event.sourceModule || 'system',
    }
  }

  // Skip unknown/irrelevant event types for the console timeline
  return null
}

/**
 * Service for building console timeline events from transcript and event store data.
 */
export interface ConsoleTimelineService {
  /**
   * Get timeline events for a session with pagination.
   */
  getTimeline(sessionId: string, options?: TimelineOptions): TimelineResult
}

class ConsoleTimelineServiceImpl implements ConsoleTimelineService {
  private stores: ConsoleTimelineStores

  constructor(stores: ConsoleTimelineStores) {
    this.stores = stores
  }

  getTimeline(sessionId: string, options: TimelineOptions = {}): TimelineResult {
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const offset = options.offset ?? 0
    const eventTypesFilter = options.eventTypes

    // Collect all events from transcripts
    const transcriptEvents: ConsoleTimelineEvent[] = []
    const turns = this.stores.transcriptStore.findBySession(sessionId)

    for (const turn of turns) {
      const events = mapTurnToTimelineEvents(turn, this.stores.fileUploadStore)
      transcriptEvents.push(...events)
    }

    // Collect events from event store
    const storeEvents: ConsoleTimelineEvent[] = []
    const eventRecords = this.stores.eventStore.query({ sessionId })

    for (const record of eventRecords) {
      const event = mapEventRecordToTimelineEvent(record)
      if (event) {
        storeEvents.push(event)
      }
    }

    // Merge and sort all events
    // Primary: createdAt ASC, Secondary: eventId for deterministic ordering
    const allEvents = [...transcriptEvents, ...storeEvents]
    allEvents.sort((a, b) => {
      const timeCompare = a.timestamp.localeCompare(b.timestamp)
      if (timeCompare !== 0) {
        return timeCompare
      }
      const seqA = typeof a.metadata?.turnSequence === 'number' ? a.metadata.turnSequence : undefined
      const seqB = typeof b.metadata?.turnSequence === 'number' ? b.metadata.turnSequence : undefined
      if (seqA !== undefined && seqB !== undefined && seqA !== seqB) {
        return seqA - seqB
      }
      // Prefer tool_call before tool_result before assistant when sequences tie
      const rank = (e: ConsoleTimelineEvent): number => {
        if (e.eventType === 'user_message') return 0
        if (e.eventType === 'tool_call') return 1
        if (e.eventType === 'tool_result') return 2
        if (e.eventType === 'assistant_message') return 3
        return 4
      }
      const rankCompare = rank(a) - rank(b)
      if (rankCompare !== 0) return rankCompare
      return a.eventId.localeCompare(b.eventId)
    })

    // Apply event type filter if specified
    let filteredEvents = allEvents
    if (eventTypesFilter && eventTypesFilter.length > 0) {
      filteredEvents = allEvents.filter((e) => eventTypesFilter.includes(e.eventType))
    }

    const total = filteredEvents.length

    // Apply pagination
    const paginatedEvents = filteredEvents.slice(offset, offset + limit)

    return {
      events: paginatedEvents,
      total,
    }
  }
}

/**
 * Factory function to create a ConsoleTimelineService.
 */
export function createConsoleTimelineService(stores: ConsoleTimelineStores): ConsoleTimelineService {
  return new ConsoleTimelineServiceImpl(stores)
}
