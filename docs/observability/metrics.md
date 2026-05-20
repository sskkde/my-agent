# Prometheus 指标文档

本文档描述 Agent Platform 暴露的所有 Prometheus 指标，包括指标名称、类型、标签、含义，以及推荐的 Grafana 仪表盘配置。

## 指标端点

平台通过以下端点暴露 Prometheus 格式的指标数据：

```
GET /api/v1/metrics
```

- **Content-Type**: `text/plain; version=0.0.4; charset=utf-8`
- **认证**: 无需认证（公开端点，供 Prometheus 抓取）
- **格式**: Prometheus exposition format

### Prometheus 抓取配置

在 `prometheus.yml` 中添加以下配置：

```yaml
scrape_configs:
  - job_name: 'agent-platform'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3003']
    metrics_path: '/api/v1/metrics'
```

### 默认标签

所有指标自动附加以下默认标签：

| 标签 | 默认值 | 说明 |
|------|--------|------|
| `service_name` | `agent-platform` | 服务名称 |
| `version` | `0.6.0` | 平台版本号 |
| `instance` | `local-1` | 实例标识（取自 `HOSTNAME` 环境变量） |

### 指标前缀

所有指标名称以 `agent_platform_` 为前缀。下文中的指标名称均为完整名称。

## 核心业务指标

### agent_platform_request_total

| 属性 | 值 |
|------|-----|
| 类型 | Counter |
| 说明 | 请求总数 |

追踪平台接收到的所有请求的累计数量。用于计算请求速率（QPS）和观测流量变化。

**标签**:

| 标签 | 说明 |
|------|------|
| `service_name` | 服务名称 |
| `version` | 平台版本 |
| `instance` | 实例标识 |
| *(其他动态标签)* | 取决于记录时的上下文 |

**典型查询**:
```promql
# 每秒请求速率
rate(agent_platform_request_total[5m])

# 按实例分组统计
sum by (instance) (rate(agent_platform_request_total[5m]))
```

---

### agent_platform_request_duration_seconds

| 属性 | 值 |
|------|-----|
| 类型 | Histogram |
| 说明 | 请求耗时（秒） |

请求处理的耗时分布。内部使用 timer 类型记录，导出时转换为 histogram 格式。

**Histogram 桶边界**: `0.1, 0.25, 0.5, 1, 2.5, 5, 10`（秒）

**标签**:

| 标签 | 说明 |
|------|------|
| `service_name` | 服务名称 |
| `version` | 平台版本 |
| `instance` | 实例标识 |
| `le` | 桶上限（histogram 标准标签） |
| `spanType` | Span 类型 |
| `operation` | 操作名称 |
| `status` | 状态（`success` / `failed`） |

**导出格式**:
```
agent_platform_request_duration_seconds_bucket{le="0.1"} 5
agent_platform_request_duration_seconds_bucket{le="0.25"} 12
agent_platform_request_duration_seconds_bucket{le="+Inf"} 42
agent_platform_request_duration_seconds_sum 18.7
agent_platform_request_duration_seconds_count 42
```

**典型查询**:
```promql
# P95 延迟
histogram_quantile(0.95, rate(agent_platform_request_duration_seconds_bucket[5m]))

# 平均延迟
rate(agent_platform_request_duration_seconds_sum[5m])
  / rate(agent_platform_request_duration_seconds_count[5m])
```

---

### agent_platform_active_sessions

| 属性 | 值 |
|------|-----|
| 类型 | Gauge |
| 说明 | 当前活跃会话数 |

反映平台中正在进行交互的会话数量。Gauge 类型只保留每个标签组合的最新值。

**标签**:

| 标签 | 说明 |
|------|------|
| `service_name` | 服务名称 |
| `version` | 平台版本 |
| `instance` | 实例标识 |

**典型查询**:
```promql
# 当前活跃会话数
agent_platform_active_sessions

# 各实例活跃会话
agent_platform_active_sessions{instance="local-1"}
```

---

### agent_platform_workflow_runs_total

| 属性 | 值 |
|------|-----|
| 类型 | Counter |
| 说明 | 工作流运行总数 |

累计统计所有工作流的执行次数。配合 `rate()` 可以观测工作流执行频率。

**标签**:

| 标签 | 说明 |
|------|------|
| `service_name` | 服务名称 |
| `version` | 平台版本 |
| `instance` | 实例标识 |

**典型查询**:
```promql
# 每分钟工作流执行数
rate(agent_platform_workflow_runs_total[5m]) * 60
```

---

### agent_platform_connector_requests_total

| 属性 | 值 |
|------|-----|
| 类型 | Counter |
| 说明 | 连接器请求总数 |

