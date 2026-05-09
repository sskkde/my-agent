/**
 * Retention Policy Module
 * 
 * Implements configurable retention for audit records, traces, metrics,
 * memory lifecycle data, and result blobs using soft-delete/archive metadata.
 */

import type { ConnectionManager } from '../storage/connection.js';
import type { AuditStore } from './audit-types.js';
import type { TraceStore, MetricStore } from './types.js';
import type { LongTermMemoryStore } from '../storage/long-term-memory-store.js';
import type { ToolResultStore } from '../storage/tool-result-store.js';

export type EntityType = 'audit' | 'traces' | 'metrics' | 'memory' | 'blobs';

export type RetentionAction = 'soft_delete' | 'archive' | 'hard_delete';

export interface RetentionConfig {
  entityType: EntityType;
  ttlDays: number;
  action: RetentionAction;
}

export interface RetentionReport {
  entityType: EntityType;
  eligibleCount: number;
  totalCount: number;
  dryRun: boolean;
  cutoffTimestamp: string;
}

export interface RetentionResult {
  entityType: EntityType;
  affectedCount: number;
  action: RetentionAction;
  dryRun: boolean;
  cutoffTimestamp: string;
  audited: boolean;
}

export interface RetentionPolicyOptions {
  auditStore: AuditStore;
  traceStore: TraceStore;
  metricStore: MetricStore;
  memoryStore: LongTermMemoryStore;
  toolResultStore: ToolResultStore;
  connection: ConnectionManager;
  defaultTtlDays?: number;
}

const PROTECTED_SENSITIVITY_LEVELS = ['high', 'restricted'] as const;

function isProtectedSensitivity(sensitivity: string): boolean {
  return PROTECTED_SENSITIVITY_LEVELS.includes(sensitivity as typeof PROTECTED_SENSITIVITY_LEVELS[number]);
}

export class RetentionPolicy {
  private auditStore: AuditStore;
  private memoryStore: LongTermMemoryStore;
  private connection: ConnectionManager;
  private defaultTtlDays: number;

  constructor(options: RetentionPolicyOptions) {
    this.auditStore = options.auditStore;
    this.memoryStore = options.memoryStore;
    this.connection = options.connection;
    this.defaultTtlDays = options.defaultTtlDays ?? 90;
  }

  getTtlDays(entityType: EntityType): number {
    const rows = this.connection.query<{ ttl_days: number }>(
      'SELECT ttl_days FROM retention_config WHERE entity_type = ?',
      [entityType]
    );
    return rows.length > 0 ? rows[0].ttl_days : this.defaultTtlDays;
  }

  getRetentionAction(entityType: EntityType): RetentionAction {
    const rows = this.connection.query<{ policy: string }>(
      'SELECT policy FROM retention_config WHERE entity_type = ?',
      [entityType]
    );
    return rows.length > 0 ? (rows[0].policy as RetentionAction) : 'soft_delete';
  }

