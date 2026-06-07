import type { ConnectionManager } from './connection.js'

// ============================================================================
// Types
// ============================================================================

export type AlertConditionType = 'threshold' | 'rate' | 'absence'
export type AlertOperator = '>' | '<' | '>=' | '<=' | '=='
export type AlertSeverity = 'critical' | 'warning' | 'info'
export type AlertStateValue = 'idle' | 'firing' | 'resolved'

export interface AlertRule {
  /** Unique rule identifier */
  id: string
  /** Human-readable rule name */
  name: string
  /** Description of the alert */
  description?: string
  /** Metric name to monitor */
  metricName: string
  /** Metric module filter */
  metricModule?: string
  /** Condition type: threshold, rate, or absence */
  conditionType: AlertConditionType
  /** Comparison operator for threshold/rate conditions */
  operator?: AlertOperator
  /** Threshold value for comparison */
  threshold: number
  /** Time window in seconds for evaluating the condition */
  windowSeconds: number
  /** Severity level when firing */
  severity: AlertSeverity
  /** Webhook URL for notifications */
  webhookUrl?: string
  /** Labels to include in alerts */
  labels: Record<string, string>
  /** Whether the rule is enabled */
  enabled: boolean
  /** Creation timestamp */
  createdAt: string
  /** Last update timestamp */
  updatedAt: string
}

export interface AlertStateRecord {
  /** State record ID */
  id: string
  /** ID of the associated rule */
  ruleId: string
  /** Current state (idle, firing, or resolved) */
  state: AlertStateValue
  /** Current metric value */
  currentValue: number
  /** Timestamp when the alert started firing */
  firedAt?: string
  /** Timestamp when the alert resolved */
  resolvedAt?: string
  /** Labels for this alert instance */
  labels: Record<string, string>
  /** Last evaluation timestamp */
  lastEvaluatedAt: string
}

export interface AlertNotification {
  /** Rule that triggered the notification */
  rule: AlertRule
  /** Current state */
  state: AlertStateValue
  /** Previous state */
  previousState: AlertStateValue
  /** Current metric value */
  value: number
  /** Timestamp of the state change */
  timestamp: string
  /** Labels for the alert */
  labels: Record<string, string>
}

export interface AlertStore {
  // Rule management
  createRule(rule: AlertRule): void
  getRule(ruleId: string): AlertRule | null
  listRules(): AlertRule[]
  updateRule(rule: AlertRule): void
  deleteRule(ruleId: string): void

  // State management
  getState(ruleId: string): AlertStateRecord | null
  getAllStates(): AlertStateRecord[]
  updateState(state: AlertStateRecord): void
}

// ============================================================================
// Implementation
// ============================================================================

