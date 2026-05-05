import type { ConnectionManager } from './connection.js';

export type Visibility = 'public' | 'internal' | 'confidential';

export interface VisibleMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'tool' | 'thinking' | 'system_status' | 'approval' | 'artifact' | 'error';
  content: string;
}

export interface TurnTranscript {
  turnId: string;
  sessionId: string;
  userId: string;

  input: {
    inboundEventId?: string;
    userMessageSummary?: string;
    contentRefs?: string[];
    /** ISO timestamp of the inbound user message (when the user sent it). */
    inboundTimestamp?: string;
  };

  output: {
    visibleMessages: VisibleMessage[];
    artifactRefs?: string[];
  };

  runtimeSummary?: {
    foregroundDecisionId?: string;
    plannerRunIds?: string[];
    runtimeActionIds?: string[];
    toolCallSummaries?: string[];
    approvalSummaries?: string[];
  };

  eventRange?: {
    startEventId: string;
    endEventId: string;
  };

  visibility: Visibility;
  createdAt: string;
}

export interface FindOptions {
  limit?: number;
  offset?: number;
}

export interface SearchOptions {
  sessionId?: string;
  limit?: number;
  offset?: number;
}

export interface TranscriptStore {
  saveTurn(transcript: TurnTranscript): boolean;
  getTurn(turnId: string): TurnTranscript | null;
  findBySession(sessionId: string, options?: FindOptions): TurnTranscript[];
  search(query: string, options?: SearchOptions): TurnTranscript[];
  findByArtifactRef(artifactRef: string): TurnTranscript[];
  findByPlannerRunId(plannerRunId: string): TurnTranscript[];
  updateUserIdForSession(sessionId: string, newUserId: string): number;
}

interface TranscriptRow {
  turnId: string;
  sessionId: string;
  userId: string;
  inboundEventId: string | null;
  userMessageSummary: string | null;
  contentRefs: string | null;
  visibleMessages: string;
  artifactRefs: string | null;
  foregroundDecisionId: string | null;
  plannerRunIds: string | null;
  runtimeActionIds: string | null;
  toolCallSummaries: string | null;
  approvalSummaries: string | null;
  startEventId: string | null;
  endEventId: string | null;
  visibility: Visibility;
  createdAt: string;
}

const INBOUND_TS_PREFIX = '__inboundTimestamp:';

function encodeContentRefs(refs: string[] | undefined, inboundTimestamp?: string): string | null {
  const entries = [...(refs ?? [])];
  if (inboundTimestamp) {
    entries.push(`${INBOUND_TS_PREFIX}${inboundTimestamp}`);
  }
  return entries.length > 0 ? JSON.stringify(entries) : null;
}

function decodeContentRefs(raw: string | null): { contentRefs?: string[]; inboundTimestamp?: string } {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const refs: string[] = [];
    let inboundTimestamp: string | undefined;
    for (const entry of parsed) {
      if (typeof entry === 'string' && entry.startsWith(INBOUND_TS_PREFIX)) {
        inboundTimestamp = entry.slice(INBOUND_TS_PREFIX.length);
      } else if (typeof entry === 'string') {
        refs.push(entry);
      }
    }
    return {
      contentRefs: refs.length > 0 ? refs : undefined,
      inboundTimestamp,
    };
  } catch {
    return {};
  }
}

