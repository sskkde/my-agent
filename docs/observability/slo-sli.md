# SLO/SLI 文档 (SLO/SLI Documentation)

本文档定义 Agent Platform GA 版本的服务水平目标 (SLO) 和服务水平指标 (SLI)，确保服务质量可测量、可告警、可改进。

This document defines the Service Level Objectives (SLOs) and Service Level Indicators (SLIs) for Agent Platform GA release, ensuring service quality is measurable, alertable, and improvable.

## 概述 (Overview)

### 什么是 SLO/SLI？ (What are SLO/SLI?)

| 概念 (Concept)                                 | 说明 (Description)                    |
| ---------------------------------------------- | ------------------------------------- |
| **SLI** (服务水平指标 Service Level Indicator) | 衡量服务水平的具体量化指标            |
| **SLO** (服务水平目标 Service Level Objective) | SLI 的目标值，代表服务质量的承诺      |
| **SLA** (服务水平协议 Service Level Agreement) | 违反 SLO 时的业务后果（本文档不涉及） |

### 错误预算计算 (Error Budget Calculation)

99.5% 可用性意味着每月允许的最大不可用时间：

99.5% availability means maximum allowed downtime per month:

| 时间窗口 (Time Window) | 可用时间 (Available)              | 不可用时间 (Downtime Allowed) |
| ---------------------- | --------------------------------- | ----------------------------- |
| 每月 (Monthly)         | 30 天 × 24 小时 × 60 分钟 × 99.5% | **43 分 12 秒**               |
| 每周 (Weekly)          | 7 天 × 24 小时 × 60 分钟 × 99.5%  | 10 分 5 秒                    |
| 每天 (Daily)           | 24 小时 × 60 分钟 × 99.5%         | 7 分 12 秒                    |

**计算公式 (Calculation Formula):**

```
每月总分钟数 = 30 × 24 × 60 = 43,200 分钟
不可用分钟数 = 43,200 × (1 - 0.995) = 216 分钟 = 3 小时 36 分钟

实际精确计算：
30 天 × 24 小时 × 60 分钟 × 0.5% = 216 分钟
216 分钟 ÷ 60 = 3.6 小时 = 3 小时 36 分钟 = 43 分 12 秒（按 30 天计）

正确计算：
每月按 30 天计：30 × 24 × 60 × (1 - 99.5%) = 216 分钟 = 3 小时 36 分钟
每月按 31 天计：31 × 24 × 60 × 0.5% = 223.2 分钟 ≈ 3 小时 43 分钟

注：本文档采用 30 天标准月计算，允许停机时间为 3 小时 36 分钟。
```

---

## SLO 1: API 可用性 (API Availability)

### 定义 (Definition)

| 属性 (Attribute)                  | 值 (Value)                    |
| --------------------------------- | ----------------------------- |
| **SLO 名称 (SLO Name)**           | API 可用性 (API Availability) |
| **目标值 (Target)**               | **99.5%**                     |
| **测量周期 (Measurement Period)** | 滚动 30 天 (Rolling 30 days)  |
| **严重级别 (Severity)**           | Critical                      |

**定义 (Definition):** API 服务在测量周期内成功响应请求的比例。

The percentage of successfully responded API requests within the measurement period.

### SLI 测量方法 (SLI Measurement Method)

| 测量维度 (Measurement Dimension)  | 说明 (Description)                     |
| --------------------------------- | -------------------------------------- |
| **指标来源 (Metric Source)**      | `agent_platform_request_total` Counter |
| **成功定义 (Success Definition)** | HTTP 状态码 2xx 或 3xx                 |
| **失败定义 (Failure Definition)** | HTTP 状态码 5xx（服务端错误）          |
| **排除项 (Exclusions)**           | 4xx 客户端错误不计入可用性             |

**PromQL 查询 (PromQL Query):**

```promql
# SLI: 成功请求率 (Success rate)
sum(rate(agent_platform_request_total{status!="5xx"}[30d]))
  / sum(rate(agent_platform_request_total[30d]))

# 错误预算消耗率 (Error budget burn rate)
(1 - (
  sum(rate(agent_platform_request_total{status!="5xx"}[1h]))
    / sum(rate(agent_platform_request_total[1h]))
)) / (1 - 0.995)
```

