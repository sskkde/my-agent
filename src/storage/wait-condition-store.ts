import type { ConnectionManager } from './connection.js'

export const WAIT_CONDITION_STATES = {
  REGISTERED: 'registered',
  ACTIVE: 'active',
  SATISFIED: 'satisfied',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
} as const

export type WaitConditionState = (typeof WAIT_CONDITION_STATES)[keyof typeof WAIT_CONDITION_STATES]

export interface WaitCondition {
  id: string
  waitType: string
  conditionPattern: string
  targetType: string
  targetRef: string
  status: WaitConditionState
  priority: number
  timeoutAt?: string | null
  satisfiedAt?: string | null
  satisfiedBy?: string | null
  resultData?: Record<string, unknown> | null
  metadata?: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateWaitCondition {
  id: string
  waitType: string
  conditionPattern: string
  targetType: string
  targetRef: string
  status: WaitConditionState
  priority?: number
  timeoutAt?: string
  metadata?: string
}

export interface WaitConditionStore {
  create(condition: CreateWaitCondition): WaitCondition
  getById(id: string): WaitCondition | null
  findByTarget(targetType: string, targetRef: string): WaitCondition[]
  findByStatus(status: WaitConditionState): WaitCondition[]
  markSatisfied(id: string, satisfiedBy: string, resultData?: Record<string, unknown>): WaitCondition
  markFailed(id: string, reason?: string): WaitCondition
  markTimeout(id: string): WaitCondition
  markCancelled(id: string, reason?: string): WaitCondition
  findExpired(before: string): WaitCondition[]
  delete(id: string): void
}

class WaitConditionStoreImpl implements WaitConditionStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  create(condition: CreateWaitCondition): WaitCondition {
    const now = new Date().toISOString()
    const waitCondition: WaitCondition = {
      id: condition.id,
      waitType: condition.waitType,
      conditionPattern: condition.conditionPattern,
      targetType: condition.targetType,
      targetRef: condition.targetRef,
      status: condition.status,
      priority: condition.priority ?? 0,
      timeoutAt: condition.timeoutAt ?? null,
      satisfiedAt: null,
      satisfiedBy: null,
      resultData: null,
      metadata: condition.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    }

