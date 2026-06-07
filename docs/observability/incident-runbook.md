# Incident Runbook | 事件运维手册

This runbook covers common incident scenarios and response procedures for Agent Platform GA release.

本手册涵盖 Agent Platform GA 发布的常见事件场景和响应流程。

## Incident Severity Levels | 事件严重级别

| Level | Name     | Description                                           | Response Time |
| ----- | -------- | ----------------------------------------------------- | ------------- |
| P0    | Critical | Service completely unavailable, data loss risk        | < 5 minutes   |
| P1    | High     | Major functionality impaired, significant user impact | < 15 minutes  |
| P2    | Medium   | Minor functionality issues, limited user impact       | < 1 hour      |

| 级别 | 名称 | 描述                             | 响应时间  |
| ---- | ---- | -------------------------------- | --------- |
| P0   | 紧急 | 服务完全不可用，存在数据丢失风险 | < 5 分钟  |
| P1   | 高   | 主要功能受损，影响大量用户       | < 15 分钟 |
| P2   | 中   | 次要功能问题，影响有限用户       | < 1 小时  |

---

## Incident 1: API Unavailable | API 不可用

### Symptoms | 症状

- All API endpoints return 5xx errors or connection refused
- Health endpoint `/api/v1/health` returns non-200 status
- No response from `/api/v1/metrics`
- Users report complete service outage

所有 API 端点返回 5xx 错误或连接被拒绝，健康检查端点返回非 200 状态，用户报告服务完全中断。

### Severity | 严重级别

**P0 - Critical**

### Detection Method | 检测方法

```bash
# Health check
curl -f http://localhost:3003/api/v1/health || echo "API DOWN"

# Prometheus alert
ALERT ApiDown {
  expr: up{job="agent-platform"} == 0
  for: 1m
  severity: critical
}
```

### Immediate Response | 立即响应

1. **Verify the issue** - Check multiple endpoints to confirm scope
2. **Check process status** - `systemctl status agent-platform` or `docker ps`
3. **Review recent changes** - Check deployment history, config changes
4. **Notify stakeholders** - Alert on-call team, update status page

### Investigation Steps | 调查步骤

```bash
# 1. Check process status
systemctl status agent-platform
docker logs agent-platform --tail 100

# 2. Check port binding
netstat -tlnp | grep 3003
lsof -i :3003

# 3. Check system resources
top -n 1
free -h
df -h

# 4. Check recent logs
journalctl -u agent-platform --since "10 minutes ago"
```

### Resolution Steps | 解决步骤

| Scenario        | Action                                       |
| --------------- | -------------------------------------------- |
| Process crashed | `systemctl restart agent-platform`           |
| Port conflict   | Identify and kill conflicting process        |
| Out of memory   | Free memory, add swap, or increase resources |
| Database locked | See Incident 2                               |
| Config error    | Revert config, restart service               |

### Post-Mortem Checklist | 复盘清单

- [ ] Root cause identified
- [ ] Fix documented in knowledge base
- [ ] Monitoring improved to detect earlier
- [ ] Runbook updated if new scenario discovered
- [ ] Customer communication completed

---

## Incident 2: Database Locked | 数据库锁定

### Symptoms | 症状

- API returns `SQLITE_BUSY` or `database is locked` errors
- Write operations hang or timeout
- Read operations may still work
- Error logs show database lock wait timeouts

API 返回 `SQLITE_BUSY` 或 `database is locked` 错误，写操作挂起或超时，日志显示数据库锁等待超时。

### Severity | 严重级别

**P0 - Critical** (if widespread)
**P1 - High** (if intermittent)

### Detection Method | 检测方法

```bash
# Check for SQLITE_BUSY errors in logs
grep -i "SQLITE_BUSY\|database is locked" /var/log/agent-platform/*.log

# Prometheus alert
ALERT DatabaseLocked {
  expr: rate(agent_platform_database_errors{type="locked"}[5m]) > 0
  for: 2m
  severity: critical
}
```