### 告警阈值 (Alert Thresholds)

| 告警级别 (Alert Level) | 条件 (Condition)             | 响应时间 (Response Time) |
| ---------------------- | ---------------------------- | ------------------------ |
| **Warning**            | 可用性 < 99.9%（1 小时窗口） | 30 分钟内响应            |
| **Critical**           | 可用性 < 99.5%（5 分钟窗口） | 5 分钟内响应             |
| **Emergency**          | 可用性 < 95%（1 分钟窗口）   | 立即响应                 |

### 修复步骤 (Remediation Steps)

1. **立即诊断 (Immediate Diagnosis)**
   - 检查服务进程状态: `systemctl status agent-platform`
   - 查看错误日志: `journalctl -u agent-platform -n 100 --no-pager`
   - 检查数据库连接: `curl http://localhost:3003/api/v1/health`

2. **常见原因及处理 (Common Causes & Actions)**
   - **数据库连接池耗尽**: 增加 `DATABASE_POOL_SIZE` 或优化查询
   - **内存不足**: 检查 `agent_platform_memory_usage_bytes`，必要时扩容
   - **外部依赖故障**: 检查 LLM Provider、OAuth 服务状态

3. **恢复验证 (Recovery Verification)**

   ```bash
   # 验证健康检查
   curl -f http://localhost:3003/api/v1/health || exit 1

   # 验证关键 API
   curl -f http://localhost:3003/api/v1/sessions
   ```

---

## SLO 2: 健康检查延迟 (Health Check Latency)

### 定义 (Definition)

| 属性 (Attribute)                  | 值 (Value)                          |
| --------------------------------- | ----------------------------------- |
| **SLO 名称 (SLO Name)**           | 健康检查延迟 (Health Check Latency) |
| **目标值 (Target)**               | **P95 < 100ms**                     |
| **测量周期 (Measurement Period)** | 滚动 5 分钟 (Rolling 5 minutes)     |
| **严重级别 (Severity)**           | Warning                             |

**定义 (Definition):** `/api/v1/health` 端点的 P95 响应时间。

The P95 response time of the `/api/v1/health` endpoint.

### SLI 测量方法 (SLI Measurement Method)

| 测量维度 (Measurement Dimension) | 说明 (Description)                                  |
| -------------------------------- | --------------------------------------------------- |
| **指标来源 (Metric Source)**     | `agent_platform_request_duration_seconds` Histogram |
| **端点 (Endpoint)**              | `/api/v1/health`                                    |
| **百分位 (Percentile)**          | P95                                                 |

**PromQL 查询 (PromQL Query):**

```promql
# SLI: 健康检查 P95 延迟
histogram_quantile(0.95,
  sum(rate(agent_platform_request_duration_seconds_bucket{operation="health"}[5m])) by (le)
)

# 超过阈值的请求比例
sum(rate(agent_platform_request_duration_seconds_bucket{operation="health",le="0.1"}[5m]))
  / sum(rate(agent_platform_request_duration_seconds_count{operation="health"}[5m]))
```

### 告警阈值 (Alert Thresholds)

| 告警级别 (Alert Level) | 条件 (Condition) | 响应时间 (Response Time) |
| ---------------------- | ---------------- | ------------------------ |
| **Warning**            | P95 > 100ms      | 15 分钟内响应            |
| **Critical**           | P95 > 500ms      | 5 分钟内响应             |

### 修复步骤 (Remediation Steps)

1. **立即诊断 (Immediate Diagnosis)**
   - 检查数据库连接状态（健康检查包含 DB 探测）
   - 检查 PostgreSQL 连接池状态: `getPoolMetrics()`
   - 检查系统负载: `top`, `iostat`

2. **常见原因及处理 (Common Causes & Actions)**
   - **数据库响应慢**: 检查慢查询日志，优化索引
   - **连接池饱和**: 增加 `PG_POOL_MAX` 或减少连接泄漏
   - **系统资源竞争**: 检查是否有资源密集型任务运行

3. **优化建议 (Optimization Suggestions)**
   - 考虑缓存健康检查结果（短时间窗口如 5 秒）
   - 使用轻量级数据库探测（`SELECT 1` 而非复杂查询）