    this.connection.exec(
      `INSERT INTO wait_conditions (
        id, wait_type, condition_pattern, target_type, target_ref,
        status, priority, timeout_at, satisfied_at, satisfied_by,
        result_data, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        waitCondition.id,
        waitCondition.waitType,
        waitCondition.conditionPattern,
        waitCondition.targetType,
        waitCondition.targetRef,
        waitCondition.status,
        waitCondition.priority,
        waitCondition.timeoutAt,
        waitCondition.satisfiedAt,
        waitCondition.satisfiedBy,
        waitCondition.resultData,
        waitCondition.metadata,
        waitCondition.createdAt,
        waitCondition.updatedAt,
      ],
    )

    return waitCondition
  }

  getById(id: string): WaitCondition | null {
    const results = this.connection.query<WaitConditionRow>('SELECT * FROM wait_conditions WHERE id = ?', [id])

    if (results.length === 0) {
      return null
    }

    return this.rowToCondition(results[0])
  }

  findByTarget(targetType: string, targetRef: string): WaitCondition[] {
    const results = this.connection.query<WaitConditionRow>(
      'SELECT * FROM wait_conditions WHERE target_type = ? AND target_ref = ?',
      [targetType, targetRef],
    )
    return results.map((row) => this.rowToCondition(row))
  }

  findByStatus(status: WaitConditionState): WaitCondition[] {
    const results = this.connection.query<WaitConditionRow>('SELECT * FROM wait_conditions WHERE status = ?', [status])
    return results.map((row) => this.rowToCondition(row))
  }

  markSatisfied(id: string, satisfiedBy: string, resultData?: Record<string, unknown>): WaitCondition {
    const existing = this.getById(id)
    if (!existing) {
      throw new Error(`Wait condition not found: ${id}`)
    }

    const now = new Date().toISOString()
    const resultDataJson = resultData ? JSON.stringify(resultData) : null

    this.connection.exec(
      `UPDATE wait_conditions SET
        status = ?,
        satisfied_at = ?,
        satisfied_by = ?,
        result_data = ?,
        updated_at = ?
      WHERE id = ?`,
      [WAIT_CONDITION_STATES.SATISFIED, now, satisfiedBy, resultDataJson, now, id],
    )

    return {
      ...existing,
      status: WAIT_CONDITION_STATES.SATISFIED,
      satisfiedAt: now,
      satisfiedBy,
      resultData: resultData ?? null,
      updatedAt: now,
    }
  }

  markFailed(id: string, reason?: string): WaitCondition {
    const existing = this.getById(id)
    if (!existing) {
      throw new Error(`Wait condition not found: ${id}`)
    }

    const now = new Date().toISOString()
    const metadata = existing.metadata
      ? JSON.stringify({ ...JSON.parse(existing.metadata), failureReason: reason })
      : JSON.stringify({ failureReason: reason })

    this.connection.exec(
      `UPDATE wait_conditions SET
        status = ?,
        metadata = ?,
        updated_at = ?
      WHERE id = ?`,
      [WAIT_CONDITION_STATES.FAILED, metadata, now, id],
    )

    return {
      ...existing,
      status: WAIT_CONDITION_STATES.FAILED,
      metadata,
      updatedAt: now,
    }
  }

  markTimeout(id: string): WaitCondition {
    const existing = this.getById(id)
    if (!existing) {
      throw new Error(`Wait condition not found: ${id}`)
    }

    const now = new Date().toISOString()

    this.connection.exec('UPDATE wait_conditions SET status = ?, updated_at = ? WHERE id = ?', [
      WAIT_CONDITION_STATES.TIMEOUT,
      now,
      id,
    ])

    return {
      ...existing,
      status: WAIT_CONDITION_STATES.TIMEOUT,
      updatedAt: now,
    }
  }

  markCancelled(id: string, reason?: string): WaitCondition {
    const existing = this.getById(id)
    if (!existing) {
      throw new Error(`Wait condition not found: ${id}`)
    }

    const now = new Date().toISOString()
    const metadata = existing.metadata
      ? JSON.stringify({ ...JSON.parse(existing.metadata), cancelReason: reason })
      : JSON.stringify({ cancelReason: reason })

    this.connection.exec(
      `UPDATE wait_conditions SET
        status = ?,
        metadata = ?,
        updated_at = ?
      WHERE id = ?`,
      [WAIT_CONDITION_STATES.CANCELLED, metadata, now, id],
    )

    return {
      ...existing,
      status: WAIT_CONDITION_STATES.CANCELLED,
      metadata,
      updatedAt: now,
    }
  }

  findExpired(before: string): WaitCondition[] {
    const results = this.connection.query<WaitConditionRow>(
      'SELECT * FROM wait_conditions WHERE timeout_at IS NOT NULL AND timeout_at < ?',
      [before],
    )
    return results.map((row) => this.rowToCondition(row))
  }

  delete(id: string): void {
    this.connection.exec('DELETE FROM wait_conditions WHERE id = ?', [id])
  }

  private rowToCondition(row: WaitConditionRow): WaitCondition {
    return {
      id: row.id,
      waitType: row.wait_type,
      conditionPattern: row.condition_pattern,
      targetType: row.target_type,
      targetRef: row.target_ref,
      status: row.status as WaitConditionState,
      priority: row.priority,
      timeoutAt: row.timeout_at,
      satisfiedAt: row.satisfied_at,
      satisfiedBy: row.satisfied_by,
      resultData: row.result_data ? JSON.parse(row.result_data) : null,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

interface WaitConditionRow {
  id: string
  wait_type: string
  condition_pattern: string
  target_type: string
  target_ref: string
  status: string
  priority: number
  timeout_at: string | null
  satisfied_at: string | null
  satisfied_by: string | null
  result_data: string | null
  metadata: string | null
  created_at: string
  updated_at: string
}

export function createWaitConditionStore(connection: ConnectionManager): WaitConditionStore {
  return new WaitConditionStoreImpl(connection)
}
