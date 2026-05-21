# Dashboard Guide | 仪表盘指南

This guide describes recommended dashboards for monitoring Agent Platform in production environments.

本指南描述生产环境中监控 Agent Platform 的推荐仪表盘配置。

## Overview | 概述

Agent Platform exposes metrics via `/api/v1/metrics` in Prometheus format. Use Grafana or similar visualization tools to create dashboards for operational visibility.

Agent Platform 通过 `/api/v1/metrics` 端点以 Prometheus 格式暴露指标。使用 Grafana 或类似可视化工具创建仪表盘以获得运营可见性。

---

## Dashboard 1: API Health Overview | API 健康概览

### Dashboard Name | 仪表盘名称

`Agent Platform - API Health`

### Purpose | 用途

Monitor overall API health and availability. This is the primary dashboard for on-call engineers and SREs.

监控整体 API 健康状况和可用性。这是值班工程师和 SRE 的主要仪表盘。

### Metrics Displayed | 显示指标

| Panel | Metric | PromQL Query |
|-------|--------|--------------|
| Service Status | Health endpoint | `up{job="agent-platform"}` |
| Uptime | Request success rate | `sum(rate(agent_platform_request_duration_seconds_count{status="success"}[5m])) / sum(rate(agent_platform_request_duration_seconds_count[5m])) * 100` |
| Active Instances | Instance count | `count(up{job="agent-platform"})` |
| Health Score | Composite | Custom calculation based on error rate, latency, availability |

### Refresh Rate | 刷新频率

**10 seconds** - Fast refresh for real-time monitoring

### Filter Options | 过滤选项

| Filter | Type | Values |
|--------|------|--------|
| `instance` | Dropdown | All instances, or specific instance |
| `environment` | Dropdown | `production`, `staging`, `development` |
| `timeRange` | Time picker | Last 1h, 6h, 24h, 7d |

### Panel Layout | 面板布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Service Status    │  Uptime (%)    │  Active Instances        │
│  [Stat/Gauge]      │  [Stat/Gauge]  │  [Stat/Gauge]            │
├─────────────────────────────────────────────────────────────────┤
│                    Request Rate Over Time                        │
│                    [Time Series]                                 │
├─────────────────────────────────────────────────────────────────┤
│                    Error Rate Over Time                          │
│                    [Time Series]                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Dashboard 2: Request Rate | 请求速率

### Dashboard Name | 仪表盘名称

`Agent Platform - Request Rate`

### Purpose | 用途

Track incoming request volume and identify traffic patterns, spikes, or drops.

跟踪传入请求量，识别流量模式、峰值或下降。

### Metrics Displayed | 显示指标

| Panel | Metric | PromQL Query |
|-------|--------|--------------|
| Requests/sec | Request rate | `sum(rate(agent_platform_request_total[5m]))` |
| Requests by Endpoint | Rate by operation | `sum by (operation)(rate(agent_platform_request_duration_seconds_count[5m]))` |
| Requests by Status | Rate by status code | `sum by (status)(rate(agent_platform_request_duration_seconds_count[5m]))` |
| Peak Traffic | Max rate | `max_over_time(sum(rate(agent_platform_request_total[5m]))[1h])` |

### Refresh Rate | 刷新频率

**15 seconds** - Moderate refresh for traffic analysis

### Filter Options | 过滤选项

| Filter | Type | Values |
|--------|------|--------|
| `instance` | Multi-select | Select multiple instances |
| `operation` | Multi-select | Filter by API endpoint |
| `status` | Multi-select | `success`, `failed` |
| `timeRange` | Time picker | Last 30m, 1h, 6h, 24h |

