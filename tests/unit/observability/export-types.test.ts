import { describe, it, expect } from 'vitest'
import type {
  PrometheusMetric,
  PrometheusConfig,
  OTelSpan,
  OTelExportConfig,
  AlertRule,
  AlertState,
} from '../../../src/observability/export-types.js'

describe('Export Types', () => {
  describe('Prometheus Types', () => {
    it('should define PrometheusMetric with all fields', () => {
      const metric: PrometheusMetric = {
        name: 'http_requests_total',
        type: 'counter',
        labels: { method: 'GET', status: '200' },
        value: 100,
        help: 'Total HTTP requests',
      }

      expect(metric.name).toBe('http_requests_total')
      expect(metric.type).toBe('counter')
      expect(metric.labels).toEqual({ method: 'GET', status: '200' })
      expect(metric.value).toBe(100)
      expect(metric.help).toBe('Total HTTP requests')
    })

    it('should support all Prometheus metric types', () => {
      const counter: PrometheusMetric = { name: 'counter', type: 'counter', value: 1 }
      const gauge: PrometheusMetric = { name: 'gauge', type: 'gauge', value: 42 }
      const histogram: PrometheusMetric = { name: 'histogram', type: 'histogram', value: 0.5 }

      expect(counter.type).toBe('counter')
      expect(gauge.type).toBe('gauge')
      expect(histogram.type).toBe('histogram')
    })

    it('should define PrometheusConfig with all fields', () => {
      const config: PrometheusConfig = {
        defaultLabels: { app: 'agent-platform', env: 'production' },
        metricPrefix: 'agent_',
        includeTimestamp: true,
      }

      expect(config.defaultLabels).toEqual({ app: 'agent-platform', env: 'production' })
      expect(config.metricPrefix).toBe('agent_')
      expect(config.includeTimestamp).toBe(true)
    })

    it('should allow optional PrometheusConfig fields', () => {
      const config: PrometheusConfig = {}
      expect(config.defaultLabels).toBeUndefined()
      expect(config.metricPrefix).toBeUndefined()
      expect(config.includeTimestamp).toBeUndefined()
    })
  })

  describe('OpenTelemetry Types', () => {
    it('should define OTelSpan with all fields', () => {
      const span: OTelSpan = {
        traceId: 'trace-123',
        spanId: 'span-456',
        parentSpanId: 'parent-789',
        operationName: 'http.request',
        startTime: '2024-01-01T00:00:00.000Z',
        endTime: '2024-01-01T00:00:01.000Z',
        status: 'ok',
        attributes: { 'http.method': 'GET', 'http.url': '/api/test' },
      }

      expect(span.traceId).toBe('trace-123')
      expect(span.spanId).toBe('span-456')
      expect(span.parentSpanId).toBe('parent-789')
      expect(span.operationName).toBe('http.request')
      expect(span.startTime).toBe('2024-01-01T00:00:00.000Z')
      expect(span.endTime).toBe('2024-01-01T00:00:01.000Z')
      expect(span.status).toBe('ok')
      expect(span.attributes).toEqual({ 'http.method': 'GET', 'http.url': '/api/test' })
    })

    it('should allow optional parentSpanId in OTelSpan', () => {
      const span: OTelSpan = {
        traceId: 'trace-123',
        spanId: 'span-456',
        operationName: 'root',
        startTime: '2024-01-01T00:00:00.000Z',
        status: 'ok',
      }

      expect(span.parentSpanId).toBeUndefined()
      expect(span.endTime).toBeUndefined()
      expect(span.attributes).toBeUndefined()
    })

    it('should define OTelExportConfig with all fields', () => {
      const config: OTelExportConfig = {
        endpoint: 'http://localhost:4318/v1/traces',
        protocol: 'http',
        headers: { 'api-key': 'secret' },
        resource: { 'service.name': 'agent-platform', 'service.version': '1.0.0' },
      }

      expect(config.endpoint).toBe('http://localhost:4318/v1/traces')
      expect(config.protocol).toBe('http')
      expect(config.headers).toEqual({ 'api-key': 'secret' })
      expect(config.resource).toEqual({ 'service.name': 'agent-platform', 'service.version': '1.0.0' })
    })

    it('should support grpc protocol in OTelExportConfig', () => {
      const config: OTelExportConfig = {
        endpoint: 'http://localhost:4317',
        protocol: 'grpc',
      }

      expect(config.protocol).toBe('grpc')
    })
  })

  describe('Alerting Types', () => {
    it('should define AlertRule with all fields', () => {
      const rule: AlertRule = {
        id: 'rule-1',
        name: 'High Error Rate',
        condition: 'error_rate > threshold',
        threshold: 0.05,
        windowSeconds: 300,
        severity: 'critical',
        channels: ['slack', 'email'],
      }

      expect(rule.id).toBe('rule-1')
      expect(rule.name).toBe('High Error Rate')
      expect(rule.condition).toBe('error_rate > threshold')
      expect(rule.threshold).toBe(0.05)
      expect(rule.windowSeconds).toBe(300)
      expect(rule.severity).toBe('critical')
      expect(rule.channels).toEqual(['slack', 'email'])
    })

    it('should support all severity levels', () => {
      const critical: AlertRule = {
        id: '1',
        name: 'c',
        condition: 'c',
        threshold: 1,
        windowSeconds: 60,
        severity: 'critical',
        channels: [],
      }
      const warning: AlertRule = {
        id: '2',
        name: 'w',
        condition: 'w',
        threshold: 1,
        windowSeconds: 60,
        severity: 'warning',
        channels: [],
      }
      const info: AlertRule = {
        id: '3',
        name: 'i',
        condition: 'i',
        threshold: 1,
        windowSeconds: 60,
        severity: 'info',
        channels: [],
      }

      expect(critical.severity).toBe('critical')
      expect(warning.severity).toBe('warning')
      expect(info.severity).toBe('info')
    })

    it('should define AlertState with all fields', () => {
      const state: AlertState = {
        ruleId: 'rule-1',
        state: 'firing',
        firedAt: '2024-01-01T00:00:00.000Z',
        labels: { alertname: 'HighErrorRate', instance: 'api-1' },
      }

      expect(state.ruleId).toBe('rule-1')
      expect(state.state).toBe('firing')
      expect(state.firedAt).toBe('2024-01-01T00:00:00.000Z')
      expect(state.resolvedAt).toBeUndefined()
      expect(state.labels).toEqual({ alertname: 'HighErrorRate', instance: 'api-1' })
    })

    it('should support resolved state with resolvedAt', () => {
      const state: AlertState = {
        ruleId: 'rule-1',
        state: 'resolved',
        firedAt: '2024-01-01T00:00:00.000Z',
        resolvedAt: '2024-01-01T00:05:00.000Z',
        labels: {},
      }

      expect(state.state).toBe('resolved')
      expect(state.resolvedAt).toBe('2024-01-01T00:05:00.000Z')
    })
  })
})