### Immediate Response | 立即响应

1. **Assess scope** - Check if all write operations affected
2. **Check for long transactions** - Identify blocking queries
3. **Consider read-only mode** - Temporarily disable writes if needed
4. **Prepare for restart** - Database may need restart

### Investigation Steps | 调查步骤

```bash
# 1. Check database file
ls -la data/app.db*
sqlite3 data/app.db "PRAGMA busy_timeout;"
sqlite3 data/app.db "PRAGMA journal_mode;"

# 2. Check for long-running transactions
sqlite3 data/app.db "SELECT * FROM sqlite_master WHERE type='table';"

# 3. Check WAL mode status
sqlite3 data/app.db "PRAGMA wal_checkpoint;"
ls -la data/app.db-wal data/app.db-shm

# 4. Monitor lock waits
tail -f /var/log/agent-platform/*.log | grep -i "locked"
```

### Resolution Steps | 解决步骤

| Scenario                      | Action                                           |
| ----------------------------- | ------------------------------------------------ |
| WAL mode not enabled          | `sqlite3 data/app.db "PRAGMA journal_mode=WAL;"` |
| Busy timeout too low          | Increase `busy_timeout` in config                |
| Long transaction holding lock | Identify and terminate the transaction           |
| Corrupted WAL file            | Stop service, delete `.wal` and `.shm`, restart  |
| Persistent lock               | Restart the service                              |

```bash
# Enable WAL mode (recommended)
sqlite3 data/app.db "PRAGMA journal_mode=WAL;"

# Set busy timeout (30 seconds)
sqlite3 data/app.db "PRAGMA busy_timeout=30000;"

# Force checkpoint if WAL too large
sqlite3 data/app.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

### Post-Mortem Checklist | 复盘清单

- [ ] WAL mode confirmed enabled
- [ ] Busy timeout appropriately configured
- [ ] Long transaction source identified
- [ ] Consider PostgreSQL migration for high concurrency

---

## Incident 3: High Error Rate | 高错误率

### Symptoms | 症状

- Error rate exceeds 5% of total requests
- Multiple 5xx responses in logs
- User reports of failed operations
- Alert triggered from `*_errors` metrics

错误率超过总请求的 5%，日志中大量 5xx 响应，用户报告操作失败，告警触发。

### Severity | 严重级别

**P0 - Critical** (> 10% error rate)
**P1 - High** (5-10% error rate)
**P2 - Medium** (< 5% error rate)

### Detection Method | 检测方法

```bash
# Check error rate from metrics
curl -s http://localhost:3003/api/v1/metrics | grep errors