统计通过连接器（GitHub、Google Calendar 等）发起的外部请求次数。

**标签**:

| 标签 | 说明 |
|------|------|
| `service_name` | 服务名称 |
| `version` | 平台版本 |
| `instance` | 实例标识 |
| `connectorId` | 连接器 ID |
| `operation` | 操作名称 |

**典型查询**:
```promql
# 按连接器分组的请求速率
sum by (connectorId) (rate(agent_platform_connector_requests_total[5m]))

# 连接器错误率
sum by (connectorId) (rate(agent_platform_connector_requests_total{status="failed"}[5m]))
  / sum by (connectorId) (rate(agent_platform_connector_requests_total[5m]))
```

---

### agent_platform_memory_usage_bytes

| 属性 | 值 |
|------|-----|
| 类型 | Gauge |
| 说明 | 当前内存使用量（字节） |

反映平台运行时的内存占用。用于监控内存泄漏和资源消耗。

**标签**:

| 标签 | 说明 |
|------|------|
| `service_name` | 服务名称 |
| `version` | 平台版本 |
| `instance` | 实例标识 |

**典型查询**:
```promql
# 内存使用量 (MB)
agent_platform_memory_usage_bytes / 1024 / 1024
```

---

### agent_platform_budget_usage_percent

| 属性 | 值 |
|------|-----|
| 类型 | Gauge |
| 说明 | 当前预算使用百分比 |

反映令牌消耗或 API 请求计数预算的使用比例。值范围 0 到 100。接近 100 表示即将超出预算限制。

**标签**:

| 标签 | 说明 |
|------|------|
| `service_name` | 服务名称 |
| `version` | 平台版本 |
| `instance` | 实例标识 |

**典型查询**:
```promql
# 预算使用率
agent_platform_budget_usage_percent

# 超过 80% 预算的实例
agent_platform_budget_usage_percent > 80
```

## 自动生成的指标

除了上述预定义指标外，TracingCollector 的 `withSpan` 方法会在每次操作执行后自动记录两类指标：

### 操作耗时指标

格式为 `{operation}_duration_ms`，类型为 histogram（timer 导出）。

**示例**:
- `agent_platform_gateway_request_duration_ms` 网关请求耗时
- `agent_platform_dispatch_to_foreground_duration_ms` 前台分发耗时
- `agent_platform_kernel_run_{agentId}_duration_ms` 内核运行耗时
- `agent_platform_execute_{toolName}_duration_ms` 工具执行耗时
- `agent_platform_workflow_{workflowId}_duration_ms` 工作流执行耗时
- `agent_platform_subagent_{agentType}_duration_ms` 子代理执行耗时
- `agent_platform_connector_{connectorId}_{operation}_duration_ms` 连接器调用耗时

**标签**:

| 标签 | 说明 |
|------|------|
| `spanType` | Span 类型（dispatch / tool_execution / kernel_run 等） |
| `operation` | 操作名称 |
| `status` | 执行结果（`success` / `failed`） |

### 操作错误指标

格式为 `{operation}_errors`，类型为 counter。

**示例**:
- `agent_platform_gateway_request_errors` 网关请求错误
- `agent_platform_execute_{toolName}_errors` 工具执行错误
- `agent_platform_connector_{connectorId}_{operation}_errors` 连接器调用错误

**标签**:

| 标签 | 说明 |
|------|------|
| `spanType` | Span 类型 |
| `operation` | 操作名称 |
| `error` | 错误信息 |

## 推荐 Grafana 仪表盘

### 仪表盘概览

建议创建一个名为 "Agent Platform Overview" 的仪表盘，包含以下面板：

#### 第一行: 流量概览

| 面板 | 类型 | 查询 | 说明 |
|------|------|------|------|
| 请求速率 | Time series | `sum(rate(agent_platform_request_total[5m]))` | 每秒请求数 |
| 活跃会话 | Stat | `agent_platform_active_sessions` | 当前会话数 |
| 工作流执行速率 | Time series | `sum(rate(agent_platform_workflow_runs_total[5m]))` | 每秒工作流执行数 |

#### 第二行: 延迟分布

| 面板 | 类型 | 查询 | 说明 |
|------|------|------|------|
| P50 延迟 | Time series | `histogram_quantile(0.5, sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le))` | 中位数延迟 |
| P95 延迟 | Time series | `histogram_quantile(0.95, sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le))` | P95 延迟 |
| P99 延迟 | Time series | `histogram_quantile(0.99, sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le))` | P99 延迟 |

#### 第三行: 资源使用

