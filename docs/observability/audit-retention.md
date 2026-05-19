# 审计日志保留策略

本文档描述 Agent Platform 的审计日志保留机制、配置选项及合规性要求。

## 概述

审计日志保留策略通过 `RetentionPolicy` 类实现，支持对五类数据实体进行生命周期管理：

| 实体类型 | 说明 | 默认保留期 |
|----------|------|-----------|
| `audit` | 审计记录 | 90 天 |
| `traces` | 分布式追踪数据 | 90 天 |
| `metrics` | 指标数据 | 90 天 |
| `memory` | 长期记忆数据 | 90 天 |
| `blobs` | 工具结果二进制数据 | 90 天 |

## 保留期配置

### 数据库配置表

保留策略通过 `retention_config` 表进行配置：

```sql
CREATE TABLE retention_config (
  config_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,        -- 实体类型
  ttl_days INTEGER NOT NULL,        -- 保留天数
  policy TEXT NOT NULL DEFAULT 'soft_delete',  -- 保留动作
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 保留动作类型

| 动作 | 说明 |
|------|------|
| `soft_delete` | 软删除，标记为已删除但保留元数据 |
| `archive` | 归档，压缩存储以节省空间 |
| `hard_delete` | 硬删除，永久移除数据 |

### 敏感数据保护

具有 `high` 或 `restricted` 敏感级别的记录**不受保留策略影响**，将永久保留：

```typescript
const PROTECTED_SENSITIVITY_LEVELS = ['high', 'restricted'];
```

这确保了敏感操作（如外部写入、权限决策）的完整审计追踪。

## 清理机制

### 手动执行

通过 `RetentionPolicy` 类提供的方法：

```typescript
// 预览模式：仅统计符合条件的记录数
const report = retentionPolicy.dryRun('audit');

// 实际执行：应用保留策略
const result = retentionPolicy.apply('audit');

// 批量执行所有实体类型
const allResults = retentionPolicy.applyAll();
```

### 自动清理流程

1. **计算截止时间**：根据配置的 TTL 天数计算时间戳
2. **筛选候选记录**：排除高敏感级别记录
3. **执行保留动作**：根据配置执行删除或归档
4. **记录审计日志**：每次清理操作都会生成审计记录

### 清理审计

每次保留策略执行后，系统自动生成审计记录：

```typescript
{
  auditId: `retention-${entityType}-${Date.now()}`,
  auditType: 'workflow_change',
  sourceModule: 'system',
  sourceAction: 'retention_policy_apply',
  actionSummary: `Applied ${action} retention for ${entityType}: ${affectedCount} records`,
  riskLevel: 'low',
  sensitivity: 'low'
}
```

## 审计类别与保留建议

根据合规要求，不同审计类型的保留期建议如下：

| 审计类型 | 典型场景 | 建议保留期 | 敏感级别 |
|----------|----------|-----------|----------|
| `user_input` | 用户输入 | 90 天 | low |
| `assistant_output` | 助手响应 | 90 天 | low |
| `tool_call` | 工具调用 | 180 天 | medium |
| `external_write` | 外部写入 | 永久保留 | high |
| `permission_decision` | 权限决策 | 永久保留 | high |
| `approval_request` | 审批请求 | 1 年 | high |
| `approval_response` | 审批响应 | 1 年 | medium |
| `workflow_change` | 工作流变更 | 1 年 | medium |
| `connector_access` | 连接器访问 | 180 天 | high |

## 合规性参考

### 数据保留法规

审计日志保留策略设计参考以下法规要求：

- **GDPR（欧盟通用数据保护条例）**
  - 个人数据处理记录需保留
  - 数据最小化原则：仅保留必要的日志数据
  - 数据主体权利支持：可按用户 ID 查询/删除审计记录

- **SOX（萨班斯法案）**
  - 财务相关审计记录需保留 5 年以上
  - 外部写入操作建议永久保留

- **ISO 27001**
  - 事件日志需保留以支持安全事件调查
  - 日志完整性保护机制

### 实现合规的关键机制

1. **敏感数据脱敏**：自动识别并脱敏密码、密钥、令牌等敏感字段
2. **不可篡改性**：审计记录写入后不支持修改
3. **完整追踪**：通过 `correlationId` 和 `causationId` 支持事件链追踪
4. **访问控制**：审计查询需要适当的权限验证

## 最佳实践

1. **定期清理**：建议每周执行一次 `dryRun` 预览，每月执行一次实际清理
2. **监控告警**：设置存储空间告警，当日志存储接近上限时通知管理员
3. **备份策略**：清理前建议备份即将删除的审计记录
4. **合规审计**：定期审查保留策略是否满足最新法规要求

## 相关文件

- `src/observability/retention-policy.ts` - 保留策略实现
- `src/observability/audit-store.ts` - 审计数据存储
- `src/observability/audit-recorder.ts` - 审计记录器
- `src/observability/audit-types.ts` - 审计类型定义
- `migrations/012_create_retention_config.sql` - 数据库迁移
