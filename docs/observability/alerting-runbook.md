# 告警运维手册

本手册介绍 Agent Platform 告警系统的配置、使用和故障处理方法。

## 概述

告警系统基于指标监控实现自动化告警检测和通知。系统支持三种告警条件类型,可通过 Webhook 发送告警通知到外部系统。

## 告警规则配置

### 规则结构

每条告警规则包含以下字段:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 规则唯一标识符 |
| `name` | string | 是 | 规则名称,用于显示 |
| `description` | string | 否 | 规则描述 |
| `metricName` | string | 是 | 监控的指标名称 |
| `metricModule` | string | 否 | 指标来源模块过滤 |
| `conditionType` | string | 是 | 条件类型: `threshold`/`rate`/`absence` |
| `operator` | string | 条件相关 | 比较运算符: `>`/`<`/`>=`/`<=`/`==` |
| `threshold` | number | 是 | 阈值 |
| `windowSeconds` | number | 是 | 评估时间窗口(秒) |
| `severity` | string | 是 | 严重级别: `critical`/`warning`/`info` |
| `webhookUrl` | string | 否 | Webhook 通知地址 |
| `labels` | object | 是 | 标签键值对 |
| `enabled` | boolean | 是 | 是否启用 |

### 创建告警规则示例

```typescript
const rule: AlertRule = {
  id: 'high-error-rate',
  name: '高错误率告警',
  description: '当 API 错误率超过 5% 时触发',
  metricName: 'api.errors',
  conditionType: 'threshold',
  operator: '>',
  threshold: 0.05,
  windowSeconds: 300,  // 5分钟窗口
  severity: 'critical',
  webhookUrl: 'https://hooks.example.com/alert',
  labels: { team: 'backend', service: 'api' },
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
```

## 告警条件类型

### 1. 阈值告警 (threshold)

当指标值超过或低于指定阈值时触发。

**工作原理:**
- 在时间窗口内计算指标平均值
- 使用运算符比较平均值与阈值
- 满足条件则触发告警

**配置示例:**

```typescript
// CPU 使用率超过 80%
{
  conditionType: 'threshold',
  metricName: 'system.cpu_usage',
  operator: '>',
  threshold: 0.8,
  windowSeconds: 60,
}

// 可用内存低于 10%
{
  conditionType: 'threshold',
  metricName: 'system.memory_available',
  operator: '<',
  threshold: 0.1,
  windowSeconds: 60,
}
```

**支持的运算符:**

| 运算符 | 含义 | 使用场景 |
|--------|------|----------|
| `>` | 大于 | 资源使用率过高、错误率过高 |
| `<` | 小于 | 可用资源过低、成功率过低 |
| `>=` | 大于等于 | 达到或超过阈值 |
| `<=` | 小于等于 | 降至或低于阈值 |
| `==` | 等于 | 精确匹配特定值 |

### 2. 速率告警 (rate)

检测指标变化速率,适用于检测突发增长或下降。

**工作原理:**
- 将时间窗口分为前后两半
- 计算后半段与前半段的差值
- 差值超过阈值则触发告警

**配置示例:**

```typescript
// 错误数快速增长
{
  conditionType: 'rate',
  metricName: 'api.errors',
  operator: '>',
  threshold: 100,  // 突增超过100个错误
  windowSeconds: 600,  // 10分钟窗口
}

// 请求量骤降
{
  conditionType: 'rate',
  metricName: 'api.requests',
  operator: '<',
  threshold: -1000,  // 减少超过1000请求
  windowSeconds: 300,
}
```

**典型场景:**
- 错误数突增检测
- 流量骤降检测
- 资源消耗快速增长

### 3. 缺失告警 (absence)

当指定时间窗口内没有指标数据时触发。

**工作原理:**
- 查询时间窗口内的指标数据
- 数据为空则触发告警

**配置示例:**

```typescript
// 心跳检测 - 30秒无心跳则告警
{
  conditionType: 'absence',
  metricName: 'service.heartbeat',
  windowSeconds: 30,
  severity: 'critical',
}

// 定时任务未执行
{
  conditionType: 'absence',
  metricName: 'job.cleanup.completed',
  windowSeconds: 3600,  // 1小时内应执行
  severity: 'warning',
}
```

**典型场景:**
- 服务存活检测(心跳)
- 定时任务执行检测
- 数据采集检测

## Webhook 通知配置

### 配置 Webhook

在告警规则中设置 `webhookUrl` 字段:

```typescript
const rule: AlertRule = {
  // ... 其他字段
  webhookUrl: 'https://your-webhook-endpoint.com/alerts',
};
```

### Webhook 请求格式

告警触发或恢复时,系统发送 POST 请求:

```json
{
  "ruleId": "high-error-rate",
  "ruleName": "高错误率告警",
  "severity": "critical",
  "state": "firing",
  "previousState": "idle",
  "value": 0.08,
  "threshold": 0.05,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "labels": {
    "team": "backend",
    "service": "api"
  },
  "firedAt": "2024-01-15T10:30:00.000Z",
  "resolvedAt": null
}
```

### 状态说明

| 状态 | 含义 |
|------|------|
| `idle` | 正常状态,未触发告警 |
| `firing` | 告警触发中 |
| `resolved` | 告警已恢复 |

### 接收 Webhook 示例