### Panel Layout | 面板布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Current RPS       │  Peak RPS        │  Total Today           │
│  [Big Stat]        │  [Big Stat]      │  [Big Stat]            │
├─────────────────────────────────────────────────────────────────┤
│                    Request Rate Timeline                         │
│                    [Time Series - Stacked]                       │
├───────────────────────────┬─────────────────────────────────────┤
│  Requests by Endpoint     │  Requests by Status                 │
│  [Pie Chart]              │  [Pie Chart]                        │
└───────────────────────────┴─────────────────────────────────────┘
```

---

## Dashboard 3: Error Rate | 错误率

### Dashboard Name | 仪表盘名称

`Agent Platform - Error Rate`

### Purpose | 用途

Monitor error rates across all operations and quickly identify error spikes.

监控所有操作的错误率，快速识别错误峰值。

### Metrics Displayed | 显示指标

| Panel | Metric | PromQL Query |
|-------|--------|--------------|
| Error Rate % | Error percentage | `sum(rate(agent_platform_request_duration_seconds_count{status="failed"}[5m])) / sum(rate(agent_platform_request_duration_seconds_count[5m])) * 100` |
| Errors/sec | Error count rate | `sum(rate(agent_platform_request_duration_seconds_count{status="failed"}[5m]))` |
| Errors by Operation | Rate by operation | `sum by (operation)(rate(agent_platform_request_duration_seconds_count{status="failed"}[5m]))` |
| Error Trend | Error rate trend | `rate(agent_platform_*_errors[5m])` |

### Refresh Rate | 刷新频率

**10 seconds** - Fast refresh for error detection

### Filter Options | 过滤选项

| Filter | Type | Values |
|--------|------|--------|
| `instance` | Multi-select | Select multiple instances |
| `operation` | Multi-select | Filter by API endpoint |
| `errorType` | Multi-select | Filter by error type |
| `severity` | Multi-select | `critical`, `warning`, `info` |
| `timeRange` | Time picker | Last 15m, 1h, 6h |

### Alert Thresholds | 告警阈值

| Level | Threshold | Color |
|-------|-----------|-------|
| Normal | < 1% | Green |
| Warning | 1-5% | Yellow |
| Critical | > 5% | Red |

### Panel Layout | 面板布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Error Rate (%)    │  Errors/sec      │  Error Trend           │
│  [Gauge]           │  [Stat]          │  [Sparkline]           │
│  Thresholds:       │                  │                        │
│  Green < 1%        │                  │                        │
│  Yellow 1-5%       │                  │                        │
│  Red > 5%          │                  │                        │
├─────────────────────────────────────────────────────────────────┤
│                    Error Rate Timeline                           │
│                    [Time Series]                                 │
├───────────────────────────┬─────────────────────────────────────┤
│  Errors by Operation      │  Top Error Messages                 │
│  [Bar Chart]              │  [Table]                            │
└───────────────────────────┴─────────────────────────────────────┘
```

---

## Dashboard 4: Latency P95/P99 | 延迟 P95/P99

### Dashboard Name | 仪表盘名称

`Agent Platform - Latency`

### Purpose | 用途

Monitor API response latency percentiles to ensure SLA compliance and identify slow operations.

监控 API 响应延迟百分位数，确保 SLA 合规并识别慢操作。

### Metrics Displayed | 显示指标

| Panel | Metric | PromQL Query |
|-------|--------|--------------|
| P50 Latency | Median latency | `histogram_quantile(0.50, sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le))` |
| P95 Latency | 95th percentile | `histogram_quantile(0.95, sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le))` |
| P99 Latency | 99th percentile | `histogram_quantile(0.99, sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le))` |
| Latency by Operation | Per-operation latency | `histogram_quantile(0.95, sum by (le, operation)(rate(agent_platform_request_duration_seconds_bucket[5m])))` |
| Slow Operations | Operations > threshold | `histogram_quantile(0.95, sum by (le, operation)(rate(agent_platform_request_duration_seconds_bucket[5m]))) > 1` |

### Refresh Rate | 刷新频率

**15 seconds** - Moderate refresh for latency trends

### Filter Options | 过滤选项

| Filter | Type | Values |
|--------|------|--------|
| `instance` | Multi-select | Select multiple instances |
| `operation` | Multi-select | Filter by API endpoint |
| `percentile` | Dropdown | P50, P90, P95, P99 |
| `timeRange` | Time picker | Last 1h, 6h, 24h |

### SLA Thresholds | SLA 阈值

| Percentile | Target | Warning | Critical |
|------------|--------|---------|----------|
| P50 | < 200ms | > 500ms | > 1s |
| P95 | < 1s | > 2s | > 5s |
| P99 | < 2s | > 5s | > 10s |

### Panel Layout | 面板布局

