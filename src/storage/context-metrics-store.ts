import type { ConnectionManager } from './connection.js'
import type { MigrationRunner, Migration } from './migrations.js'

export interface ContextMetrics {
  id: string
  runId: string
  agentId: string
  sessionId: string | null
  timestamp: string
  segmentDTokenEstimate: number
  segmentDTokenActual: number
  memoryInjectedCount: number
  memoryTokenEstimate: number
  summaryHitCount: number
  summaryTokenEstimate: number
  transcriptTokenEstimate: number
  pinnedItemCount: number
  orderedItemCount: number
  droppedContextReasons: string | null
  flagPhase: string | null
  flagName: string | null
}

export interface ContextMetricsStore {
  applyMigrations(runner: MigrationRunner): void
  record(data: Omit<ContextMetrics, 'id'>): string
  getMetricsByRunId(runId: string): ContextMetrics | null
  getRecentMetrics(agentId: string, limit: number): ContextMetrics[]
}

class ContextMetricsStoreImpl implements ContextMetricsStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  applyMigrations(runner: MigrationRunner): void {
    const migrations: Migration[] = [
      {
        version: 24,
        name: 'add_context_metrics',
        up: `
          CREATE TABLE IF NOT EXISTS context_metrics (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            session_id TEXT,
            timestamp TEXT NOT NULL,
            segment_d_token_estimate INTEGER NOT NULL,
            segment_d_token_actual INTEGER NOT NULL,
            memory_injected_count INTEGER NOT NULL DEFAULT 0,
            memory_token_estimate INTEGER NOT NULL DEFAULT 0,
            summary_hit_count INTEGER NOT NULL DEFAULT 0,
            summary_token_estimate INTEGER NOT NULL DEFAULT 0,
            transcript_token_estimate INTEGER NOT NULL DEFAULT 0,
            pinned_item_count INTEGER NOT NULL DEFAULT 0,
            ordered_item_count INTEGER NOT NULL DEFAULT 0,
            dropped_context_reasons TEXT,
            flag_phase TEXT,
            flag_name TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_context_metrics_run_id ON context_metrics(run_id);
          CREATE INDEX IF NOT EXISTS idx_context_metrics_agent_id ON context_metrics(agent_id, timestamp);
        `,
        down: `
          DROP INDEX IF EXISTS idx_context_metrics_agent_id;
          DROP INDEX IF EXISTS idx_context_metrics_run_id;
          DROP TABLE IF EXISTS context_metrics;
        `,
      },
    ]
    runner.apply(migrations)
  }

  record(data: Omit<ContextMetrics, 'id'>): string {
    const id = `cm-${data.runId}-${Date.now()}`
    this.connection.exec(
      `INSERT INTO context_metrics (
        id, run_id, agent_id, session_id, timestamp,
        segment_d_token_estimate, segment_d_token_actual,
        memory_injected_count, memory_token_estimate,
        summary_hit_count, summary_token_estimate,
        transcript_token_estimate, pinned_item_count, ordered_item_count,
        dropped_context_reasons, flag_phase, flag_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.runId, data.agentId, data.sessionId, data.timestamp,
        data.segmentDTokenEstimate, data.segmentDTokenActual,
        data.memoryInjectedCount, data.memoryTokenEstimate,
        data.summaryHitCount, data.summaryTokenEstimate,
        data.transcriptTokenEstimate, data.pinnedItemCount, data.orderedItemCount,
        data.droppedContextReasons, data.flagPhase, data.flagName,
      ],
    )
    return id
  }

    getMetricsByRunId(runId: string): ContextMetrics | null {
    const rows = this.connection.query<Record<string, unknown>>(
      'SELECT * FROM context_metrics WHERE run_id = ? ORDER BY timestamp DESC LIMIT 1',
      [runId],
    )
    if (rows.length === 0) return null
    return this.rowToMetrics(rows[0])
  }

  getRecentMetrics(agentId: string, limit: number): ContextMetrics[] {
    const rows = this.connection.query<Record<string, unknown>>(
      'SELECT * FROM context_metrics WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?',
      [agentId, limit],
    )
    return rows.map((r) => this.rowToMetrics(r))
  }

  private rowToMetrics(row: Record<string, unknown>): ContextMetrics {
    return {
      id: row.id as string,
      runId: row.run_id as string,
      agentId: row.agent_id as string,
      sessionId: row.session_id as string | null,
      timestamp: row.timestamp as string,
      segmentDTokenEstimate: row.segment_d_token_estimate as number,
      segmentDTokenActual: row.segment_d_token_actual as number,
      memoryInjectedCount: row.memory_injected_count as number,
      memoryTokenEstimate: row.memory_token_estimate as number,
      summaryHitCount: row.summary_hit_count as number,
      summaryTokenEstimate: row.summary_token_estimate as number,
      transcriptTokenEstimate: row.transcript_token_estimate as number,
      pinnedItemCount: row.pinned_item_count as number,
      orderedItemCount: row.ordered_item_count as number,
      droppedContextReasons: row.dropped_context_reasons as string | null,
      flagPhase: row.flag_phase as string | null,
      flagName: row.flag_name as string | null,
    }
  }
}

export function createContextMetricsStore(connection: ConnectionManager): ContextMetricsStore {
  return new ContextMetricsStoreImpl(connection)
}
