import type { ConnectionManager } from '../storage/connection.js'
import type {
  AuditRecord,
  AuditStore,
  AuditQuery,
  AuditType,
  AuditSourceModule,
  AuditStatus,
  RiskLevel,
  SensitivityLevel,
} from './audit-types.js'

interface AuditRow {
  audit_id: string
  audit_type: string
  timestamp: string
  user_id: string
  session_id: string | null
  source_module: string
  source_action: string
  action_summary: string
  target_type: string | null
  target_ref: string | null
  status: string
  payload: string
  input_hash: string | null
  correlation_id: string | null
  causation_id: string | null
  approval_id: string | null
  tool_call_id: string | null
  permission_decision_id: string | null
  risk_level: string
  sensitivity: string
}

function rowToAuditRecord(row: AuditRow): AuditRecord {
  return {
    auditId: row.audit_id,
    auditType: row.audit_type as AuditType,
    timestamp: row.timestamp,
    userId: row.user_id,
    sessionId: row.session_id ?? undefined,
    sourceModule: row.source_module as AuditSourceModule,
    sourceAction: row.source_action,
    actionSummary: row.action_summary,
    targetType: row.target_type ?? undefined,
    targetRef: row.target_ref ?? undefined,
    status: row.status as AuditStatus,
    payload: JSON.parse(row.payload),
    inputHash: row.input_hash ?? undefined,
    correlationId: row.correlation_id ?? undefined,
    causationId: row.causation_id ?? undefined,
    approvalId: row.approval_id ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    permissionDecisionId: row.permission_decision_id ?? undefined,
    riskLevel: row.risk_level as RiskLevel,
    sensitivity: row.sensitivity as SensitivityLevel,
  }
}

