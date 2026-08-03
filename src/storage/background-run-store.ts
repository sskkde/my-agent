import type { ConnectionManager } from './connection.js'
import type { BackgroundSubagentState } from '../shared/states.js'

export interface BackgroundRun {
  backgroundRunId: string
  subagentRunId?: string
  userId: string
  sessionId?: string
  /** Profile label (e.g. 'document_processor'), NOT a runtime boundary. See AgentType for lifecycle types. */
  agentType: string
  /** Capability profile identifier. Defaults to agentType when not provided. */
  agentProfile?: string
  status: BackgroundSubagentState
  launchSource: string
  checkpointData?: unknown
  recoveryPoint?: unknown
  resultData?: unknown
  errorMessage?: string
  priority?: number
  scheduledAt?: string
  startedAt?: string
  completedAt?: string
  expiresAt?: string
  retryCount: number
  createdAt?: string
  updatedAt?: string
  /** Full task spec persisted at enqueue — worker restart recovery (v76). */
  taskSpec?: unknown
  /** Child task id (identity rule: taskId === childSessionId). */
  taskId?: string
  /** Child session id linkage. */
  childSessionId?: string
  /** Terminal notification type once the durable notification is persisted. */
  notificationType?: 'completed' | 'failed' | 'cancelled'
  /** Sanitized notification payload (summary + terminal error). */
  notificationPayload?: unknown
  /** When the parent consumed the notification (null = pending). */
  notificationDeliveredAt?: string
}

export interface BackgroundRunStore {
  create(run: Omit<BackgroundRun, 'createdAt' | 'updatedAt' | 'retryCount'> & { retryCount?: number }): void
  getById(backgroundRunId: string): BackgroundRun | null
  updateStatus(backgroundRunId: string, status: BackgroundSubagentState): void
  saveCheckpoint(backgroundRunId: string, checkpoint: unknown): void
  saveRecoveryPoint(backgroundRunId: string, recoveryPoint: unknown): void
  saveResult(backgroundRunId: string, result: unknown): void
  incrementRetryCount(backgroundRunId: string): void
  saveErrorMessage(backgroundRunId: string, message: string): void
  getByUserAndStatus(userId: string, status: BackgroundSubagentState): BackgroundRun[]
  getBySessionAndStatus(sessionId: string, status: BackgroundSubagentState): BackgroundRun[]
  getBySubagentRunId(subagentRunId: string): BackgroundRun[]
  getByLaunchSource(launchSource: string): BackgroundRun[]
  getByStatus(status: BackgroundSubagentState): BackgroundRun[]
  getExpiredRuns(): BackgroundRun[]
  /** Persist the full task spec so a restarted worker can recover it. */
  saveTaskSpec(backgroundRunId: string, taskSpec: unknown): void
  /** Persist the child session / task linkage after the child run is launched. */
  linkChildTask(
    backgroundRunId: string,
    linkage: { subagentRunId: string; taskId: string; childSessionId: string },
  ): void
  /** Persist the exactly-once terminal notification (idempotent per run). */
  saveNotification(
    backgroundRunId: string,
    notification: { type: 'completed' | 'failed' | 'cancelled'; payload: unknown },
  ): void
  /** Mark a persisted notification as delivered to the parent turn. */
  markNotificationDelivered(backgroundRunId: string, deliveredAt: string): void
  /** Runs with a persisted, not-yet-delivered notification (optionally for one parent session). */
  getPendingNotifications(sessionId?: string): BackgroundRun[]
}