  private calculateCutoff(ttlDays: number): string {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ttlDays);
    return cutoff.toISOString();
  }

  dryRun(entityType: EntityType): RetentionReport {
    const ttlDays = this.getTtlDays(entityType);
    const cutoffTimestamp = this.calculateCutoff(ttlDays);
    
    let eligibleCount = 0;
    let totalCount = 0;

    switch (entityType) {
      case 'audit':
        totalCount = this.auditStore.count({});
        eligibleCount = this.countEligibleAudit(cutoffTimestamp);
        break;
      case 'traces':
        totalCount = this.countTotalTraces();
        eligibleCount = this.countEligibleTraces(cutoffTimestamp);
        break;
      case 'metrics':
        totalCount = this.countTotalMetrics();
        eligibleCount = this.countEligibleMetrics(cutoffTimestamp);
        break;
      case 'memory':
        totalCount = this.countTotalMemory();
        eligibleCount = this.countEligibleMemory(cutoffTimestamp);
        break;
      case 'blobs':
        totalCount = this.countTotalBlobs();
        eligibleCount = this.countEligibleBlobs(cutoffTimestamp);
        break;
    }

    return {
      entityType,
      eligibleCount,
      totalCount,
      dryRun: true,
      cutoffTimestamp,
    };
  }

  apply(entityType: EntityType): RetentionResult {
    const ttlDays = this.getTtlDays(entityType);
    const action = this.getRetentionAction(entityType);
    const cutoffTimestamp = this.calculateCutoff(ttlDays);
    
    let affectedCount = 0;

    switch (entityType) {
      case 'audit':
        affectedCount = this.applyAuditRetention(cutoffTimestamp);
        break;
      case 'traces':
        affectedCount = this.applyTraceRetention(cutoffTimestamp);
        break;
      case 'metrics':
        affectedCount = this.applyMetricRetention(cutoffTimestamp);
        break;
      case 'memory':
        affectedCount = this.applyMemoryRetention(cutoffTimestamp, action);
        break;
      case 'blobs':
        affectedCount = this.applyBlobRetention(cutoffTimestamp);
        break;
    }

    this.auditRetentionAction(entityType, action, affectedCount, cutoffTimestamp);

    return {
      entityType,
      affectedCount,
      action,
      dryRun: false,
      cutoffTimestamp,
      audited: true,
    };
  }

  private countEligibleAudit(cutoffTimestamp: string): number {
    const rows = this.connection.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM audit_records 
       WHERE timestamp < ? 
       AND sensitivity NOT IN ('high', 'restricted')`,
      [cutoffTimestamp]
    );
    return rows[0]?.count ?? 0;
  }

  private applyAuditRetention(cutoffTimestamp: string): number {
    this.connection.exec(
      `DELETE FROM audit_records 
       WHERE timestamp < ? 
       AND sensitivity NOT IN ('high', 'restricted')`,
      [cutoffTimestamp]
    );
    
    const rows = this.connection.query<{ changes: number }>('SELECT changes() as changes');
    return rows[0]?.changes ?? 0;
  }

  private countTotalTraces(): number {
    const rows = this.connection.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM trace_contexts'
    );
    return rows[0]?.count ?? 0;
  }

  private countEligibleTraces(cutoffTimestamp: string): number {
    const rows = this.connection.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM trace_contexts WHERE started_at < ?',
      [cutoffTimestamp]
    );
    return rows[0]?.count ?? 0;
  }

  private applyTraceRetention(cutoffTimestamp: string): number {
    const traceIds = this.connection.query<{ trace_id: string }>(
      'SELECT trace_id FROM trace_contexts WHERE started_at < ?',
      [cutoffTimestamp]
    );
    
    for (const row of traceIds) {
      this.connection.exec('DELETE FROM trace_spans WHERE trace_id = ?', [row.trace_id]);
    }
    
    this.connection.exec(
      'DELETE FROM trace_contexts WHERE started_at < ?',
      [cutoffTimestamp]
    );
    
    const rows = this.connection.query<{ changes: number }>('SELECT changes() as changes');
    return rows[0]?.changes ?? 0;
  }

  private countTotalMetrics(): number {
    const rows = this.connection.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM metrics'
    );
    return rows[0]?.count ?? 0;
  }

  private countEligibleMetrics(cutoffTimestamp: string): number {
    const rows = this.connection.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM metrics WHERE timestamp < ?',
      [cutoffTimestamp]
    );
    return rows[0]?.count ?? 0;
  }

  private applyMetricRetention(cutoffTimestamp: string): number {
    this.connection.exec(
      'DELETE FROM metrics WHERE timestamp < ?',
      [cutoffTimestamp]
    );
    
    const rows = this.connection.query<{ changes: number }>('SELECT changes() as changes');
    return rows[0]?.changes ?? 0;
  }

  private countTotalMemory(): number {
    const rows = this.connection.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM long_term_memories WHERE lifecycle_status != 'deleted'"
    );
    return rows[0]?.count ?? 0;
  }

  private countEligibleMemory(cutoffTimestamp: string): number {
    const rows = this.connection.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM long_term_memories 
       WHERE json_extract(lifecycle, '$.updatedAt') < ? 
       AND lifecycle_status = 'active'
       AND sensitivity NOT IN ('high', 'restricted')`,
      [cutoffTimestamp]
    );
    return rows[0]?.count ?? 0;
  }

  private applyMemoryRetention(cutoffTimestamp: string, action: RetentionAction): number {
    const rows = this.connection.query<{ memory_id: string }>(
      `SELECT memory_id FROM long_term_memories 
       WHERE json_extract(lifecycle, '$.updatedAt') < ? 
       AND lifecycle_status = 'active'
       AND sensitivity NOT IN ('high', 'restricted')`,
      [cutoffTimestamp]
    );
    
    let affectedCount = 0;
    
    for (const row of rows) {
      if (action === 'hard_delete') {
        this.memoryStore.delete(row.memory_id);
      } else {
        const existing = this.memoryStore.getByMemoryId(row.memory_id);
        if (existing) {
          this.memoryStore.applyPatch(row.memory_id, {
            lifecycle: {
              ...existing.lifecycle,
              status: 'archived',
              updatedAt: new Date().toISOString(),
            },
          });
        }
      }
      affectedCount++;
    }
    
    return affectedCount;
  }

  private countTotalBlobs(): number {
    const rows = this.connection.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM tool_results'
    );
    return rows[0]?.count ?? 0;
  }

  private countEligibleBlobs(cutoffTimestamp: string): number {
    const rows = this.connection.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM tool_results 
       WHERE created_at < ? 
       AND sensitivity NOT IN ('high', 'restricted')`,
      [cutoffTimestamp]
    );
    return rows[0]?.count ?? 0;
  }

  private applyBlobRetention(cutoffTimestamp: string): number {
    this.connection.exec(
      `DELETE FROM tool_results 
       WHERE created_at < ? 
       AND sensitivity NOT IN ('high', 'restricted')`,
      [cutoffTimestamp]
    );
    
    const rows = this.connection.query<{ changes: number }>('SELECT changes() as changes');
    return rows[0]?.changes ?? 0;
  }

  private auditRetentionAction(
    entityType: EntityType,
    action: RetentionAction,
    affectedCount: number,
    cutoffTimestamp: string
  ): void {
    const auditId = `retention-${entityType}-${Date.now()}`;
    
    this.auditStore.record({
      auditId,
      auditType: 'workflow_change',
      timestamp: new Date().toISOString(),
      userId: 'system',
      sourceModule: 'system',
      sourceAction: 'retention_policy_apply',
      actionSummary: `Applied ${action} retention for ${entityType}: ${affectedCount} records affected`,
      status: 'completed',
      payload: {
        entityType,
        action,
        affectedCount,
        cutoffTimestamp,
      },
      riskLevel: 'low',
      sensitivity: 'low',
    });
  }

  dryRunAll(): RetentionReport[] {
    const entityTypes: EntityType[] = ['audit', 'traces', 'metrics', 'memory', 'blobs'];
    return entityTypes.map(type => this.dryRun(type));
  }

  applyAll(): RetentionResult[] {
    const entityTypes: EntityType[] = ['audit', 'traces', 'metrics', 'memory', 'blobs'];
    return entityTypes.map(type => this.apply(type));
  }
}

export function createRetentionPolicy(options: RetentionPolicyOptions): RetentionPolicy {
  return new RetentionPolicy(options);
}

export { isProtectedSensitivity };