class AuditStoreImpl implements AuditStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  record(record: AuditRecord): void {
    const sql = `
      INSERT INTO audit_records (
        audit_id, audit_type, timestamp, user_id, session_id,
        source_module, source_action, action_summary, target_type, target_ref,
        status, payload, input_hash, correlation_id, causation_id,
        approval_id, tool_call_id, permission_decision_id, risk_level, sensitivity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    const params = [
      record.auditId,
      record.auditType,
      record.timestamp,
      record.userId,
      record.sessionId ?? null,
      record.sourceModule,
      record.sourceAction,
      record.actionSummary,
      record.targetType ?? null,
      record.targetRef ?? null,
      record.status,
      JSON.stringify(record.payload),
      record.inputHash ?? null,
      record.correlationId ?? null,
      record.causationId ?? null,
      record.approvalId ?? null,
      record.toolCallId ?? null,
      record.permissionDecisionId ?? null,
      record.riskLevel,
      record.sensitivity,
    ]
    this.connection.exec(sql, params)
  }

  recordMany(records: AuditRecord[]): void {
    for (const record of records) {
      this.record(record)
    }
  }

  get(auditId: string): AuditRecord | null {
    const sql = 'SELECT * FROM audit_records WHERE audit_id = ?'
    const rows = this.connection.query<AuditRow>(sql, [auditId])
    if (rows.length === 0) {
      return null
    }
    return rowToAuditRecord(rows[0])
  }

  query(query: AuditQuery): AuditRecord[] {
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (query.userId !== undefined) {
      conditions.push('user_id = ?')
      params.push(query.userId)
    }

    if (query.sessionId !== undefined) {
      conditions.push('session_id = ?')
      params.push(query.sessionId)
    }

    if (query.auditType !== undefined) {
      conditions.push('audit_type = ?')
      params.push(query.auditType)
    }

    if (query.sourceModule !== undefined) {
      conditions.push('source_module = ?')
      params.push(query.sourceModule)
    }

    if (query.status !== undefined) {
      conditions.push('status = ?')
      params.push(query.status)
    }

    if (query.riskLevel !== undefined) {
      conditions.push('risk_level = ?')
      params.push(query.riskLevel)
    }

    if (query.sensitivity !== undefined) {
      conditions.push('sensitivity = ?')
      params.push(query.sensitivity)
    }

    if (query.approvalId !== undefined) {
      conditions.push('approval_id = ?')
      params.push(query.approvalId)
    }

    if (query.toolCallId !== undefined) {
      conditions.push('tool_call_id = ?')
      params.push(query.toolCallId)
    }

    if (query.permissionDecisionId !== undefined) {
      conditions.push('permission_decision_id = ?')
      params.push(query.permissionDecisionId)
    }

    if (query.correlationId !== undefined) {
      conditions.push('correlation_id = ?')
      params.push(query.correlationId)
    }

    if (query.startTime !== undefined) {
      conditions.push('timestamp >= ?')
      params.push(query.startTime)
    }

    if (query.endTime !== undefined) {
      conditions.push('timestamp <= ?')
      params.push(query.endTime)
    }

    let sql = 'SELECT * FROM audit_records'
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY timestamp DESC'

    if (query.limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }

    if (query.offset !== undefined) {
      if (query.limit === undefined) {
        sql += ' LIMIT -1'
      }
      sql += ' OFFSET ?'
      params.push(query.offset)
    }

    const rows = this.connection.query<AuditRow>(sql, params)
    return rows.map(rowToAuditRecord)
  }

  findByUser(userId: string): AuditRecord[] {
    const sql = 'SELECT * FROM audit_records WHERE user_id = ? ORDER BY timestamp DESC'
    const rows = this.connection.query<AuditRow>(sql, [userId])
    return rows.map(rowToAuditRecord)
  }

  findBySession(sessionId: string): AuditRecord[] {
    const sql = 'SELECT * FROM audit_records WHERE session_id = ? ORDER BY timestamp DESC'
    const rows = this.connection.query<AuditRow>(sql, [sessionId])
    return rows.map(rowToAuditRecord)
  }

  findByCorrelationId(correlationId: string): AuditRecord[] {
    const sql = 'SELECT * FROM audit_records WHERE correlation_id = ? ORDER BY timestamp DESC'
    const rows = this.connection.query<AuditRow>(sql, [correlationId])
    return rows.map(rowToAuditRecord)
  }

  findByApprovalId(approvalId: string): AuditRecord[] {
    const sql = 'SELECT * FROM audit_records WHERE approval_id = ? ORDER BY timestamp DESC'
    const rows = this.connection.query<AuditRow>(sql, [approvalId])
    return rows.map(rowToAuditRecord)
  }

  findByToolCallId(toolCallId: string): AuditRecord[] {
    const sql = 'SELECT * FROM audit_records WHERE tool_call_id = ? ORDER BY timestamp DESC'
    const rows = this.connection.query<AuditRow>(sql, [toolCallId])
    return rows.map(rowToAuditRecord)
  }

  findByPermissionDecisionId(permissionDecisionId: string): AuditRecord[] {
    const sql = 'SELECT * FROM audit_records WHERE permission_decision_id = ? ORDER BY timestamp DESC'
    const rows = this.connection.query<AuditRow>(sql, [permissionDecisionId])
    return rows.map(rowToAuditRecord)
  }

  count(query: AuditQuery): number {
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (query.userId !== undefined) {
      conditions.push('user_id = ?')
      params.push(query.userId)
    }

    if (query.sessionId !== undefined) {
      conditions.push('session_id = ?')
      params.push(query.sessionId)
    }

    if (query.auditType !== undefined) {
      conditions.push('audit_type = ?')
      params.push(query.auditType)
    }

    if (query.sourceModule !== undefined) {
      conditions.push('source_module = ?')
      params.push(query.sourceModule)
    }

    if (query.status !== undefined) {
      conditions.push('status = ?')
      params.push(query.status)
    }

    if (query.riskLevel !== undefined) {
      conditions.push('risk_level = ?')
      params.push(query.riskLevel)
    }

    if (query.sensitivity !== undefined) {
      conditions.push('sensitivity = ?')
      params.push(query.sensitivity)
    }

    if (query.approvalId !== undefined) {
      conditions.push('approval_id = ?')
      params.push(query.approvalId)
    }

    if (query.toolCallId !== undefined) {
      conditions.push('tool_call_id = ?')
      params.push(query.toolCallId)
    }

    if (query.permissionDecisionId !== undefined) {
      conditions.push('permission_decision_id = ?')
      params.push(query.permissionDecisionId)
    }

    if (query.correlationId !== undefined) {
      conditions.push('correlation_id = ?')
      params.push(query.correlationId)
    }

    if (query.startTime !== undefined) {
      conditions.push('timestamp >= ?')
      params.push(query.startTime)
    }

    if (query.endTime !== undefined) {
      conditions.push('timestamp <= ?')
      params.push(query.endTime)
    }

    let sql = 'SELECT COUNT(*) as count FROM audit_records'
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    const result = this.connection.query<{ count: number }>(sql, params)
    return result[0]?.count ?? 0
  }

  deleteOlderThan(timestamp: string): number {
    const sql = 'DELETE FROM audit_records WHERE timestamp < ?'
    this.connection.exec(sql, [timestamp])
    return this.connection.query<{ changes: number }>('SELECT changes() as changes')[0]?.changes ?? 0
  }
}

export function createAuditStore(connection: ConnectionManager): AuditStore {
  return new AuditStoreImpl(connection)
}
