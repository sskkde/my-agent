import type { ConnectionManager } from './connection.js';

export type Visibility = 'public' | 'internal' | 'confidential';

export interface VisibleMessage {
  messageId: string;
  role: 'assistant' | 'system_status';
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
      transcript.input.contentRefs ? JSON.stringify(transcript.input.contentRefs) : null,
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

  private rowToTranscript(row: TranscriptRow): TurnTranscript {
    return {
      turnId: row.turnId,
      sessionId: row.sessionId,
      userId: row.userId,
      input: {
        inboundEventId: row.inboundEventId ?? undefined,
        userMessageSummary: row.userMessageSummary ?? undefined,
        contentRefs: row.contentRefs ? JSON.parse(row.contentRefs) : undefined
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
