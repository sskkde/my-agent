# 回滚操作手册

**版本**: v0.7.0-rc.1  
**最后更新**: 2026-05-19

---

## 概述

本文档提供从 v0.7.0-rc.1 回滚到 v0.6.0 的详细步骤。回滚操作应在以下情况执行：

- 新版本发现严重安全漏洞
- 关键功能无法正常工作
- 性能严重退化
- 数据兼容性问题

---

## 回滚前准备

### 1. 评估回滚必要性

在执行回滚前，确认：

- [ ] 问题无法通过热修复解决
- [ ] 问题影响生产环境关键功能
- [ ] 回滚风险已评估（数据兼容性、配置变更等）

### 2. 通知相关方

- 通知运维团队即将执行回滚
- 通知用户服务将短暂中断
- 准备回滚公告

### 3. 确认备份存在

```bash
# 检查备份文件
ls -la /var/backups/agent-platform/

# 确认备份时间
stat /var/backups/agent-platform/agent-platform-*.db.gz
```

**要求**: 必须有升级前的数据库备份。

---

## 回滚步骤

### 方式一：Docker 部署回滚

#### 步骤 1：停止当前服务

```bash
docker compose down
```

#### 步骤 2：恢复数据库备份

```bash
# 停止服务后恢复
gunzip -c /var/backups/agent-platform/agent-platform-YYYYMMDD.db.gz > /data/agent-platform.db

# 或使用备份脚本
./scripts/restore-backup.sh YYYYMMDD
```

#### 步骤 3：切换到旧版本

```bash
git fetch --tags
git checkout v0.6.0
```

#### 步骤 4：重建并启动

```bash
# 清理旧镜像
docker compose down --rmi local

# 重建
docker compose build

# 启动
docker compose up -d
```

#### 步骤 5：验证服务

```bash
# 等待服务就绪（最多 60 秒）
sleep 30

# 健康检查
curl -f http://localhost:3003/api/v1/health || echo "Health check failed"

# 版本确认
curl -s http://localhost:3003/api/v1/docs | grep -o "0.6.0" || echo "Version mismatch"
```

---

### 方式二：直接部署回滚

#### 步骤 1：停止服务

```bash
systemctl stop agent-platform
# 或
pm2 stop agent-platform
```

#### 步骤 2：恢复数据库

```bash
# 备份当前数据库（以防需要恢复）
cp /data/agent-platform.db /data/agent-platform.db.failed

# 恢复备份
gunzip -c /var/backups/agent-platform/agent-platform-YYYYMMDD.db.gz > /data/agent-platform.db
```

#### 步骤 3：切换代码版本

```bash
git fetch --tags
git checkout v0.6.0
```

#### 步骤 4：安装依赖

```bash
npm install
npm --prefix web install
```

#### 步骤 5：启动服务

```bash
systemctl start agent-platform
# 或
pm2 start agent-platform
```

#### 步骤 6：验证

```bash
curl -f http://localhost:3003/api/v1/health
```

---

## 验证步骤

### 1. 服务健康检查

```bash
# API 健康检查
curl -f http://localhost:3003/api/v1/health

# Web 健康检查
curl -f http://localhost:3002/

# 详细健康检查
curl http://localhost:3003/api/v1/health/ready
```

### 2. 版本确认

```bash
# 检查 package.json 版本
grep '"version"' package.json

# 检查 API 版本
curl -s http://localhost:3003/api/v1/docs | grep -o '"version":"[^"]*"'
```

### 3. 数据完整性验证

```bash
# 运行完整性检查脚本
npx tsx scripts/check-backup-restore.ts

# 或手动检查
sqlite3 /data/agent-platform.db "PRAGMA integrity_check;"
sqlite3 /data/agent-platform.db "SELECT COUNT(*) FROM sessions;"
```

### 4. 功能验证

```bash
# 创建测试会话
curl -X POST http://localhost:3003/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"userId":"rollback-test"}'

# 查询会话列表
curl http://localhost:3003/api/v1/sessions
```

### 5. 安全验证