```
┌─────────────────────────────────────────────────────────────────┐
│  P50 (ms)          │  P95 (ms)        │  P99 (ms)              │
│  [Stat + Trend]    │  [Stat + Trend]  │  [Stat + Trend]        │
├─────────────────────────────────────────────────────────────────┤
│                    Latency Distribution Over Time                │
│                    [Time Series - Multi-line]                    │
│                    Lines: P50, P95, P99                          │
├───────────────────────────┬─────────────────────────────────────┤
│  Latency by Operation     │  Slow Operations (>1s)              │
│  [Heatmap]                │  [Table - Sorted by latency]        │
└───────────────────────────┴─────────────────────────────────────┘
```

---

## Dashboard 5: Workflow Run Status | 工作流运行状态

### Dashboard Name | 仪表盘名称

`Agent Platform - Workflows`

### Purpose | 用途

Monitor workflow execution status, success rates, and identify failed workflows.

监控工作流执行状态、成功率，识别失败的工作流。

### Metrics Displayed | 显示指标

| Panel | Metric | PromQL Query |
|-------|--------|--------------|
| Active Workflows | Running count | `agent_platform_workflow_runs_active` |
| Workflow Success Rate | Success % | `sum(rate(agent_platform_workflow_runs_total{status="success"}[5m])) / sum(rate(agent_platform_workflow_runs_total[5m])) * 100` |
| Runs/hour | Execution rate | `sum(increase(agent_platform_workflow_runs_total[1h]))` |
| Failed Runs | Failed count | `sum(increase(agent_platform_workflow_runs_total{status="failed"}[1h]))` |

### Refresh Rate | 刷新频率

**30 seconds** - Moderate refresh for workflow monitoring

### Filter Options | 过滤选项

| Filter | Type | Values |
|--------|------|--------|
| `workflowId` | Multi-select | Select specific workflows |
| `status` | Multi-select | `running`, `success`, `failed`, `pending` |
| `instance` | Multi-select | Select instances |
| `timeRange` | Time picker | Last 1h, 6h, 24h, 7d |

### Panel Layout | 面板布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Active Workflows  │  Success Rate     │  Runs Today           │
│  [Stat]            │  [Gauge %]        │  [Stat]               │
├─────────────────────────────────────────────────────────────────┤
│                    Workflow Executions Timeline                  │
│                    [Time Series - Stacked by status]             │
├───────────────────────────┬─────────────────────────────────────┤
│  Runs by Workflow         │  Failed Workflows                   │
│  [Pie Chart]              │  [Table - Recent failures]          │
└───────────────────────────┴─────────────────────────────────────┘
```

---

## Dashboard 6: Connector Failures | 连接器故障

### Dashboard Name | 仪表盘名称

`Agent Platform - Connectors`

### Purpose | 用途

Monitor connector health, request rates, and identify failing external integrations.

监控连接器健康、请求速率，识别失败的外部集成。

### Metrics Displayed | 显示指标

| Panel | Metric | PromQL Query |
|-------|--------|--------------|
| Connector Status | Health per connector | `agent_platform_connector_status` |
| Request Rate | Requests/sec per connector | `sum by (connectorId)(rate(agent_platform_connector_requests_total[5m]))` |
| Error Rate | Errors per connector | `sum by (connectorId)(rate(agent_platform_connector_requests_total{status="failed"}[5m]))` |
| Latency by Connector | P95 per connector | `histogram_quantile(0.95, sum by (le, connectorId)(rate(agent_platform_connector_*_duration_ms_bucket[5m])))` |

### Refresh Rate | 刷新频率

**30 seconds** - Moderate refresh for connector monitoring

### Filter Options | 过滤选项

| Filter | Type | Values |
|--------|------|--------|
| `connectorId` | Multi-select | `github`, `google-calendar`, `google-docs`, etc. |
| `operation` | Multi-select | Filter by operation type |
| `status` | Multi-select | `success`, `failed` |
| `timeRange` | Time picker | Last 1h, 6h, 24h |

### Panel Layout | 面板布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Total Connectors  │  Healthy         │  With Errors           │
│  [Stat]            │  [Stat - Green]  │  [Stat - Red]          │
├─────────────────────────────────────────────────────────────────┤
│                    Connector Request Rate                        │
│                    [Time Series - Per connector]                 │
├───────────────────────────┬─────────────────────────────────────┤
│  Error Rate by Connector  │  Connector Status Table             │
│  [Bar Chart]              │  [Table]                            │
└───────────────────────────┴─────────────────────────────────────┘
```