使用 Express 接收告警:

```typescript
app.post('/alerts', express.json(), (req, res) => {
  const notification = req.body;
  
  console.log(`告警: ${notification.ruleName}`);
  console.log(`状态: ${notification.state}`);
  console.log(`当前值: ${notification.value}`);
  console.log(`阈值: ${notification.threshold}`);
  
  // 根据严重级别处理
  if (notification.severity === 'critical') {
    // 发送紧急通知
    sendUrgentNotification(notification);
  }
  
  res.status(200).send('OK');
});
```

## 常见告警场景

### 场景一: 服务不可用检测

**需求:** 当服务停止响应时立即告警。

**配置:**

```typescript
{
  id: 'service-down',
  name: '服务不可用告警',
  metricName: 'service.heartbeat',
  conditionType: 'absence',
  windowSeconds: 60,
  severity: 'critical',
  labels: { service: 'api' },
}
```

**处理步骤:**
1. 检查服务进程状态: `systemctl status api`
2. 查看服务日志: `journalctl -u api -n 100`
3. 检查资源使用: `top`, `free -h`
4. 重启服务: `systemctl restart api`
5. 验证服务恢复

### 场景二: 高延迟告警

**需求:** API 响应时间超过阈值时告警。

**配置:**

```typescript
{
  id: 'high-latency',
  name: '高延迟告警',
  metricName: 'api.latency_p99',
  conditionType: 'threshold',
  operator: '>',
  threshold: 1000,  // 1秒
  windowSeconds: 300,
  severity: 'warning',
  labels: { service: 'api' },
}
```

**处理步骤:**
1. 检查慢查询日志
2. 分析数据库性能
3. 检查外部依赖响应时间
4. 查看系统资源使用情况
5. 必要时扩容或优化

### 场景三: 错误率突增

**需求:** 错误率快速上升时告警。

**配置:**

```typescript
{
  id: 'error-spike',
  name: '错误率突增告警',
  metricName: 'api.errors',
  conditionType: 'rate',
  operator: '>',
  threshold: 50,
  windowSeconds: 300,
  severity: 'critical',
  labels: { service: 'api' },
}
```

**处理步骤:**
1. 检查最近的部署变更
2. 查看错误日志定位问题
3. 检查外部服务状态
4. 必要时回滚部署
5. 修复问题后重新部署

### 场景四: 限流触发

**需求:** 触发限流时告警,提示可能需要扩容。

**配置:**

```typescript
{
  id: 'rate-limit-triggered',
  name: '限流触发告警',
  metricName: 'api.rate_limited',
  conditionType: 'threshold',
  operator: '>',
  threshold: 100,  // 每分钟超过100次限流
  windowSeconds: 60,
  severity: 'warning',
  labels: { service: 'api' },
}
```

**处理步骤:**
1. 分析流量来源
2. 检查是否为正常流量增长
3. 评估是否需要调整限流阈值
4. 考虑扩容或优化性能
5. 区分正常流量和异常流量

## 告警状态管理

### 告警生命周期

```
idle ──(触发)──> firing ──(恢复)──> resolved ──(重置)──> idle
```

- **idle**: 正常状态,条件未满足
- **firing**: 告警触发中,持续监控
- **resolved**: 条件不再满足,告警恢复

### 查看告警状态

通过 AlertStore 查询当前状态:

```typescript
// 获取单条规则状态
const state = alertStore.getState('high-error-rate');
console.log(state?.state);  // 'firing' | 'idle' | 'resolved'
console.log(state?.currentValue);  // 当前指标值
console.log(state?.firedAt);  // 触发时间

// 获取所有规则状态
const allStates = alertStore.getAllStates();
```

## 最佳实践

### 1. 合理设置时间窗口

- 短窗口(30-60秒): 快速响应,但可能产生误报
- 中窗口(5-10分钟): 平衡响应速度和准确性
- 长窗口(30分钟+): 稳定告警,适合趋势检测

### 2. 使用标签分类

```typescript
labels: {
  team: 'backend',      // 负责团队
  service: 'api',       // 服务名称
  environment: 'prod',  // 环境
  priority: 'p1',       // 优先级
}
```

### 3. 分级告警

- `critical`: 需要立即处理,影响用户
- `warning`: 需要关注,暂不影响用户
- `info`: 信息性告警,供参考

### 4. 避免告警风暴

- 使用合适的时间窗口
- 设置合理的阈值
- 对相关告警进行聚合

### 5. 完善的告警内容

确保告警包含足够信息:
- 明确的告警名称和描述
- 当前值和阈值的对比
- 相关标签便于定位
- 时间戳用于追溯

## 故障排查

### 告警未触发

**检查项:**
1. 规则是否启用: `rule.enabled === true`
2. 指标是否存在数据
3. 阈值设置是否合理
4. 时间窗口是否合适

### Webhook 发送失败

**检查项:**
1. Webhook URL 是否可访问
2. 网络连接是否正常
3. 接收端是否正常响应
4. 查看服务端日志: `[Alerting] Webhook failed`

### 告警频繁抖动

**解决方案:**
1. 增加时间窗口
2. 调整阈值避免边界值
3. 使用速率告警替代阈值告警

## 相关文档

- [运维手册](../RUNBOOK.md)
- [故障排查](../troubleshooting.md)