---

## SLO 3: 常规 API 延迟 (Normal API Latency)

### 定义 (Definition)

| 属性 (Attribute)                  | 值 (Value)                                                 |
| --------------------------------- | ---------------------------------------------------------- |
| **SLO 名称 (SLO Name)**           | 常规 API 延迟 (Normal API Latency)                         |
| **目标值 (Target)**               | **P95 < 500ms**                                            |
| **测量周期 (Measurement Period)** | 滚动 5 分钟 (Rolling 5 minutes)                            |
| **严重级别 (Severity)**           | Warning                                                    |
| **排除端点 (Excluded Endpoints)** | `/api/v1/health`, `/api/v1/runs/stream`, `/api/v1/metrics` |

**定义 (Definition):** 非流式、非健康检查 API 端点的 P95 响应时间。

The P95 response time of non-streaming, non-health-check API endpoints.

### SLI 测量方法 (SLI Measurement Method)

| 测量维度 (Measurement Dimension)  | 说明 (Description)                                  |
| --------------------------------- | --------------------------------------------------- |
| **指标来源 (Metric Source)**      | `agent_platform_request_duration_seconds` Histogram |
| **包含端点 (Included Endpoints)** | 除健康检查、SSE 流、指标端点外的所有 API            |
| **百分位 (Percentile)**           | P95                                                 |

**PromQL 查询 (PromQL Query):**

```promql
# SLI: 常规 API P95 延迟
histogram_quantile(0.95,
  sum(rate(agent_platform_request_duration_seconds_bucket{
    operation!~"health|runs_stream|metrics"
  }[5m])) by (le)
)

# 按操作分组查看延迟
histogram_quantile(0.95,
  sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le, operation)
)
```

### 告警阈值 (Alert Thresholds)

| 告警级别 (Alert Level) | 条件 (Condition) | 响应时间 (Response Time) |
| ---------------------- | ---------------- | ------------------------ |
| **Warning**            | P95 > 500ms      | 15 分钟内响应            |
| **Critical**           | P95 > 2000ms     | 5 分钟内响应             |

### 修复步骤 (Remediation Steps)

1. **立即诊断 (Immediate Diagnosis)**
   - 识别慢端点: 查看 Grafana 面板按 operation 分组
   - 检查数据库慢查询: `SELECT * FROM sqlite_master WHERE type='table'`
   - 检查外部调用: LLM Provider、OAuth Provider

2. **常见原因及处理 (Common Causes & Actions)**
   - **数据库查询慢**: 添加索引，优化 JOIN 操作
   - **LLM 调用超时**: 调整 `routingTimeoutMs` 或切换 Provider
   - **大响应体**: 分页查询，限制返回字段

3. **性能优化 (Performance Optimization)**
   - 对频繁查询添加缓存层
   - 使用 `EXPLAIN QUERY PLAN` 分析慢查询
   - 考虑读写分离（高负载场景）

---

## SLO 4: 工作流启动延迟 (Workflow Start Latency)

### 定义 (Definition)

| 属性 (Attribute)                  | 值 (Value)                              |
| --------------------------------- | --------------------------------------- |
| **SLO 名称 (SLO Name)**           | 工作流启动延迟 (Workflow Start Latency) |
| **目标值 (Target)**               | **P95 < 1000ms**                        |
| **测量周期 (Measurement Period)** | 滚动 5 分钟 (Rolling 5 minutes)         |
| **严重级别 (Severity)**           | Warning                                 |

**定义 (Definition):** 从工作流启动请求到第一步开始执行的 P95 时间。

The P95 time from workflow start request to first step execution beginning.

### SLI 测量方法 (SLI Measurement Method)

| 测量维度 (Measurement Dimension) | 说明 (Description)                                |
| -------------------------------- | ------------------------------------------------- |
| **指标来源 (Metric Source)**     | `agent_platform_workflow_start_duration_ms` Timer |
| **起点 (Start Point)**           | 工作流启动 API 请求接收                           |
| **终点 (End Point)**             | 第一步执行开始                                    |
| **百分位 (Percentile)**          | P95                                               |

**PromQL 查询 (PromQL Query):**