---

## Dashboard 7: DLQ Backlog | 死信队列积压

### Dashboard Name | 仪表盘名称

`Agent Platform - DLQ`

### Purpose | 用途

Monitor dead letter queue size and identify patterns in failed events.

监控死信队列大小，识别失败事件模式。

### Metrics Displayed | 显示指标

| Panel | Metric | PromQL Query |
|-------|--------|--------------|
| DLQ Size | Current count | `agent_platform_dlq_size` |
| DLQ Growth Rate | Events/hour | `rate(agent_platform_dlq_events_total[1h])` |
| Retry Success Rate | Retry success % | `sum(rate(agent_platform_dlq_retries{status="success"}[5m])) / sum(rate(agent_platform_dlq_retries[5m])) * 100` |
| Events by Error Type | Error distribution | `sum by (errorType)(agent_platform_dlq_events)` |

### Refresh Rate | 刷新频率

**60 seconds** - Slow refresh for DLQ monitoring

### Filter Options | 过滤选项

| Filter | Type | Values |
|--------|------|--------|
| `errorType` | Multi-select | Filter by error type |
| `source` | Multi-select | Filter by event source |
| `timeRange` | Time picker | Last 1h, 6h, 24h, 7d |

### Alert Thresholds | 告警阈值

| Level | Threshold | Action |
|-------|-----------|--------|
| Normal | < 10 events | None |
| Warning | 10-100 events | Monitor |
| Critical | > 100 events | Investigate immediately |

### Panel Layout | 面板布局

```
┌─────────────────────────────────────────────────────────────────┐
│  DLQ Size          │  Growth Rate     │  Retry Success         │
│  [Stat]            │  [Stat]          │  [Gauge %]             │
│  Thresholds:       │                  │                        │
│  Green < 10        │                  │                        │
│  Yellow 10-100     │                  │                        │
│  Red > 100         │                  │                        │
├─────────────────────────────────────────────────────────────────┤
│                    DLQ Size Over Time                            │
│                    [Time Series]                                 │
├───────────────────────────┬─────────────────────────────────────┤
│  Events by Error Type     │  Recent DLQ Events                  │
│  [Pie Chart]              │  [Table]                            │
└───────────────────────────┴─────────────────────────────────────┘
```

---

## Dashboard 8: Memory Budget Usage | 内存预算使用

### Dashboard Name | 仪表盘名称

`Agent Platform - Budget`

### Purpose | 用途

Monitor token and request budget usage across users and identify budget exhaustion.

监控令牌和请求预算使用情况，识别预算耗尽。

### Metrics Displayed | 显示指标

| Panel | Metric | PromQL Query |
|-------|--------|--------------|
| Overall Budget Usage | Usage % | `agent_platform_budget_usage_percent` |
| Tokens Used | Token consumption | `agent_platform_tokens_used_total` |
| Requests Count | Request count | `agent_platform_requests_count_total` |
| Users Near Limit | Users > 80% | `count(agent_platform_budget_usage_percent > 80)` |

### Refresh Rate | 刷新频率

**60 seconds** - Slow refresh for budget monitoring

### Filter Options | 过滤选项

| Filter | Type | Values |
|--------|------|--------|
| `userId` | Multi-select | Filter by user |
| `budgetType` | Dropdown | `token`, `request`, `storage` |
| `period` | Dropdown | `daily`, `monthly`, `session` |
| `timeRange` | Time picker | Last 1h, 24h, 7d, 30d |

### Alert Thresholds | 告警阈值

| Level | Threshold | Color |
|-------|-----------|-------|
| Normal | < 70% | Green |
| Warning | 70-90% | Yellow |
| Critical | > 90% | Red |

