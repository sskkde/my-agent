/**
 * Metrics Rollup Module
 *
 * Aggregates metrics for latency, token/cost, tool calls, connector calls,
 * approval latency, retry counts, and failure categories.
 */

import type { ConnectionManager } from '../storage/connection.js'

export type FailureCategory =
  | 'connector_rate_limited'
  | 'connector_timeout'
  | 'connector_auth_error'
  | 'permission_denied'
  | 'tool_execution_error'
  | 'llm_error'
  | 'validation_error'
  | 'system_error'

export interface LatencyMetrics {
  avgMs: number
  minMs: number
  maxMs: number
  count: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

export interface ToolCallMetrics {
  byCategory: Record<string, number>
  byTool: Record<string, number>
  total: number
  successCount: number
  failureCount: number
}

export interface ConnectorCallMetrics {
  byConnector: Record<string, number>
  byOperation: Record<string, number>
  total: number
  successCount: number
  failureCount: number
  rateLimitedCount: number
}

export interface ApprovalMetrics {
  totalCount: number
  approvedCount: number
  rejectedCount: number
  avgLatencyMs: number
  byRiskLevel: Record<string, number>
}

export interface RetryMetrics {
  totalRetries: number
  byCategory: Record<string, number>
  avgAttemptsPerOperation: number
}

export interface FailureMetrics {
  byCategory: Record<FailureCategory, number>
  total: number
  recoverableCount: number
  nonRecoverableCount: number
}

export interface RollupReport {
  periodStart: string
  periodEnd: string
  latency: LatencyMetrics
  toolCalls: ToolCallMetrics
  connectorCalls: ConnectorCallMetrics
  approvals: ApprovalMetrics
  retries: RetryMetrics
  failures: FailureMetrics
}

export interface MetricsRollupOptions {
  connection: ConnectionManager
}

interface SpanRow {
  span_id: string
  trace_id: string
  span_type: string
  module: string
  operation: string
  status: string
  duration_ms: number | null
  error: string | null
  metadata: string | null
  start_time: string
}

interface MetricRow {
  name: string
  value: number
  module: string
  metric_type: string
  timestamp: string
  labels: string | null
}

export class MetricsRollup {
  private connection: ConnectionManager

  constructor(options: MetricsRollupOptions) {
    this.connection = options.connection
  }

  rollup(periodStart: string, periodEnd: string): RollupReport {
    const spans = this.fetchSpans(periodStart, periodEnd)
    const metrics = this.fetchMetrics(periodStart, periodEnd)

    return {
      periodStart,
      periodEnd,
      latency: this.calculateLatencyMetrics(spans),
      toolCalls: this.calculateToolCallMetrics(spans),
      connectorCalls: this.calculateConnectorCallMetrics(spans),
      approvals: this.calculateApprovalMetrics(spans),
      retries: this.calculateRetryMetrics(metrics),
      failures: this.calculateFailureMetrics(spans, metrics),
    }
  }

  private fetchSpans(periodStart: string, periodEnd: string): SpanRow[] {
    return this.connection.query<SpanRow>(
      `SELECT span_id, trace_id, span_type, module, operation, status, 
              duration_ms, error, metadata, start_time
       FROM trace_spans
       WHERE start_time >= ? AND start_time <= ?`,
      [periodStart, periodEnd],
    )
  }

  private fetchMetrics(periodStart: string, periodEnd: string): MetricRow[] {
    return this.connection.query<MetricRow>(
      `SELECT name, value, module, metric_type, timestamp, labels
       FROM metrics
       WHERE timestamp >= ? AND timestamp <= ?`,
      [periodStart, periodEnd],
    )
  }