```bash
# 确认安全头存在（v0.6.0 可能没有）
curl -I http://localhost:3003/api/v1/health | grep -E "X-Frame-Options|X-Content-Type-Options"
```

---

## 回滚后操作

### 1. 清理失败版本资源

```bash
# 清理 Docker 镜像
docker image prune -f

# 清理临时文件
rm -f /data/agent-platform.db.failed
```

### 2. 更新监控和告警

```bash
# 确认监控正常
curl http://localhost:3003/api/v1/metrics

# 确认告警规则生效
# （根据实际监控系统配置）
```

### 3. 记录回滚事件

创建回滚记录：

```markdown
## 回滚记录

- **时间**: YYYY-MM-DD HH:MM:SS
- **从版本**: v0.7.0-rc.1
- **到版本**: v0.6.0
- **原因**: [问题描述]
- **执行人**: [姓名]
- **验证结果**: [通过/失败]
- **备注**: [其他说明]
```

### 4. 通知相关方

- 通知运维团队回滚完成
- 通知用户服务已恢复
- 发布回滚公告

---

## 故障排除

### 问题 1：数据库恢复失败

**症状**:
```
Error: unable to open database file
```

**解决**:
```bash
# 检查文件权限
ls -la /data/agent-platform.db

# 修复权限
chown agent-platform:agent-platform /data/agent-platform.db
chmod 644 /data/agent-platform.db
```

---

### 问题 2：服务启动失败

**症状**:
```
Error: Cannot find module 'xxx'
```

**解决**:
```bash
# 清理 node_modules 重新安装
rm -rf node_modules
rm -rf web/node_modules
npm install
npm --prefix web install
```

---

### 问题 3：迁移版本不匹配

**症状**:
```
Migration version mismatch: expected 50, got 45
```

**解决**:
```bash
# 确认使用正确的备份
# v0.6.0 数据库迁移版本应为 45
# v0.7.0-rc.1 数据库迁移版本应为 50

# 如果备份版本不对，寻找正确的备份
ls -la /var/backups/agent-platform/
```

---

### 问题 4：Docker 构建失败

**症状**:
```
ERROR: failed to solve: process "/bin/sh -c npm ci" did not complete successfully
```

**解决**:
```bash
# 清理 Docker 缓存
docker system prune -f

# 重新构建
docker compose build --no-cache
```

---

### 问题 5：健康检查超时

**症状**:
```
curl: (28) Operation timed out
```

**解决**:
```bash
# 检查服务日志
docker compose logs api
# 或
journalctl -u agent-platform -f

# 检查端口占用
netstat -tlnp | grep 3003

# 检查进程状态
ps aux | grep node
```

---

## 紧急回滚流程

当生产环境出现严重问题时，执行快速回滚：

```bash
#!/bin/bash
# emergency-rollback.sh

set -e

echo "[1/5] Stopping services..."
docker compose down

echo "[2/5] Restoring database..."
gunzip -c /var/backups/agent-platform/agent-platform-latest.db.gz > /data/agent-platform.db

echo "[3/5] Switching version..."
git checkout v0.6.0

echo "[4/5] Rebuilding..."
docker compose build --no-cache
docker compose up -d

echo "[5/5] Verifying..."
sleep 30
curl -f http://localhost:3003/api/v1/health && echo "Rollback successful!" || echo "Rollback failed!"
```

---

## 回滚决策矩阵

| 问题类型 | 严重程度 | 是否回滚 | 备注 |
|----------|----------|----------|------|
| 安全漏洞 | 高 | 是 | 立即回滚 |
| 数据丢失 | 高 | 是 | 先恢复数据再评估 |
| 服务不可用 | 高 | 是 | 检查是否可快速修复 |
| 性能退化 | 中 | 评估 | 先尝试调优 |
| 功能缺陷 | 低 | 否 | 优先热修复 |
| UI 问题 | 低 | 否 | 优先热修复 |

---

## 相关文档

- [生产部署指南](../deployment/production.md)
- [备份恢复操作](../backup/restore-operations.md)
- [已知安全限制](../security/known-limitations.md)
