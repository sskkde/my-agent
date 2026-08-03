/**
 * Console Timeline — child task lifecycle events (Todo 12 of
 * opencode-like-subagent-sessions).
 *
 * Unit contract: persisted child-task lifecycle events — built by
 * `buildChildTaskLifecycleEvent` from the ChildSessionTaskRuntime transition
 * points (launchTask → started, executeRun terminal → completed/failed,
 * cancelRun → cancelled) — map through the EXISTING run-event mapping in
 * console-timeline (`mapEventRecordToTimelineEvent`) to deterministic
 * timeline entries with stable metadata:
 *
 *   - eventType REUSES run_started / run_completed / run_failed /
 *     run_cancelled (no new event types)
 *   - metadata carries {taskId, childSessionId, runId, agentProfile,
 *     launchMode, status, progress?, safeMessage}
 *   - content is the safe message ONLY — never child response text
 *   - events are scoped to the PARENT session (never the child timeline)
 *   - eventId + idempotencyKey are deterministic per (runId, stage)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TranscriptStore } from '../../../src/storage/transcript-store.js'
import type { EventStore, EventRecord } from '../../../src/storage/event-store.js'
import {
  buildChildTaskLifecycleEvent,
  type ChildTaskLifecycleMetadata,
} from '../../../src/subagents/child-session-task-runtime.js'
import { createConsoleTimelineService } from '../../../src/api/console-timeline.js'
import type { ConsoleTimelineEvent } from '../../../src/api/types.js'

const PARENT_SESSION = 'sess_parent_123'
const CHILD_SESSION = 'sess_child_456'
const RUN_ID = 'subagent-1720000000000-abc123'
const USER_ID = 'user-123'
const FIXED_CREATED_AT = '2026-08-04T00:00:00.000Z'

function lifecycleMetadata(overrides: Partial<ChildTaskLifecycleMetadata> = {}): ChildTaskLifecycleMetadata {
  return {
    taskId: CHILD_SESSION,
    childSessionId: CHILD_SESSION,
    runId: RUN_ID,
    agentProfile: 'document_processor',
    launchMode: 'foreground',
    status: 'completed',
    ...overrides,
  }
}

function buildLifecycleEvent(
  eventType: 'run_started' | 'run_completed' | 'run_failed' | 'run_cancelled',
  metadata: ChildTaskLifecycleMetadata,
): EventRecord {
  return buildChildTaskLifecycleEvent({
    parentSessionId: PARENT_SESSION,
    userId: USER_ID,
    eventType,
    metadata,
    createdAt: FIXED_CREATED_AT,
  })
}

describe('console-timeline child task lifecycle mapping (Todo 12)', () => {
  let savedEvents: EventRecord[]
  let mockEventStore: EventStore
  let stores: { transcriptStore: TranscriptStore; eventStore: EventStore }

  beforeEach(() => {
    savedEvents = []
    mockEventStore = {
      append: vi.fn((event: EventRecord | EventRecord[]) => {
        if (Array.isArray(event)) {
          savedEvents.push(...event)
        } else {
          savedEvents.push(event)
        }
      }),
      query: vi.fn((filters: { sessionId?: string; eventType?: string }) => {
        return savedEvents.filter((e) => {
          if (filters.sessionId && e.sessionId !== filters.sessionId) return false
          if (filters.eventType && e.eventType !== filters.eventType) return false
          return true
        })
      }),
      findByCorrelationId: vi.fn().mockReturnValue([]),
      findByCausationId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn(),
    } as unknown as EventStore

    const mockTranscriptStore = {
      findBySession: vi.fn().mockReturnValue([]),
    } as unknown as TranscriptStore

    stores = {
      transcriptStore: mockTranscriptStore,
      eventStore: mockEventStore,
    }
  })

  it('maps started + completed lifecycle events to deterministic timeline entries with stable metadata', () => {
    mockEventStore.append([
      buildLifecycleEvent('run_started', lifecycleMetadata({ status: 'running', safeMessage: 'Task started' })),
      buildLifecycleEvent('run_completed', lifecycleMetadata({ status: 'completed' })),
    ])

    const timelineService = createConsoleTimelineService(stores)
    const result = timelineService.getTimeline(PARENT_SESSION)

    expect(result.total).toBe(2)
    const started = result.events.find((e) => e.eventType === 'run_started')
    const completed = result.events.find((e) => e.eventType === 'run_completed')
    expect(started).toBeDefined()
    expect(completed).toBeDefined()

    // Deterministic event ids (per runId + stage) reused from persistence.
    expect(started!.eventId).toBe(`child-task:${RUN_ID}:started`)
    expect(completed!.eventId).toBe(`child-task:${RUN_ID}:completed`)

    // Scoped to the PARENT session, actor = source module.
    expect(started!.sessionId).toBe(PARENT_SESSION)
    expect(completed!.sessionId).toBe(PARENT_SESSION)
    expect(started!.actor).toBe('subagent')

    // Stable metadata on both entries.
    for (const event of [started!, completed!]) {
      expect(event.metadata?.taskId).toBe(CHILD_SESSION)
      expect(event.metadata?.childSessionId).toBe(CHILD_SESSION)
      expect(event.metadata?.runId).toBe(RUN_ID)
      expect(event.metadata?.agentProfile).toBe('document_processor')
      expect(event.metadata?.launchMode).toBe('foreground')
      expect(event.metadata?.subagentRunId).toBe(RUN_ID)
      expect(event.metadata?.sourceModule).toBe('subagent')
    }
    expect(started!.metadata?.status).toBe('running')
    expect(started!.content).toBe('Task started')
    expect(completed!.metadata?.status).toBe('completed')
  })

  it('maps failed lifecycle events with ONLY the safe message (never raw child content)', () => {
    mockEventStore.append(
      buildLifecycleEvent('run_failed', lifecycleMetadata({ status: 'failed', safeMessage: 'EXECUTION_ERROR: boom' })),
    )

    const timelineService = createConsoleTimelineService(stores)
    const result = timelineService.getTimeline(PARENT_SESSION)

    expect(result.total).toBe(1)
    const failed = result.events[0]!
    expect(failed.eventType).toBe('run_failed')
    expect(failed.eventId).toBe(`child-task:${RUN_ID}:failed`)
    expect(failed.content).toBe('EXECUTION_ERROR: boom')
    expect(failed.metadata?.safeMessage).toBe('EXECUTION_ERROR: boom')
    expect(failed.metadata?.status).toBe('failed')
    // No child response/content may leak into the parent timeline entry.
    expect(JSON.stringify(failed.metadata)).not.toContain('response')
    expect(failed.content).not.toContain('CHILD_RAW_RESPONSE')
  })

  it('maps cancelled lifecycle events to run_cancelled with status cancelled', () => {
    mockEventStore.append(
      buildLifecycleEvent(
        'run_cancelled',
        lifecycleMetadata({ status: 'cancelled', safeMessage: 'Subagent execution was cancelled' }),
      ),
    )

    const timelineService = createConsoleTimelineService(stores)
    const result = timelineService.getTimeline(PARENT_SESSION)

    expect(result.total).toBe(1)
    expect(result.events[0]!.eventType).toBe('run_cancelled')
    expect(result.events[0]!.metadata?.status).toBe('cancelled')
    expect(result.events[0]!.content).toBe('Subagent execution was cancelled')
  })

  it('the lifecycle event builder is deterministic per (runId, stage): identical eventId + idempotencyKey', () => {
    const first = buildLifecycleEvent('run_started', lifecycleMetadata({ status: 'running' }))
    const second = buildLifecycleEvent('run_started', lifecycleMetadata({ status: 'running' }))

    expect(first.eventId).toBe(second.eventId)
    expect(first.idempotencyKey).toBe(`child-task-lifecycle:${CHILD_SESSION}:started`)
    expect(first.idempotencyKey).toBe(second.idempotencyKey)
    // Completed stage keys off the same taskId.
    const completed = buildLifecycleEvent('run_completed', lifecycleMetadata({ status: 'completed' }))
    expect(completed.idempotencyKey).toBe(`child-task-lifecycle:${CHILD_SESSION}:completed`)
    expect(completed.eventId).toBe(`child-task:${RUN_ID}:completed`)
  })

  it('lifecycle events are parent-scoped: the child session timeline never sees them', () => {
    mockEventStore.append([
      buildLifecycleEvent('run_started', lifecycleMetadata({ status: 'running' })),
      buildLifecycleEvent('run_completed', lifecycleMetadata({ status: 'completed' })),
    ])

    const timelineService = createConsoleTimelineService(stores)
    const parentTimeline = timelineService.getTimeline(PARENT_SESSION)
    const childTimeline = timelineService.getTimeline(CHILD_SESSION)

    expect(parentTimeline.total).toBe(2)
    // The child stream/snapshot is built from the child session id — no lifecycle entries.
    expect(childTimeline.total).toBe(0)
  })

  it('progress metadata is optional and preserved when present', () => {
    mockEventStore.append(
      buildLifecycleEvent(
        'run_completed',
        lifecycleMetadata({ status: 'completed', progress: 100, safeMessage: 'Done' }),
      ),
    )

    const timelineService = createConsoleTimelineService(stores)
    const event = timelineService.getTimeline(PARENT_SESSION).events[0] as ConsoleTimelineEvent
    expect(event.metadata?.progress).toBe(100)
  })
})