# Prometheus alert
ALERT HighErrorRate {
  expr: |
    sum(rate(agent_platform_request_duration_seconds_count{status="failed"}[5m]))
    / sum(rate(agent_platform_request_duration_seconds_count[5m])) > 0.05
  for: 2m
  severity: critical
}
```

### Immediate Response | 立即响应

1. **Check recent deployments** - Identify if linked to recent changes
2. **Review error logs** - Categorize error types
3. **Check external dependencies** - LLM providers, connectors
4. **Consider rollback** - If error spike correlates with deployment

### Investigation Steps | 调查步骤

```bash
# 1. Check error distribution by type
tail -1000 /var/log/agent-platform/*.log | grep -i "error" | sort | uniq -c | sort -rn

# 2. Check for specific error patterns
grep -i "ECONNREFUSED\|ETIMEDOUT\|ENOTFOUND" /var/log/agent-platform/*.log

# 3. Check LLM provider status
curl -s https://status.openrouter.ai/api/v2/status.json

# 4. Check connector health
curl -s http://localhost:3003/api/v1/connectors | jq '.[] | {id, status}'
```

### Resolution Steps | 解决步骤

| Error Type          | Action                                          |
| ------------------- | ----------------------------------------------- |
| LLM provider errors | Check provider status, enable fallback provider |
| Database errors     | See Incident 2                                  |
| Network errors      | Check firewall, DNS, connectivity               |
| Validation errors   | Review recent input changes                     |
| Timeout errors      | Increase timeout, optimize queries              |

```bash
# Enable fallback provider
curl -X PATCH http://localhost:3003/api/v1/agents/foreground.default/config \
  -H "Content-Type: application/json" \
  -d '{"providerId": "fallback-provider"}'
```

### Post-Mortem Checklist | 复盘清单

- [ ] Error root cause identified
- [ ] Error categorization documented
- [ ] Monitoring thresholds adjusted if needed
- [ ] Runbook updated for similar patterns

---

## Incident 4: High Latency | 高延迟

### Symptoms | 症状

- P95 latency exceeds 5 seconds
- P99 latency exceeds 10 seconds
- Users report slow response times
- Request queue buildup

P95 延迟超过 5 秒，P99 延迟超过 10 秒，用户报告响应缓慢，请求队列积压。

### Severity | 严重级别

**P1 - High** (P95 > 5s)
**P2 - Medium** (P95 > 2s)

### Detection Method | 检测方法

```bash
# Check latency metrics
curl -s http://localhost:3003/api/v1/metrics | grep duration_seconds

# Prometheus alert
ALERT HighLatency {
  expr: |
    histogram_quantile(0.95,
      sum(rate(agent_platform_request_duration_seconds_bucket[5m])) by (le)
    ) > 5
  for: 5m
  severity: warning
}
```

### Immediate Response | 立即响应

1. **Identify slow operations** - Check which endpoints are slow
2. **Check system resources** - CPU, memory, disk I/O
3. **Check database performance** - Query execution time
4. **Check external dependencies** - LLM provider latency

### Investigation Steps | 调查步骤

```bash
# 1. Check slow operations from metrics
curl -s http://localhost:3003/api/v1/metrics | grep "_duration_ms" | sort -t' ' -k2 -rn | head -20

# 2. Check system resources
top -n 1 | head -20
iostat -x 1 3

# 3. Check database query performance
sqlite3 data/app.db "EXPLAIN QUERY PLAN SELECT * FROM sessions WHERE user_id = 'test';"

# 4. Check for blocking operations
tail -f /var/log/agent-platform/*.log | grep -i "slow\|timeout"
```

### Resolution Steps | 解决步骤

| Cause                 | Action                               |
| --------------------- | ------------------------------------ |
| Slow LLM responses    | Reduce prompt size, use faster model |
| Database slow queries | Add indexes, optimize queries        |
| Memory pressure       | Free memory, add resources           |
| High CPU usage        | Scale horizontally, optimize code    |
| Network latency       | Check network path, use CDN          |

```bash
# Check for missing indexes
sqlite3 data/app.db "EXPLAIN QUERY PLAN SELECT * FROM sessions WHERE user_id = 'test';"

# Add index if needed
sqlite3 data/app.db "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);"
```

### Post-Mortem Checklist | 复盘清单

- [ ] Bottleneck identified
- [ ] Performance improvement plan documented
- [ ] SLA thresholds reviewed
- [ ] Load testing scheduled

---

## Incident 5: Connector Outage | 连接器故障

### Symptoms | 症状

- Specific connector returns errors consistently
- OAuth token refresh failures
- External API returns 5xx or rate limit errors
- Users cannot access connector functionality

特定连接器持续返回错误，OAuth 令牌刷新失败，外部 API 返回 5xx 或限流错误，用户无法使用连接器功能。

### Severity | 严重级别

**P1 - High** (critical connector like GitHub)
**P2 - Medium** (non-critical connector)

### Detection Method | 检测方法

```bash
# Check connector metrics
curl -s http://localhost:3003/api/v1/metrics | grep connector_requests

# Prometheus alert
ALERT ConnectorOutage {
  expr: |
    sum by (connectorId) (
      rate(agent_platform_connector_requests_total{status="failed"}[5m])
    ) / sum by (connectorId) (
      rate(agent_platform_connector_requests_total[5m])
    ) > 0.1
  for: 5m
  severity: warning
}
```

### Immediate Response | 立即响应

1. **Identify affected connector** - Check which connector is failing
2. **Check provider status** - External service status page
3. **Check OAuth tokens** - Token may need refresh
4. **Notify users** - If widespread, post status update

### Investigation Steps | 调查步骤

```bash
# 1. Check connector instance status
curl -s http://localhost:3003/api/v1/connectors | jq '.[] | select(.status == "error")'

# 2. Check OAuth token status
curl -s http://localhost:3003/api/v1/connectors/{connectorId}/auth | jq '.tokenStatus'

# 3. Test connector directly
curl -s https://api.github.com/zen

# 4. Check rate limits
curl -s -I https://api.github.com/user | grep -i "x-ratelimit"
```

### Resolution Steps | 解决步骤

| Issue                | Action                                       |
| -------------------- | -------------------------------------------- |
| OAuth token expired  | Re-authenticate through UI or API            |
| Rate limited         | Wait for reset, or use different credentials |
| API endpoint changed | Update connector configuration               |
| Service down         | Wait for provider recovery, notify users     |
| Credentials invalid  | Re-configure connector credentials           |

```bash
# Re-authenticate connector
curl -X POST http://localhost:3003/api/v1/connectors/{connectorId}/auth/refresh

# Disable failing connector temporarily
curl -X PATCH http://localhost:3003/api/v1/connectors/{connectorId} \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

### Post-Mortem Checklist | 复盘清单

- [ ] Root cause identified
- [ ] Token refresh mechanism reviewed
- [ ] Fallback mechanism considered
- [ ] Provider SLA documented

---

## Incident 6: DLQ Backlog | 死信队列积压

### Symptoms | 症状

- DLQ size exceeds threshold
- Events stuck in failed state
- Alert triggered from DLQ metrics
- Trigger executions delayed or missing

DLQ 大小超过阈值，事件卡在失败状态，告警触发，触发器执行延迟或丢失。

### Severity | 严重级别

**P1 - High** (> 1000 events)
**P2 - Medium** (100-1000 events)

### Detection Method | 检测方法

```bash
# Check DLQ size
curl -s http://localhost:3003/api/v1/dlq | jq 'length'

# Prometheus alert
ALERT DLQBacklog {
  expr: agent_platform_dlq_size > 100
  for: 10m
  severity: warning
}
```

### Immediate Response | 立即响应

1. **Assess DLQ contents** - What events are failing
2. **Check for patterns** - Same error type recurring
3. **Determine if retry safe** - Events may be retried if transient
4. **Consider manual intervention** - Some events may need fixing

### Investigation Steps | 调查步骤

```bash
# 1. List DLQ events
curl -s http://localhost:3003/api/v1/dlq | jq '.[] | {id, error, timestamp}'

# 2. Check error patterns
curl -s http://localhost:3003/api/v1/dlq | jq -r '.[].error' | sort | uniq -c | sort -rn

# 3. Check specific event details
curl -s http://localhost:3003/api/v1/dlq/{eventId} | jq '.'

# 4. Check related system logs
grep -i "dlq\|dead letter" /var/log/agent-platform/*.log | tail -50
```

### Resolution Steps | 解决步骤

| Action             | Command                                                         |
| ------------------ | --------------------------------------------------------------- |
| Retry single event | `curl -X POST http://localhost:3003/api/v1/dlq/{eventId}/retry` |
| Retry all events   | `curl -X POST http://localhost:3003/api/v1/dlq/retry-all`       |
| Discard event      | `curl -X DELETE http://localhost:3003/api/v1/dlq/{eventId}`     |
| Fix and retry      | Modify event payload, then retry                                |

```bash
# Bulk retry with filtering
curl -s http://localhost:3003/api/v1/dlq | jq -r '.[] | select(.error | contains("timeout")) | .id' | \
  xargs -I {} curl -X POST http://localhost:3003/api/v1/dlq/{}/retry
```

### Post-Mortem Checklist | 复盘清单

- [ ] Failure pattern identified
- [ ] Retry logic reviewed
- [ ] Downstream service issues addressed
- [ ] DLQ size monitoring improved

---

## Incident 7: Memory Budget Exceeded | 内存预算超限

### Symptoms | 症状

- Users get "Budget exceeded" errors
- API requests rejected with 429 status
- Budget usage at 100%
- Token or request count limits reached

用户收到"预算超限"错误，API 请求被 429 状态拒绝，预算使用率 100%，令牌或请求计数达到限制。

### Severity | 严重级别

**P1 - High** (budget exhausted for multiple users)
**P2 - Medium** (single user budget exhausted)

### Detection Method | 检测方法

```bash
# Check budget usage
curl -s http://localhost:3003/api/v1/metrics | grep budget_usage

# Prometheus alert
ALERT BudgetExceeded {
  expr: agent_platform_budget_usage_percent > 90
  for: 5m
  severity: warning
}
```

### Immediate Response | 立即响应

1. **Identify affected users** - Who hit budget limits
2. **Check budget configuration** - Current limits and periods
3. **Determine if legitimate or abuse** - Traffic patterns
4. **Consider temporary increase** - If business-critical

### Investigation Steps | 调查步骤

```bash
# 1. Check budget metrics by user
curl -s http://localhost:3003/api/v1/admin/budgets | jq '.[] | select(.usage > 80)'

# 2. Check user activity
curl -s http://localhost:3003/api/v1/admin/users/{userId}/activity | jq '.recentRequests'

# 3. Check budget configuration
curl -s http://localhost:3003/api/v1/admin/budgets/config | jq '.'

# 4. Check for abuse patterns
grep -i "budget\|rate limit" /var/log/agent-platform/*.log | tail -100
```

### Resolution Steps | 解决步骤

| Scenario                  | Action                           |
| ------------------------- | -------------------------------- |
| Legitimate usage increase | Increase budget limit            |
| Budget period reset due   | Wait for reset or manually reset |
| Abuse detected            | Suspend user, review activity    |
| Configuration error       | Fix budget settings              |

```bash
# Increase user budget
curl -X PATCH http://localhost:3003/api/v1/admin/users/{userId}/budget \
  -H "Content-Type: application/json" \
  -d '{"tokenLimit": 1000000, "requestLimit": 10000}'

# Reset budget (if needed)
curl -X POST http://localhost:3003/api/v1/admin/users/{userId}/budget/reset
```

### Post-Mortem Checklist | 复盘清单

- [ ] Usage pattern analyzed
- [ ] Budget limits reviewed
- [ ] Abuse detection improved
- [ ] User communication completed

---

## Incident 8: Backup Failed | 备份失败

### Symptoms | 症状

- Backup job returns error
- No recent backup files
- Backup monitoring alert triggered
- Scheduled backup did not complete

备份任务返回错误，没有最近的备份文件，备份监控告警触发，计划备份未完成。

### Severity | 严重级别

**P1 - High** (if data at risk)
**P2 - Medium** (backup delayed)

### Detection Method | 检测方法

```bash
# Check backup status
ls -la backups/
cat backups/backup.log

# Prometheus alert
ALERT BackupFailed {
  expr: agent_platform_backup_status{status="failed"} == 1
  for: 1m
  severity: warning
}
```

### Immediate Response | 立即响应

1. **Check disk space** - Backup destination may be full
2. **Check database status** - Database may be locked or corrupted
3. **Review backup logs** - Identify specific error
4. **Consider manual backup** - Run backup manually if needed

### Investigation Steps | 调查步骤

```bash
# 1. Check backup directory
ls -la backups/
df -h backups/

# 2. Check backup logs
tail -100 backups/backup.log

# 3. Test backup command manually
npm run db:backup

# 4. Check database integrity
sqlite3 data/app.db "PRAGMA integrity_check;"
```

### Resolution Steps | 解决步骤

| Issue              | Action                               |
| ------------------ | ------------------------------------ |
| Disk full          | Free space or change backup location |
| Database locked    | See Incident 2                       |
| Permission denied  | Fix file permissions                 |
| Database corrupted | Restore from last good backup        |

```bash
# Manual backup
npm run db:backup

# Verify backup integrity
sqlite3 backups/backup-$(date +%Y%m%d).db "PRAGMA integrity_check;"

# Rotate old backups (keep last 7)
find backups/ -name "*.db" -mtime +7 -delete
```

### Post-Mortem Checklist | 复盘清单

- [ ] Backup failure root cause identified
- [ ] Backup schedule verified
- [ ] Retention policy reviewed
- [ ] Backup monitoring improved

---

## Incident 9: Suspected Key Leak | 疑似密钥泄露

### Symptoms | 症状

- API key found in logs or error messages
- Unusual authentication patterns
- Unknown sessions or API key usage
- Security audit findings

日志或错误消息中发现 API 密钥，异常认证模式，未知会话或 API 密钥使用，安全审计发现。

### Severity | 严重级别

**P0 - Critical** (confirmed leak)
**P1 - High** (suspected leak)

### Detection Method | 检测方法

```bash
# Search for key patterns in logs
grep -r "sk-\|ak_\|api_key\|secret" /var/log/agent-platform/*.log

# Check for exposed keys in responses
curl -s http://localhost:3003/api/v1/admin/audit | jq '.[] | select(.action | contains("key_exposed"))'
```

### Immediate Response | 立即响应

1. **Identify scope** - Which keys are exposed
2. **Revoke affected keys** - Immediately invalidate
3. **Notify affected users** - Force re-authentication
4. **Document incident** - For security review

### Investigation Steps | 调查步骤

```bash
# 1. Find exposed key references
grep -r "ak_live_\|ak_test_" /var/log/agent-platform/*.log | tail -50

# 2. Check key usage patterns
curl -s http://localhost:3003/api/v1/admin/api-keys | jq '.[] | select(.lastUsed > "2024-01-01")'

# 3. Check authentication logs
grep -i "auth\|api.*key" /var/log/agent-platform/*.log | tail -100

# 4. Review recent access patterns
curl -s http://localhost:3003/api/v1/admin/security/audit | jq '.recentEvents'
```

### Resolution Steps | 解决步骤

| Action               | Command                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| Revoke API key       | `curl -X DELETE http://localhost:3003/api/v1/api-keys/{keyId}`               |
| Revoke all user keys | `curl -X DELETE http://localhost:3003/api/v1/admin/users/{userId}/api-keys`  |
| Force password reset | `curl -X POST http://localhost:3003/api/v1/admin/users/{userId}/force-reset` |
| Invalidate sessions  | `curl -X DELETE http://localhost:3003/api/v1/admin/users/{userId}/sessions`  |

```bash
# Revoke compromised key immediately
curl -X DELETE http://localhost:3003/api/v1/api-keys/{keyId}

# Generate new key for user
curl -X POST http://localhost:3003/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "Replacement key", "role": "user"}'
```

### Post-Mortem Checklist | 复盘清单

- [ ] All affected keys revoked
- [ ] Users notified and re-authenticated
- [ ] Leak source identified
- [ ] Secret redaction verified
- [ ] Security incident report filed

---

## Incident 10: Rollback Decision | 回滚决策

### Symptoms | 症状

- Critical bug in production
- Performance regression after deployment
- Feature causing user impact
- Deployment correlated with incidents

生产环境存在严重缺陷，部署后性能退化，功能导致用户影响，部署与事件相关联。

### Severity | 严重级别

**P0 - Critical** (immediate rollback needed)
**P1 - High** (rollback within 1 hour)

### Decision Criteria | 决策标准

| Criteria                 | Rollback?             |
| ------------------------ | --------------------- |
| User data loss           | Yes - Immediate       |
| Security vulnerability   | Yes - Immediate       |
| Service unavailable      | Yes - Immediate       |
| Performance 2x worse     | Yes - Within 1 hour   |
| Feature partially broken | Consider hotfix first |
| Minor bugs               | No - Hotfix           |

### Detection Method | 检测方法

```bash
# Check deployment history
git log --oneline -10
docker images | grep agent-platform

# Compare metrics before/after
curl -s http://localhost:3003/api/v1/metrics | grep -E "request_total|errors"
```

### Immediate Response | 立即响应

1. **Confirm the issue** - Verify deployment is the cause
2. **Assess impact** - How many users affected
3. **Notify stakeholders** - Communicate rollback plan
4. **Execute rollback** - Follow rollback procedure

### Investigation Steps | 调查步骤

```bash
# 1. Check current version
curl -s http://localhost:3003/api/v1/health | jq '.version'

# 2. Check deployment timeline
kubectl rollout history deployment/agent-platform

# 3. Compare metrics before/after deployment
# Use Grafana or Prometheus to compare time ranges

# 4. Identify problematic change
git diff HEAD~1 HEAD
```

### Resolution Steps | 解决步骤

```bash
# Docker Compose rollback
docker compose down
docker compose up -d --build previous-version-tag

# Kubernetes rollback
kubectl rollout undo deployment/agent-platform

# Manual rollback
git checkout HEAD~1
npm install
npm run build
npm run start:api

# Verify rollback
curl -s http://localhost:3003/api/v1/health | jq '.version'
```

### Post-Rollback Verification | 回滚后验证

| Check             | Command                                    |
| ----------------- | ------------------------------------------ |
| Health check      | `curl http://localhost:3003/api/v1/health` |
| Error rate        | Check Grafana for error rate drop          |
| Latency           | Check P95/P99 latency recovery             |
| User confirmation | Test critical user flows                   |

### Post-Mortem Checklist | 复盘清单

- [ ] Rollback executed successfully
- [ ] Service confirmed stable
- [ ] Root cause of issue identified
- [ ] Fix prepared in development
- [ ] Deployment process reviewed
- [ ] Monitoring gaps addressed

---

## Quick Reference | 快速参考

### Health Check Commands | 健康检查命令

```bash
# API health
curl -f http://localhost:3003/api/v1/health

# Readiness check
curl -f http://localhost:3003/api/v1/health/ready

# Database health
npm run db:health

# Metrics
curl http://localhost:3003/api/v1/metrics
```

### Key Log Locations | 关键日志位置

| Log         | Path                                 |
| ----------- | ------------------------------------ |
| Application | `/var/log/agent-platform/app.log`    |
| Access      | `/var/log/agent-platform/access.log` |
| Error       | `/var/log/agent-platform/error.log`  |
| Audit       | `/var/log/agent-platform/audit.log`  |

### Key Files | 关键文件

| File          | Purpose                   |
| ------------- | ------------------------- |
| `data/app.db` | SQLite database           |
| `backups/`    | Database backups          |
| `.env`        | Environment configuration |
| `migrations/` | Database migrations       |

### Contact Escalation | 联系升级

| Level | Contact             | Response   |
| ----- | ------------------- | ---------- |
| L1    | On-call engineer    | 5 minutes  |
| L2    | Team lead           | 15 minutes |
| L3    | Engineering manager | 30 minutes |
| L4    | VP Engineering      | 1 hour     |

---

## Related Documentation | 相关文档

- [Alerting Runbook](./alerting-runbook.md)
- [Metrics Documentation](./metrics.md)
- [Rollback Runbook](../release/ROLLBACK_RUNBOOK.md)
- [Main Runbook](../RUNBOOK.md)
