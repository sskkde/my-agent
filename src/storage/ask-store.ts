import type { ConnectionManager } from './connection.js'

export const ASK_STATES = {
  PENDING: 'pending',
  ANSWERED: 'answered',
} as const

export type AskState = (typeof ASK_STATES)[keyof typeof ASK_STATES]

export interface AskOption {
  value: string
  label?: string
}

export interface AskAnswer {
  value: string
  label?: string
}

export interface AskRequest {
  id: string
  userId: string
  sessionId: string
  status: AskState
  question: string
  options: AskOption[] | null
  multiSelect: boolean
  context: string | null
  answers: AskAnswer[] | null
  requestedBy: string
  requestedAt: string
  respondedAt: string | null
  responseBy: string | null
  responseClaimedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateAskRequest {
  id: string
  userId: string
  sessionId: string
  status: AskState
  question: string
  options?: AskOption[] | null
  multiSelect?: boolean
  context?: string | null
  answers?: AskAnswer[] | null
  requestedBy: string
  requestedAt: string
  respondedAt?: string | null
  responseBy?: string | null
}

export interface UpdateAskRequest {
  status?: AskState
  answers?: AskAnswer[]
  respondedAt?: string
  responseBy?: string
}

export interface AskStore {
  create(request: CreateAskRequest): AskRequest
  getById(id: string): AskRequest | null
  update(id: string, updates: UpdateAskRequest): AskRequest
  findByUser(userId: string, opts?: { sessionId?: string }): AskRequest[]
  findPendingByUser(userId: string): AskRequest[]
  claimResponse(id: string, claimedAt: string): boolean
  unclaimResponse(id: string): void
  delete(id: string): void
}

class AskStoreImpl implements AskStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  create(request: CreateAskRequest): AskRequest {
    const now = new Date().toISOString()
    const ask: AskRequest = {
      id: request.id,
      userId: request.userId,
      sessionId: request.sessionId,
      status: request.status,
      question: request.question,
      options: request.options ?? null,
      multiSelect: request.multiSelect ?? false,
      context: request.context ?? null,
      answers: request.answers ?? null,
      requestedBy: request.requestedBy,
      requestedAt: request.requestedAt,
      respondedAt: request.respondedAt ?? null,
      responseBy: request.responseBy ?? null,
      responseClaimedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    this.connection.exec(
      `INSERT INTO ask_requests (
        id, user_id, session_id, status, question, options, multi_select, context, answers,
        requested_by, requested_at, responded_at, response_by, response_claimed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ask.id,
        ask.userId,
        ask.sessionId,
        ask.status,
        ask.question,
        ask.options ? JSON.stringify(ask.options) : null,
        ask.multiSelect ? 1 : 0,
        ask.context,
        ask.answers ? JSON.stringify(ask.answers) : null,
        ask.requestedBy,
        ask.requestedAt,
        ask.respondedAt,
        ask.responseBy,
        ask.responseClaimedAt,
        ask.createdAt,
        ask.updatedAt,
      ],
    )

    return ask
  }

  getById(id: string): AskRequest | null {
    const results = this.connection.query<AskRequestRow>('SELECT * FROM ask_requests WHERE id = ?', [id])

    if (results.length === 0) {
      return null
    }

    return this.rowToRequest(results[0])
  }

  update(id: string, updates: UpdateAskRequest): AskRequest {
    const existing = this.getById(id)
    if (!existing) {
      throw new Error(`Ask request not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: AskRequest = {
      ...existing,
      status: updates.status ?? existing.status,
      answers: updates.answers ?? existing.answers,
      respondedAt: updates.respondedAt ?? existing.respondedAt,
      responseBy: updates.responseBy ?? existing.responseBy,
      updatedAt: now,
    }

    this.connection.exec(
      `UPDATE ask_requests SET
        status = ?,
        answers = ?,
        responded_at = ?,
        response_by = ?,
        updated_at = ?
      WHERE id = ?`,
      [
        updated.status,
        updated.answers ? JSON.stringify(updated.answers) : null,
        updated.respondedAt,
        updated.responseBy,
        updated.updatedAt,
        id,
      ],
    )

    return updated
  }

  findByUser(userId: string, opts?: { sessionId?: string }): AskRequest[] {
    const params: string[] = [userId]
    let sql = 'SELECT * FROM ask_requests WHERE user_id = ?'
    if (opts?.sessionId) {
      sql += ' AND session_id = ?'
      params.push(opts.sessionId)
    }
    // Earliest requested first so pending asks surface at the top.
    sql += ' ORDER BY requested_at ASC'
    const results = this.connection.query<AskRequestRow>(sql, params)
    return results.map((row) => this.rowToRequest(row))
  }

  findPendingByUser(userId: string): AskRequest[] {
    const results = this.connection.query<AskRequestRow>(
      'SELECT * FROM ask_requests WHERE user_id = ? AND status = ? ORDER BY requested_at ASC',
      [userId, ASK_STATES.PENDING],
    )
    return results.map((row) => this.rowToRequest(row))
  }

  claimResponse(id: string, claimedAt: string): boolean {
    this.connection.exec(
      `UPDATE ask_requests SET response_claimed_at = ? WHERE id = ? AND response_claimed_at IS NULL`,
      [claimedAt, id],
    )
    const result = this.connection.query<{ changes: number }>('SELECT changes() as changes')
    return (result[0]?.changes ?? 0) > 0
  }

  unclaimResponse(id: string): void {
    this.connection.exec(`UPDATE ask_requests SET response_claimed_at = NULL WHERE id = ?`, [id])
  }

  delete(id: string): void {
    this.connection.exec('DELETE FROM ask_requests WHERE id = ?', [id])
  }

  private rowToRequest(row: AskRequestRow): AskRequest {
    let options: AskOption[] | null = null
    if (row.options) {
      try {
        options = JSON.parse(row.options) as AskOption[]
      } catch {
        options = null
      }
    }

    let answers: AskAnswer[] | null = null
    if (row.answers) {
      try {
        answers = JSON.parse(row.answers) as AskAnswer[]
      } catch {
        answers = null
      }
    }

    return {
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      status: row.status as AskState,
      question: row.question,
      options,
      multiSelect: row.multi_select === 1,
      context: row.context,
      answers,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      respondedAt: row.responded_at,
      responseBy: row.response_by,
      responseClaimedAt: row.response_claimed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

interface AskRequestRow {
  id: string
  user_id: string
  session_id: string
  status: string
  question: string
  options: string | null
  multi_select: number
  context: string | null
  answers: string | null
  requested_by: string
  requested_at: string
  responded_at: string | null
  response_by: string | null
  response_claimed_at: string | null
  created_at: string
  updated_at: string
}

export function createAskStore(connection: ConnectionManager): AskStore {
  return new AskStoreImpl(connection)
}
