import type { ConnectionManager } from '../storage/connection.js'
import type { TraceContext, RuntimeSpan, TraceStore, TraceQuery, SpanQuery, TraceStatus, SpanStatus } from './types.js'

interface TraceRow {
  trace_id: string
  root_span_id: string
  correlation_id: string | null
  user_id: string | null
  session_id: string | null
  started_at: string
  status: string
}

interface SpanRow {
  span_id: string
  trace_id: string
  parent_span_id: string | null
  span_type: string
  module: string
  operation: string
  status: string
  start_time: string
  end_time: string | null
  duration_ms: number | null
  error: string | null
  metadata: string | null
}

function rowToTraceContext(row: TraceRow): TraceContext {
  return {
    traceId: row.trace_id,
    rootSpanId: row.root_span_id,
    correlationId: row.correlation_id ?? undefined,
    userId: row.user_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    startedAt: row.started_at,
    status: row.status as TraceStatus,
  }
}

function rowToRuntimeSpan(row: SpanRow): RuntimeSpan {
  return {
    spanId: row.span_id,
    traceId: row.trace_id,
    parentSpanId: row.parent_span_id ?? undefined,
    spanType: row.span_type as RuntimeSpan['spanType'],
    module: row.module as RuntimeSpan['module'],
    operation: row.operation,
    status: row.status as SpanStatus,
    startTime: row.start_time,
    endTime: row.end_time ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    error: row.error ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }
}

class TraceStoreImpl implements TraceStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  createTrace(context: TraceContext): void {
    const sql = `
      INSERT INTO trace_contexts (
        trace_id, root_span_id, correlation_id, user_id, session_id, started_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    const params = [
      context.traceId,
      context.rootSpanId,
      context.correlationId ?? null,
      context.userId ?? null,
      context.sessionId ?? null,
      context.startedAt,
      context.status,
    ]
    this.connection.exec(sql, params)
  }

  getTrace(traceId: string): TraceContext | null {
    const sql = 'SELECT * FROM trace_contexts WHERE trace_id = ?'
    const rows = this.connection.query<TraceRow>(sql, [traceId])
    if (rows.length === 0) {
      return null
    }
    return rowToTraceContext(rows[0])
  }

  updateTraceStatus(traceId: string, status: TraceStatus): void {
    const sql = 'UPDATE trace_contexts SET status = ? WHERE trace_id = ?'
    this.connection.exec(sql, [status, traceId])
  }

  findTracesByCorrelation(correlationId: string): TraceContext[] {
    const sql = 'SELECT * FROM trace_contexts WHERE correlation_id = ? ORDER BY started_at DESC'
    const rows = this.connection.query<TraceRow>(sql, [correlationId])
    return rows.map(rowToTraceContext)
  }

  findTracesByUser(userId: string): TraceContext[] {
    const sql = 'SELECT * FROM trace_contexts WHERE user_id = ? ORDER BY started_at DESC'
    const rows = this.connection.query<TraceRow>(sql, [userId])
    return rows.map(rowToTraceContext)
  }

  findTracesBySession(sessionId: string): TraceContext[] {
    const sql = 'SELECT * FROM trace_contexts WHERE session_id = ? ORDER BY started_at DESC'
    const rows = this.connection.query<TraceRow>(sql, [sessionId])
    return rows.map(rowToTraceContext)
  }

  findTraces(query: TraceQuery): TraceContext[] {
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (query.correlationId !== undefined) {
      conditions.push('correlation_id = ?')
      params.push(query.correlationId)
    }

    if (query.userId !== undefined) {
      conditions.push('user_id = ?')
      params.push(query.userId)
    }

    if (query.sessionId !== undefined) {
      conditions.push('session_id = ?')
      params.push(query.sessionId)
    }

    if (query.status !== undefined) {
      conditions.push('status = ?')
      params.push(query.status)
    }

    let sql = 'SELECT * FROM trace_contexts'
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY started_at DESC'

    if (query.limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }

    if (query.offset !== undefined) {
      sql += ' OFFSET ?'
      params.push(query.offset)
    }

    const rows = this.connection.query<TraceRow>(sql, params)
    return rows.map(rowToTraceContext)
  }

  createSpan(span: RuntimeSpan): void {
    const sql = `
      INSERT INTO trace_spans (
        span_id, trace_id, parent_span_id, span_type, module, operation,
        status, start_time, end_time, duration_ms, error, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    const params = [
      span.spanId,
      span.traceId,
      span.parentSpanId ?? null,
      span.spanType,
      span.module,
      span.operation,
      span.status,
      span.startTime,
      span.endTime ?? null,
      span.durationMs ?? null,
      span.error ?? null,
      span.metadata ? JSON.stringify(span.metadata) : null,
    ]
    this.connection.exec(sql, params)
  }

