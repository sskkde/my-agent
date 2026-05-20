# 生产就绪检查清单

**版本**: v0.7.0-rc.1  
**最后更新**: 2026-05-19

---

## 概述

本检查清单用于验证 v0.7.0-rc.1 是否满足生产部署要求。所有项目必须在生产部署前检查通过。

---

## 1. 安全检查

### 1.1 认证与授权

- [ ] <!-- deployment-time check --> **API Key 认证已配置**
  ```bash
  # 确认至少有一个 API Key 存在
  curl -H "Authorization: Bearer ak_xxx" http://localhost:3003/api/v1/sessions
  ```

- [x] **RBAC 权限配置正确**
  ```bash
  # 运行 RBAC 集成测试
  npx vitest run tests/integration/api/rbac-integration.test.ts
  ```

- [ ] <!-- deployment-time check --> **API_AUTH_TOKEN 已设置**
  ```bash
  # 确认环境变量
  echo $API_AUTH_TOKEN
  ```

### 1.2 安全响应头

- [x] **X-Content-Type-Options 存在**
  ```bash
  curl -I http://localhost:3003/api/v1/health | grep -i "X-Content-Type-Options"
  # 期望: X-Content-Type-Options: nosniff
  ```

- [x] **X-Frame-Options 存在**
  ```bash
  curl -I http://localhost:3003/api/v1/health | grep -i "X-Frame-Options"
  # 期望: X-Frame-Options: DENY
  ```

- [x] **Strict-Transport-Security 存在（HTTPS）**
  ```bash
  curl -I https://api.example.com/api/v1/health | grep -i "Strict-Transport-Security"
  # 期望: Strict-Transport-Security: max-age=31536000; includeSubDomains
  ```

### 1.3 SSRF 防护

- [x] **私有地址访问被阻止**
  ```bash
  npx vitest run tests/unit/tools/web-safety.test.ts
  ```

### 1.4 密钥管理

- [ ] <!-- deployment-time check --> **APP_SECRET_KEY 已设置且安全**
  ```bash
  # 确认长度（应为 64 字符 hex）
  echo -n $APP_SECRET_KEY | wc -c
  # 期望: 64
  ```

- [x] **API Key 以哈希形式存储**
  ```bash
  # 检查数据库中的 api_keys 表
  sqlite3 /data/agent-platform.db "SELECT key_prefix, key_hash FROM api_keys LIMIT 1;"
  # 期望: key_hash 为 SHA-256 哈希值
  ```

### 1.5 安全测试通过

- [x] **所有安全测试通过**
  ```bash
  npx vitest run tests/security/
  # 期望: 所有测试通过
  ```

---

## 2. 性能检查

### 2.1 延迟基线

- [x] **Health 端点延迟 < 200ms**
  ```bash
  # 运行性能测试
  npx vitest run tests/performance/api-latency-smoke.test.ts
  ```

- [x] **Sessions 列表延迟 < 1000ms**

- [x] **Sessions 创建延迟 < 500ms**

- [x] **Tools 列表延迟 < 200ms**

### 2.2 资源限制

- [ ] <!-- deployment-time check --> **内存限制已配置**
  ```bash
  echo $MAX_CACHE_SIZE_MB
  # 期望: 有值（如 256）
  ```

- [ ] <!-- deployment-time check --> **并发限制已配置**
  ```bash
  echo $MAX_CONCURRENT_LLM_CALLS
  # 期望: 有值（如 2）
  ```

### 2.3 数据库性能

- [ ] <!-- deployment-time check --> **数据库大小合理**
  ```bash
  du -h /data/agent-platform.db
  # 建议: < 10GB
  ```

- [ ] <!-- deployment-time check --> **WAL 模式已启用**
  ```bash
  sqlite3 /data/agent-platform.db "PRAGMA journal_mode;"
  # 期望: wal
  ```

---

## 3. 监控检查

### 3.1 健康检查端点

- [ ] <!-- deployment-time check --> **Health 端点可访问**
  ```bash
  curl -f http://localhost:3003/api/v1/health
  # 期望: 200 OK
  ```

- [ ] <!-- deployment-time check --> **Readiness 端点可访问**
  ```bash
  curl -f http://localhost:3003/api/v1/health/ready
  # 期望: 200 OK
  ```

