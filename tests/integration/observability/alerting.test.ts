import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createAlertStore } from '../../../src/storage/alert-store.js';
import { createMetricStore } from '../../../src/observability/metric-store.js';
import { createAlertingEngine } from '../../../src/observability/alerting.js';
import type { AlertStore, AlertRule, AlertStateRecord } from '../../../src/storage/alert-store.js';
import type { MetricStore, MetricRecord } from '../../../src/observability/types.js';

const alertMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_metrics_table',
    up: `
      CREATE TABLE metrics (
        metric_id TEXT PRIMARY KEY,
        trace_id TEXT,
        span_id TEXT,
        module TEXT NOT NULL CHECK(module IN ('gateway', 'foreground_agent', 'planner', 'dispatcher', 'kernel', 'tool', 'workflow', 'subagent', 'trigger', 'connector', 'permission', 'memory')),
        metric_type TEXT NOT NULL CHECK(metric_type IN ('counter', 'gauge', 'histogram', 'timer')),
        name TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        timestamp TEXT NOT NULL,
        labels TEXT
      );
      CREATE INDEX idx_metrics_module ON metrics(module);
      CREATE INDEX idx_metrics_name ON metrics(name);
      CREATE INDEX idx_metrics_timestamp ON metrics(timestamp DESC);
      CREATE INDEX idx_metrics_module_name ON metrics(module, name, timestamp DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_metrics_module_name;
      DROP INDEX IF EXISTS idx_metrics_timestamp;
      DROP INDEX IF EXISTS idx_metrics_name;
      DROP INDEX IF EXISTS idx_metrics_module;
      DROP TABLE IF EXISTS metrics;
    `
  },
  {
    version: 2,
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
      CREATE INDEX IF NOT EXISTS idx_alert_states_state ON alert_states(state);
    `,
    down: `
      DROP INDEX IF EXISTS idx_alert_states_state;
      DROP INDEX IF EXISTS idx_alert_states_rule;
      DROP TABLE IF EXISTS alert_states;
      DROP INDEX IF EXISTS idx_alert_rules_metric;
      DROP INDEX IF EXISTS idx_alert_rules_enabled;
      DROP TABLE IF EXISTS alert_rules;
    `
  }
];

function createTestAlertRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'rule-1',
    name: 'High Error Rate',
    description: 'Alert when error rate exceeds threshold',
    metricName: 'error_rate',
    conditionType: 'threshold',
    operator: '>',
    threshold: 0.05,
    windowSeconds: 60,
    severity: 'critical',
    labels: { service: 'api' },
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createTestMetric(overrides: Partial<MetricRecord> = {}): MetricRecord {
  return {
    metricId: `metric-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    module: 'gateway',
    metricType: 'gauge',
    name: 'error_rate',
    value: 0.1,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('Alerting System', () => {
  let connection: ConnectionManager;
  let migrationRunner: MigrationRunner;
  let alertStore: AlertStore;
  let metricStore: MetricStore;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(alertMigrations);
    alertStore = createAlertStore(connection);
    metricStore = createMetricStore(connection);
  });

  afterEach(() => {
    connection.close();
  });

  describe('AlertStore', () => {
    describe('createRule / getRule', () => {
      it('should create and retrieve a rule', () => {
        const rule = createTestAlertRule();
        alertStore.createRule(rule);

        const retrieved = alertStore.getRule(rule.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(rule.id);
        expect(retrieved!.name).toBe(rule.name);
        expect(retrieved!.metricName).toBe(rule.metricName);
        expect(retrieved!.conditionType).toBe(rule.conditionType);
        expect(retrieved!.threshold).toBe(rule.threshold);
        expect(retrieved!.severity).toBe(rule.severity);
        expect(retrieved!.enabled).toBe(true);
      });

      it('should return null for non-existent rule', () => {
        const retrieved = alertStore.getRule('non-existent');
        expect(retrieved).toBeNull();
      });
    });

    describe('listRules', () => {
      it('should list all rules', () => {
        const rule1 = createTestAlertRule({ id: 'rule-1', name: 'Rule 1' });
        const rule2 = createTestAlertRule({ id: 'rule-2', name: 'Rule 2' });
        
        alertStore.createRule(rule1);
        alertStore.createRule(rule2);

        const rules = alertStore.listRules();
        expect(rules).toHaveLength(2);
        expect(rules.map(r => r.id)).toContain('rule-1');
        expect(rules.map(r => r.id)).toContain('rule-2');
      });

      it('should return empty array when no rules', () => {
        const rules = alertStore.listRules();
        expect(rules).toHaveLength(0);
      });
    });

    describe('updateRule', () => {
      it('should update an existing rule', () => {
        const rule = createTestAlertRule();
        alertStore.createRule(rule);

        const updated = { ...rule, threshold: 0.1, updatedAt: new Date().toISOString() };
        alertStore.updateRule(updated);

        const retrieved = alertStore.getRule(rule.id);
        expect(retrieved!.threshold).toBe(0.1);
      });
    });

    describe('deleteRule', () => {
      it('should delete a rule', () => {
        const rule = createTestAlertRule();
        alertStore.createRule(rule);

        alertStore.deleteRule(rule.id);

        expect(alertStore.getRule(rule.id)).toBeNull();
      });

      it('should delete associated state when deleting rule', () => {
        const rule = createTestAlertRule();
        alertStore.createRule(rule);

        const state: AlertStateRecord = {
          id: 'state-1',
          ruleId: rule.id,
          state: 'firing',
          currentValue: 0.1,
          firedAt: new Date().toISOString(),
          labels: {},
          lastEvaluatedAt: new Date().toISOString(),
        };
        alertStore.updateState(state);

        alertStore.deleteRule(rule.id);

        expect(alertStore.getState(rule.id)).toBeNull();
      });
    });

    describe('getState / updateState', () => {
      it('should store and retrieve alert state', () => {
        const rule = createTestAlertRule();
        alertStore.createRule(rule);

        const state: AlertStateRecord = {
          id: 'state-1',
          ruleId: rule.id,
          state: 'firing',
          currentValue: 0.1,
          firedAt: new Date().toISOString(),
          labels: { service: 'api' },
          lastEvaluatedAt: new Date().toISOString(),
        };

        alertStore.updateState(state);

        const retrieved = alertStore.getState(rule.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.state).toBe('firing');
        expect(retrieved!.currentValue).toBe(0.1);
      });

      it('should update existing state', () => {
        const rule = createTestAlertRule();
        alertStore.createRule(rule);

        const state: AlertStateRecord = {
          id: 'state-1',
          ruleId: rule.id,
          state: 'firing',
          currentValue: 0.1,
          firedAt: new Date().toISOString(),
          labels: {},
          lastEvaluatedAt: new Date().toISOString(),
        };
        alertStore.updateState(state);

        const updated: AlertStateRecord = {
          ...state,
          state: 'resolved',
          resolvedAt: new Date().toISOString(),
          currentValue: 0.02,
          lastEvaluatedAt: new Date().toISOString(),
        };
        alertStore.updateState(updated);

        const retrieved = alertStore.getState(rule.id);
        expect(retrieved!.state).toBe('resolved');
        expect(retrieved!.currentValue).toBe(0.02);
      });
    });
  });

  describe('AlertingEngine', () => {
    describe('threshold condition evaluation', () => {
      it('should fire when threshold exceeded (>)', async () => {
        const rule = createTestAlertRule({
          id: 'rule-threshold',
          conditionType: 'threshold',
          operator: '>',
          threshold: 0.05,
        });
        alertStore.createRule(rule);

        const metric = createTestMetric({ name: 'error_rate', value: 0.1 });
        metricStore.recordMetric(metric);

        const engine = createAlertingEngine({ alertStore, metricStore });
        const notification = engine.evaluateRule(rule.id);

        expect(notification).not.toBeNull();
        expect(notification!.state).toBe('firing');
        expect(notification!.previousState).toBe('idle');
        expect(notification!.value).toBe(0.1);

        const state = alertStore.getState(rule.id);
        expect(state!.state).toBe('firing');
      });

      it('should not fire when threshold not exceeded', async () => {
        const rule = createTestAlertRule({
          id: 'rule-threshold',
          conditionType: 'threshold',
          operator: '>',
          threshold: 0.05,
        });
        alertStore.createRule(rule);

        const metric = createTestMetric({ name: 'error_rate', value: 0.02 });
        metricStore.recordMetric(metric);

        const engine = createAlertingEngine({ alertStore, metricStore });
        const notification = engine.evaluateRule(rule.id);

        expect(notification).toBeNull();

        const state = alertStore.getState(rule.id);
        expect(state!.state).toBe('idle');
      });

      it('should support all operators: > < >= <= ==', async () => {
        const testCases = [
          { operator: '>' as const, value: 10, threshold: 5, expected: true },
          { operator: '>' as const, value: 3, threshold: 5, expected: false },
          { operator: '<' as const, value: 3, threshold: 5, expected: true },
          { operator: '<' as const, value: 10, threshold: 5, expected: false },
          { operator: '>=' as const, value: 5, threshold: 5, expected: true },
          { operator: '>=' as const, value: 4, threshold: 5, expected: false },
          { operator: '<=' as const, value: 5, threshold: 5, expected: true },
          { operator: '<=' as const, value: 6, threshold: 5, expected: false },
          { operator: '==' as const, value: 5, threshold: 5, expected: true },
          { operator: '==' as const, value: 6, threshold: 5, expected: false },
        ];

        for (let i = 0; i < testCases.length; i++) {
          const tc = testCases[i];
          connection.exec('DELETE FROM alert_rules');
          connection.exec('DELETE FROM alert_states');
          connection.exec('DELETE FROM metrics');

          const rule = createTestAlertRule({
            id: `rule-op-${i}`,
            conditionType: 'threshold',
            operator: tc.operator,
            threshold: tc.threshold,
          });
          alertStore.createRule(rule);

          const metric = createTestMetric({ name: 'error_rate', value: tc.value });
          metricStore.recordMetric(metric);

          const engine = createAlertingEngine({ alertStore, metricStore });
          engine.evaluateRule(rule.id);

          const state = alertStore.getState(rule.id);
          if (tc.expected) {
            expect(state!.state).toBe('firing');
          } else {
            expect(state!.state).toBe('idle');
          }
        }
      });
    });

    describe('rate condition evaluation', () => {
      it('should fire when rate of change exceeds threshold', async () => {
        const rule = createTestAlertRule({
          id: 'rule-rate',
          conditionType: 'rate',
          operator: '>',
          threshold: 10,
          windowSeconds: 120,
        });
        alertStore.createRule(rule);

        const now = Date.now();
        const olderMetric = createTestMetric({
          name: 'error_rate',
          value: 5,
          timestamp: new Date(now - 90000).toISOString(),
        });
        const newerMetric = createTestMetric({
          name: 'error_rate',
          value: 20,
          timestamp: new Date(now - 30000).toISOString(),
        });

        metricStore.recordMetric(olderMetric);
        metricStore.recordMetric(newerMetric);

        const engine = createAlertingEngine({ alertStore, metricStore });
        engine.evaluateRule(rule.id);

        const state = alertStore.getState(rule.id);
        expect(state!.state).toBe('firing');
      });

      it('should not fire when rate within threshold', async () => {
        const rule = createTestAlertRule({
          id: 'rule-rate',
          conditionType: 'rate',
          operator: '>',
          threshold: 100,
          windowSeconds: 120,
        });
        alertStore.createRule(rule);

        const now = Date.now();
        const olderMetric = createTestMetric({
          name: 'error_rate',
          value: 10,
          timestamp: new Date(now - 90000).toISOString(),
        });
        const newerMetric = createTestMetric({
          name: 'error_rate',
          value: 20,
          timestamp: new Date(now - 30000).toISOString(),
        });

        metricStore.recordMetric(olderMetric);
        metricStore.recordMetric(newerMetric);

        const engine = createAlertingEngine({ alertStore, metricStore });
        engine.evaluateRule(rule.id);

        const state = alertStore.getState(rule.id);
        expect(state!.state).toBe('idle');
      });
    });

    describe('absence condition evaluation', () => {
      it('should fire when no metrics in window', async () => {
        const rule = createTestAlertRule({
          id: 'rule-absence',
          conditionType: 'absence',
          windowSeconds: 60,
        });
        alertStore.createRule(rule);

        const engine = createAlertingEngine({ alertStore, metricStore });
        engine.evaluateRule(rule.id);

        const state = alertStore.getState(rule.id);
        expect(state!.state).toBe('firing');
      });

      it('should not fire when metrics present in window', async () => {
        const rule = createTestAlertRule({
          id: 'rule-absence',
          conditionType: 'absence',
          windowSeconds: 60,
        });
        alertStore.createRule(rule);

        const metric = createTestMetric({ name: 'error_rate', value: 0.01 });
        metricStore.recordMetric(metric);

        const engine = createAlertingEngine({ alertStore, metricStore });
        engine.evaluateRule(rule.id);

        const state = alertStore.getState(rule.id);
        expect(state!.state).toBe('idle');
      });
    });

    describe('alert lifecycle (idle → firing → resolved)', () => {
      it('should transition from idle to firing', async () => {
        const rule = createTestAlertRule({
          id: 'rule-lifecycle',
          conditionType: 'threshold',
          operator: '>',
          threshold: 0.05,
        });
        alertStore.createRule(rule);

        const metric = createTestMetric({ name: 'error_rate', value: 0.1 });
        metricStore.recordMetric(metric);

        const engine = createAlertingEngine({ alertStore, metricStore });
        const notification = engine.evaluateRule(rule.id);

        expect(notification!.state).toBe('firing');
        expect(notification!.previousState).toBe('idle');
        expect(alertStore.getState(rule.id)!.firedAt).toBeDefined();
      });

      it('should stay firing while condition holds', async () => {
        const rule = createTestAlertRule({
          id: 'rule-lifecycle',
          conditionType: 'threshold',
          operator: '>',
          threshold: 0.05,
        });
        alertStore.createRule(rule);

        const metric1 = createTestMetric({ name: 'error_rate', value: 0.1 });
        metricStore.recordMetric(metric1);

        const engine = createAlertingEngine({ alertStore, metricStore });
        const notification1 = engine.evaluateRule(rule.id);
        expect(notification1!.state).toBe('firing');

        connection.exec('DELETE FROM metrics');
        const metric2 = createTestMetric({ name: 'error_rate', value: 0.15 });
        metricStore.recordMetric(metric2);

        const notification2 = engine.evaluateRule(rule.id);
        expect(notification2).toBeNull();

        const state = alertStore.getState(rule.id);
        expect(state!.state).toBe('firing');
      });

      it('should transition from firing to resolved', async () => {
        const rule = createTestAlertRule({
          id: 'rule-lifecycle',
          conditionType: 'threshold',
          operator: '>',
          threshold: 0.05,
        });
        alertStore.createRule(rule);

        const metric1 = createTestMetric({ name: 'error_rate', value: 0.1 });
        metricStore.recordMetric(metric1);

        const engine = createAlertingEngine({ alertStore, metricStore });
        engine.evaluateRule(rule.id);
        expect(alertStore.getState(rule.id)!.state).toBe('firing');

        connection.exec('DELETE FROM metrics');
        const metric2 = createTestMetric({ name: 'error_rate', value: 0.02 });
        metricStore.recordMetric(metric2);

        const notification = engine.evaluateRule(rule.id);
        expect(notification!.state).toBe('resolved');
        expect(notification!.previousState).toBe('firing');

        const state = alertStore.getState(rule.id);
        expect(state!.state).toBe('resolved');
        expect(state!.resolvedAt).toBeDefined();
      });

      it('should transition from resolved back to firing', async () => {
        const rule = createTestAlertRule({
          id: 'rule-lifecycle',
          conditionType: 'threshold',
          operator: '>',
          threshold: 0.05,
        });
        alertStore.createRule(rule);

        const metric1 = createTestMetric({ name: 'error_rate', value: 0.1 });
        metricStore.recordMetric(metric1);

        const engine = createAlertingEngine({ alertStore, metricStore });
        engine.evaluateRule(rule.id);

        connection.exec('DELETE FROM metrics');
        const metric2 = createTestMetric({ name: 'error_rate', value: 0.02 });
        metricStore.recordMetric(metric2);
        engine.evaluateRule(rule.id);

        connection.exec('DELETE FROM metrics');
        const metric3 = createTestMetric({ name: 'error_rate', value: 0.15 });
        metricStore.recordMetric(metric3);

        const notification = engine.evaluateRule(rule.id);
        expect(notification!.state).toBe('firing');
        expect(notification!.previousState).toBe('resolved');

        const state = alertStore.getState(rule.id);
        expect(state!.state).toBe('firing');
      });
    });

    describe('webhook notification', () => {
      it('should send webhook notification on state change', async () => {
        const webhookUrl = 'http://localhost:9999/webhook';
        const rule = createTestAlertRule({
          id: 'rule-webhook',
          conditionType: 'threshold',
          operator: '>',
          threshold: 0.05,
          webhookUrl,
        });
        alertStore.createRule(rule);

        const metric = createTestMetric({ name: 'error_rate', value: 0.1 });
        metricStore.recordMetric(metric);

        const engine = createAlertingEngine({ alertStore, metricStore });
        const notification = engine.evaluateRule(rule.id);

        expect(notification).not.toBeNull();

        const result = await engine.sendNotification(notification!);
        expect(result).toBe(false);
      });

      it('should succeed when no webhook URL configured', async () => {
        const rule = createTestAlertRule({
          id: 'rule-no-webhook',
          conditionType: 'threshold',
          operator: '>',
          threshold: 0.05,
        });
        alertStore.createRule(rule);

        const metric = createTestMetric({ name: 'error_rate', value: 0.1 });
        metricStore.recordMetric(metric);

        const engine = createAlertingEngine({ alertStore, metricStore });
        const notification = engine.evaluateRule(rule.id);

        const result = await engine.sendNotification(notification!);
        expect(result).toBe(true);
      });
    });

    describe('evaluateAllRules', () => {
      it('should evaluate all enabled rules', async () => {
        const rule1 = createTestAlertRule({ id: 'rule-1', name: 'Rule 1' });
        const rule2 = createTestAlertRule({ id: 'rule-2', name: 'Rule 2' });
        const rule3 = createTestAlertRule({ id: 'rule-3', name: 'Rule 3', enabled: false });

        alertStore.createRule(rule1);
        alertStore.createRule(rule2);
        alertStore.createRule(rule3);

        const metric1 = createTestMetric({ name: 'error_rate', value: 0.1 });
        const metric2 = createTestMetric({ name: 'error_rate', value: 0.15 });
        metricStore.recordMetric(metric1);
        metricStore.recordMetric(metric2);

        const engine = createAlertingEngine({ alertStore, metricStore });
        const notifications = engine.evaluateAllRules();

        expect(notifications).toHaveLength(2);
        expect(notifications.map(n => n.rule.id)).toContain('rule-1');
        expect(notifications.map(n => n.rule.id)).toContain('rule-2');
      });
    });

    describe('metric module filtering', () => {
      it('should filter metrics by module', async () => {
        const rule = createTestAlertRule({
          id: 'rule-module',
          metricName: 'request_duration',
          metricModule: 'gateway',
          conditionType: 'threshold',
          operator: '>',
          threshold: 100,
        });
        alertStore.createRule(rule);

        const metric1 = createTestMetric({
          name: 'request_duration',
          module: 'gateway',
          value: 150,
        });
        const metric2 = createTestMetric({
          name: 'request_duration',
          module: 'kernel',
          value: 200,
        });
        metricStore.recordMetric(metric1);
        metricStore.recordMetric(metric2);

        const engine = createAlertingEngine({ alertStore, metricStore });
        engine.evaluateRule(rule.id);

        const state = alertStore.getState(rule.id);
        expect(state!.currentValue).toBe(150);
      });
    });

    describe('disabled rule', () => {
      it('should skip disabled rules', async () => {
        const rule = createTestAlertRule({ id: 'rule-disabled', enabled: false });
        alertStore.createRule(rule);

        const metric = createTestMetric({ name: 'error_rate', value: 0.5 });
        metricStore.recordMetric(metric);

        const engine = createAlertingEngine({ alertStore, metricStore });
        const notification = engine.evaluateRule(rule.id);

        expect(notification).toBeNull();
      });
    });

    describe('notification callback', () => {
      it('should call onNotification callback', async () => {
        const onNotification = vi.fn();
        const rule = createTestAlertRule({
          id: 'rule-callback',
          conditionType: 'threshold',
          operator: '>',
          threshold: 0.05,
        });
        alertStore.createRule(rule);

        const metric = createTestMetric({ name: 'error_rate', value: 0.1 });
        metricStore.recordMetric(metric);

        const engine = createAlertingEngine({ alertStore, metricStore, onNotification });
        engine.evaluateRule(rule.id);

        expect(onNotification).toHaveBeenCalledTimes(1);
        expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
          rule: expect.objectContaining({ id: 'rule-callback' }),
          state: 'firing',
          previousState: 'idle',
        }));
      });
    });
  });
});