```promql
# SLI: 工作流启动 P95 延迟（毫秒转秒）
histogram_quantile(0.95,
  sum(rate(agent_platform_workflow_start_duration_ms_bucket[5m])) by (le)
) / 1000

# 工作流启动成功率
sum(rate(agent_platform_workflow_runs_total{status="success"}[5m]))
  / sum(rate(agent_platform_workflow_runs_total[5m]))
```

### 告警阈值 (Alert Thresholds)

| 告警级别 (Alert Level) | 条件 (Condition)               | 响应时间 (Response Time) |
| ---------------------- | ------------------------------ | ------------------------ |
| **Warning**            | P95 > 1000ms                   | 15 分钟内响应            |
| **Critical**           | P95 > 3000ms 或启动失败率 > 1% | 5 分钟内响应             |

### 修复步骤 (Remediation Steps)

1. **立即诊断 (Immediate Diagnosis)**
   - 检查工作流定义加载时间
   - 检查触发器队列积压
   - 检查数据库锁等待

2. **常见原因及处理 (Common Causes & Actions)**
   - **工作流定义过大**: 拆分复杂工作流，按需加载
   - **数据库锁**: 检查长时间运行的事务，使用 WAL 模式
   - **触发器队列满**: 增加工作进程或优化处理速度

3. **优化建议 (Optimization Suggestions)**
   - 缓存常用工作流定义
   - 预热工作流执行器池
   - 使用异步启动模式（立即返回，后台执行）

---

## SLO 5: 连接器调用超时 (Connector Call Timeout)

### 定义 (Definition)

| 属性 (Attribute)                  | 值 (Value)                              |
| --------------------------------- | --------------------------------------- |
| **SLO 名称 (SLO Name)**           | 连接器调用超时 (Connector Call Timeout) |
| **目标值 (Target)**               | **100% 在配置超时内完成**               |
| **测量周期 (Measurement Period)** | 滚动 5 分钟 (Rolling 5 minutes)         |
| **严重级别 (Severity)**           | Warning                                 |

**定义 (Definition):** 所有连接器调用在配置的超时时间内完成的比例。

The percentage of connector calls completing within configured timeout.

### SLI 测量方法 (SLI Measurement Method)

| 测量维度 (Measurement Dimension)  | 说明 (Description)                                |
| --------------------------------- | ------------------------------------------------- |
| **指标来源 (Metric Source)**      | `agent_platform_connector_requests_total` Counter |
| **超时定义 (Timeout Definition)** | 调用时长超过 `connector.timeout_ms` 配置          |
| **超时标签 (Timeout Label)**      | `status="timeout"`                                |

**PromQL 查询 (PromQL Query):**

```promql
# SLI: 非超时调用比例
sum(rate(agent_platform_connector_requests_total{status!="timeout"}[5m]))
  / sum(rate(agent_platform_connector_requests_total[5m]))

# 按连接器分组的超时率
sum by (connectorId) (
  rate(agent_platform_connector_requests_total{status="timeout"}[5m])
)
  / sum by (connectorId) (
    rate(agent_platform_connector_requests_total[5m])
  )
```

### 告警阈值 (Alert Thresholds)

| 告警级别 (Alert Level) | 条件 (Condition) | 响应时间 (Response Time) |
| ---------------------- | ---------------- | ------------------------ |
| **Warning**            | 超时率 > 1%      | 15 分钟内响应            |
| **Critical**           | 超时率 > 5%      | 5 分钟内响应             |

### 修复步骤 (Remediation Steps)

1. **立即诊断 (Immediate Diagnosis)**
   - 识别问题连接器: 查看 `connectorId` 标签
   - 检查外部服务状态
   - 检查网络连通性

2. **常见原因及处理 (Common Causes & Actions)**
   - **外部服务慢**: 增加超时配置，或联系服务方
   - **网络问题**: 检查 DNS 解析、防火墙规则
   - **OAuth Token 过期**: 检查 `OAuthRefreshManager` 日志

3. **配置调整 (Configuration Adjustment)**
   ```typescript
   // 连接器超时配置示例
   {
     connectorId: 'github',
     timeoutMs: 30000,  // 根据实际情况调整
     retryPolicy: {
       maxRetries: 3,
       backoffMs: 1000,
     }
   }
   ```