### 3.2 指标导出

- [ ] <!-- deployment-time check --> **Prometheus 指标可访问**
  ```bash
  curl http://localhost:3003/api/v1/metrics
  # 期望: Prometheus 格式指标
  ```

### 3.3 告警配置

- [ ] <!-- deployment-time check --> **告警规则已配置**
  ```bash
  # 检查告警配置
  curl http://localhost:3003/api/v1/observability/alerts/rules
  ```

- [ ] <!-- deployment-time check --> **Webhook 通知已配置（如需要）**

### 3.4 日志聚合

- [ ] <!-- deployment-time check --> **日志级别正确**
  ```bash
  echo $LOG_LEVEL
  # 生产建议: info 或 warn
  ```

- [ ] <!-- deployment-time check --> **日志输出格式正确**
  ```bash
  # 检查日志格式
  docker compose logs api 2>&1 | head -5
  ```

---

## 4. 备份检查

### 4.1 备份配置

- [x] **备份脚本存在**
  ```bash
  ls -la scripts/db-backup.ts
  ```

- [ ] <!-- deployment-time check --> **备份目录存在**
  ```bash
  ls -la /var/backups/agent-platform/
  ```

- [ ] <!-- deployment-time check --> **备份 cron 任务已配置**
  ```bash
  crontab -l | grep backup
  ```

### 4.2 备份验证

- [x] **备份恢复验证通过**
  ```bash
  npx tsx scripts/check-backup-restore.ts
  # 期望: PASS
  ```

- [ ] <!-- deployment-time check --> **最新备份存在且有效**
  ```bash
  ls -la /var/backups/agent-platform/*.gz | tail -1
  # 检查备份时间在 24 小时内
  ```

### 4.3 恢复流程

- [x] **恢复文档已阅读**
  - [docs/backup/restore-operations.md](../backup/restore-operations.md)

- [ ] <!-- deployment-time check --> **恢复流程已测试**

---

## 5. 文档检查

### 5.1 发布文档

- [x] **CHANGELOG 存在**
  ```bash
  ls -la docs/release/CHANGELOG.md
  ```

- [x] **Release Notes 存在**
  ```bash
  ls -la docs/release/RELEASE_NOTES_v0.7.0-rc.1.md
  ```

- [x] **Rollback Runbook 存在**
  ```bash
  ls -la docs/release/ROLLBACK_RUNBOOK.md
  ```

- [x] **Production Readiness Checklist 存在**
  ```bash
  ls -la docs/release/PRODUCTION_READINESS_CHECKLIST.md
  ```

### 5.2 运维文档

- [x] **生产部署指南存在**
  ```bash
  ls -la docs/deployment/production.md
  ```

- [x] **已知限制文档存在**
  ```bash
  ls -la docs/security/known-limitations.md
  ```

### 5.3 API 文档

- [x] **OpenAPI 规范存在**
  ```bash
  ls -la docs/api/openapi.yaml
  ```

- [ ] <!-- deployment-time check --> **Swagger UI 可访问**
  ```bash
  curl -f http://localhost:3003/api/v1/docs
  ```

- [x] **Breaking Change Policy 存在**
  ```bash
  ls -la docs/api/breaking-change-policy.md
  ```

---

## 6. 配置检查

### 6.1 环境变量

- [ ] <!-- deployment-time check --> **NODE_ENV=production**
  ```bash
  echo $NODE_ENV
  # 期望: production
  ```

- [ ] <!-- deployment-time check --> **必要环境变量已设置**
  - [ ] <!-- deployment-time check --> `APP_SECRET_KEY`
  - [ ] <!-- deployment-time check --> `DATABASE_PATH`
  - [ ] <!-- deployment-time check --> `HOST`（如需外部访问）
  - [ ] <!-- deployment-time check --> `PORT`

### 6.2 LLM 提供商

- [ ] <!-- deployment-time check --> **至少一个 LLM 提供商已配置**
  ```bash
  # 检查提供商配置
  curl http://localhost:3003/api/v1/providers
  ```

- [ ] <!-- deployment-time check --> **LLM 连接测试通过**
  ```bash
  # 测试提供商连接
  curl -X POST http://localhost:3003/api/v1/providers/{providerId}/test
  ```