class TranscriptStoreImpl implements TranscriptStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  saveTurn(transcript: TurnTranscript): boolean {
    const sql = `
      INSERT INTO transcripts (
        turnId, sessionId, userId,
        inboundEventId, userMessageSummary, contentRefs,
        visibleMessages, artifactRefs,
        foregroundDecisionId, plannerRunIds, runtimeActionIds,
        toolCallSummaries, approvalSummaries,
        startEventId, endEventId,
        visibility, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      transcript.turnId,
      transcript.sessionId,
      transcript.userId,
      transcript.input.inboundEventId ?? null,
      transcript.input.userMessageSummary ?? null,
      encodeContentRefs(transcript.input.contentRefs, transcript.input.inboundTimestamp),
      JSON.stringify(transcript.output.visibleMessages),
      transcript.output.artifactRefs ? JSON.stringify(transcript.output.artifactRefs) : null,
      transcript.runtimeSummary?.foregroundDecisionId ?? null,
      transcript.runtimeSummary?.plannerRunIds ? JSON.stringify(transcript.runtimeSummary.plannerRunIds) : null,
      transcript.runtimeSummary?.runtimeActionIds ? JSON.stringify(transcript.runtimeSummary.runtimeActionIds) : null,
      transcript.runtimeSummary?.toolCallSummaries ? JSON.stringify(transcript.runtimeSummary.toolCallSummaries) : null,
      transcript.runtimeSummary?.approvalSummaries ? JSON.stringify(transcript.runtimeSummary.approvalSummaries) : null,
      transcript.eventRange?.startEventId ?? null,
      transcript.eventRange?.endEventId ?? null,
      transcript.visibility,
      transcript.createdAt
    ];

    try {
      this.connection.exec(sql, params);
      return true;
    } catch (error) {
      return false;
    }
  }

  getTurn(turnId: string): TurnTranscript | null {
    const sql = 'SELECT * FROM transcripts WHERE turnId = ?';
    const rows = this.connection.query<TranscriptRow>(sql, [turnId]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToTranscript(rows[0]);
  }

  findBySession(sessionId: string, options: FindOptions = {}): TurnTranscript[] {
    const { limit = 1000, offset = 0 } = options;

    const sql = `
      SELECT * FROM transcripts
      WHERE sessionId = ?
      ORDER BY createdAt ASC
      LIMIT ? OFFSET ?
    `;

    const rows = this.connection.query<TranscriptRow>(sql, [sessionId, limit, offset]);
    return rows.map(row => this.rowToTranscript(row));
  }

  search(query: string, options: SearchOptions = {}): TurnTranscript[] {
    const { sessionId, limit = 100, offset = 0 } = options;

    const searchPattern = `%${query}%`;
    let sql: string;
    let params: unknown[];

    if (sessionId) {
      sql = `
        SELECT * FROM transcripts
        WHERE sessionId = ?
          AND (
            userMessageSummary LIKE ?
            OR EXISTS (
              SELECT 1 FROM json_each(visibleMessages)
              WHERE json_extract(json_each.value, '$.content') LIKE ?
            )
          )
        ORDER BY createdAt ASC
        LIMIT ? OFFSET ?
      `;
      params = [sessionId, searchPattern, searchPattern, limit, offset];
    } else {
      sql = `
        SELECT * FROM transcripts
        WHERE userMessageSummary LIKE ?
          OR EXISTS (
            SELECT 1 FROM json_each(visibleMessages)
            WHERE json_extract(json_each.value, '$.content') LIKE ?
          )
        ORDER BY createdAt ASC
        LIMIT ? OFFSET ?
      `;
      params = [searchPattern, searchPattern, limit, offset];
    }

    try {
      const rows = this.connection.query<TranscriptRow>(sql, params);
      return rows.map(row => this.rowToTranscript(row));
    } catch {
      return [];
    }
  }

  findByArtifactRef(artifactRef: string): TurnTranscript[] {
    const sql = `
      SELECT * FROM transcripts
      WHERE artifactRefs IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM json_each(artifactRefs)
          WHERE json_each.value = ?
        )
    `;

    const rows = this.connection.query<TranscriptRow>(sql, [artifactRef]);
    return rows.map(row => this.rowToTranscript(row));
  }

  findByPlannerRunId(plannerRunId: string): TurnTranscript[] {
    const sql = `
      SELECT * FROM transcripts
      WHERE plannerRunIds IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM json_each(plannerRunIds)
          WHERE json_each.value = ?
        )
    `;

    const rows = this.connection.query<TranscriptRow>(sql, [plannerRunId]);
    return rows.map(row => this.rowToTranscript(row));
  }

  updateUserIdForSession(sessionId: string, newUserId: string): number {
    const sql = `
      UPDATE transcripts
      SET userId = ?
      WHERE sessionId = ?
    `;

    try {
      this.connection.exec(sql, [newUserId, sessionId]);
      const countSql = 'SELECT COUNT(*) as count FROM transcripts WHERE sessionId = ? AND userId = ?';
      const rows = this.connection.query<{ count: number }>(countSql, [sessionId, newUserId]);
      return rows[0]?.count ?? 0;
    } catch {
      return 0;
    }
  }

  private rowToTranscript(row: TranscriptRow): TurnTranscript {
    const decoded = decodeContentRefs(row.contentRefs);
    return {
      turnId: row.turnId,
      sessionId: row.sessionId,
      userId: row.userId,
      input: {
        inboundEventId: row.inboundEventId ?? undefined,
        userMessageSummary: row.userMessageSummary ?? undefined,
        contentRefs: decoded.contentRefs,
        inboundTimestamp: decoded.inboundTimestamp,
      },
      output: {
        visibleMessages: JSON.parse(row.visibleMessages),
        artifactRefs: row.artifactRefs ? JSON.parse(row.artifactRefs) : undefined
      },
      runtimeSummary: row.foregroundDecisionId || row.plannerRunIds || row.runtimeActionIds ||
                       row.toolCallSummaries || row.approvalSummaries
        ? {
            foregroundDecisionId: row.foregroundDecisionId ?? undefined,
            plannerRunIds: row.plannerRunIds ? JSON.parse(row.plannerRunIds) : undefined,
            runtimeActionIds: row.runtimeActionIds ? JSON.parse(row.runtimeActionIds) : undefined,
            toolCallSummaries: row.toolCallSummaries ? JSON.parse(row.toolCallSummaries) : undefined,
            approvalSummaries: row.approvalSummaries ? JSON.parse(row.approvalSummaries) : undefined
          }
        : undefined,
      eventRange: row.startEventId && row.endEventId
        ? { startEventId: row.startEventId, endEventId: row.endEventId }
        : undefined,
      visibility: row.visibility,
      createdAt: row.createdAt
    };
  }
}

export function createTranscriptStore(connection: ConnectionManager): TranscriptStore {
  return new TranscriptStoreImpl(connection);
}