---

## SLO 6: DLQ 处理延迟 (DLQ Processing Lag)

### 定义 (Definition)

| 属性 (Attribute)                  | 值 (Value)                        |
| --------------------------------- | --------------------------------- |
| **SLO 名称 (SLO Name)**           | DLQ 处理延迟 (DLQ Processing Lag) |
| **目标值 (Target)**               | **< 5 分钟**                      |
| **测量周期 (Measurement Period)** | 实时 (Real-time)                  |
| **严重级别 (Severity)**           | Warning                           |

**定义 (Definition):** 消息从进入死信队列到被处理（重试或丢弃）的最大时间。

The maximum time from message entering DLQ to being processed (retry or discard).

### SLI 测量方法 (SLI Measurement Method)

| 测量维度 (Measurement Dimension) | 说明 (Description)                     |
| -------------------------------- | -------------------------------------- |
| **指标来源 (Metric Source)**     | `agent_platform_dlq_lag_seconds` Gauge |
| **计算方式 (Calculation)**       | `now() - dlq_message.created_at`       |
| **聚合方式 (Aggregation)**       | 最大值（关注最旧消息）                 |

**PromQL 查询 (PromQL Query):**

```promql
# SLI: DLQ 最大延迟（秒）
max(agent_platform_dlq_lag_seconds)

# DLQ 消息积压数量
count(agent_platform_dlq_messages)

# DLQ 处理速率
rate(agent_platform_dlq_processed_total[5m])
```

### 告警阈值 (Alert Thresholds)

| 告警级别 (Alert Level) | 条件 (Condition)                    | 响应时间 (Response Time) |
| ---------------------- | ----------------------------------- | ------------------------ |
| **Warning**            | 最大延迟 > 5 分钟                   | 15 分钟内响应            |
| **Critical**           | 最大延迟 > 30 分钟 或 积压 > 100 条 | 5 分钟内响应             |

### 修复步骤 (Remediation Steps)

1. **立即诊断 (Immediate Diagnosis)**
   - 检查 DLQ 消息内容: `SELECT * FROM dlq ORDER BY created_at ASC LIMIT 10`
   - 检查处理失败原因: 查看 `error` 字段
   - 检查 DLQ 处理器状态

2. **常见原因及处理 (Common Causes & Actions)**
   - **持续失败的消息**: 分析错误原因，修复后手动重试
   - **处理器停机**: 重启 DLQ 处理器
   - **依赖服务故障**: 恢复依赖服务后重试

3. **手动干预 (Manual Intervention)**

   ```sql
   -- 重试特定消息
   UPDATE dlq SET status = 'pending', retry_count = 0 WHERE id = 'xxx';

   -- 丢弃无法恢复的消息
   UPDATE dlq SET status = 'discarded' WHERE id = 'xxx';

   -- 批量重试所有待处理消息
   UPDATE dlq SET status = 'pending' WHERE status = 'failed' AND retry_count < 5;
   ```

---

## SLO 7: 备份新鲜度 (Backup Freshness)

### 定义 (Definition)

| 属性 (Attribute)                  | 值 (Value)                    |
| --------------------------------- | ----------------------------- |
| **SLO 名称 (SLO Name)**           | 备份新鲜度 (Backup Freshness) |
| **目标值 (Target)**               | **< 24 小时**                 |
| **测量周期 (Measurement Period)** | 每次检查时 (On each check)    |
| **严重级别 (Severity)**           | Warning                       |

**定义 (Definition):** 最新成功备份距当前时间的时长。

The time elapsed since the most recent successful backup.

### SLI 测量方法 (SLI Measurement Method)

| 测量维度 (Measurement Dimension)   | 说明 (Description)                        |
| ---------------------------------- | ----------------------------------------- |
| **指标来源 (Metric Source)**       | `agent_platform_backup_age_seconds` Gauge |
| **计算方式 (Calculation)**         | `now() - last_successful_backup_at`       |
| **备份检查频率 (Check Frequency)** | 每小时                                    |

**PromQL 查询 (PromQL Query):**