### 6.3 连接器

- [ ] <!-- deployment-time check --> **必要连接器已配置**
  ```bash
  curl http://localhost:3003/api/v1/connectors
  ```

---

## 7. 测试检查

### 7.1 单元测试

- [x] **所有单元测试通过**
  ```bash
  npm run test:unit
  # 期望: 全部通过
  ```

### 7.2 集成测试

- [x] **所有集成测试通过**
  ```bash
  npm run test:integration
  # 期望: 全部通过
  ```

### 7.3 E2E 测试

- [x] **所有 E2E 测试通过**
  ```bash
  npm run test:e2e
  # 期望: 全部通过
  ```

### 7.4 前端测试

- [x] **所有前端测试通过**
  ```bash
  npm --prefix web test
  # 期望: 全部通过
  ```

### 7.5 P7 验证

- [x] **P7 验证脚本通过**
  ```bash
  npm run test:p7
  # 期望: 8/8 检查通过
  ```

---

## 8. 构建检查

### 8.1 类型检查

- [x] **TypeScript 类型检查通过**
  ```bash
  npm run typecheck
  # 期望: 无错误
  ```

### 8.2 Lint 检查

- [x] **ESLint 检查通过（警告可接受）**
  ```bash
  npm run lint
  # 期望: 无错误（警告可接受）
  ```

### 8.3 前端构建

- [x] **前端构建成功**
  ```bash
  npm --prefix web run build
  # 期望: 构建成功
  ```

### 8.4 Docker 构建

- [ ] <!-- deployment-time check --> **Docker 镜像构建成功**
  ```bash
  docker compose build
  # 期望: 构建成功
  ```

---

## 9. 部署检查

### 9.1 Docker 配置

- [ ] <!-- deployment-time check --> **Docker Compose 配置正确**
  ```bash
  docker compose config
  # 期望: 配置有效
  ```

- [ ] <!-- deployment-time check --> **健康检查配置正确**
  ```bash
  grep -A5 "healthcheck:" docker-compose.yml
  ```

### 9.2 服务启动

- [ ] <!-- deployment-time check --> **服务启动成功**
  ```bash
  docker compose up -d
  docker compose ps
  # 期望: 所有服务 running
  ```

- [ ] <!-- deployment-time check --> **服务健康检查通过**
  ```bash
  # 等待 60 秒
  sleep 60
  curl -f http://localhost:3003/api/v1/health
  ```

---

## 10. 已知限制确认

以下限制已知晓并接受：

- [x] **excludedPaths 覆盖几乎所有路由** — 已配置 API_AUTH_TOKEN 作为替代保护
- [x] **CORS origin:true 允许所有来源** — 计划后续版本修复
- [x] **速率限制豁免本地请求** — 开发便利，生产环境需注意
- [x] **Cookie 未设置 Secure 标志** — 计划后续版本修复
- [x] **会话认证不保护大多数端点** — 使用 API Key 认证作为主要保护

---

## 检查结果汇总

| 类别 | 检查项 | 通过 | 失败 | 状态 |
|------|--------|------|------|------|
| 安全 | 10 | 7 | 3 | 部署时检查 |
| 性能 | 8 | 4 | 4 | 部署时检查 |
| 监控 | 7 | 0 | 7 | 部署时检查 |
| 备份 | 7 | 3 | 4 | 部署时检查 |
| 文档 | 9 | 8 | 1 | 部署时检查 |
| 配置 | 9 | 0 | 9 | 部署时检查 |
| 测试 | 5 | 5 | 0 | ✅ 通过 |
| 构建 | 4 | 3 | 1 | 部署时检查 |
| 部署 | 4 | 0 | 4 | 部署时检查 |
| 已知限制 | 5 | 5 | 0 | ✅ 已确认 |
| **总计** | **68** | **35** | **33** | - |

---

## 签署

**检查人**: ________________  
**检查日期**: ________________  
**检查结果**: [ ] 通过 / [ ] 不通过  
**备注**: ________________

---

## 相关文档

- [生产部署指南](../deployment/production.md)
- [回滚操作手册](./ROLLBACK_RUNBOOK.md)
- [已知安全限制](../security/known-limitations.md)
- [发布说明](./RELEASE_NOTES_v0.7.0-rc.1.md)