  getSpan(spanId: string): RuntimeSpan | null {
    const sql = 'SELECT * FROM trace_spans WHERE span_id = ?'
    const rows = this.connection.query<SpanRow>(sql, [spanId])
    if (rows.length === 0) {
      return null
    }
    return rowToRuntimeSpan(rows[0])
  }

  updateSpan(spanId: string, updates: Partial<RuntimeSpan>): void {
    const fields: string[] = []
    const params: unknown[] = []

    if (updates.status !== undefined) {
      fields.push('status = ?')
      params.push(updates.status)
    }

    if (updates.endTime !== undefined) {
      fields.push('end_time = ?')
      params.push(updates.endTime)
    }

    if (updates.durationMs !== undefined) {
      fields.push('duration_ms = ?')
      params.push(updates.durationMs)
    }

    if (updates.error !== undefined) {
      fields.push('error = ?')
      params.push(updates.error)
    }

    if (updates.metadata !== undefined) {
      fields.push('metadata = ?')
      params.push(JSON.stringify(updates.metadata))
    }

    if (fields.length === 0) {
      return
    }

    const sql = `UPDATE trace_spans SET ${fields.join(', ')} WHERE span_id = ?`
    params.push(spanId)
    this.connection.exec(sql, params)
  }

  endSpan(spanId: string, status: SpanStatus, error?: string): void {
    const span = this.getSpan(spanId)
    if (!span) {
      return
    }

    const endTime = new Date().toISOString()
    const startMs = new Date(span.startTime).getTime()
    const endMs = new Date(endTime).getTime()
    const durationMs = endMs - startMs

    const sql = `
      UPDATE trace_spans
      SET status = ?, end_time = ?, duration_ms = ?, error = ?
      WHERE span_id = ?
    `
    this.connection.exec(sql, [status, endTime, durationMs, error ?? null, spanId])
  }

  findSpansByTrace(traceId: string): RuntimeSpan[] {
    const sql = 'SELECT * FROM trace_spans WHERE trace_id = ? ORDER BY start_time ASC'
    const rows = this.connection.query<SpanRow>(sql, [traceId])
    return rows.map(rowToRuntimeSpan)
  }

  findSpansByModule(module: string): RuntimeSpan[] {
    const sql = 'SELECT * FROM trace_spans WHERE module = ? ORDER BY start_time DESC'
    const rows = this.connection.query<SpanRow>(sql, [module])
    return rows.map(rowToRuntimeSpan)
  }

  findSpansByParent(parentSpanId: string): RuntimeSpan[] {
    const sql = 'SELECT * FROM trace_spans WHERE parent_span_id = ? ORDER BY start_time ASC'
    const rows = this.connection.query<SpanRow>(sql, [parentSpanId])
    return rows.map(rowToRuntimeSpan)
  }

  findSpans(query: SpanQuery): RuntimeSpan[] {
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (query.traceId !== undefined) {
      conditions.push('trace_id = ?')
      params.push(query.traceId)
    }

    if (query.module !== undefined) {
      conditions.push('module = ?')
      params.push(query.module)
    }

    if (query.spanType !== undefined) {
      conditions.push('span_type = ?')
      params.push(query.spanType)
    }

    if (query.status !== undefined) {
      conditions.push('status = ?')
      params.push(query.status)
    }

    if (query.parentSpanId !== undefined) {
      conditions.push('parent_span_id = ?')
      params.push(query.parentSpanId)
    }

    let sql = 'SELECT * FROM trace_spans'
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY start_time DESC'

    if (query.limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }

    if (query.offset !== undefined) {
      sql += ' OFFSET ?'
      params.push(query.offset)
    }

    const rows = this.connection.query<SpanRow>(sql, params)
    return rows.map(rowToRuntimeSpan)
  }
}

export function createTraceStore(connection: ConnectionManager): TraceStore {
  return new TraceStoreImpl(connection)
}