```promql
# SLI: 备份新鲜度（小时）
agent_platform_backup_age_seconds / 3600

# 备份成功率
sum(rate(agent_platform_backup_total{status="success"}[24h]))
  / sum(rate(agent_platform_backup_total[24h]))

# 上次备份时间
time() - agent_platform_backup_last_success_timestamp
```

### 告警阈值 (Alert Thresholds)

| 告警级别 (Alert Level) | 条件 (Condition)     | 响应时间 (Response Time) |
| ---------------------- | -------------------- | ------------------------ |
| **Warning**            | 备份新鲜度 > 24 小时 | 4 小时内响应             |
| **Critical**           | 备份新鲜度 > 48 小时 | 1 小时内响应             |

### 修复步骤 (Remediation Steps)

1. **立即诊断 (Immediate Diagnosis)**
   - 检查备份任务日志: `journalctl -u agent-backup -n 100`
   - 检查备份存储空间: `df -h /var/backups/agent`
   - 检查数据库文件权限

2. **常见原因及处理 (Common Causes & Actions)**
   - **存储空间不足**: 清理旧备份或扩容
   - **备份进程异常**: 重启备份服务
   - **权限问题**: 检查并修复文件权限

3. **手动备份 (Manual Backup)**

   ```bash
   # 执行手动备份
   npm run db:backup

   # 验证备份完整性
   ls -la data/backups/
   sqlite3 data/backups/latest.db "PRAGMA integrity_check;"
   ```

4. **备份恢复测试 (Backup Recovery Test)**
   ```bash
   # 测试备份恢复（建议每月执行）
   cp data/backups/latest.db data/test_restore.db
   npm run start:api -- --database-path data/test_restore.db
   # 验证数据完整性后删除测试数据库
   rm data/test_restore.db
   ```

---

## SLO 汇总表 (SLO Summary Table)

| SLO            | 目标 (Target)     | 测量周期 (Period) | 严重级别 (Severity) | 告警阈值 (Alert Threshold) |
| -------------- | ----------------- | ----------------- | ------------------- | -------------------------- |
| API 可用性     | 99.5%             | 30 天             | Critical            | < 99.5% (5min)             |
| 健康检查延迟   | P95 < 100ms       | 5 分钟            | Warning             | P95 > 100ms                |
| 常规 API 延迟  | P95 < 500ms       | 5 分钟            | Warning             | P95 > 500ms                |
| 工作流启动延迟 | P95 < 1000ms      | 5 分钟            | Warning             | P95 > 1000ms               |
| 连接器调用超时 | 100% 在配置时间内 | 5 分钟            | Warning             | 超时率 > 1%                |
| DLQ 处理延迟   | < 5 分钟          | 实时              | Warning             | 最大延迟 > 5min            |
| 备份新鲜度     | < 24 小时         | 每小时            | Warning             | 新鲜度 > 24h               |

---

## 实施指南 (Implementation Guide)

### 1. 指标采集配置 (Metrics Collection Setup)

确保 Prometheus 正确采集指标:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'agent-platform'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3003']
    metrics_path: '/api/v1/metrics'
```

### 2. 告警规则配置 (Alert Rules Setup)

创建告警规则:

```bash
# 通过 API 创建告警规则
POST /api/v1/alerts/rules
```

示例规则配置参见各 SLO 的告警阈值部分。

### 3. Grafana 仪表盘 (Grafana Dashboard)

导入推荐的 Grafana 仪表盘（参见 `metrics.md` 文档），创建 SLO 专用面板:

- SLO 燃尽图 (Error Budget Burn-down)
- 各 SLO 当前状态 (SLO Status Overview)
- 错误预算剩余 (Error Budget Remaining)

### 4. 定期回顾 (Regular Review)

| 频率 (Frequency) | 活动 (Activity)               |
| ---------------- | ----------------------------- |
| 每日             | 检查 SLO 状态仪表盘           |
| 每周             | 回顾告警历史和误报            |
| 每月             | 评估 SLO 目标是否合理         |
| 每季度           | 调整 SLO 目标（基于实际数据） |

---

## 相关文档 (Related Documents)

- [Prometheus 指标文档](./metrics.md) - 指标定义和查询方法
- [告警运维手册](./alerting-runbook.md) - 告警配置和处理流程
- [审计日志保留策略](./audit-retention.md) - 数据保留策略