| 面板 | 类型 | 查询 | 说明 |
|------|------|------|------|
| 内存使用 | Gauge | `agent_platform_memory_usage_bytes / 1024 / 1024` | 内存占用 (MB) |
| 预算使用率 | Gauge | `agent_platform_budget_usage_percent` | 预算使用百分比 |
| 连接器请求 | Time series | `sum by (connectorId)(rate(agent_platform_connector_requests_total[5m]))` | 连接器调用速率 |

#### 第四行: 错误监控

| 面板 | 类型 | 查询 | 说明 |
|------|------|------|------|
| 错误速率 | Time series | `sum(rate(agent_platform_{operation}_errors[5m]))` | 各操作错误趋势 |
| 慢请求 | Table | `histogram_quantile(0.99, sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le, operation)) > 1` | P99 超过 1 秒的操作 |

### Grafana 仪表盘 JSON 模板

以下是一个可导入的仪表盘 JSON：

```json
{
  "dashboard": {
    "title": "Agent Platform Overview",
    "tags": ["agent-platform", "prometheus"],
    "timezone": "browser",
    "panels": [
      {
        "title": "请求速率 (req/s)",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 8, "x": 0, "y": 0 },
        "targets": [
          {
            "expr": "sum(rate(agent_platform_request_total[5m]))",
            "legendFormat": "总请求速率"
          }
        ]
      },
      {
        "title": "活跃会话",
        "type": "stat",
        "gridPos": { "h": 8, "w": 4, "x": 8, "y": 0 },
        "targets": [
          {
            "expr": "agent_platform_active_sessions",
            "legendFormat": "活跃会话"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "steps": [
                { "color": "green", "value": null },
                { "color": "yellow", "value": 50 },
                { "color": "red", "value": 100 }
              ]
            }
          }
        }
      },
      {
        "title": "预算使用率 (%)",
        "type": "gauge",
        "gridPos": { "h": 8, "w": 4, "x": 12, "y": 0 },
        "targets": [
          {
            "expr": "agent_platform_budget_usage_percent",
            "legendFormat": "预算使用"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "percent",
            "min": 0,
            "max": 100,
            "thresholds": {
              "steps": [
                { "color": "green", "value": null },
                { "color": "yellow", "value": 70 },
                { "color": "red", "value": 90 }
              ]
            }
          }
        }
      },
      {
        "title": "请求延迟分布",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 12, "x": 0, "y": 8 },
        "targets": [
          {
            "expr": "histogram_quantile(0.5, sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le))",
            "legendFormat": "P50"
          },
          {
            "expr": "histogram_quantile(0.95, sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le))",
            "legendFormat": "P95"
          },
          {
            "expr": "histogram_quantile(0.99, sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le))",
            "legendFormat": "P99"
          }
        ],
        "fieldConfig": {
          "defaults": { "unit": "s" }
        }
      },
      {
        "title": "内存使用 (MB)",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 12, "x": 12, "y": 8 },
        "targets": [
          {
            "expr": "agent_platform_memory_usage_bytes / 1024 / 1024",
            "legendFormat": "{{instance}}"
          }
        ],
        "fieldConfig": {
          "defaults": { "unit": "decmbytes" }
        }
      },
      {
        "title": "连接器请求速率",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 12, "x": 0, "y": 16 },
        "targets": [
          {
            "expr": "sum by (connectorId)(rate(agent_platform_connector_requests_total[5m]))",
            "legendFormat": "{{connectorId}}"
          }
        ]
      },
      {
        "title": "工作流执行速率",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 12, "x": 12, "y": 16 },
        "targets": [
          {
            "expr": "sum(rate(agent_platform_workflow_runs_total[5m]))",
            "legendFormat": "工作流/秒"
          }
        ]
      }
    ],
    "refresh": "10s",
    "time": { "from": "now-1h", "to": "now" }
  }
}
```

## 告警规则配置

平台内置了告警引擎，支持基于指标的告警规则。告警规则通过 API 管理：

### 告警规则管理

```bash
# 列出所有告警规则
GET /api/v1/alerts/rules

# 获取特定规则
GET /api/v1/alerts/rules/:ruleId

# 创建告警规则
POST /api/v1/alerts/rules
Content-Type: application/json
{
  "id": "high-error-rate",
  "name": "高错误率告警",
  "metricName": "gateway_request_errors",
  "conditionType": "threshold",
  "operator": ">",
  "threshold": 10,
  "windowSeconds": 300,
  "severity": "critical",
  "webhookUrl": "https://hooks.slack.com/...",
  "labels": { "team": "platform" },
  "enabled": true
}

# 删除告警规则
DELETE /api/v1/alerts/rules/:ruleId

# 手动触发告警评估
POST /api/v1/alerts/evaluate

# 查看告警状态
GET /api/v1/alerts/state
```

