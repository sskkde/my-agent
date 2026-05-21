import type { MetricStore, MetricRecord } from './types.js';
import type { PrometheusConfig, PrometheusMetricType } from './export-types.js';

export interface PrometheusExporter {
  export(): string;
  exportMetrics(metricNames?: string[]): string;
}

export interface PrometheusExporterOptions {
  metricStore: MetricStore;
  config?: PrometheusConfig;
}

const DEFAULT_CONFIG: PrometheusConfig = {
  defaultLabels: {
    service_name: 'agent-platform',
    version: '0.8.0-ga-candidate',
    instance: 'local-1',
  },
  metricPrefix: 'agent_platform_',
  includeTimestamp: false,
};

const METRIC_HELP: Record<string, string> = {
  request_total: 'Total request count',
  request_duration_seconds: 'Request duration in seconds',
  active_sessions: 'Number of active sessions',
  workflow_runs_total: 'Total workflow runs',
  connector_requests_total: 'Total connector requests',
  memory_usage_bytes: 'Current memory usage in bytes',
  budget_usage_percent: 'Current budget usage percentage',
};

const HISTOGRAM_BUCKETS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels)
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(', ');
  return `{${entries}}`;
}

function mergeLabels(
  defaultLabels: Record<string, string>,
  metricLabels?: Record<string, string>
): Record<string, string> {
  return { ...defaultLabels, ...metricLabels };
}

class PrometheusExporterImpl implements PrometheusExporter {
  private metricStore: MetricStore;
  private config: PrometheusConfig;

  constructor(options: PrometheusExporterOptions) {
    this.metricStore = options.metricStore;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  export(): string {
    return this.exportMetrics();
  }

  exportMetrics(metricNames?: string[]): string {
    const allMetrics = this.metricStore.queryMetrics({});
    const lines: string[] = [];

    const metricsByName = new Map<string, MetricRecord[]>();
    for (const metric of allMetrics) {
      if (!metricNames || metricNames.includes(metric.name)) {
        const existing = metricsByName.get(metric.name) || [];
        existing.push(metric);
        metricsByName.set(metric.name, existing);
      }
    }

    const processedMetrics = new Set<string>();

    for (const [name, metrics] of metricsByName) {
      if (metrics.length === 0) continue;

      const metricType = this.determineMetricType(metrics);
      const fullName = this.getFullName(name);

      if (processedMetrics.has(fullName)) continue;
      processedMetrics.add(fullName);

      const help = METRIC_HELP[name] || `Metric ${name}`;
      lines.push(`# HELP ${fullName} ${help}`);
      lines.push(`# TYPE ${fullName} ${metricType}`);

      if (metricType === 'histogram') {
        const histogramLines = this.formatHistogram(fullName, metrics);
        lines.push(...histogramLines);
      } else if (metricType === 'gauge') {
        const gaugeLines = this.formatGauge(fullName, metrics);
        lines.push(...gaugeLines);
      } else {
        const counterLines = this.formatCounter(fullName, metrics);
        lines.push(...counterLines);
      }
    }

    return lines.join('\n');
  }

  private determineMetricType(metrics: MetricRecord[]): PrometheusMetricType {
    const firstMetric = metrics[0];
    if (!firstMetric) return 'counter';

    if (firstMetric.metricType === 'timer') {
      return 'histogram';
    }

    return firstMetric.metricType as PrometheusMetricType;
  }

  private getFullName(name: string): string {
    const prefix = this.config.metricPrefix || '';
    return `${prefix}${name}`;
  }

  private formatCounter(fullName: string, metrics: MetricRecord[]): string[] {
    const lines: string[] = [];
    const aggregated = new Map<string, { value: number; timestamp: string }>();

    for (const metric of metrics) {
      const labels = mergeLabels(
        this.config.defaultLabels || {},
        metric.labels
      );
      const labelKey = JSON.stringify(labels);
      const existing = aggregated.get(labelKey);
      aggregated.set(labelKey, {
        value: (existing?.value || 0) + metric.value,
        timestamp: metric.timestamp,
      });
    }

    for (const [labelKey, data] of aggregated) {
      const labels = JSON.parse(labelKey) as Record<string, string>;
      const labelStr = formatLabels(labels);
      const line = this.formatMetricLine(fullName, labelStr, data.value, data.timestamp);
      lines.push(line);
    }

    return lines;
  }

  private formatGauge(fullName: string, metrics: MetricRecord[]): string[] {
    const lines: string[] = [];
    const latestByLabels = new Map<string, MetricRecord>();

    for (const metric of metrics) {
      const labels = mergeLabels(
        this.config.defaultLabels || {},
        metric.labels
      );
      const labelKey = JSON.stringify(labels);
      const existing = latestByLabels.get(labelKey);
      if (!existing || new Date(metric.timestamp) > new Date(existing.timestamp)) {
        latestByLabels.set(labelKey, metric);
      }
    }

    for (const [, metric] of latestByLabels) {
      const labels = mergeLabels(
        this.config.defaultLabels || {},
        metric.labels
      );
      const labelStr = formatLabels(labels);
      const line = this.formatMetricLine(fullName, labelStr, metric.value, metric.timestamp);
      lines.push(line);
    }

    return lines;
  }

  private formatHistogram(fullName: string, metrics: MetricRecord[]): string[] {
    const lines: string[] = [];
    const byLabels = new Map<string, MetricRecord[]>();

    for (const metric of metrics) {
      const labels = mergeLabels(
        this.config.defaultLabels || {},
        metric.labels
      );
      const labelKey = JSON.stringify(labels);
      const existing = byLabels.get(labelKey) || [];
      existing.push(metric);
      byLabels.set(labelKey, existing);
    }

    for (const [, groupMetrics] of byLabels) {
      const firstMetric = groupMetrics[0];
      if (!firstMetric) continue;

      const baseLabels = mergeLabels(
        this.config.defaultLabels || {},
        firstMetric.labels
      );

      const values = groupMetrics.map(m => m.value);
      const sum = values.reduce((a, b) => a + b, 0);
      const count = values.length;

      for (const bucket of HISTOGRAM_BUCKETS) {
        const bucketCount = values.filter(v => v <= bucket).length;
        const bucketLabels = { ...baseLabels, le: bucket.toString() };
        const labelStr = formatLabels(bucketLabels);
        const line = this.formatMetricLine(`${fullName}_bucket`, labelStr, bucketCount);
        lines.push(line);
      }

      const infLabels = { ...baseLabels, le: '+Inf' };
      const infLabelStr = formatLabels(infLabels);
      const infLine = this.formatMetricLine(`${fullName}_bucket`, infLabelStr, count);
      lines.push(infLine);

      const baseLabelStr = formatLabels(baseLabels);
      const sumLine = this.formatMetricLine(`${fullName}_sum`, baseLabelStr, sum);
      lines.push(sumLine);

      const countLine = this.formatMetricLine(`${fullName}_count`, baseLabelStr, count);
      lines.push(countLine);
    }

    return lines;
  }

  private formatMetricLine(
    name: string,
    labelStr: string,
    value: number,
    timestamp?: string
  ): string {
    let line = `${name}${labelStr} ${value}`;

    if (this.config.includeTimestamp && timestamp) {
      const ts = new Date(timestamp).getTime();
      line += ` ${ts}`;
    }

    return line;
  }
}

export function createPrometheusExporter(options: PrometheusExporterOptions): PrometheusExporter {
  return new PrometheusExporterImpl(options);
}
