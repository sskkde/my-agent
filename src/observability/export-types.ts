/**
 * Export types for Prometheus, OpenTelemetry, and Alerting integrations.
 * These types define the shape of data exported to external observability systems.
 */

// ============================================================================
// Prometheus Types
// ============================================================================

/**
 * Prometheus metric type enumeration.
 */
export type PrometheusMetricType = 'counter' | 'gauge' | 'histogram'

/**
 * Represents a single Prometheus metric.
 */
export interface PrometheusMetric {
  /** Metric name (e.g., 'http_requests_total') */
  name: string
  /** Metric type */
  type: PrometheusMetricType
  /** Optional labels for dimensional metrics */
  labels?: Record<string, string>
  /** Metric value */
  value: number
  /** Optional help text describing the metric */
  help?: string
}

/**
 * Configuration for Prometheus export.
 */
export interface PrometheusConfig {
  /** Default labels to apply to all metrics */
  defaultLabels?: Record<string, string>
  /** Prefix to prepend to all metric names */
  metricPrefix?: string
  /** Whether to include timestamp in exported metrics */
  includeTimestamp?: boolean
}

// ============================================================================
// OpenTelemetry Types
// ============================================================================

/**
 * OpenTelemetry span status.
 */
export type OTelSpanStatus = 'ok' | 'error' | 'unset'

/**
 * Represents an OpenTelemetry span for distributed tracing.
 */
export interface OTelSpan {
  /** Trace ID (hex string) */
  traceId: string
  /** Span ID (hex string) */
  spanId: string
  /** Parent span ID (optional for root spans) */
  parentSpanId?: string
  /** Operation name (e.g., 'http.request') */
  operationName: string
  /** Start timestamp (ISO 8601) */
  startTime: string
  /** End timestamp (ISO 8601, optional if span is still active) */
  endTime?: string
  /** Span status */
  status: OTelSpanStatus
  /** Optional attributes for additional context */
  attributes?: Record<string, string | number | boolean>
}

/**
 * OpenTelemetry export protocol.
 */
export type OTelProtocol = 'grpc' | 'http'

/**
 * Configuration for OpenTelemetry export.
 */
export interface OTelExportConfig {
  /** OTel collector endpoint URL */
  endpoint: string
  /** Export protocol (grpc or http) */
  protocol: OTelProtocol
  /** Optional headers for authentication */
  headers?: Record<string, string>
  /** Optional resource attributes */
  resource?: Record<string, string>
}

// ============================================================================
// Alerting Types
// ============================================================================

/**
 * Alert severity level.
 */
export type AlertSeverity = 'critical' | 'warning' | 'info'

/**
 * Alert state.
 */
export type AlertStateValue = 'firing' | 'resolved'

/**
 * Defines an alerting rule.
 */
export interface AlertRule {
  /** Unique rule identifier */
  id: string
  /** Human-readable rule name */
  name: string
  /** Condition expression (e.g., 'error_rate > threshold') */
  condition: string
  /** Threshold value for the condition */
  threshold: number
  /** Time window in seconds for evaluating the condition */
  windowSeconds: number
  /** Severity level */
  severity: AlertSeverity
  /** Notification channels (e.g., ['slack', 'email']) */
  channels: string[]
}

/**
 * Represents the current state of an alert.
 */
export interface AlertState {
  /** ID of the associated rule */
  ruleId: string
  /** Current state (firing or resolved) */
  state: AlertStateValue
  /** Timestamp when the alert fired */
  firedAt: string
  /** Timestamp when the alert resolved (optional) */
  resolvedAt?: string
  /** Labels for identifying the alert instance */
  labels: Record<string, string>
}