### Panel Layout | 面板布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Budget Usage (%)  │  Tokens Used      │  Users Near Limit     │
│  [Gauge 0-100%]    │  [Stat]           │  [Stat - Warning]     │
│  Thresholds:       │                   │                        │
│  Green < 70%       │                   │                        │
│  Yellow 70-90%     │                   │                        │
│  Red > 90%         │                   │                        │
├─────────────────────────────────────────────────────────────────┤
│                    Budget Usage Over Time                        │
│                    [Time Series]                                 │
├───────────────────────────┬─────────────────────────────────────┤
│  Usage by User (Top 10)   │  Budget Reset Schedule              │
│  [Bar Chart]              │  [Table]                            │
└───────────────────────────┴─────────────────────────────────────┘
```

---

## Dashboard 9: Backup Status | 备份状态

### Dashboard Name | 仪表盘名称

`Agent Platform - Backups`

### Purpose | 用途

Monitor database backup status and ensure data recovery capability.

监控数据库备份状态，确保数据恢复能力。

### Metrics Displayed | 显示指标

| Panel | Metric | PromQL Query |
|-------|--------|--------------|
| Last Backup Time | Timestamp | `agent_platform_backup_last_timestamp` |
| Backup Status | Success/Fail | `agent_platform_backup_status` |
| Backup Size | Size in MB | `agent_platform_backup_size_bytes / 1024 / 1024` |
| Backup Age | Hours since backup | `(time() - agent_platform_backup_last_timestamp) / 3600` |

### Refresh Rate | 刷新频率

**300 seconds (5 minutes)** - Slow refresh for backup monitoring

### Filter Options | 过滤选项

| Filter | Type | Values |
|--------|------|--------|
| `backupType` | Dropdown | `full`, `incremental` |
| `status` | Multi-select | `success`, `failed`, `in_progress` |
| `timeRange` | Time picker | Last 24h, 7d, 30d |

### Alert Thresholds | 告警阈值

| Condition | Level | Action |
|-----------|-------|--------|
| Backup failed | Critical | Immediate investigation |
| Backup age > 24h | Warning | Check backup schedule |
| Backup size = 0 | Critical | Backup not running |

### Panel Layout | 面板布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Last Backup       │  Status          │  Backup Size           │
│  [Stat - Time]     │  [Stat - Color]  │  [Stat - MB]           │
├─────────────────────────────────────────────────────────────────┤
│                    Backup History                                │
│                    [Time Series - Status over time]              │
├───────────────────────────┬─────────────────────────────────────┤
│  Backup Schedule          │  Backup File List                   │
│  [Table]                  │  [Table]                            │
└───────────────────────────┴─────────────────────────────────────┘
```

---

## Dashboard 10: Alert State | 告警状态

### Dashboard Name | 仪表盘名称

`Agent Platform - Alerts`

### Purpose | 用途

Monitor active alerts and alert system health.

监控活动告警和告警系统健康状况。

### Metrics Displayed | 显示指标

| Panel | Metric | PromQL Query |
|-------|--------|--------------|
| Active Alerts | Firing count | `count(agent_platform_alert_state{state="firing"})` |
| Alert Rate | Alerts/hour | `rate(agent_platform_alerts_fired_total[1h])` |
| Alerts by Severity | Count by severity | `sum by (severity)(agent_platform_alert_state{state="firing"})` |
| Webhook Success Rate | Notification success | `sum(rate(agent_platform_alert_webhook_total{status="success"}[5m])) / sum(rate(agent_platform_alert_webhook_total[5m])) * 100` |

### Refresh Rate | 刷新频率

**10 seconds** - Fast refresh for alert monitoring

### Filter Options | 过滤选项

| Filter | Type | Values |
|--------|------|--------|
| `severity` | Multi-select | `critical`, `warning`, `info` |
| `state` | Multi-select | `idle`, `firing`, `resolved` |
| `ruleId` | Multi-select | Filter by alert rule |
| `timeRange` | Time picker | Last 1h, 6h, 24h |