  private calculateLatencyMetrics(spans: SpanRow[]): LatencyMetrics {
    const durations = spans
      .filter((s) => s.duration_ms !== null && s.duration_ms > 0)
      .map((s) => s.duration_ms as number)
      .sort((a, b) => a - b)

    if (durations.length === 0) {
      return {
        avgMs: 0,
        minMs: 0,
        maxMs: 0,
        count: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
      }
    }

    const sum = durations.reduce((acc, d) => acc + d, 0)

    return {
      avgMs: sum / durations.length,
      minMs: durations[0],
      maxMs: durations[durations.length - 1],
      count: durations.length,
      p50Ms: this.percentile(durations, 50),
      p95Ms: this.percentile(durations, 95),
      p99Ms: this.percentile(durations, 99),
    }
  }

  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0
    const index = Math.ceil((p / 100) * sortedValues.length) - 1
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))]
  }

  private calculateToolCallMetrics(spans: SpanRow[]): ToolCallMetrics {
    const toolSpans = spans.filter((s) => s.span_type === 'tool_execution' || s.span_type === 'tool_call')

    const byCategory: Record<string, number> = {}
    const byTool: Record<string, number> = {}
    let successCount = 0
    let failureCount = 0

    for (const span of toolSpans) {
      const metadata = span.metadata ? JSON.parse(span.metadata) : {}
      const category = metadata.category || 'unknown'
      const toolName = span.operation || 'unknown'

      byCategory[category] = (byCategory[category] || 0) + 1
      byTool[toolName] = (byTool[toolName] || 0) + 1

      if (span.status === 'completed') {
        successCount++
      } else if (span.status === 'failed') {
        failureCount++
      }
    }

    return {
      byCategory,
      byTool,
      total: toolSpans.length,
      successCount,
      failureCount,
    }
  }

  private calculateConnectorCallMetrics(spans: SpanRow[]): ConnectorCallMetrics {
    const connectorSpans = spans.filter((s) => s.span_type === 'connector_call')

    const byConnector: Record<string, number> = {}
    const byOperation: Record<string, number> = {}
    let successCount = 0
    let failureCount = 0
    let rateLimitedCount = 0

    for (const span of connectorSpans) {
      const metadata = span.metadata ? JSON.parse(span.metadata) : {}
      const connectorId = metadata.connectorId || 'unknown'
      const operation = span.operation || 'unknown'

      byConnector[connectorId] = (byConnector[connectorId] || 0) + 1
      byOperation[operation] = (byOperation[operation] || 0) + 1

      if (span.status === 'completed') {
        successCount++
      } else if (span.status === 'failed') {
        failureCount++
        if (metadata.errorCategory === 'rate_limited' || span.error?.includes('rate') || span.error?.includes('429')) {
          rateLimitedCount++
        }
      }
    }

    return {
      byConnector,
      byOperation,
      total: connectorSpans.length,
      successCount,
      failureCount,
      rateLimitedCount,
    }
  }

  private calculateApprovalMetrics(spans: SpanRow[]): ApprovalMetrics {
    const approvalSpans = spans.filter((s) => s.span_type === 'permission_check' || s.module === 'permission')

    const byRiskLevel: Record<string, number> = {}
    let approvedCount = 0
    let rejectedCount = 0
    const latencies: number[] = []

    for (const span of approvalSpans) {
      const metadata = span.metadata ? JSON.parse(span.metadata) : {}
      const riskLevel = metadata.riskLevel || 'unknown'

      byRiskLevel[riskLevel] = (byRiskLevel[riskLevel] || 0) + 1

      if (metadata.decision === 'approved' || metadata.decision === 'allowed') {
        approvedCount++
      } else if (metadata.decision === 'rejected' || metadata.decision === 'denied') {
        rejectedCount++
      }

      if (span.duration_ms !== null) {
        latencies.push(span.duration_ms)
      }
    }

    const avgLatencyMs = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0

    return {
      totalCount: approvalSpans.length,
      approvedCount,
      rejectedCount,
      avgLatencyMs,
      byRiskLevel,
    }
  }

  private calculateRetryMetrics(metrics: MetricRow[]): RetryMetrics {
    const retryMetrics = metrics.filter((m) => m.name.includes('retry') || m.name.includes('attempt'))

    const byCategory: Record<string, number> = {}
    let totalRetries = 0
    const attemptsPerOp: number[] = []

    for (const metric of retryMetrics) {
      const labels = metric.labels ? JSON.parse(metric.labels) : {}
      const category = labels.category || labels.errorCategory || 'unknown'

      byCategory[category] = (byCategory[category] || 0) + metric.value
      totalRetries += metric.value

      if (metric.name === 'operation_attempts') {
        attemptsPerOp.push(metric.value)
      }
    }

    const avgAttemptsPerOperation =
      attemptsPerOp.length > 0 ? attemptsPerOp.reduce((a, b) => a + b, 0) / attemptsPerOp.length : 1

    return {
      totalRetries,
      byCategory,
      avgAttemptsPerOperation,
    }
  }

  private calculateFailureMetrics(spans: SpanRow[], metrics: MetricRow[]): FailureMetrics {
    const failedSpans = spans.filter((s) => s.status === 'failed')

    const byCategory: Record<FailureCategory, number> = {
      connector_rate_limited: 0,
      connector_timeout: 0,
      connector_auth_error: 0,
      permission_denied: 0,
      tool_execution_error: 0,
      llm_error: 0,
      validation_error: 0,
      system_error: 0,
    }

    let recoverableCount = 0
    let nonRecoverableCount = 0

    for (const span of failedSpans) {
      const metadata = span.metadata ? JSON.parse(span.metadata) : {}
      const errorCategory = this.categorizeError(span, metadata)

      byCategory[errorCategory]++

      if (metadata.recoverable === true) {
        recoverableCount++
      } else if (metadata.recoverable === false) {
        nonRecoverableCount++
      }
    }

    for (const metric of metrics) {
      if (metric.name === 'failure_count' || metric.name === 'error_count') {
        const labels = metric.labels ? JSON.parse(metric.labels) : {}
        const category = labels.category as FailureCategory
        if (category && byCategory.hasOwnProperty(category)) {
          byCategory[category] += metric.value
        }
      }
    }

    return {
      byCategory,
      total: failedSpans.length,
      recoverableCount,
      nonRecoverableCount,
    }
  }

  private categorizeError(span: SpanRow, metadata: Record<string, unknown>): FailureCategory {
    const errorCategory = metadata.errorCategory as string

    if (errorCategory === 'rate_limited' || span.error?.includes('rate') || span.error?.includes('429')) {
      return 'connector_rate_limited'
    }

    if (errorCategory === 'timeout' || span.error?.includes('timeout')) {
      return 'connector_timeout'
    }

    if (errorCategory === 'auth_error' || span.error?.includes('401') || span.error?.includes('403')) {
      return 'connector_auth_error'
    }

    if (errorCategory === 'permission_denied' || span.module === 'permission' || span.error?.includes('permission')) {
      return 'permission_denied'
    }

    if (span.span_type === 'tool_execution' || span.span_type === 'tool_call') {
      return 'tool_execution_error'
    }

    if (span.module === 'foreground_agent' || span.module === 'kernel') {
      return 'llm_error'
    }

    if (errorCategory === 'validation' || span.error?.includes('validation')) {
      return 'validation_error'
    }

    return 'system_error'
  }
}

export function createMetricsRollup(options: MetricsRollupOptions): MetricsRollup {
  return new MetricsRollup(options)
}