### 告警条件类型

| 类型 | 说明 | 必填字段 |
|------|------|----------|
| `threshold` | 指标值超过阈值 | `operator`, `threshold` |
| `rate` | 指标变化速率超过阈值 | `operator`, `threshold`, `windowSeconds` |
| `absence` | 指标在时间窗口内未出现 | `windowSeconds` |

### 推荐告警规则

| 规则名称 | 指标 | 条件 | 建议阈值 | 严重度 |
|----------|------|------|----------|--------|
| 高请求延迟 | `request_duration_seconds` | threshold | P95 > 5s | warning |
| 预算即将耗尽 | `budget_usage_percent` | threshold | > 90% | critical |
| 错误率飙升 | `*_errors` | rate | 5 分钟内增长 > 10 | critical |
| 连接器不可用 | `connector_requests_total` | absence | 5 分钟内无数据 | warning |

## 指标导出配置

Prometheus 导出器支持以下配置项：

```typescript
interface PrometheusConfig {
  // 应用于所有指标的默认标签
  defaultLabels?: Record<string, string>;

  // 指标名称前缀（默认: 'agent_platform_'）
  metricPrefix?: string;

  // 是否在导出数据中包含时间戳（默认: false）
  includeTimestamp?: boolean;
}
```

### 自定义配置示例

如果需要在代码中创建自定义的 Prometheus 导出器：

```typescript
import { createPrometheusExporter } from './observability/prometheus-exporter.js';
import { createMetricStore } from './observability/metric-store.js';

const metricStore = createMetricStore(connection);
const exporter = createPrometheusExporter({
  metricStore,
  config: {
    defaultLabels: {
      service_name: 'agent-platform',
      version: '1.0.0',
      instance: process.env.HOSTNAME || 'local-1',
    },
    metricPrefix: 'agent_platform_',
    includeTimestamp: true,
  },
});

// 导出所有指标
const output = exporter.export();

// 只导出指定指标
const partial = exporter.exportMetrics(['request_total', 'request_duration_seconds']);
```

## Histogram 桶边界

当前 histogram 使用的桶边界：

```
0.1, 0.25, 0.5, 1, 2.5, 5, 10
```

这意味着：
- 0 到 0.1 秒的请求会落入第一个桶
- 0.1 到 0.25 秒的请求落入第二个桶
- 以此类推
- 超过 10 秒的请求落入 `+Inf` 桶

如果需要调整桶边界，需修改 `src/observability/prometheus-exporter.ts` 中的 `HISTOGRAM_BUCKETS` 常量。

## 指标存储

指标数据存储在 SQLite 数据库的 `metrics` 表中，字段如下：

| 字段 | 类型 | 说明 |
|------|------|------|
| `metric_id` | TEXT | 指标唯一 ID |
| `trace_id` | TEXT | 关联追踪 ID |
| `span_id` | TEXT | 关联 Span ID |
| `module` | TEXT | 来源模块 |
| `metric_type` | TEXT | 指标类型 (counter/gauge/histogram/timer) |
| `name` | TEXT | 指标名称 |
| `value` | REAL | 指标值 |
| `unit` | TEXT | 单位 |
| `timestamp` | TEXT | 时间戳 |
| `labels` | TEXT | 标签（JSON 格式） |

### 来源模块

指标可能来自以下模块：

| 模块 | 说明 |
|------|------|
| `gateway` | 请求网关 |
| `foreground_agent` | 前台代理 |
| `planner` | 任务规划器 |
| `dispatcher` | 任务分发器 |
| `kernel` | 核心执行引擎 |
| `tool` | 工具执行 |
| `workflow` | 工作流引擎 |
| `subagent` | 子代理 |
| `trigger` | 触发器 |
| `connector` | 连接器 |
| `permission` | 权限检查 |
| `memory` | 内存/缓存管理 |

## 常见问题

### 为什么指标端点返回空数据？

指标端点从 `metrics` 表中读取数据。如果平台刚启动且没有执行过任何操作，表内没有记录，端点会返回空内容。等有请求进来后，指标数据会自动产生。

### 如何只获取特定指标？

当前 `/api/v1/metrics` 端点返回所有指标。如果需要按名称过滤，可以使用 `exportMetrics(metricNames)` 方法创建自定义端点，或在 Prometheus 侧使用 `metric_relabel_configs` 过滤。

### 指标数据如何清理？

平台支持通过 `MetricStore` 的查询和聚合接口按时间范围检索数据。如需设置数据保留策略，可结合 SQLite 的定期清理任务实现。