class BackgroundRunStoreImpl implements BackgroundRunStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  create(run: Omit<BackgroundRun, 'createdAt' | 'updatedAt' | 'retryCount'> & { retryCount?: number }): void {
    const now = new Date().toISOString()
    this.connection.exec(
      `INSERT INTO background_runs (
        background_run_id, subagent_run_id, user_id, session_id, agent_type,
        agent_profile, status, launch_source, checkpoint_data, recovery_point, result_data,
        error_message, priority, scheduled_at, started_at, completed_at,
        expires_at, retry_count, created_at, updated_at,
        task_spec_json, task_id, child_session_id, notification_type, notification_payload_json, notification_delivered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.backgroundRunId,
        run.subagentRunId ?? null,
        run.userId,
        run.sessionId ?? null,
        run.agentType,
        run.agentProfile ?? null,
        run.status,
        run.launchSource,
        run.checkpointData ? JSON.stringify(run.checkpointData) : null,
        run.recoveryPoint ? JSON.stringify(run.recoveryPoint) : null,
        run.resultData ? JSON.stringify(run.resultData) : null,
        run.errorMessage ?? null,
        run.priority ?? 0,
        run.scheduledAt ?? null,
        run.startedAt ?? null,
        run.completedAt ?? null,
        run.expiresAt ?? null,
        run.retryCount ?? 0,
        now,
        now,
        run.taskSpec ? JSON.stringify(run.taskSpec) : null,
        run.taskId ?? null,
        run.childSessionId ?? null,
        run.notificationType ?? null,
        run.notificationPayload ? JSON.stringify(run.notificationPayload) : null,
        run.notificationDeliveredAt ?? null,
      ],
    )
  }

  getById(backgroundRunId: string): BackgroundRun | null {
    const results = this.connection.query<{
      background_run_id: string
      subagent_run_id: string | null
      user_id: string
      session_id: string | null
      agent_type: string
      agent_profile: string | null
      status: string
      launch_source: string
      checkpoint_data: string | null
      recovery_point: string | null
      result_data: string | null
      error_message: string | null
      priority: number
      scheduled_at: string | null
      started_at: string | null
      completed_at: string | null
      expires_at: string | null
      retry_count: number
      task_spec_json: string | null
      task_id: string | null
      child_session_id: string | null
      notification_type: string | null
      notification_payload_json: string | null
      notification_delivered_at: string | null
      created_at: string
      updated_at: string
    }>(`SELECT * FROM background_runs WHERE background_run_id = ?`, [backgroundRunId])

    if (results.length === 0) {
      return null
    }

    return this.mapRowToBackgroundRun(results[0])
  }

  updateStatus(backgroundRunId: string, status: BackgroundSubagentState): void {
    const now = new Date().toISOString()
    this.connection.exec(`UPDATE background_runs SET status = ?, updated_at = ? WHERE background_run_id = ?`, [
      status,
      now,
      backgroundRunId,
    ])
  }

  saveCheckpoint(backgroundRunId: string, checkpoint: unknown): void {
    const now = new Date().toISOString()
    const recoveryPoint = { checkpointSavedAt: now, data: checkpoint }
    this.connection.exec(
      `UPDATE background_runs SET checkpoint_data = ?, recovery_point = ?, updated_at = ? WHERE background_run_id = ?`,
      [JSON.stringify(checkpoint), JSON.stringify(recoveryPoint), now, backgroundRunId],
    )
  }

  saveRecoveryPoint(backgroundRunId: string, recoveryPoint: unknown): void {
    const now = new Date().toISOString()
    this.connection.exec(`UPDATE background_runs SET recovery_point = ?, updated_at = ? WHERE background_run_id = ?`, [
      JSON.stringify(recoveryPoint),
      now,
      backgroundRunId,
    ])
  }

  saveResult(backgroundRunId: string, result: unknown): void {
    const now = new Date().toISOString()
    const completedAt = new Date().toISOString()
    this.connection.exec(
      `UPDATE background_runs 
       SET result_data = ?, completed_at = ?, updated_at = ? 
       WHERE background_run_id = ?`,
      [JSON.stringify(result), completedAt, now, backgroundRunId],
    )
  }

  incrementRetryCount(backgroundRunId: string): void {
    const now = new Date().toISOString()
    this.connection.exec(
      `UPDATE background_runs 
       SET retry_count = retry_count + 1, updated_at = ? 
       WHERE background_run_id = ?`,
      [now, backgroundRunId],
    )
  }

  saveErrorMessage(backgroundRunId: string, message: string): void {
    const now = new Date().toISOString()
    this.connection.exec(`UPDATE background_runs SET error_message = ?, updated_at = ? WHERE background_run_id = ?`, [
      message,
      now,
      backgroundRunId,
    ])
  }

  getByUserAndStatus(userId: string, status: BackgroundSubagentState): BackgroundRun[] {
    const results = this.connection.query<{
      background_run_id: string
      subagent_run_id: string | null
      user_id: string
      session_id: string | null
      agent_type: string
      agent_profile: string | null
      status: string
      launch_source: string
      checkpoint_data: string | null
      recovery_point: string | null
      result_data: string | null
      error_message: string | null
      priority: number
      scheduled_at: string | null
      started_at: string | null
      completed_at: string | null
      expires_at: string | null
      retry_count: number
      task_spec_json: string | null
      task_id: string | null
      child_session_id: string | null
      notification_type: string | null
      notification_payload_json: string | null
      notification_delivered_at: string | null
      created_at: string
      updated_at: string
    }>(`SELECT * FROM background_runs WHERE user_id = ? AND status = ? ORDER BY updated_at DESC`, [userId, status])

    return results.map((r) => this.mapRowToBackgroundRun(r))
  }

  getBySessionAndStatus(sessionId: string, status: BackgroundSubagentState): BackgroundRun[] {
    const results = this.connection.query<{
      background_run_id: string
      subagent_run_id: string | null
      user_id: string
      session_id: string | null
      agent_type: string
      agent_profile: string | null
      status: string
      launch_source: string
      checkpoint_data: string | null
      recovery_point: string | null
      result_data: string | null
      error_message: string | null
      priority: number
      scheduled_at: string | null
      started_at: string | null
      completed_at: string | null
      expires_at: string | null
      retry_count: number
      task_spec_json: string | null
      task_id: string | null
      child_session_id: string | null
      notification_type: string | null
      notification_payload_json: string | null
      notification_delivered_at: string | null
      created_at: string
      updated_at: string
    }>(`SELECT * FROM background_runs WHERE session_id = ? AND status = ? ORDER BY updated_at DESC`, [
      sessionId,
      status,
    ])

    return results.map((r) => this.mapRowToBackgroundRun(r))
  }

  getBySubagentRunId(subagentRunId: string): BackgroundRun[] {
    const results = this.connection.query<{
      background_run_id: string
      subagent_run_id: string | null
      user_id: string
      session_id: string | null
      agent_type: string
      agent_profile: string | null
      status: string
      launch_source: string
      checkpoint_data: string | null
      recovery_point: string | null
      result_data: string | null
      error_message: string | null
      priority: number
      scheduled_at: string | null
      started_at: string | null
      completed_at: string | null
      expires_at: string | null
      retry_count: number
      task_spec_json: string | null
      task_id: string | null
      child_session_id: string | null
      notification_type: string | null
      notification_payload_json: string | null
      notification_delivered_at: string | null
      created_at: string
      updated_at: string
    }>(`SELECT * FROM background_runs WHERE subagent_run_id = ? ORDER BY updated_at DESC`, [subagentRunId])

    return results.map((r) => this.mapRowToBackgroundRun(r))
  }

  getByLaunchSource(launchSource: string): BackgroundRun[] {
    const results = this.connection.query<{
      background_run_id: string
      subagent_run_id: string | null
      user_id: string
      session_id: string | null
      agent_type: string
      agent_profile: string | null
      status: string
      launch_source: string
      checkpoint_data: string | null
      recovery_point: string | null
      result_data: string | null
      error_message: string | null
      priority: number
      scheduled_at: string | null
      started_at: string | null
      completed_at: string | null
      expires_at: string | null
      retry_count: number
      task_spec_json: string | null
      task_id: string | null
      child_session_id: string | null
      notification_type: string | null
      notification_payload_json: string | null
      notification_delivered_at: string | null
      created_at: string
      updated_at: string
    }>(`SELECT * FROM background_runs WHERE launch_source = ? ORDER BY updated_at DESC`, [launchSource])

    return results.map((r) => this.mapRowToBackgroundRun(r))
  }

  getByStatus(status: BackgroundSubagentState): BackgroundRun[] {
    const results = this.connection.query<{
      background_run_id: string
      subagent_run_id: string | null
      user_id: string
      session_id: string | null
      agent_type: string
      agent_profile: string | null
      status: string
      launch_source: string
      checkpoint_data: string | null
      recovery_point: string | null
      result_data: string | null
      error_message: string | null
      priority: number
      scheduled_at: string | null
      started_at: string | null
      completed_at: string | null
      expires_at: string | null
      retry_count: number
      task_spec_json: string | null
      task_id: string | null
      child_session_id: string | null
      notification_type: string | null
      notification_payload_json: string | null
      notification_delivered_at: string | null
      created_at: string
      updated_at: string
    }>(`SELECT * FROM background_runs WHERE status = ? ORDER BY updated_at DESC`, [status])

    return results.map((r) => this.mapRowToBackgroundRun(r))
  }

  getExpiredRuns(): BackgroundRun[] {
    const now = new Date().toISOString()
    const results = this.connection.query<{
      background_run_id: string
      subagent_run_id: string | null
      user_id: string
      session_id: string | null
      agent_type: string
      agent_profile: string | null
      status: string
      launch_source: string
      checkpoint_data: string | null
      recovery_point: string | null
      result_data: string | null
      error_message: string | null
      priority: number
      scheduled_at: string | null
      started_at: string | null
      completed_at: string | null
      expires_at: string | null
      retry_count: number
      task_spec_json: string | null
      task_id: string | null
      child_session_id: string | null
      notification_type: string | null
      notification_payload_json: string | null
      notification_delivered_at: string | null
      created_at: string
      updated_at: string
    }>(
      `SELECT * FROM background_runs 
       WHERE expires_at IS NOT NULL AND expires_at < ? 
       ORDER BY expires_at ASC`,
      [now],
    )

    return results.map((r) => this.mapRowToBackgroundRun(r))
  }

  saveTaskSpec(backgroundRunId: string, taskSpec: unknown): void {
    const now = new Date().toISOString()
    this.connection.exec(`UPDATE background_runs SET task_spec_json = ?, updated_at = ? WHERE background_run_id = ?`, [
      JSON.stringify(taskSpec),
      now,
      backgroundRunId,
    ])
  }

  linkChildTask(
    backgroundRunId: string,
    linkage: { subagentRunId: string; taskId: string; childSessionId: string },
  ): void {
    const now = new Date().toISOString()
    this.connection.exec(
      `UPDATE background_runs
       SET subagent_run_id = ?, task_id = ?, child_session_id = ?, updated_at = ?
       WHERE background_run_id = ?`,
      [linkage.subagentRunId, linkage.taskId, linkage.childSessionId, now, backgroundRunId],
    )
  }

  saveNotification(
    backgroundRunId: string,
    notification: { type: 'completed' | 'failed' | 'cancelled'; payload: unknown },
  ): void {
    const now = new Date().toISOString()
    this.connection.exec(
      `UPDATE background_runs
       SET notification_type = ?, notification_payload_json = ?, updated_at = ?
       WHERE background_run_id = ?`,
      [notification.type, JSON.stringify(notification.payload), now, backgroundRunId],
    )
  }

  markNotificationDelivered(backgroundRunId: string, deliveredAt: string): void {
    const now = new Date().toISOString()
    this.connection.exec(
      `UPDATE background_runs
       SET notification_delivered_at = ?, updated_at = ?
       WHERE background_run_id = ?`,
      [deliveredAt, now, backgroundRunId],
    )
  }

  getPendingNotifications(sessionId?: string): BackgroundRun[] {
    let sql = `SELECT * FROM background_runs
       WHERE notification_type IS NOT NULL AND notification_delivered_at IS NULL`
    const params: (string | number)[] = []
    if (sessionId !== undefined) {
      sql += ' AND session_id = ?'
      params.push(sessionId)
    }
    sql += ' ORDER BY updated_at ASC'
    const results = this.connection.query<{
      background_run_id: string
      subagent_run_id: string | null
      user_id: string
      session_id: string | null
      agent_type: string
      agent_profile: string | null
      status: string
      launch_source: string
      checkpoint_data: string | null
      recovery_point: string | null
      result_data: string | null
      error_message: string | null
      priority: number
      scheduled_at: string | null
      started_at: string | null
      completed_at: string | null
      expires_at: string | null
      retry_count: number
      task_spec_json: string | null
      task_id: string | null
      child_session_id: string | null
      notification_type: string | null
      notification_payload_json: string | null
      notification_delivered_at: string | null
      created_at: string
      updated_at: string
    }>(sql, params)
    return results.map((r) => this.mapRowToBackgroundRun(r))
  }

  private mapRowToBackgroundRun(row: {
    background_run_id: string
    subagent_run_id: string | null
    user_id: string
    session_id: string | null
    agent_type: string
    agent_profile: string | null
    status: string
    launch_source: string
    checkpoint_data: string | null
    recovery_point: string | null
    result_data: string | null
    error_message: string | null
    priority: number
    scheduled_at: string | null
    started_at: string | null
    completed_at: string | null
    expires_at: string | null
    retry_count: number
    task_spec_json: string | null
    task_id: string | null
    child_session_id: string | null
    notification_type: string | null
    notification_payload_json: string | null
    notification_delivered_at: string | null
    created_at: string
    updated_at: string
  }): BackgroundRun {
    return {
      backgroundRunId: row.background_run_id,
      subagentRunId: row.subagent_run_id ?? undefined,
      userId: row.user_id,
      sessionId: row.session_id ?? undefined,
      agentType: row.agent_type,
      agentProfile: row.agent_profile ?? undefined,
      status: row.status as BackgroundSubagentState,
      launchSource: row.launch_source,
      checkpointData: row.checkpoint_data ? JSON.parse(row.checkpoint_data) : undefined,
      recoveryPoint: row.recovery_point ? JSON.parse(row.recovery_point) : undefined,
      resultData: row.result_data ? JSON.parse(row.result_data) : undefined,
      errorMessage: row.error_message ?? undefined,
      priority: row.priority,
      scheduledAt: row.scheduled_at ?? undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      retryCount: row.retry_count,
      taskSpec: parseJsonField(row.task_spec_json),
      taskId: row.task_id ?? undefined,
      childSessionId: row.child_session_id ?? undefined,
      notificationType: (row.notification_type ?? undefined) as 'completed' | 'failed' | 'cancelled' | undefined,
      notificationPayload: parseJsonField(row.notification_payload_json),
      notificationDeliveredAt: row.notification_delivered_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

function parseJsonField(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

export function createBackgroundRunStore(connection: ConnectionManager): BackgroundRunStore {
  return new BackgroundRunStoreImpl(connection)
}
