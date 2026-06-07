import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'

export const SCHEDULE_TRIGGER_STATUSES = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
} as const

export type ScheduleTriggerStatus = (typeof SCHEDULE_TRIGGER_STATUSES)[keyof typeof SCHEDULE_TRIGGER_STATUSES]

export interface ScheduleTrigger {
  scheduleId: string
  ownerUserId: string
  name: string
  schedulePattern: string
  status: ScheduleTriggerStatus
  triggerRegistrationId?: string | null
  lastRunAt?: string | null
  nextRunAt?: string | null
  runCount: number
  maxRuns?: number | null
  createdAt: string
  updatedAt: string
}

export interface CreateScheduleTrigger {
  scheduleId: string
  ownerUserId: string
  name: string
  schedulePattern: string
  status?: ScheduleTriggerStatus
  triggerRegistrationId?: string
  nextRunAt?: string
  maxRuns?: number
}

export interface ScheduleTriggerStore {
  create(trigger: CreateScheduleTrigger, tenantId?: string): ScheduleTrigger
  getById(scheduleId: string, tenantId?: string): ScheduleTrigger | null
  findByOwner(ownerUserId: string, tenantId?: string): ScheduleTrigger[]
  findByStatus(status: ScheduleTriggerStatus, tenantId?: string): ScheduleTrigger[]
  updateStatus(scheduleId: string, status: ScheduleTriggerStatus, tenantId?: string): ScheduleTrigger | null
  incrementRunCount(
    scheduleId: string,
    lastRunAt: string,
    nextRunAt?: string,
    tenantId?: string,
  ): ScheduleTrigger | null
  delete(scheduleId: string, tenantId?: string): void
}

interface ScheduleTriggerRow {
  schedule_id: string
  owner_user_id: string
  name: string
  schedule_pattern: string
  status: string
  trigger_registration_id: string | null
  last_run_at: string | null
  next_run_at: string | null
  run_count: number
  max_runs: number | null
  created_at: string
  updated_at: string
}

class ScheduleTriggerStoreImpl implements ScheduleTriggerStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  create(trigger: CreateScheduleTrigger, tenantId: string = DEFAULT_TENANT_ID): ScheduleTrigger {
    const now = new Date().toISOString()
    const record: ScheduleTrigger = {
      scheduleId: trigger.scheduleId,
      ownerUserId: trigger.ownerUserId,
      name: trigger.name,
      schedulePattern: trigger.schedulePattern,
      status: trigger.status ?? SCHEDULE_TRIGGER_STATUSES.ACTIVE,
      triggerRegistrationId: trigger.triggerRegistrationId ?? null,
      lastRunAt: null,
      nextRunAt: trigger.nextRunAt ?? null,
      runCount: 0,
      maxRuns: trigger.maxRuns ?? null,
      createdAt: now,
      updatedAt: now,
    }

    this.connection.exec(
      `INSERT INTO schedule_triggers (
        schedule_id, owner_user_id, name, schedule_pattern, status,
        trigger_registration_id, last_run_at, next_run_at, run_count, max_runs,
        created_at, updated_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.scheduleId,
        record.ownerUserId,
        record.name,
        record.schedulePattern,
        record.status,
        record.triggerRegistrationId,
        record.lastRunAt,
        record.nextRunAt,
        record.runCount,
        record.maxRuns,
        record.createdAt,
        record.updatedAt,
        tenantId,
      ],
    )

    return record
  }

  getById(scheduleId: string, tenantId: string = DEFAULT_TENANT_ID): ScheduleTrigger | null {
    const results = this.connection.query<ScheduleTriggerRow>(
      'SELECT * FROM schedule_triggers WHERE schedule_id = ? AND tenant_id = ?',
      [scheduleId, tenantId],
    )

    if (results.length === 0) {
      return null
    }

    return this.rowToTrigger(results[0]!)
  }

  findByOwner(ownerUserId: string, tenantId: string = DEFAULT_TENANT_ID): ScheduleTrigger[] {
    const results = this.connection.query<ScheduleTriggerRow>(
      'SELECT * FROM schedule_triggers WHERE owner_user_id = ? AND tenant_id = ? ORDER BY created_at DESC',
      [ownerUserId, tenantId],
    )
    return results.map((row) => this.rowToTrigger(row))
  }

  findByStatus(status: ScheduleTriggerStatus, tenantId: string = DEFAULT_TENANT_ID): ScheduleTrigger[] {
    const results = this.connection.query<ScheduleTriggerRow>(
      'SELECT * FROM schedule_triggers WHERE status = ? AND tenant_id = ?',
      [status, tenantId],
    )
    return results.map((row) => this.rowToTrigger(row))
  }

  updateStatus(
    scheduleId: string,
    status: ScheduleTriggerStatus,
    tenantId: string = DEFAULT_TENANT_ID,
  ): ScheduleTrigger | null {
    const existing = this.getById(scheduleId, tenantId)
    if (!existing) {
      return null
    }

    const now = new Date().toISOString()

    this.connection.exec(
      'UPDATE schedule_triggers SET status = ?, updated_at = ? WHERE schedule_id = ? AND tenant_id = ?',
      [status, now, scheduleId, tenantId],
    )

    return {
      ...existing,
      status,
      updatedAt: now,
    }
  }

  incrementRunCount(
    scheduleId: string,
    lastRunAt: string,
    nextRunAt?: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): ScheduleTrigger | null {
    const existing = this.getById(scheduleId, tenantId)
    if (!existing) {
      return null
    }

    const now = new Date().toISOString()
    const newRunCount = existing.runCount + 1
    const newStatus =
      existing.maxRuns && newRunCount >= existing.maxRuns ? SCHEDULE_TRIGGER_STATUSES.COMPLETED : existing.status

    this.connection.exec(
      `UPDATE schedule_triggers SET
        run_count = ?,
        last_run_at = ?,
        next_run_at = ?,
        status = ?,
        updated_at = ?
      WHERE schedule_id = ? AND tenant_id = ?`,
      [newRunCount, lastRunAt, nextRunAt ?? null, newStatus, now, scheduleId, tenantId],
    )

    return {
      ...existing,
      runCount: newRunCount,
      lastRunAt,
      nextRunAt: nextRunAt ?? null,
      status: newStatus,
      updatedAt: now,
    }
  }

  delete(scheduleId: string, tenantId: string = DEFAULT_TENANT_ID): void {
    this.connection.exec('DELETE FROM schedule_triggers WHERE schedule_id = ? AND tenant_id = ?', [
      scheduleId,
      tenantId,
    ])
  }

  private rowToTrigger(row: ScheduleTriggerRow): ScheduleTrigger {
    return {
      scheduleId: row.schedule_id,
      ownerUserId: row.owner_user_id,
      name: row.name,
      schedulePattern: row.schedule_pattern,
      status: row.status as ScheduleTriggerStatus,
      triggerRegistrationId: row.trigger_registration_id,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      runCount: row.run_count,
      maxRuns: row.max_runs,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

export function createScheduleTriggerStore(connection: ConnectionManager): ScheduleTriggerStore {
  return new ScheduleTriggerStoreImpl(connection)
}