### Panel Layout | 面板布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Active Alerts     │  Critical Count   │  Webhook Success      │
│  [Stat - Color]    │  [Stat - Red]     │  [Gauge %]            │
├─────────────────────────────────────────────────────────────────┤
│                    Alert Timeline                                │
│                    [Time Series - By severity]                   │
├───────────────────────────┬─────────────────────────────────────┤
│  Active Alerts List       │  Alert Rule Status                  │
│  [Table - Sortable]       │  [Table]                            │
└───────────────────────────┴─────────────────────────────────────┘
```

---

## Master Dashboard | 主仪表盘

### Dashboard Name | 仪表盘名称

`Agent Platform - Master Overview`

### Purpose | 用途

Combined view of all critical metrics for executive summary and NOC monitoring.

所有关键指标的综合视图，用于高管摘要和 NOC 监控。

### Layout | 布局

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SYSTEM HEALTH                                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ API UP  │ │ Error % │ │ P95 Lat │ │ Budget  │ │ Alerts  │       │
│  │   ✓     │ │  0.5%   │ │  120ms  │ │  45%    │ │   0     │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
├─────────────────────────────────────────────────────────────────────┤
│                         TRAFFIC                                      │
│  Request Rate Timeline (24h)                                         │
│  [Time Series]                                                       │
├──────────────────────────────┬──────────────────────────────────────┤
│       LATENCY                │           ERRORS                      │
│  P50/P95/P99 Timeline        │  Error Rate Timeline                  │
│  [Time Series]               │  [Time Series]                        │
├──────────────────────────────┼──────────────────────────────────────┤
│       WORKFLOWS              │           CONNECTORS                  │
│  Execution Status            │  Health Status                        │
│  [Pie + Stats]               │  [Table + Status indicators]          │
├──────────────────────────────┴──────────────────────────────────────┤
│                         RESOURCES                                    │
│  Memory Usage │ DLQ Size │ Backup Status │ Budget Usage             │
│  [Gauge]      │ [Stat]   │ [Stat]        │ [Gauge]                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Refresh Rate | 刷新频率

**30 seconds**

---

## Dashboard Best Practices | 仪表盘最佳实践

### Color Coding | 颜色编码

| Color | Meaning |
|-------|---------|
| Green | Normal, within SLA |
| Yellow | Warning, approaching threshold |
| Red | Critical, needs immediate attention |
| Gray | No data / unknown |

### Annotation Standards | 注释标准

```bash
# Add deployment annotations
curl -X POST http://grafana/api/annotations \
  -d '{"time": 1234567890000, "tags": ["deployment"], "text": "v1.2.3 deployed"}'

# Add incident annotations
curl -X POST http://grafana/api/annotations \
  -d '{"time": 1234567890000, "tags": ["incident"], "text": "INC-123 Started"}'
```

### Dashboard Variables | 仪表盘变量

Recommended variables to define in Grafana:

| Variable | Type | Purpose |
|----------|------|---------|
| `$instance` | Query | Filter by instance |
| `$environment` | Custom | Filter by environment |
| `$timeRange` | Interval | Time range selector |

---

## Grafana Import Instructions | Grafana 导入说明

### Method 1: Import JSON

1. Open Grafana → Dashboards → Import
2. Upload JSON file or paste JSON content
3. Select Prometheus data source
4. Click Import

### Method 2: Provision Dashboards

Add to `grafana/provisioning/dashboards/dashboards.yml`:

```yaml
apiVersion: 1
providers:
  - name: 'Agent Platform'
    orgId: 1
    folder: 'Agent Platform'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    options:
      path: /var/lib/grafana/dashboards
```

### Prometheus Configuration

Ensure `prometheus.yml` includes:

```yaml
scrape_configs:
  - job_name: 'agent-platform'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3003']
    metrics_path: '/api/v1/metrics'
```

---

## Quick Reference | 快速参考

### Key Endpoints | 关键端点

| Endpoint | Purpose |
|----------|---------|
| `/api/v1/metrics` | Prometheus metrics |
| `/api/v1/health` | Health check |
| `/api/v1/health/ready` | Readiness check |

### Common PromQL Queries | 常用 PromQL 查询

```promql
# Request rate (requests per second)
sum(rate(agent_platform_request_total[5m]))

# Error rate percentage
sum(rate(agent_platform_request_duration_seconds_count{status="failed"}[5m])) 
  / sum(rate(agent_platform_request_duration_seconds_count[5m])) * 100

# P95 latency
histogram_quantile(0.95, sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le))

# Active sessions
agent_platform_active_sessions

# Memory usage (MB)
agent_platform_memory_usage_bytes / 1024 / 1024

# Budget usage percentage
agent_platform_budget_usage_percent
```

---

## Related Documentation | 相关文档

- [Incident Runbook](./incident-runbook.md)
- [Metrics Documentation](./metrics.md)
- [Alerting Runbook](./alerting-runbook.md)