class AlertStoreImpl implements AlertStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  createRule(rule: AlertRule): void {
    const sql = `
      INSERT INTO alert_rules (
        id, name, description, metric_name, metric_module, condition_type,
        operator, threshold, window_seconds, severity, webhook_url, labels,
        enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    this.connection.exec(sql, [
      rule.id,
      rule.name,
      rule.description ?? null,
      rule.metricName,
      rule.metricModule ?? null,
      rule.conditionType,
      rule.operator ?? null,
      rule.threshold,
      rule.windowSeconds,
      rule.severity,
      rule.webhookUrl ?? null,
      JSON.stringify(rule.labels),
      rule.enabled ? 1 : 0,
      rule.createdAt,
      rule.updatedAt,
    ])
  }

  getRule(ruleId: string): AlertRule | null {
    const sql = 'SELECT * FROM alert_rules WHERE id = ?'
    const rows = this.connection.query<AlertRuleRow>(sql, [ruleId])
    if (rows.length === 0) {
      return null
    }
    return this.rowToRule(rows[0])
  }

  listRules(): AlertRule[] {
    const sql = 'SELECT * FROM alert_rules ORDER BY created_at DESC'
    const rows = this.connection.query<AlertRuleRow>(sql)
    return rows.map(this.rowToRule)
  }

  updateRule(rule: AlertRule): void {
    const sql = `
      UPDATE alert_rules SET
        name = ?, description = ?, metric_name = ?, metric_module = ?,
        condition_type = ?, operator = ?, threshold = ?, window_seconds = ?,
        severity = ?, webhook_url = ?, labels = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `
    this.connection.exec(sql, [
      rule.name,
      rule.description ?? null,
      rule.metricName,
      rule.metricModule ?? null,
      rule.conditionType,
      rule.operator ?? null,
      rule.threshold,
      rule.windowSeconds,
      rule.severity,
      rule.webhookUrl ?? null,
      JSON.stringify(rule.labels),
      rule.enabled ? 1 : 0,
      rule.updatedAt,
      rule.id,
    ])
  }

  deleteRule(ruleId: string): void {
    this.connection.exec('DELETE FROM alert_states WHERE rule_id = ?', [ruleId])
    this.connection.exec('DELETE FROM alert_rules WHERE id = ?', [ruleId])
  }

  getState(ruleId: string): AlertStateRecord | null {
    const sql = 'SELECT * FROM alert_states WHERE rule_id = ?'
    const rows = this.connection.query<AlertStateRow>(sql, [ruleId])
    if (rows.length === 0) {
      return null
    }
    return this.rowToState(rows[0])
  }

  getAllStates(): AlertStateRecord[] {
    const sql = 'SELECT * FROM alert_states ORDER BY last_evaluated_at DESC'
    const rows = this.connection.query<AlertStateRow>(sql)
    return rows.map(this.rowToState)
  }

  updateState(state: AlertStateRecord): void {
    const sql = `
      INSERT INTO alert_states (
        id, rule_id, state, current_value, fired_at, resolved_at,
        labels, last_evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rule_id) DO UPDATE SET
        state = excluded.state,
        current_value = excluded.current_value,
        fired_at = excluded.fired_at,
        resolved_at = excluded.resolved_at,
        labels = excluded.labels,
        last_evaluated_at = excluded.last_evaluated_at
    `
    this.connection.exec(sql, [
      state.id,
      state.ruleId,
      state.state,
      state.currentValue,
      state.firedAt ?? null,
      state.resolvedAt ?? null,
      JSON.stringify(state.labels),
      state.lastEvaluatedAt,
    ])
  }

  private rowToRule(row: AlertRuleRow): AlertRule {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      metricName: row.metric_name,
      metricModule: row.metric_module ?? undefined,
      conditionType: row.condition_type as AlertConditionType,
      operator: row.operator as AlertOperator | undefined,
      threshold: row.threshold,
      windowSeconds: row.window_seconds,
      severity: row.severity as AlertSeverity,
      webhookUrl: row.webhook_url ?? undefined,
      labels: row.labels ? JSON.parse(row.labels) : {},
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private rowToState(row: AlertStateRow): AlertStateRecord {
    return {
      id: row.id,
      ruleId: row.rule_id,
      state: row.state as AlertStateValue,
      currentValue: row.current_value,
      firedAt: row.fired_at ?? undefined,
      resolvedAt: row.resolved_at ?? undefined,
      labels: row.labels ? JSON.parse(row.labels) : {},
      lastEvaluatedAt: row.last_evaluated_at,
    }
  }
}

type AlertRuleRow = {
  id: string
  name: string
  description: string | null
  metric_name: string
  metric_module: string | null
  condition_type: string
  operator: string | null
  threshold: number
  window_seconds: number
  severity: string
  webhook_url: string | null
  labels: string | null
  enabled: number
  created_at: string
  updated_at: string
}

type AlertStateRow = {
  id: string
  rule_id: string
  state: string
  current_value: number
  fired_at: string | null
  resolved_at: string | null
  labels: string | null
  last_evaluated_at: string
}

// ============================================================================
// Factory
// ============================================================================

export function createAlertStore(connection: ConnectionManager): AlertStore {
  return new AlertStoreImpl(connection)
}

// ============================================================================
// Migration
// ============================================================================

import type { Migration } from './migrations.js'

export const alertTablesMigration: Migration = {
  version: 50,
  name: 'create_alert_tables',
  up: `
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      metric_name TEXT NOT NULL,
      metric_module TEXT,
      condition_type TEXT NOT NULL CHECK(condition_type IN ('threshold', 'rate', 'absence')),
      operator TEXT CHECK(operator IN ('>', '<', '>=', '<=', '==')),
      threshold REAL NOT NULL,
      window_seconds INTEGER NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('critical', 'warning', 'info')),
      webhook_url TEXT,
      labels TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);
    CREATE INDEX IF NOT EXISTS idx_alert_rules_metric ON alert_rules(metric_name);

    CREATE TABLE IF NOT EXISTS alert_states (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL CHECK(state IN ('idle', 'firing', 'resolved')),
      current_value REAL NOT NULL DEFAULT 0,
      fired_at TEXT,
      resolved_at TEXT,
      labels TEXT,
      last_evaluated_at TEXT NOT NULL,
      FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_alert_states_rule ON alert_states(rule_id);
    CREATE INDEX IF NOT EXISTS idx_alert_states_state ON alert_states(state)
  `,
  down: `
    DROP INDEX IF EXISTS idx_alert_states_state;
    DROP INDEX IF EXISTS idx_alert_states_rule;
    DROP TABLE IF EXISTS alert_states;

    DROP INDEX IF EXISTS idx_alert_rules_metric;
    DROP INDEX IF EXISTS idx_alert_rules_enabled;
    DROP TABLE IF EXISTS alert_rules
  `,
}
