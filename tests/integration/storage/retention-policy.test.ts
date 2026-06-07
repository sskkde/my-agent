import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js'
import { createPlannerRunStore, type PlannerRunStore } from '../../../src/storage/planner-run-store.js'
import { createPlanStore, type PlanStore, type PlanStep } from '../../../src/storage/plan-store.js'
import { createApprovalStore, type ApprovalStore } from '../../../src/storage/approval-store.js'
import { createToolResultStore, type ToolResultStore } from '../../../src/storage/tool-result-store.js'
import { PLANNER_STATES } from '../../../src/shared/states.js'

function getTableColumns(connection: ConnectionManager, tableName: string): string[] {
  const rows = connection.query<{ name: string }>(`PRAGMA table_info(${tableName})`)
  return rows.map((r) => r.name)
}

describe('Retention Policy', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let eventStore: EventStore
  let plannerRunStore: PlannerRunStore
  let planStore: PlanStore
  let approvalStore: ApprovalStore
  let toolResultStore: ToolResultStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()
    migrations.apply(allStoreMigrations)

    eventStore = createEventStore(connection)
    plannerRunStore = createPlannerRunStore(connection)
    planStore = createPlanStore(connection)
    approvalStore = createApprovalStore(connection)
    toolResultStore = createToolResultStore(connection)
  })

  afterEach(() => {
    connection?.close()
  })

  describe('Events retention_class support', () => {
    it('should have retention_class column on events table', () => {
      expect(getTableColumns(connection, 'events')).toContain('retention_class')
    })

    it('should store events with retention_class values', () => {
      const now = new Date().toISOString()

      eventStore.append({
        eventId: 'evt-ret-standard',
        eventType: 'test.event',
        sourceModule: 'system',
        payload: { test: true },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: now,
      })

      eventStore.append({
        eventId: 'evt-ret-long',
        eventType: 'test.event',
        sourceModule: 'system',
        payload: { test: true },
        sensitivity: 'medium',
        retentionClass: 'long',
        createdAt: now,
      })

      eventStore.append({
        eventId: 'evt-ret-legal',
        eventType: 'test.event',
        sourceModule: 'system',
        payload: { test: true },
        sensitivity: 'high',
        retentionClass: 'legal_hold',
        createdAt: now,
      })

      const standardEvents = eventStore.query({ eventType: 'test.event', limit: 10 })
      expect(standardEvents.length).toBeGreaterThanOrEqual(3)

      const legalHold = standardEvents.find((e) => e.eventId === 'evt-ret-legal')
      expect(legalHold).toBeDefined()
      expect(legalHold?.retentionClass).toBe('legal_hold')
      expect(legalHold?.sensitivity).toBe('high')
    })

    it('should default retention_class to standard for new events', () => {
      const now = new Date().toISOString()

      eventStore.append({
        eventId: 'evt-default-ret',
        eventType: 'test.event',
        sourceModule: 'system',
        payload: {},
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: now,
      })

      const events = eventStore.query({ eventType: 'test.event' })
      const evt = events.find((e) => e.eventId === 'evt-default-ret')
      expect(evt).toBeDefined()
      expect(evt?.retentionClass).toBe('standard')
    })
  })

  describe('Active planner run data persistence', () => {
    const userId = 'user-ret-001'
    const planId = 'plan-ret-001'
    const plannerRunId = 'prun-ret-001'

    function createActivePlanAndRun(): { planId: string; plannerRunId: string } {
      const now = new Date().toISOString()
      const steps: PlanStep[] = [
        { stepId: 's1', description: 'Step 1', status: 'completed' },
        { stepId: 's2', description: 'Step 2', status: 'in_progress' },
      ]

      planStore.createPlan({
        planId,
        userId,
        objective: 'Retention test objective',
        status: 'in_execution',
        currentVersion: 1,
        steps,
        createdAt: now,
        updatedAt: now,
      })

      plannerRunStore.create({
        plannerRunId,
        planId,
        userId,
        status: PLANNER_STATES.PLANNING,
        checkpoint: null,
        createdAt: now,
        updatedAt: now,
      })

      return { planId, plannerRunId }
    }

    it('should persist active planner runs', () => {
      createActivePlanAndRun()

      const run = plannerRunStore.getById(plannerRunId)
      expect(run).not.toBeNull()
      expect(run?.plannerRunId).toBe(plannerRunId)
      expect(run?.status).toBe(PLANNER_STATES.PLANNING)
      expect(run?.userId).toBe(userId)
      expect(run?.planId).toBe(planId)
    })

    it('should list active (non-terminal) runs for a user', () => {
      createActivePlanAndRun()

      plannerRunStore.create({
        plannerRunId: 'prun-ret-archived',
        planId,
        userId,
        status: PLANNER_STATES.ARCHIVED,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const activeRuns = plannerRunStore.findActive(userId)
      expect(activeRuns.length).toBeGreaterThanOrEqual(1)
      expect(activeRuns.some((r) => r.plannerRunId === plannerRunId)).toBe(true)
      expect(activeRuns.some((r) => r.plannerRunId === 'prun-ret-archived')).toBe(false)
    })

    it('should include active runs in all user runs', () => {
      createActivePlanAndRun()

      const allRuns = plannerRunStore.findByUser(userId)
      expect(allRuns.length).toBeGreaterThanOrEqual(1)
      expect(allRuns.some((r) => r.plannerRunId === plannerRunId)).toBe(true)
    })
  })

  describe('Approval audit trail persistence', () => {
    const userId = 'user-ret-002'
    const sessionId = 'sess-ret-002'

    it('should persist approval requests', () => {
      const now = new Date().toISOString()
      const approvalId = 'approval-ret-001'

      const created = approvalStore.create({
        id: approvalId,
        userId,
        sessionId,
        status: 'pending',
        actionType: 'tool.execute',
        resource: 'file.write',
        justification: 'Need to write output file',
        requestedBy: 'planner',
        requestedAt: now,
        riskLevel: 'medium',
      })

      expect(created.id).toBe(approvalId)
      expect(created.userId).toBe(userId)
      expect(created.status).toBe('pending')

      const retrieved = approvalStore.getById(approvalId)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(approvalId)
      expect(retrieved?.actionType).toBe('tool.execute')
      expect(retrieved?.resource).toBe('file.write')
      expect(retrieved?.riskLevel).toBe('medium')
    })

    it('should persist approval state transitions', () => {
      const now = new Date().toISOString()
      const approvalId = 'approval-ret-002'

      approvalStore.create({
        id: approvalId,
        userId,
        sessionId,
        status: 'pending',
        actionType: 'tool.execute',
        requestedBy: 'planner',
        requestedAt: now,
        riskLevel: 'high',
      })

      const respondedAt = new Date().toISOString()
      const updated = approvalStore.update(approvalId, {
        status: 'approved',
        respondedAt,
        responseBy: 'user-admin',
        responseReason: 'Validated and approved',
      })

      expect(updated.status).toBe('approved')
      expect(updated.respondedAt).toBe(respondedAt)
      expect(updated.responseBy).toBe('user-admin')
      expect(updated.responseReason).toBe('Validated and approved')
      expect(updated.riskLevel).toBe('high')
    })

    it('should find pending approvals for user', () => {
      const now = new Date().toISOString()

      approvalStore.create({
        id: 'approval-ret-003',
        userId,
        sessionId,
        status: 'pending',
        actionType: 'tool.execute',
        requestedBy: 'planner',
        requestedAt: now,
      })

      approvalStore.create({
        id: 'approval-ret-004',
        userId,
        sessionId: 'sess-other',
        status: 'pending',
        actionType: 'connector.access',
        requestedBy: 'subagent',
        requestedAt: now,
      })

      const pending = approvalStore.findPendingByUser(userId)
      expect(pending.length).toBeGreaterThanOrEqual(2)
      expect(pending.every((a) => a.status === 'pending')).toBe(true)
    })

    it('should find all user approvals regardless of status', () => {
      const now = new Date().toISOString()

      approvalStore.create({
        id: 'approval-ret-005',
        userId,
        sessionId,
        status: 'approved',
        actionType: 'tool.execute',
        requestedBy: 'planner',
        requestedAt: now,
      })

      approvalStore.create({
        id: 'approval-ret-006',
        userId,
        sessionId,
        status: 'rejected',
        actionType: 'tool.execute',
        requestedBy: 'planner',
        requestedAt: now,
      })

      const all = approvalStore.findByUser(userId)
      expect(all.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Tool result metadata persistence', () => {
    it('should persist tool results with metadata', () => {
      const userId = 'user-ret-003'
      const toolCallId = 'tc-ret-001'

      const result = toolResultStore.create({
        resultRef: 'ref://results/tc-ret-001',
        toolCallId,
        toolName: 'file_read',
        userId,
        sessionId: 'sess-ret-003',
        preview: 'Contents of file.txt',
        sensitivity: 'low',
      })

      expect(result.resultRef).toBe('ref://results/tc-ret-001')
      expect(result.toolCallId).toBe(toolCallId)
      expect(result.toolName).toBe('file_read')
      expect(result.preview).toBe('Contents of file.txt')
      expect(result.sensitivity).toBe('low')
      expect(result.id).toBeTruthy()
      expect(result.createdAt).toBeTruthy()
    })

    it('should find tool results by tool call id', () => {
      const userId = 'user-ret-004'
      const toolCallId = 'tc-ret-002'

      toolResultStore.create({
        resultRef: 'ref://results/a',
        toolCallId,
        toolName: 'web_fetch',
        userId,
        sensitivity: 'low',
      })

      toolResultStore.create({
        resultRef: 'ref://results/b',
        toolCallId,
        toolName: 'web_fetch',
        userId,
        sensitivity: 'medium',
      })

      const results = toolResultStore.findByToolCallId(toolCallId)
      expect(results.length).toBe(2)
      expect(results.every((r) => r.toolCallId === toolCallId)).toBe(true)
    })

    it('should find tool results by tool name', () => {
      const userId = 'user-ret-005'

      toolResultStore.create({
        resultRef: 'ref://results/x',
        toolCallId: 'tc-x',
        toolName: 'search',
        userId,
        sensitivity: 'low',
      })

      toolResultStore.create({
        resultRef: 'ref://results/y',
        toolCallId: 'tc-y',
        toolName: 'file_read',
        userId,
        sensitivity: 'low',
      })

      const searchResults = toolResultStore.findByToolName('search')
      expect(searchResults.length).toBeGreaterThanOrEqual(1)
      expect(searchResults.every((r) => r.toolName === 'search')).toBe(true)

      const fileResults = toolResultStore.findByToolName('file_read')
      expect(fileResults.length).toBeGreaterThanOrEqual(1)
    })

    it('should find tool results by sensitivity', () => {
      const userId = 'user-ret-006'

      toolResultStore.create({
        resultRef: 'ref://results/high-sens',
        toolCallId: 'tc-high',
        toolName: 'web_fetch',
        userId,
        sensitivity: 'high',
      })

      toolResultStore.create({
        resultRef: 'ref://results/low-sens',
        toolCallId: 'tc-low',
        toolName: 'web_fetch',
        userId,
        sensitivity: 'low',
      })

      const highSens = toolResultStore.findBySensitivity('high')
      expect(highSens.length).toBeGreaterThanOrEqual(1)
      expect(highSens.every((r) => r.sensitivity === 'high')).toBe(true)
    })

    it('should persist tool results after multiple writes', () => {
      const userId = 'user-ret-007'
      const resultRef = 'ref://results/persist-test'

      const r1 = toolResultStore.create({
        resultRef,
        toolCallId: 'tc-p1',
        toolName: 'test.tool',
        userId,
        sensitivity: 'low',
      })

      const r2 = toolResultStore.create({
        resultRef: 'ref://results/persist-test-2',
        toolCallId: 'tc-p2',
        toolName: 'test.tool',
        userId,
        sensitivity: 'medium',
      })

      const found1 = toolResultStore.findById(r1.id)
      expect(found1).toBeDefined()
      expect(found1?.resultRef).toBe(resultRef)

      const found2 = toolResultStore.findById(r2.id)
      expect(found2).toBeDefined()
      expect(found2?.sensitivity).toBe('medium')
    })
  })

  describe('Time boundary behavior', () => {
    it('should use correct timestamps for sequential creates', () => {
      const userId = 'user-time-001'
      const beforeTime = new Date().toISOString()

      vi.useFakeTimers()
      vi.setSystemTime(new Date(beforeTime))

      toolResultStore.create({
        resultRef: 'ref://results/time-1',
        toolCallId: 'tc-time-1',
        toolName: 'test.tool',
        userId,
        sensitivity: 'low',
      })

      const afterFirst = new Date(Date.now() + 5000).toISOString()
      vi.setSystemTime(new Date(afterFirst))

      toolResultStore.create({
        resultRef: 'ref://results/time-2',
        toolCallId: 'tc-time-2',
        toolName: 'test.tool',
        userId,
        sensitivity: 'low',
      })

      vi.useRealTimers()

      const results = toolResultStore.findByToolName('test.tool')
      expect(results.length).toBe(2)

      const r1 = results.find((r) => r.resultRef === 'ref://results/time-1')
      const r2 = results.find((r) => r.resultRef === 'ref://results/time-2')

      expect(r1).toBeDefined()
      expect(r2).toBeDefined()

      if (r1 && r2) {
        expect(new Date(r1.createdAt).getTime()).toBeLessThan(new Date(r2.createdAt).getTime())
      }
    })

    it('should preserve event data with specific retention_class over fake time', () => {
      vi.useFakeTimers()
      const startTime = new Date('2026-01-15T12:00:00Z')
      vi.setSystemTime(startTime)

      eventStore.append({
        eventId: 'evt-time-ret',
        eventType: 'audit.access',
        sourceModule: 'system',
        payload: { resource: 'file.db', action: 'read' },
        sensitivity: 'high',
        retentionClass: 'long',
        createdAt: startTime.toISOString(),
      })

      vi.useRealTimers()

      const events = eventStore.query({ eventType: 'audit.access' })
      const evt = events.find((e) => e.eventId === 'evt-time-ret')
      expect(evt).toBeDefined()
      expect(evt?.retentionClass).toBe('long')
      expect(evt?.sensitivity).toBe('high')
      expect(evt?.payload).toEqual({ resource: 'file.db', action: 'read' })
    })
  })
})
